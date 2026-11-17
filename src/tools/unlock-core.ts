/**
 * فك حماية ملف PDF بكلمة يعرفها صاحبه، ولا كسر لكلمات المرور.
 * ملف له كلمة مالك فقط (يُفتح بلا كلمة) يُفك بلا كلمة.
 * `@cantoo/pdf-lib` تُحمَّل عند الطلب.
 */
import { toLatinDigits } from "../numerals";
import { checkInput, hasSignature } from "./pdf-checks";
import type { PDFArray as Arr, PDFDict as Dict, PDFName as Name, PDFString as Str } from "@cantoo/pdf-lib";

export type UnlockError = "too-big" | "bad-pdf" | "not-encrypted" | "password-required" | "wrong-password" | "unsupported-encryption" | "failed";
/** `signed`: في الملف توقيع رقمي، والفك يعيد كتابته فيبطل التوقيع. و`pages` عدد صفحات الناتج («الأدوات» بعد الحفظ). */
export type UnlockResult = { ok: true; bytes: Uint8Array; signed: boolean; pages: number } | { ok: false; error: UnlockError };

type Lib = typeof import("@cantoo/pdf-lib");
type Doc = Awaited<ReturnType<Lib["PDFDocument"]["load"]>>;

/** سقف ما يُمرّ عليه من القيم المتداخلة: فوقه يُعدّ الملف غير معقول فيُعاد `failed`. */
const MAX_WALK = 10_000_000;

/**
 * المكتبة تفكّ السلسلة الحرفية في الكائن العلوي وتخزّن بايتاتها خاماً (PDFObjectParser.js:109)،
 * ثم تكتبها بين قوسين بلا escaping (PDFString.js:83)، فيُكسر الملف أو يتحرّف النص إن كان فيه `(` أو `)` أو `\`:
 * و«ب» بترميز UTF-16BE `06 28`، و«ة» `06 29`. فتُستبدل بها هنا سلسلة ست عشرية بالبايتات نفسها.
 * وما في تدفّق الكائنات لا تفكّه المكتبة سلسلةً سلسلة (PDFObjectStreamParser بلا مفتاح)، فيبقى بصيغته الأصلية،
 * ويُكتب صحيحاً كما هو، وقراءته بايتاتٍ خاماً تحرّفه، فلا يُلمس.
 * يعيد false إن تجاوز السقف.
 */
function hexDecryptedStrings(lib: Lib, doc: Doc): boolean {
  const { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFStream, PDFString, decodePDFRawStream } = lib;
  const ctx = doc.context;
  const [Type, ObjStm, First, N] = ["Type", "ObjStm", "First", "N"].map((s) => PDFName.of(s)) as [Name, Name, Name, Name];

  // أرقام الكائنات المضغوطة في تدفّق كائنات: من رأس التدفّق، أزواج «رقم الكائن، موضعه»
  const packed = new Set<number>();
  for (const [, object] of ctx.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.lookup(Type) !== ObjStm) continue;
    const first = object.dict.lookup(First, PDFNumber).asNumber();
    const count = object.dict.lookup(N, PDFNumber).asNumber();
    const head = decodePDFRawStream(object).decode().subarray(0, first);
    let text = "";
    for (let i = 0; i < head.length; i++) text += String.fromCharCode(head[i]!);
    const numbers = text.match(/\d+/g) ?? [];
    for (let i = 0; i < count && 2 * i < numbers.length; i++) packed.add(Number(numbers[2 * i]));
  }

  const toHex = (s: Str) => {
    const raw = s.asString();
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff;
    return PDFHexString.fromBytes(out);
  };

  let walked = 0;
  for (const [ref, object] of ctx.enumerateIndirectObjects()) {
    if (ref.generationNumber === 0 && packed.has(ref.objectNumber)) continue;
    if (object instanceof PDFString) {
      ctx.assign(ref, toHex(object));
      continue;
    }
    const top = object instanceof PDFStream ? object.dict : object;
    if (!(top instanceof PDFDict || top instanceof PDFArray)) continue;
    const stack: (Dict | Arr)[] = [top];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node instanceof PDFDict) {
        for (const [key, value] of node.entries()) {
          if (++walked > MAX_WALK) return false;
          if (value instanceof PDFString) node.set(key, toHex(value));
          else if (value instanceof PDFDict || value instanceof PDFArray) stack.push(value);
        }
      } else {
        for (let i = 0, n = node.size(); i < n; i++) {
          if (++walked > MAX_WALK) return false;
          const value = node.get(i);
          if (value instanceof PDFString) node.set(i, toHex(value));
          else if (value instanceof PDFDict || value instanceof PDFArray) stack.push(value);
        }
      }
    }
  }
  return true;
}

/** يُستدعى من هنا ليُنزع في الاختبار فيُرى الحارس وحده. */
export const unlockInternals = { hexDecryptedStrings };

export async function unlockPdf(bytes: Uint8Array, password?: string): Promise<UnlockResult> {
  const input = checkInput(bytes);
  if (input) return { ok: false, error: input };
  let lib: typeof import("@cantoo/pdf-lib");
  try {
    lib = await import("@cantoo/pdf-lib");
  } catch {
    return { ok: false, error: "failed" }; // انقطعت الشبكة قبل أن تصل القطعة
  }
  const { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } = lib;

  let probe: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { ok: false, error: "bad-pdf" };
  }
  if (!probe.isEncrypted) return { ok: false, error: "not-encrypted" };

  // الكلمة كما كُتبت، ثم نسختها بالأرقام الإنجليزية إن اختلفت
  const given = password ?? "";
  for (const candidate of new Set([given, toLatinDigits(given)])) {
    let doc: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      doc = await PDFDocument.load(bytes, { password: candidate, updateMetadata: false, preserveXFA: true });
    } catch (e) {
      if (/password/i.test(String(e))) continue;
      return { ok: false, error: "unsupported-encryption" };
    }
    try {
      // المكتبة تُسقط /Encrypt من الذيل وتُبقي قاموسه كائناً يتيماً، وفيه ما يُختبر به تخمين الكلمة القديمة (/O و/U)
      const { Encrypt, Info, ID } = probe.context.trailerInfo;
      if (Encrypt instanceof PDFRef) doc.context.delete(Encrypt);
      // وجدول XRef القديم يصير بعد فك التشفير كائناً غير صالح يُكتب كما هو وفيه /Encrypt، فيُعرف من التحميل الأول
      for (const [ref, object] of probe.context.enumerateIndirectObjects()) {
        if (object instanceof PDFRawStream && object.dict.lookup(PDFName.of("Type")) === PDFName.of("XRef")) doc.context.delete(ref);
      }
      // ومع جدول XRef المضغوط يضيع مرجع Info وID بعد فك التشفير، فتضيع بيانات الملف (العنوان والمؤلف)
      doc.context.trailerInfo.Info ??= Info;
      doc.context.trailerInfo.ID ??= ID;
      const signed = hasSignature(doc.context.enumerateIndirectObjects(), (o): o is Dict => o instanceof PDFDict, (s) => PDFName.of(s));
      if (!unlockInternals.hexDecryptedStrings(lib, doc)) return { ok: false, error: "failed" };
      const pages = doc.getPageCount();
      const out = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
      // الحارس: ما كُتب يُقرأ من جديد بالخيارات نفسها وبعدد الصفحات نفسه، وإلا فلا يُسلَّم ملف معطوب
      const back = await PDFDocument.load(out, { password: candidate, updateMetadata: false, preserveXFA: true });
      if (back.getPageCount() !== pages) return { ok: false, error: "failed" };
      return { ok: true, bytes: out, signed, pages };
    } catch {
      return { ok: false, error: "failed" };
    }
  }
  return { ok: false, error: given === "" ? "password-required" : "wrong-password" };
}
