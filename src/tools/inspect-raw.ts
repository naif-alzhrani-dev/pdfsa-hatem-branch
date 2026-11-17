/**
 * المرور الخام على بايتات الملف لفحصه (مراجعة 🕵️ أمين الرابعة): pdf-lib يمرّ على الملف خطّياً ويأخذ آخر نسخة لكل كائن
 * وآخر ذيل، والقارئ يتبع `startxref` وجدول المواضع، فقد يرى نسخةً لا يراها الفحص البنيوي. فهنا تُجمع كل النسخ:
 * كل `N G obj` أينما كان في الملف (ولو داخل تيار، فالجدول قد يشير إليه)، وما في كل تيار كائنات (/ObjStm، أو فيه /N و/First)
 * ولو لم يُشر إليه الجدول، بالمحلِّل الذي يقرأ به pdf-lib الكائن الواحد. والتيارات العادية لا تُفكّ ولا يُقرأ محتواها:
 * يُقرأ قاموسها وحده، فاسمٌ في محتوى صفحة أو داخل سلسلة نصية لا يُعدّ مفتاحاً.
 * والحكم على ما يُجمع هنا في `inspect-core.ts` بقواعده نفسها.
 * والملف المشفّر الذي يُفتح بلا كلمة (كلمة مالك وحدها) يُعطى هنا مفتاحه (`RawCipher`): تُفكّ به تيارات الكائنات قبل فكّ
 * ضغطها بمفتاح التيارات (/StmF) كما يفعل pdf.js، ويُقرأ كلٌّ منها كما هو أيضاً، وبلا مفتاح يبقى ما فيها مشفّراً فيُعدّ «أجزاء معطوبة». وكل كائن في أعلى الملف
 * يُعدّ نسختين: كما قُرئ، وبسلاسله مفكوكةً بمفتاح كائنه. فبعض المنتجين يترك سلاسل مكشوفة في الملف المشفّر (`protect-core.ts`)،
 * والقارئ الذي يفكّها يرى غير ما يراه الذي لا يفكّها، فيُحكم على الاثنين.
 */
import { Unzlib } from "fflate";
import { PDFArray, PDFContext, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFObjectParser, PDFRef, PDFString, type PDFObject } from "pdf-lib";
import { MAX_INFLATED_BYTES } from "./pdf-checks";

export interface RawScan {
  /** كل نسخ كل كائن («N G») بترتيب ورودها. */
  versions: Map<string, PDFObject[]>;
  /** بايتات الكائنات التي لا يقرؤها المحلِّل: يُبحث فيها عن الأسماء كما في الكائن المعطوب. */
  unreadable: Uint8Array[];
  /** كل /Root في الذيول وقواميس جداول XRef. */
  roots: Set<string>;
  /** تيارات الكائنات التي لم تُفكّ كاملةً (`objStmData`): ما فيها لم يُفحص، فتُعدّ «أجزاء معطوبة». */
  undecoded: number;
}

/**
 * مفتاح الملف المشفّر: يفكّ بايتات كائنٍ برقمه وجيله، ويرمي إن تعذّر.
 * و`encrypt`: «N G» لقاموس /Encrypt، فسلاسله (/O و/U) لا تُشفَّر.
 */
export interface RawCipher {
  /** السلاسل بمفتاح /StrF، والتيارات بمفتاح /StmF (كما يفكّها pdf.js)، فقد يختلف المفتاحان في الملف الواحد. */
  string: (num: number, gen: number, data: Uint8Array) => Uint8Array;
  stream: (num: number, gen: number, data: Uint8Array) => Uint8Array;
  encrypt?: string;
}

export const refKey = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`;

const WS = "\\x00\\x09\\x0a\\x0c\\x0d\\x20";
const REGULAR_END = `(?![^${WS}()<>\\[\\]{}/%])`;
const HEADER = new RegExp(`(?<![0-9])([0-9]{1,10})[${WS}]+([0-9]{1,5})[${WS}]+obj${REGULAR_END}`, "g");
const TRAILER = new RegExp(`(?<![A-Za-z])trailer${REGULAR_END}`, "g");
/** أقصى ما يُبحث فيه من كائن لا يُقرأ (حتى «endobj»). */
const UNREADABLE_MAX = 1 << 20;
const OVER = new Error("over");

type Parser = {
  bytes: { offset(): number };
  skipWhitespaceAndComments(): void;
  parseDict(): PDFDict;
  parseObject(): PDFObject;
};

const isWs = (c: number | undefined) => c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
function wordAt(b: Uint8Array, at: number, w: string): boolean {
  for (let i = 0; i < w.length; i++) if (b[at + i] !== w.charCodeAt(i)) return false;
  return true;
}

/** الكائن الذي يبدأ عند `at`، وموضع بيانات تياره إن كان قاموساً يليه «stream». يرمي إن لم يُقرأ. */
function parseAt(b: Uint8Array, at: number, ctx: PDFContext): { obj: PDFObject; data?: number } {
  const p = PDFObjectParser.forBytes(b.subarray(at), ctx) as unknown as Parser;
  p.skipWhitespaceAndComments();
  const q = at + p.bytes.offset();
  if (b[q] !== 0x3c || b[q + 1] !== 0x3c) return { obj: p.parseObject() };
  const dict = p.parseDict(); // لا `parseObject`: لا يُقرأ التيار، ولا يُبحث عن نهايته إلا لتيار الكائنات
  p.skipWhitespaceAndComments();
  let s = at + p.bytes.offset();
  if (!wordAt(b, s, "stream")) return { obj: dict };
  s += 6;
  if (b[s] === 0x0d && b[s + 1] === 0x0a) s += 2;
  else if (b[s] === 0x0d || b[s] === 0x0a) s += 1;
  return { obj: dict, data: s };
}

const nameOf = (v: PDFObject | undefined) => (v instanceof PDFName ? v.decodeText() : undefined);

const EMPTY = new Uint8Array(0);

/** بايتات التيار كما في الملف، من `start` إلى «endstream» (بـ/Length إن صحّ). */
function streamBytes(b: Uint8Array, dict: PDFDict, start: number): Uint8Array {
  const len = dict.get(PDFName.of("Length"));
  let end = -1;
  if (len instanceof PDFNumber && len.asNumber() >= 0 && start + len.asNumber() <= b.length) {
    let q = start + len.asNumber();
    while (isWs(b[q])) q++;
    if (wordAt(b, q, "endstream")) end = start + len.asNumber();
  }
  if (end < 0) {
    end = indexOfWord(b, "endstream", start);
    if (end < 0) end = b.length;
  }
  return b.subarray(start, end);
}

/**
 * /Predictor من 10 إلى 15 (PNG) كما في pdf.js `PredictorStream.readBlockPng`: بايت نوعٍ (0–4) قبل كل سطر، والسطر الأول
 * يسبقه سطر أصفار. والسطر الأخير الناقص يُفكّ بما فيه بلا حشو. ونوع مجهول يوقف الفكّ، وما قبله يُقرأ.
 */
function unpredictPng(data: Uint8Array, colors: number, bits: number, columns: number): { data: Uint8Array; ok: boolean } {
  const pix = (colors * bits + 7) >> 3;
  const row = (columns * colors * bits + 7) >> 3;
  if (!(pix >= 1 && row >= 1)) return { data: EMPTY, ok: false };
  const out = new Uint8Array(data.length);
  let o = 0;
  for (let i = 0; i + 1 < data.length; i += row + 1) {
    const type = data[i]!;
    if (type > 4) return { data: out.subarray(0, o), ok: false };
    const n = Math.min(row, data.length - i - 1);
    const up = o - row;
    for (let k = 0; k < n; k++) {
      const a = k >= pix ? out[o + k - pix]! : 0;
      const b = up >= 0 ? out[up + k]! : 0;
      const c = k >= pix && up >= 0 ? out[up + k - pix]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[o + k] = (data[i + 1 + k]! + pred) & 0xff;
    }
    o += n;
  }
  return { data: out.subarray(0, o), ok: true };
}

/**
 * بيانات تيار الكائنات بعد فكّ ضغطها، و`ok` false إن لم تُفكّ كاملةً: مرشّح غير Flate، أو /Predictor غير PNG (لا يطبّقه
 * الفكّ هنا)، أو فكّ فشل (مشفّرة مثلاً)، و`over` إن تجاوزت الميزانية. وما فُكّ قبل الفشل يُقرأ.
 */
function objStmData(raw: Uint8Array, dict: PDFDict, budget: { left: number }, keyless = false): { data: Uint8Array; ok: boolean; noKey?: boolean; over?: boolean } {
  const f = dict.get(PDFName.of("Filter"));
  const filters = f instanceof PDFArray ? f.asArray().map((x) => nameOf(x)) : f === undefined ? [] : [nameOf(f)];
  if (filters.length === 0) {
    if (raw.length > budget.left) { budget.left = 0; return { data: EMPTY, ok: false, over: true }; }
    budget.left -= raw.length;
    return { data: raw, ok: true };
  }
  if (filters.length !== 1 || (filters[0] !== "FlateDecode" && filters[0] !== "Fl")) return { data: EMPTY, ok: false };
  let parms = dict.get(PDFName.of("DecodeParms"));
  if (parms instanceof PDFArray && parms.size() === 1) parms = parms.get(0);
  if (parms === PDFNull) parms = undefined;
  if (parms !== undefined && !(parms instanceof PDFDict)) return { data: EMPTY, ok: false };
  // كما في pdf.js: `params.get(k) || الافتراضي`
  const param = (k: string, d: number) => { const v = parms instanceof PDFDict ? parms.get(PDFName.of(k)) : undefined; return v instanceof PDFNumber && v.asNumber() ? v.asNumber() : d; };
  const p = parms instanceof PDFDict ? parms.get(PDFName.of("Predictor")) : undefined;
  if (p !== undefined && !(p instanceof PDFNumber)) return { data: EMPTY, ok: false };
  const predictor = param("Predictor", 1);
  const png = predictor >= 10 && predictor <= 15;
  if (predictor > 1 && !png) return { data: EMPTY, ok: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let ok = true;
  const u = new Unzlib((c) => { total += c.length; if (total > budget.left) throw OVER; chunks.push(c); });
  try {
    for (let i = 0; i < raw.length; i += 16_384) u.push(raw.subarray(i, i + 16_384), i + 16_384 >= raw.length);
  } catch (e) {
    if (e === OVER) { budget.left = 0; return { data: EMPTY, ok: false, over: true }; }
    ok = false; // تالف: يُقرأ ما فُكّ منه، ويُعدّ
  }
  // ملف بكلمة فتح بلا مفتاح: مرشّح مدعوم (Flate) لم يُفكّ، فسببه التشفير لا عطبٌ في الملف
  const noKey = keyless && !ok;
  budget.left -= total;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  if (!png) return { data: out, ok, noKey };
  const r = unpredictPng(out, param("Colors", 1), param("BPC", param("BitsPerComponent", 8)), param("Columns", 1));
  budget.left = Math.max(0, budget.left - r.data.length); // المصفوفة الثانية (بعد إزالة التنبؤ) تُحسب أيضاً
  return { data: r.data, ok: ok && r.ok, noKey };
}

function indexOfWord(b: Uint8Array, w: string, from: number): number {
  const first = w.charCodeAt(0);
  for (let at = b.indexOf(first, from); at >= 0; at = b.indexOf(first, at + 1)) if (wordAt(b, at, w)) return at;
  return -1;
}

/** كل الكائنات في تيار الكائنات: أزواج «الرقم الموضع» قبل /First، كلها لا الـ/N الأولى وحدها. */
function objStmObjects(data: Uint8Array, first: number | undefined, ctx: PDFContext, add: (key: string, o: PDFObject) => void, unreadable: Uint8Array[]): void {
  if (first === undefined) return;
  const f = Math.min(first, data.length);
  let head = "";
  for (let i = 0; i < f; i++) head += String.fromCharCode(data[i]!);
  const nums = head.match(/[0-9]+/g) ?? [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const at = f + Number(nums[i + 1]);
    if (at >= data.length) continue;
    try {
      add(`${Number(nums[i])} 0`, parseAt(data, at, ctx).obj);
    } catch {
      unreadable.push(data.subarray(at, Math.min(data.length, at + UNREADABLE_MAX)));
    }
  }
}

/** عدد صحيح غير سالب، كما يطلبه pdf.js في /N و/First (`fetchCompressed`). */
const countOf = (v: PDFObject | undefined) => (v instanceof PDFNumber && Number.isInteger(v.asNumber()) && v.asNumber() >= 0 ? v.asNumber() : undefined);

const hexOf = (b: Uint8Array) => {
  let h = "";
  for (const x of b) h += x.toString(16).padStart(2, "0");
  return h;
};

/**
 * سلاسل الكائن (نسخة مقروءة له وحده، تُعدَّل في مكانها) بعد فكّها بمفتاح كائنه، ست عشرية. وما لا يُفكّ يبقى كما قُرئ،
 * ونسخته كما قُرئت تُعدّ معها.
 */
function decryptStrings(o: PDFObject, unlock: (d: Uint8Array) => Uint8Array): PDFObject {
  const open = (v: PDFObject): PDFObject | undefined => {
    if (!(v instanceof PDFString || v instanceof PDFHexString)) return undefined;
    try { return PDFHexString.of(hexOf(unlock(v.asBytes()))); } catch { return undefined; }
  };
  const top = open(o);
  if (top) return top;
  const stack: PDFObject[] = [o];
  while (stack.length) {
    const c = stack.pop();
    if (c instanceof PDFDict) {
      for (const [k, v] of c.entries()) { const d = open(v); if (d) c.set(k, d); else stack.push(v); }
    } else if (c instanceof PDFArray) {
      for (let i = 0; i < c.size(); i++) { const v = c.get(i); const d = open(v); if (d) c.set(i, d); else stack.push(v); }
    }
  }
  return o;
}

/** `keyless`: الملف يطلب كلمة فتح ولا مفتاح له، فما لم يُفكّ من تياراته المدعومة بسبب التشفير لا يُحسب في `undecoded`. */
export function rawScan(bytes: Uint8Array, cipher?: RawCipher, keyless = false): RawScan {
  const text = new TextDecoder("latin1").decode(bytes); // بايت لكل حرف، فالمواضع واحدة
  const ctx = PDFContext.create();
  const versions = new Map<string, PDFObject[]>();
  const unreadable: Uint8Array[] = [];
  const roots = new Set<string>();
  const budget = { left: MAX_INFLATED_BYTES };
  let undecoded = 0;
  const add = (key: string, o: PDFObject) => {
    const l = versions.get(key);
    if (l) l.push(o);
    else versions.set(key, [o]);
  };
  const root = (d: PDFObject) => {
    const r = d instanceof PDFDict ? d.get(PDFName.of("Root")) : undefined;
    if (r instanceof PDFRef) roots.add(refKey(r));
  };

  type Stm = { dict: PDFDict; data: number; num: number; gen: number };
  /**
   * تيار كائنات (معلَن، أو مرشّح بـ/N و/First عددين يقرؤه pdf.js أيّاً كان /Type ومرشّحاته): يُقرأ كما هو، ومفكوكاً
   * بمفتاح التيارات إن كان للملف مفتاح (فالقارئ قد يرى أيّاً منهما)، بكل قيمة لـ/First (`firsts`، فالمرجع قد تكون له
   * نسخ). ويُعدّ في `undecoded` إن لم تنفكّ نسخةٌ منه كاملةً، أو نفدت الميزانية في أيٍّ منهما. وتيار ICC فيه /N بلا
   * /First فلا يصل هنا.
   */
  const objStm = (s: Stm, firsts = [countOf(s.dict.get(PDFName.of("First")))].filter((n) => n !== undefined)) => {
    const raw = streamBytes(bytes, s.dict, s.data);
    const views = [raw];
    if (cipher) {
      try { const d = cipher.stream(s.num, s.gen, raw); if (d !== raw) views.push(d); } catch { /* لا يُفكّ: يبقى كما هو */ }
    }
    let ok = false;
    let over = false;
    for (const v of views) {
      const res = objStmData(v, s.dict, budget, keyless);
      if (res.ok || res.noKey) ok = true;
      if (res.over) over = true;
      for (const first of firsts) objStmObjects(res.data, first, ctx, add, unreadable);
    }
    // /First لم يُحلّ إلى عدد (مرجعٌ إلى كائنٍ في تيار مؤجَّل يأتي بعده): لا يُعرف ما يقرؤه pdf.js، فيُعدّ ولا يُسكَت عنه
    if (!ok || over || !firsts.length) undecoded++;
  };
  /** /N و/First عددان صحيحان غير سالبين، فيقرأ pdf.js منه إن أشار إليه جدول XRef مضغوط أيّاً كان /Type. */
  const counted = (d: PDFDict) => countOf(d.get(PDFName.of("N"))) !== undefined && countOf(d.get(PDFName.of("First"))) !== undefined;
  // ما في /Type أو /N أو /First منه مرجع: يُحلّ بعد أن تُجمع الكائنات كلها، فقد يرد ما يُشير إليه بعده
  const deferred: Stm[] = [];

  for (const m of text.matchAll(HEADER)) {
    const at = m.index! + m[0].length;
    let r: { obj: PDFObject; data?: number };
    try {
      r = parseAt(bytes, at, ctx);
    } catch {
      const end = text.indexOf("endobj", at);
      unreadable.push(bytes.subarray(at, Math.min(end < 0 ? bytes.length : end, at + UNREADABLE_MAX)));
      continue;
    }
    const num = Number(m[1]);
    const gen = Number(m[2]);
    const key = `${num} ${gen}`;
    add(key, r.obj);
    if (cipher && key !== cipher.encrypt) add(key, decryptStrings(parseAt(bytes, at, ctx).obj, (d) => cipher.string(num, gen, d)));
    if (!(r.obj instanceof PDFDict) || r.data === undefined) continue;
    const t = r.obj.get(PDFName.of("Type"));
    const type = nameOf(t);
    if (type === "XRef") root(r.obj);
    const s = { dict: r.obj, data: r.data, num, gen };
    const refs = t instanceof PDFRef || r.obj.get(PDFName.of("N")) instanceof PDFRef || r.obj.get(PDFName.of("First")) instanceof PDFRef;
    if (refs) deferred.push(s); // ولو كان /Type /ObjStm: /First المرجع لا يُعرف إلا بعد الجمع
    else if (type === "ObjStm" || counted(r.obj)) objStm(s);
  }
  // يُحلّ من كائنات المرور نفسها. /Type يُحلّ إلى ObjStm، أو لا يُحلّ إلى اسم وفيه /N و/First: معلَن (الإغلاق على الأشدّ).
  // وما سواه بـ/N و/First عددين (مباشرين أو مُحلَّين): مرشّح. ولكل قيمة عددية مختلفة لـ/First قراءة
  const look = (v: PDFObject | undefined) => (v instanceof PDFRef ? versions.get(refKey(v)) ?? [] : v === undefined ? [] : [v]);
  const counts = (k: string, d: PDFDict) => [...new Set(look(d.get(PDFName.of(k))).map(countOf).filter((n) => n !== undefined))];
  for (const s of deferred) {
    const t = s.dict.get(PDFName.of("Type"));
    const names = t instanceof PDFRef ? look(t).map(nameOf).filter((n) => n !== undefined) : [nameOf(t)];
    const nf = s.dict.has(PDFName.of("N")) && s.dict.has(PDFName.of("First"));
    const declared = names.includes("ObjStm") || (t instanceof PDFRef && !names.length && nf);
    const firsts = counts("First", s.dict);
    if (declared || (firsts.length && counts("N", s.dict).length)) objStm(s, firsts);
    // غير معلَن وفيه /N و/First لم يُحلّا إلى عددين: لا يُعرف أيقرؤه pdf.js تيارَ كائنات، فيُعدّ ولا يُسكَت عنه
    else if (nf) undecoded++;
  }
  for (const m of text.matchAll(TRAILER)) {
    try {
      root(parseAt(bytes, m.index! + m[0].length, ctx).obj);
    } catch { /* ذيل لا يُقرأ: لا /Root منه */ }
  }
  return { versions, unreadable, roots, undecoded };
}
