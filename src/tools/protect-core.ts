/**
 * حماية ملف PDF بكلمة مرور: AES-256 (‏V5/R6)، وكلمة المالك هي كلمة الفتح نفسها.
 * منطق بلا واجهة: يعيد نتيجة أو رمز خطأ، والشاشة تربط الرمز بنصّه.
 * `@cantoo/pdf-lib` تُحمَّل عند الطلب، فلا تدخل حزمة أول فتح. وكلها JavaScript خالصة (لا WebAssembly).
 */
import { toLatinDigits } from "../numerals";
import { checkInput, hasSignature } from "./pdf-checks";
import type { PDFDict as Dict, PDFName as Name, PDFObject } from "@cantoo/pdf-lib";

export type PasswordError = "too-short" | "bad-chars";
export type ProtectError = PasswordError | "too-big" | "bad-pdf" | "already-encrypted" | "pdfa" | "failed";
/** `signed`: في الملف توقيع رقمي، والحماية تعيد كتابته فيبطل التوقيع. */
export type ProtectResult = { ok: true; bytes: Uint8Array; signed: boolean } | { ok: false; error: ProtectError };

export const MIN_PASSWORD_LENGTH = 6;

type Lib = typeof import("@cantoo/pdf-lib");
type Doc = Awaited<ReturnType<Lib["PDFDocument"]["load"]>>;

/**
 * الأرقام الهندية والفارسية تصير إنجليزية، ولا يُقبل إلا الأحرف والأرقام الإنجليزية والرموز (U+0021–U+007E).
 * فالحرف العربي تختلف العارضات في ترميزه فينغلق الملف على صاحبه، والمسافة لا تُرى في آخر الكلمة.
 */
export function normalizePassword(raw: string): { ok: true; password: string } | { ok: false; error: PasswordError } {
  const password = toLatinDigits(raw);
  if (!/^[\x21-\x7e]*$/.test(password)) return { ok: false, error: "bad-chars" };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "too-short" };
  return { ok: true, password };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * المكتبة لا تشفّر إلا محتوى التدفّقات (PDFWriter.js:205)، والكائنات التي تكتبها خارج تدفّق الكائنات
 * (الشرط في PDFStreamWriter.js:66) تبقى سلاسلها مكشوفة: /Lang في الفهرس، ونص التعليق في الصفحة،
 * و/Name و/Reason في التوقيع، وما في الكائنات ذات الجيل غير الصفر وقواميس التدفّقات.
 * فيُشفَّر هنا كل سلسلة فيها بمفتاح كائنها، كما يشترط المعيار (7.6.2)، وتُكتب ست عشرية.
 * ولا تُلمس: قاموس /Encrypt، و/Contents في قاموس التوقيع (المعيار يستثنيه)، وجدولا XRef وObjStm القديمان (لا يُكتبان).
 * وقاموس التوقيع هنا كائن مستقل فيه /ByteRange ونوعه /Sig أو /DocTimeStamp، لا قاموس متداخل في غيره:
 * فقاموسٌ يُسمّي نفسه /Sig داخل تعليق أو في الفهرس ليس توقيعاً، ونصّه يُشفَّر.
 * وما يُضغط في تدفّق الكائنات يُشفَّر مع التدفّق كله، وسلاسله لا تُشفَّر وحدها، فلا يُلمس.
 * يعيد false إن وُجد كائن غير صالح: يُكتب كما قُرئ، فلا يُعرف ما فيه.
 */
function encryptLooseStrings(lib: Lib, doc: Doc): boolean {
  const { PDFArray, PDFCatalog, PDFDict, PDFHexString, PDFInvalidObject, PDFName, PDFPageLeaf, PDFPageTree, PDFStream, PDFString } = lib;
  const ctx = doc.context;
  const security = ctx.security!;
  const [Type, Sig, DocTimeStamp, Contents, ByteRange, XRef, ObjStm] = ["Type", "Sig", "DocTimeStamp", "Contents", "ByteRange", "XRef", "ObjStm"].map((s) => PDFName.of(s)) as [Name, Name, Name, Name, Name, Name, Name];

  for (const [ref, object] of ctx.enumerateIndirectObjects()) {
    if (object instanceof PDFInvalidObject) return false;
    if (ref === ctx.trailerInfo.Encrypt) continue;
    const type = object instanceof PDFStream ? object.dict.lookup(Type) : object instanceof PDFDict ? object.lookup(Type) : undefined;
    const loose = object instanceof PDFStream || object instanceof PDFCatalog || object instanceof PDFPageTree || object instanceof PDFPageLeaf ||
      ref.generationNumber !== 0 || (object instanceof PDFDict && type === Sig);
    if (!loose || (object instanceof PDFStream && (type === XRef || type === ObjStm))) continue;

    const encrypt = security.getEncryptFn(ref.objectNumber, ref.generationNumber);
    // المتداخل يُنسخ ولا يُعدَّل في مكانه، فقد يشاركه كائن آخر فيُشفَّر مرتين
    const seal = (value: PDFObject): PDFObject => {
      if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(hex(encrypt(value.asBytes())));
      if (value instanceof PDFArray) {
        const out = PDFArray.withContext(ctx);
        for (let i = 0; i < value.size(); i++) out.push(seal(value.get(i)));
        return out;
      }
      if (value instanceof PDFDict) return sealEntries(value, PDFDict.withContext(ctx), false);
      return value;
    };
    const sealEntries = (from: Dict, into: Dict, keepContents: boolean): Dict => {
      for (const [key, value] of from.entries()) into.set(key, keepContents && key === Contents ? value : seal(value));
      return into;
    };

    // الكائن في أعلاه يبقى بصنفه (الفهرس والصفحات)، فتُعدَّل مداخله في مكانها
    if (object instanceof PDFStream) sealEntries(object.dict, object.dict, false);
    else if (object instanceof PDFDict) sealEntries(object, object, (type === Sig || type === DocTimeStamp) && object.has(ByteRange));
    else ctx.assign(ref, seal(object));
  }
  return true;
}

export async function protectPdf(bytes: Uint8Array, rawPassword: string): Promise<ProtectResult> {
  const checked = normalizePassword(rawPassword);
  if (!checked.ok) return checked;
  const { password } = checked;
  const input = checkInput(bytes);
  if (input) return { ok: false, error: input };

  let lib: Lib;
  try {
    lib = await import("@cantoo/pdf-lib");
  } catch {
    return { ok: false, error: "failed" }; // انقطعت الشبكة قبل أن تصل القطعة
  }
  const { PDFDocument, EncryptedPDFError, PDFDict, PDFName } = lib;
  let doc: Doc;
  try {
    // updateMetadata:false فلا يتغيّر Producer ولا التواريخ، وpreserveXFA فلا تُفقد نماذج XFA
    doc = await PDFDocument.load(bytes, { updateMetadata: false, preserveXFA: true });
  } catch (e) {
    return { ok: false, error: e instanceof EncryptedPDFError ? "already-encrypted" : "bad-pdf" };
  }
  const signed = hasSignature(doc.context.enumerateIndirectObjects(), (o): o is Dict => o instanceof PDFDict, (s) => PDFName.of(s));

  try {
    doc.encrypt({
      userPassword: password,
      ownerPassword: password,
      algorithm: "AES-256",
      // كل الأذونات مفتوحة: من يملك الكلمة يملك الملف، فالطباعة والنسخ لا تُمنع عنه
      permissions: { printing: "highResolution", modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
    });
  } catch (e) {
    // المكتبة ترفض تشفير ملف يعلن PDF/A، فالمعيار يمنع التشفير
    return { ok: false, error: /PDF\/A/.test(String(e)) ? "pdfa" : "failed" };
  }

  try {
    if (!encryptLooseStrings(lib, doc)) return { ok: false, error: "failed" };
    return { ok: true, bytes: await doc.save({ addDefaultPage: false, updateFieldAppearances: false }), signed };
  } catch {
    return { ok: false, error: "failed" };
  }
}
