/**
 * فحص ملف PDF بلا DOM ولا شبكة: يقرأ بنيته ويعيد حكماً واحداً، وقائمة ما وجد، ومعلومتين لا تغيّران الحكم.
 * القواعد من docs/logs/phase2/inspect-copy-v2.md (النصّ المعتمد) وجدول البنود في inspect-copy.md.
 * يعمل في العامل (`runTool("inspect")`)، فالملف الخبيث الذي يستهلك المعالج يُنهى بالمهلة.
 *
 * الكشف يمرّ على كل كائن يُبلَغ من الذيل (/Root و/Info و/Encrypt) كما في `stripActions`، لا على /Annots وحدها:
 * الإشارات المرجعية، وسلاسل /Next، والتيارات، وما في تيارات الكائنات (يفكّها pdf-lib عند التحميل). والأسماء تُفكّ من
 * `#xx` بحرفَي الست عشرية الكبيرين والصغيرين (pdf-lib 1.17.1 يفكّ الكبيرين وحدهما) قبل كل مقارنة، في المفاتيح والقيم.
 * ومعه مرور خام على البايتات (`inspect-raw.ts`) بالقواعد نفسها على كل نسخ الكائنات، يُضمّ إليه فلا يخفّ الحكم عنه.
 * ولا يُفحص: محتوى الصور والخطوط والمرفقات، ووجهة الروابط العادية، وما تفعله أوامر JavaScript، وصحة التوقيع.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFObject } from "pdf-lib";
import { rawScan, refKey, type RawCipher } from "./inspect-raw";
import { safeAction, safeActionIn, structElems, structElemsIn } from "./pdf-actions";
import { hasSignature, scanPdf } from "./pdf-checks";

export type Verdict = "invalid" | "unsafe" | "caution" | "clear";
export type ItemKind =
  | "launch" | "js-link" | "file-link" | "media-script"
  | "javascript" | "open-action" | "auto-actions" | "submit" | "import" | "remote-file"
  | "attachments" | "interactive" | "xfa" | "broken" | "encrypted";
export type ItemLevel = "unsafe" | "caution";
/** `count`: للمرفقات وحدها، عدد مواصف الملفات المضمَّنة (/EF). */
export interface InspectItem { kind: ItemKind; level: ItemLevel; count?: number }
/** معلومات لا تغيّر الحكم: `restricted` كلمة مالك وحدها (يُفتح بلا كلمة) و/P يمنع الطباعة أو التعديل أو النسخ، و`signed` توقيع رقمي لم يُتحقق من صحته. */
export type InfoKind = "restricted" | "signed";
export type InspectResult = { ok: true; verdict: Verdict; items: InspectItem[]; info: InfoKind[] } | { ok: false; error: "failed" };

/** ترتيب البنود ودرجاتها، الأشدّ أولاً ثم ترتيب الجدول المعتمد. */
export const ITEM_LEVELS: readonly (readonly [ItemKind, ItemLevel])[] = [
  ["launch", "unsafe"], ["js-link", "unsafe"], ["file-link", "unsafe"], ["media-script", "unsafe"],
  ["javascript", "caution"], ["open-action", "caution"], ["auto-actions", "caution"], ["submit", "caution"], ["import", "caution"],
  ["remote-file", "caution"], ["attachments", "caution"], ["interactive", "caution"], ["xfa", "caution"], ["broken", "caution"],
  ["encrypted", "caution"],
];

const N = (s: string) => PDFName.of(s);
const GOTO = new Set(["GoTo"]);
const HEX = /#([0-9a-fA-F]{2})/g;
/** الاسم بعد فكّ `#xx` بالحالتين. */
export const normName = (s: string) => (s.includes("#") ? s.replace(HEX, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : s);

/** أفعال /S وما تكشفه. Rendition لا يُعدّ إلا إن كان فيه /JS (`media-script`). */
const ACTIONS: Record<string, ItemKind> = {
  Launch: "launch", JavaScript: "javascript", SubmitForm: "submit", ImportData: "import", GoToR: "remote-file", GoToE: "remote-file",
};
/** الأسماء التي تُكشف في الكائن المعطوب (`PDFInvalidObject`) ببحث في بايتاته، فهي لا تُقرأ بنيةً. */
const RAW_NAMES: Record<string, ItemKind> = {
  ...ACTIONS, JS: "javascript", AA: "auto-actions", OpenAction: "open-action", RichMedia: "interactive", "3D": "interactive", XFA: "xfa",
};

type Entries = Map<string, PDFObject[]>;
/** مداخل القاموس بأسماء مفكوكة. المفتاحان اللذان يصيران اسماً واحداً بعد الفك يبقيان معاً. */
function entriesOf(d: PDFDict): Entries {
  const m: Entries = new Map();
  for (const [k, v] of d.entries()) {
    const key = normName(k.decodeText());
    const l = m.get(key);
    if (l) l.push(v);
    else m.set(key, [v]);
  }
  return m;
}

/** ما يُحكم عليه: القواميس، وكيف يُحلّ المرجع (نسخة واحدة في المستند، وكل النسخ في المرور الخام)، والفهارس. */
interface View {
  dicts: PDFDict[];
  looks: (v: PDFObject | undefined) => PDFObject[];
  /** القواميس التي تُقرأ فيها /OpenAction و/Names و/URI. */
  catalogs: PDFDict[];
  /** عناصر البنية (`get`: مداخل القاموس بأسماء مفكوكة). وإن رمت فلا قاموس عنصرَ بنية (الإغلاق على الأشدّ). */
  elems: (get: (d: PDFDict, k: string) => PDFObject[]) => Set<PDFDict>;
  /** هل /OpenAction (غير المصفوفة) فعل /GoTo بسلسلته كلها. وإن رمت فهو «أمر عند الفتح». */
  safeOpen: (v: PDFObject) => boolean;
  /** بايتات ما لا يُقرأ بنيةً: يُبحث فيها عن الأسماء والروابط. */
  raws: Uint8Array[];
}

/** يحكم على `view` بقواعد الجدول المعتمد، ويضيف ما يجده إلى `found` (البند وعدده). `broken`: هل يُعدّ ما في `raws` أجزاء معطوبة. */
function judge(view: View, found: Map<ItemKind, number>, broken: boolean): void {
  const { dicts, looks } = view;
  const add = (k: ItemKind, n = 1) => found.set(k, (found.get(k) ?? 0) + n);
  const texts = (v: PDFObject | undefined): string[] => {
    const out: string[] = [];
    for (const o of looks(v)) {
      if (o instanceof PDFName) out.push(normName(o.decodeText()));
      else if (o instanceof PDFString || o instanceof PDFHexString) out.push(o.decodeText());
    }
    return out;
  };

  const map = new Map<PDFDict, Entries>();
  for (const d of dicts) map.set(d, entriesOf(d));
  const ent = (d: PDFDict) => {
    let m = map.get(d);
    if (!m) map.set(d, (m = entriesOf(d)));
    return m;
  };
  const get = (d: PDFDict, k: string) => ent(d).get(k) ?? [];

  // ما يُستعمل فعلاً (قيمة /A أو /OpenAction أو /Next، أو قيمة في /AA): لا يُستثنى بأنه عنصر بنية ولو كان كذلك أيضاً
  const used = new Set<PDFDict>();
  const asAction = (v: PDFObject | undefined, depth = 0) => {
    for (const o of looks(v)) {
      if (o instanceof PDFDict) used.add(o);
      else if (o instanceof PDFArray && depth < 8) for (const x of o.asArray()) asAction(x, depth + 1);
    }
  };
  for (const d of dicts) {
    for (const k of ["A", "OpenAction", "Next"]) for (const v of get(d, k)) asAction(v);
    for (const v of get(d, "AA")) for (const aa of looks(v)) if (aa instanceof PDFDict) for (const [, x] of aa.entries()) asAction(x);
  }
  // /S في عنصر البنية نوعُ عنصر (وقد يسمّيه المؤلف ما شاء)، لا فعل
  let elems: Set<PDFDict> | null;
  try { elems = view.elems(get); } catch { elems = null; }
  const isElem = (d: PDFDict) => elems !== null && !used.has(d) && (elems.has(d) || get(d, "Type").some((v) => texts(v).includes("StructElem")));

  /** رابط /URI أو /Base: بعد حذف المسافات وحروف التحكم (يحذفها المتصفح من المخطّط)، وبلا حساسية للحالة. */
  const checkUri = (v: PDFObject | undefined) => {
    for (const t of texts(v)) {
      const u = t.replace(/[\x00-\x20\x7f]/g, "").toLowerCase();
      if (u.startsWith("javascript:")) add("js-link");
      else if (u.startsWith("file:") || u.startsWith("\\\\")) add("file-link"); // \\host\share مسار شبكة كـfile:
    }
  };

  const subs = (ds: PDFDict[], k: string): PDFDict[] => {
    const out: PDFDict[] = [];
    for (const d of ds) for (const v of get(d, k)) for (const o of looks(v)) if (o instanceof PDFDict) out.push(o);
    return out;
  };
  const scripts = (d: PDFDict) => get(d, "Scripts").some((v) => looks(v).some((a) => a instanceof PDFArray && a.size() > 0));

  let attachments = 0;
  for (const d of dicts) {
    const m = map.get(d)!;
    const has = (k: string) => m.has(k);
    const hasJs = has("JS");
    const kinds = new Set(get(d, "S").flatMap(texts));
    const action = !isElem(d);
    if (action && kinds.has("Rendition") && hasJs) add("media-script");
    else if (hasJs) add("javascript");
    if (action) {
      for (const s of kinds) {
        const k = ACTIONS[s];
        if (k) add(k);
      }
      if (kinds.has("URI")) for (const v of get(d, "URI")) checkUri(v);
    }
    for (const v of get(d, "AA")) if (looks(v).some((aa) => aa instanceof PDFDict && aa.entries().length > 0)) add("auto-actions");
    const subtypes = get(d, "Subtype").flatMap(texts);
    // سكربتات RichMedia (/RichMediaActivation /Scripts): مصفوفة مواصف ملفات JavaScript. فالتعليق الذي فيه سكربت «غير آمن»
    // لا «محتوى تفاعلي»، و/Scripts أينما وُجد يُعدّ
    if (subtypes.includes("RichMedia")) {
      const acts = subs(subs([d], "RichMediaSettings"), "Activation");
      if (!acts.length || acts.some((a) => !scripts(a))) add("interactive");
    }
    if (scripts(d)) add("media-script");
    if (subtypes.includes("3D") || has("3DD") || get(d, "Type").some((v) => texts(v).includes("3D"))) add("interactive");
    if (has("XFA")) add("xfa");
    if (has("EF")) attachments++;
  }
  if (attachments) add("attachments", attachments);

  for (const catalog of view.catalogs) {
    for (const v of get(catalog, "OpenAction")) {
      // وجهة (مصفوفة، أو سلسلة /GoTo) تفتح صفحة بعينها، فليست أمراً
      for (const o of looks(v)) {
        if (o instanceof PDFArray) continue;
        let safe: boolean;
        try { safe = view.safeOpen(o); } catch { safe = false; }
        if (!safe) add("open-action");
      }
    }
    for (const v of get(catalog, "Names")) if (looks(v).some((names) => names instanceof PDFDict && ent(names).has("JavaScript"))) add("javascript");
    for (const v of get(catalog, "URI")) for (const u of looks(v)) if (u instanceof PDFDict) for (const b of ent(u).get("Base") ?? []) checkUri(b);
  }

  // الكائن المعطوب يُكتب كما قُرئ ويقرؤه غير pdf-lib (مراجعة 🕵️ أمين الثالثة، H7): يُعدّ، ويُبحث في بايتاته عمّا يُكشف
  for (const data of view.raws) {
    if (broken) add("broken");
    const raw = Array.from(data, (c) => String.fromCharCode(c)).join("");
    for (const [, name] of raw.matchAll(/\/([^\x00\x09\x0a\x0c\x0d\x20()<>[\]{}/%]+)/g)) {
      const k = RAW_NAMES[normName(name!)];
      if (k) add(k);
    }
    const low = raw.replace(/[\x00-\x20\x7f]/g, "").toLowerCase();
    if (low.includes("javascript:")) add("js-link");
    if (low.includes("file:")) add("file-link");
  }
}

/**
 * يفحص المستند الذي حمّله pdf-lib: كل كائن يُبلَغ من الذيل (/Root و/Info و/Encrypt).
 * `doc` قد يكون مشفّراً حُمّل بـ`ignoreEncryption`: الأسماء والبنية مقروءة، والسلاسل والتيارات لا.
 */
function scanDoc(doc: PDFDocument, found: Map<ItemKind, number>): void {
  const ctx = doc.context;
  // كل قاموس يُبلَغ من الذيل، والتيارات بقواميسها، وكل كائن معطوب يُبلَغ إليه
  const dicts: PDFDict[] = [];
  const invalid: PDFInvalidObject[] = [];
  const seen = new Set<PDFRef>();
  const walked = new Set<unknown>();
  const stack: (PDFObject | undefined)[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = ctx.lookup(o);
      if (v instanceof PDFInvalidObject) invalid.push(v);
      else stack.push(v);
    } else if (o instanceof PDFDict || o instanceof PDFStream) {
      const d = o instanceof PDFStream ? o.dict : o;
      if (walked.has(d)) continue;
      walked.add(d);
      dicts.push(d);
      for (const [, v] of d.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      if (walked.has(o)) continue;
      walked.add(o);
      for (const v of o.asArray()) stack.push(v); // لا `push(...)`: مصفوفة من مئات الآلاف تتجاوز حدّ وسائط الدالة
    }
  }
  judge({
    dicts,
    looks: (v) => { const o = v instanceof PDFRef ? ctx.lookup(v) : v; return o === undefined ? [] : [o]; },
    catalogs: [doc.catalog],
    elems: () => structElems(doc),
    safeOpen: (v) => safeAction(doc, v, GOTO),
    raws: invalid.map((o) => (o as unknown as { data: Uint8Array }).data),
  }, found, true);
}

/**
 * المرور الخام (`inspect-raw.ts`، مراجعة 🕵️ أمين الرابعة): كل نسخ الكائنات أينما كانت، بقواعد `judge` نفسها، فلا يخفى
 * ما يراه القارئ ولا يراه pdf-lib. ويُعدّ «أجزاء معطوبة» إن اختلف /Root بين الذيول، أو لم يُرَ، أو لم يكن /Root
 * الذي أخذه pdf-lib (`maybeRecoverRoot`)، أو لم يُفكّ تيار كائنات كاملاً أو نفدت الميزانية قبله. وثمنه: ما حُذف بتحديث تزايدي يبقى في نسخته القديمة فيُعدّ.
 */
function scanRaw(bytes: Uint8Array, docRoot: PDFRef | undefined, found: Map<ItemKind, number>, cipher?: RawCipher, keyless = false): void {
  const { versions, unreadable, roots, undecoded } = rawScan(bytes, cipher, keyless);
  const resolve = (r: PDFRef) => versions.get(refKey(r)) ?? [];
  const looks = (v: PDFObject | undefined): PDFObject[] => (v instanceof PDFRef ? resolve(v) : v === undefined ? [] : [v]);
  const dicts: PDFDict[] = [];
  const walked = new Set<unknown>();
  const stack: PDFObject[] = [];
  for (const l of versions.values()) for (const o of l) stack.push(o);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFDict) {
      if (walked.has(o)) continue;
      walked.add(o);
      dicts.push(o);
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      if (walked.has(o)) continue;
      walked.add(o);
      for (const v of o.asArray()) stack.push(v);
    }
  }
  judge({
    dicts,
    looks,
    catalogs: dicts,
    elems: (get) => {
      const starts: unknown[] = [];
      for (const d of dicts) for (const v of get(d, "StructTreeRoot")) for (const r of looks(v)) if (r instanceof PDFDict) starts.push(r.get(N("K")));
      return structElemsIn(resolve, starts);
    },
    safeOpen: (v) => safeActionIn(resolve, v, GOTO),
    raws: unreadable,
  }, found, false);
  const badRoot = roots.size !== 1 || (docRoot !== undefined && !roots.has(refKey(docRoot)));
  if (badRoot || undecoded > 0) found.set("broken", (found.get("broken") ?? 0) + 1);
}

const result = (found: Map<ItemKind, number>, info: InfoKind[]): InspectResult => {
  const items: InspectItem[] = [];
  for (const [kind, level] of ITEM_LEVELS) {
    const n = found.get(kind);
    if (n) items.push(kind === "attachments" ? { kind, level, count: n } : { kind, level });
  }
  const verdict: Verdict = items.some((i) => i.level === "unsafe") ? "unsafe" : items.length ? "caution" : "clear";
  return { ok: true, verdict, items, info };
};
const INVALID: InspectResult = { ok: true, verdict: "invalid", items: [], info: [] };

/**
 * يضمّ المرور الخام إلى ما وجده البنيوي، فلا يخفّ الحكم عنه أبداً. وإن رمى المرور الخام فـ«أجزاء معطوبة» (الإغلاق على الأشدّ).
 * والمرفقات بعدد البنيوي إن رآها، فالخام يعدّ النسخ القديمة أيضاً.
 */
function withRaw(found: Map<ItemKind, number>, bytes: Uint8Array, docRoot: PDFRef | undefined, cipher?: RawCipher, keyless = false): Map<ItemKind, number> {
  const raw = new Map<ItemKind, number>();
  try { scanRaw(bytes, docRoot, raw, cipher, keyless); } catch { raw.set("broken", 1); }
  for (const [k, n] of raw) found.set(k, k === "attachments" ? found.get(k) || n : Math.max(found.get(k) ?? 0, n));
  return found;
}
const rootOf = (doc: PDFDocument | null | undefined) => doc?.context.trailerInfo.Root as PDFRef | undefined;

const signedIn = (doc: PDFDocument) =>
  hasSignature(doc.context.enumerateIndirectObjects(), (o): o is PDFDict => o instanceof PDFDict, (s) => PDFName.of(s));

/** يحمّل الملف ويتأكد أن فيه صفحة، أو null. pdf-lib يقبل ما لا فهرس فيه. */
async function load(bytes: Uint8Array, ignoreEncryption = false): Promise<PDFDocument | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption });
    return doc.getPageCount() >= 1 ? doc : null;
  } catch {
    return null;
  }
}

/**
 * هل يمنع /P في قاموس التشفير الطباعة أو التعديل أو النسخ فعلاً (البتّات 3 و4 و5، ISO 32000-1 الجدول 22)؟
 * قرار المدير (المرحلة الثانية): بند «قيود» لهذا وحده، لا لكل ملف بكلمة مالك. وبلا /P رقمياً لا يُدّعى قيد.
 */
function restrictsUse(doc: PDFDocument | null): boolean {
  const enc = doc?.context.lookup(doc.context.trailerInfo.Encrypt);
  const p = enc instanceof PDFDict ? enc.lookup(N("P")) : undefined;
  return p instanceof PDFNumber && (p.asNumber() & 0b11100) !== 0b11100;
}

/**
 * مفتاح الملف الذي يُفتح بلا كلمة (كلمة مالك وحدها) للمرور الخام، بـ`CipherTransformFactory` التي يفتح بها `@cantoo/pdf-lib`
 * الملف في `unlockPdf`: السلاسل بـ`decryptBytes` (مفتاح /StrF)، والتيارات بـ`StreamCipherConstructor` (مفتاح /StmF، كما يفكّها
 * pdf.js)، وناتج `createCipherTransform` يُحفظ لكل كائن. وهي غير مصدَّرة من مدخل الحزمة، فتُستورد بمسار ملفها،
 * وهو الملف نفسه الذي تستورده الحزمة فلا يتكرّر في الناتج. وإن تعذّر المفتاح فلا مفتاح: تبقى التيارات مشفّرة فتُعدّ «أجزاء معطوبة».
 */
async function ownerCipher(bytes: Uint8Array): Promise<RawCipher | undefined> {
  try {
    const lib = await import("@cantoo/pdf-lib");
    const { CipherTransformFactory } = await import("../../node_modules/@cantoo/pdf-lib/es/core/crypto.js");
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const { Encrypt, ID } = doc.context.trailerInfo;
    const dict = doc.context.lookup(Encrypt, lib.PDFDict);
    const id = doc.context.lookup(ID, lib.PDFArray).get(0);
    if (!(id instanceof lib.PDFString || id instanceof lib.PDFHexString)) return undefined;
    // أنواع الحزمة من نسخة cjs والتشغيل من es (الملف نفسه الذي يستورده `crypto.js`)، فالصنفان واحد وقت التشغيل
    const factory = new CipherTransformFactory(dict as never, id.asBytes(), "");
    type Transform = { decryptBytes(d: Uint8Array): Uint8Array; StreamCipherConstructor(): { decryptBlock(d: Uint8Array, finalize: boolean): Uint8Array } };
    const transforms = new Map<string, Transform>();
    const transform = (num: number, gen: number) => {
      const k = `${num} ${gen}`;
      let t = transforms.get(k);
      if (!t) { t = factory.createCipherTransform(num, gen) as unknown as Transform; transforms.set(k, t); }
      return t;
    };
    return {
      string: (num, gen, data) => transform(num, gen).decryptBytes(data),
      stream: (num, gen, data) => transform(num, gen).StreamCipherConstructor().decryptBlock(data, true),
      encrypt: Encrypt instanceof lib.PDFRef ? `${Encrypt.objectNumber} ${Encrypt.generationNumber}` : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * الملف المشفّر: يُفك بلا كلمة بأداة «فك الحماية» نفسها (`unlockPdf`). فإن فُكّ فعليه كلمة مالك وحدها: يُفحص الناتج كاملاً،
 * والمرور الخام بمفتاحه (`ownerCipher`)، وبند «قيود» معلومة. وإن طلب كلمة (أو تشفيراً لا تفكّه المكتبة) فـ«يحتاج انتباهاً» دائماً، ويُفحص ما يُقرأ من بنيته
 * (الأسماء لا تُشفَّر، والسلاسل والتيارات تُشفَّر)، فقد يكون الحكم أشدّ.
 */
async function inspectEncrypted(bytes: Uint8Array): Promise<InspectResult> {
  const found = new Map<ItemKind, number>();
  const plain = await (await import("./unlock-core")).unlockPdf(bytes);
  if (plain.ok) {
    const doc = await load(plain.bytes);
    if (!doc) return INVALID;
    scanDoc(doc, found);
    const original = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }).catch(() => null);
    withRaw(found, bytes, rootOf(original), await ownerCipher(bytes));
    const info: InfoKind[] = restrictsUse(original) ? ["restricted"] : [];
    return result(found, signedIn(doc) ? [...info, "signed"] : info);
  }
  if (plain.error === "failed") return { ok: false, error: "failed" };
  if (plain.error !== "password-required" && plain.error !== "unsupported-encryption") return INVALID;
  found.set("encrypted", 1);
  const doc = await load(bytes, true);
  // وبلا doc: فهرسه في تيار كائنات مشفّر، يفتحه القارئ بالكلمة ولا يُقرأ هنا
  if (doc) try { scanDoc(doc, found); } catch { /* ما لا يُقرأ من المشفّر لا يُسقط حكم «يحتاج انتباهاً» */ }
  // بكلمة فتح لا مفتاح للتيارات: عجزها عن الفكّ سببه «ملف محمي» وحده، فلا «أجزاء معطوبة» إلا لسببٍ آخر في الملف
  withRaw(found, bytes, rootOf(doc), undefined, true);
  return result(found, doc && signedIn(doc) ? ["signed"] : []);
}

export async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  try {
    const input = scanPdf(bytes);
    if (input.error) return INVALID;
    if (input.encrypted) return await inspectEncrypted(bytes);
    const doc = await load(bytes);
    // /Encrypt لم يُرَ في الذيل (جدول XRef مضغوط مثلاً) وpdf-lib يرفض المشفّر
    if (!doc) return (await load(bytes, true))?.isEncrypted ? await inspectEncrypted(bytes) : INVALID;
    const found = new Map<ItemKind, number>();
    scanDoc(doc, found);
    withRaw(found, bytes, rootOf(doc));
    return result(found, signedIn(doc) ? ["signed"] : []);
  } catch {
    return { ok: false, error: "failed" };
  }
}
