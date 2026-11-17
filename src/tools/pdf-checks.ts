/**
 * فحوص مشتركة بين الحماية والفك والضغط، قبل التحميل وبعده.
 * قبل التحميل: حجم الملف، وتمدّد التدفّقات التي تفكّها المكتبة كلها عند التحميل (تدفّقات الكائنات وجداول XRef).
 * فملفٌ من 400 KB تمدّد إلى 400 MB رفع الذاكرة نحو 440 MB وأخذ نحو ٦ ث لكل أداة قبل هذا الحارس.
 *
 * هذا الحارس طبقة أولى لا الحماية كلها: الحماية الحقيقية تشغيل الأدوات في عامل يُنهى بمهلة (`run-tool.ts`).
 * وهو يقرأ بنية الملف قراءة المحلِّل لا بحثاً في النص: يتخطّى التعليقات والسلاسل ومحتوى التدفّقات،
 * ويوازن `<< >>`، ويحدّد آخر التدفّق كما تحدّده المكتبة (‏/Length إن تلاه endstream، وإلا البحث عن endstream).
 */
import { Unzlib } from "fflate";

export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
/** مجموع ما تتمدّد إليه تدفّقات ObjStm وXRef. ملف عادي من مئات الصفحات لا يقارب ٥ MB. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

export type InputError = "too-big" | "bad-pdf";
/** `encrypted`: في ذيل (‏trailer) أو قاموس جدول XRef مفتاح /Encrypt، من أي نسخة في الملف. */
export interface InputScan { error: InputError | null; encrypted: boolean }

const word = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const STREAM = word("stream");
const ENDSTREAM = word("endstream");
const OVER = new Error("over");

const WS = new Uint8Array(256);
for (const c of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIM[c.charCodeAt(0)] = 1;

function matchesAt(b: Uint8Array, at: number, w: number[]): boolean {
  for (let i = 0; i < w.length; i++) if (b[at + i] !== w[i]) return false;
  return true;
}

/** كم يتمدّد التدفّق، ويتوقف حين يتجاوز `budget`. ما ليس zlib (تالف أو مشفَّر) يُعدّ حتى موضع الخطأ. */
function inflatedSize(data: Uint8Array, budget: number): number {
  let total = 0;
  const unzlib = new Unzlib((chunk) => { total += chunk.length; if (total > budget) throw OVER; });
  try {
    // دفعات صغيرة: أقصى تمدّد لـdeflate نحو ١٠٣٢ ضعفاً، فلا تتجاوز الدفعة الواحدة نحو ١٦ MB
    for (let i = 0; i < data.length; i += 16_384) unzlib.push(data.subarray(i, i + 16_384), i + 16_384 >= data.length);
  } catch { /* تجاوز، أو ليس zlib */ }
  return total;
}

type Tok =
  | { k: "name"; v: string }
  | { k: "num"; v: number }
  | { k: "word"; v: string }
  | { k: "arr"; names: string[] | null } // null: في المصفوفة غير الأسماء
  | { k: "other" };
type Value = { k: "name"; v: string } | { k: "num"; v: number } | { k: "ref"; key: string } | { k: "arr"; names: string[] | null } | { k: "other" };

/** مداخل القاموس الأعلى: الاسم ثم قيمته، و`N G R` مرجعاً. */
function entries(toks: Tok[]): Map<string, Value> {
  const out = new Map<string, Value>();
  for (let i = 0; i < toks.length;) {
    const key = toks[i];
    if (key?.k !== "name") { i++; continue; }
    const [a, b, c] = [toks[i + 1], toks[i + 2], toks[i + 3]];
    if (a?.k === "num" && b?.k === "num" && c?.k === "word" && c.v === "R") { out.set(key.v, { k: "ref", key: `${a.v} ${b.v}` }); i += 4; continue; }
    out.set(key.v, a === undefined || a.k === "word" ? { k: "other" } : a);
    i += 2;
  }
  return out;
}

interface StreamDict { dict: Map<string, Value>; start: number; end: number }

/**
 * يمرّ على الملف مرّة: يجمع قواميس التدفّقات ومواضع بياناتها، والقيم البسيطة للكائنات (اسم أو مصفوفة أسماء)
 * ليُحلّ بها مرجع /Type أو /Filter، وقواميس الذيول.
 */
function lex(b: Uint8Array): { streams: StreamDict[]; simple: Map<string, Value>; trailers: Map<string, Value>[] } {
  const n = b.length;
  const streams: StreamDict[] = [];
  const simple = new Map<string, Value>();
  const trailers: Map<string, Value>[] = [];

  const stack: ("d" | "a")[] = [];
  let top: Tok[] | null = null; // رموز القاموس الأعلى للكائن
  let arr: string[] | null | undefined; // أسماء مصفوفة مفتوحة في القاموس الأعلى أو قيمةً للكائن
  let dict: Map<string, Value> | null = null; // آخر قاموس أعلى أُغلق، ينتظر stream
  let obj: string | null = null; // «N G» للكائن الحالي
  let objHasValue = false;
  let trailerNext = false;
  let prev1: Tok | null = null, prev2: Tok | null = null; // آخر رمزين في المستوى صفر

  const atTop = () => stack.length === 1 && stack[0] === "d";
  const push = (t: Tok) => {
    if (atTop() && top) top.push(t);
    else if (stack.length === 2 && stack[0] === "d" && stack[1] === "a" && arr !== undefined && top) { if (arr && t.k === "name") arr.push(t.v); else arr = null; }
    else if (stack.length === 1 && stack[0] === "a" && arr !== undefined) { if (arr && t.k === "name") arr.push(t.v); else arr = null; }
    else if (stack.length === 0) {
      if (obj && !objHasValue && t.k === "name") simple.set(obj, t);
      if (obj) objHasValue = true;
      prev2 = prev1; prev1 = t;
    }
  };
  const reset = () => { stack.length = 0; top = null; arr = undefined; dict = null; };

  let p = 0;
  while (p < n) {
    const c = b[p]!;
    if (WS[c]) { p++; continue; }
    if (c === 0x25) { // تعليق حتى آخر السطر
      while (p < n && b[p] !== 0x0a && b[p] !== 0x0d) p++;
      continue;
    }
    if (c === 0x28) { // سلسلة: أقواس متوازنة، و\ تهرّب ما بعدها
      let depth = 1;
      for (p++; p < n && depth > 0; p++) {
        const x = b[p];
        if (x === 0x5c) p++;
        else if (x === 0x28) depth++;
        else if (x === 0x29) depth--;
      }
      push({ k: "other" });
      continue;
    }
    if (c === 0x3c && b[p + 1] === 0x3c) {
      p += 2;
      if (stack.length === 0) { top = []; if (obj) objHasValue = true; }
      else if (atTop()) top?.push({ k: "other" }); // قاموس متداخل: قيمة لا تُقرأ
      else if (arr !== undefined) arr = null;
      stack.push("d");
      continue;
    }
    if (c === 0x3e && b[p + 1] === 0x3e) {
      p += 2;
      if (stack[stack.length - 1] === "d") stack.pop();
      if (stack.length === 0 && top) {
        dict = entries(top);
        if (trailerNext) trailers.push(dict);
        trailerNext = false;
        top = null;
      }
      continue;
    }
    if (c === 0x3c) { // سلسلة ست عشرية
      const end = b.indexOf(0x3e, p + 1);
      p = end < 0 ? n : end + 1;
      push({ k: "other" });
      continue;
    }
    if (c === 0x5b) {
      p++;
      if (arr !== undefined) arr = null; // مصفوفة داخل مصفوفة: ليست قائمة مرشّحات
      else if (atTop() || (stack.length === 0 && obj && !objHasValue)) arr = [];
      else if (stack.length === 0 && obj) objHasValue = true;
      stack.push("a");
      continue;
    }
    if (c === 0x5d) {
      p++;
      if (stack[stack.length - 1] === "a") stack.pop();
      if (arr !== undefined) {
        if (atTop()) top?.push({ k: "arr", names: arr });
        else if (stack.length === 0 && obj) { simple.set(obj, { k: "arr", names: arr }); objHasValue = true; }
        if (atTop() || stack.length === 0) arr = undefined;
      }
      continue;
    }
    if (c === 0x2f) { // اسم، و#xx يُفك كما تفكّه المكتبة
      let q = p + 1;
      while (q < n && !WS[b[q]!] && !DELIM[b[q]!]) q++;
      let v = "";
      for (let i = p + 1; i < q; i++) v += String.fromCharCode(b[i]!);
      push({ k: "name", v: v.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) });
      p = q;
      continue;
    }
    if (DELIM[c]) { p++; continue; } // ) أو { أو } شاردة

    // كلمة: رقم أو كلمة مفتاحية. و«stream» قد يليها التدفّق بلا فاصل
    if (stack.length === 0 && dict && matchesAt(b, p, STREAM)) {
      let start = p + 6;
      if (b[start] === 0x20 && b[start + 1] === 0x0d && b[start + 2] === 0x0a) start += 3;
      else if (b[start] === 0x0d && b[start + 1] === 0x0a) start += 2;
      else if (b[start] === 0x0d || b[start] === 0x0a) start += 1;
      const { end, resume } = streamEnd(b, start, dict.get("Length"));
      streams.push({ dict, start, end });
      dict = null;
      p = resume;
      continue;
    }
    let q = p;
    while (q < n && !WS[b[q]!] && !DELIM[b[q]!]) q++;
    let w = "";
    for (let i = p; i < q && i < p + 32; i++) w += String.fromCharCode(b[i]!);
    p = q;
    if (w === "obj") {
      reset();
      const [g, num] = [prev1 as Tok | null, prev2 as Tok | null]; // تُسنَد داخل push فلا يراها TypeScript
      obj = g?.k === "num" && num?.k === "num" ? `${num.v} ${g.v}` : null;
      objHasValue = false;
      prev1 = prev2 = null;
      continue;
    }
    if (w === "endobj") { reset(); obj = null; prev1 = prev2 = null; continue; }
    if (w === "trailer" && stack.length === 0) { trailerNext = true; dict = null; continue; }
    dict = stack.length === 0 ? null : dict;
    push(/^[+-]?\d+$/.test(w) ? { k: "num", v: Number(w) } : { k: "word", v: w });
  }
  return { streams, simple, trailers };
}

/** آخر بيانات التدفّق كما تحدّده المكتبة (PDFObjectParser.parseDictOrStream وfindEndOfStreamFallback)، وموضع ما بعد endstream. */
function streamEnd(b: Uint8Array, start: number, length: Value | undefined): { end: number; resume: number } {
  if (length?.k === "num" && length.v >= 0 && start + length.v <= b.length) {
    let q = start + length.v;
    for (;;) {
      while (q < b.length && WS[b[q]!]) q++;
      if (b[q] !== 0x25) break;
      while (q < b.length && b[q] !== 0x0a && b[q] !== 0x0d) q++;
    }
    if (matchesAt(b, q, ENDSTREAM)) return { end: start + length.v, resume: q + 9 };
  }
  // بلا /Length صحيح: «stream» داخل البيانات تزيد العمق، و«endstream» تنقصه
  let level = 1;
  for (let at = b.indexOf(0x73, start); at >= 0; at = b.indexOf(0x73, at + 1)) {
    if (!matchesAt(b, at, STREAM)) continue;
    const e = at - 3;
    if (e >= start && b[e] === 0x65 && b[e + 1] === 0x6e && b[e + 2] === 0x64) {
      if (--level === 0) {
        const end = b[e - 2] === 0x0d && b[e - 1] === 0x0a && e - 2 >= start ? e - 2 : (b[e - 1] === 0x0d || b[e - 1] === 0x0a) && e - 1 >= start ? e - 1 : e;
        return { end, resume: at + 6 };
      }
    } else level++;
    at += 5;
  }
  return { end: b.length, resume: b.length }; // بلا نهاية: المكتبة ترفضه، ويُقاس إلى آخر الملف احتياطاً
}

/**
 * يُستدعى قبل `PDFDocument.load`. يعيد رمز الخطأ أو null، ووجود /Encrypt في ذيل.
 * يُقاس كل تدفّق نوعه ObjStm أو XRef، أو نوعه مرجع لا يُحلّ إلى غيرهما، أو فيه /N و/First عددان صحيحان غير سالبين
 * (تيار كائنات مرشّح يقرؤه pdf.js أيّاً كان نوعه، كما في `inspect-raw.ts`)، ومرشّحه Flate أو مرجع.
 * التدفّقات المشفَّرة لا تُقاس هنا (تُفك بعد التحميل)، فتلك يحميها العامل والمهلة.
 */
export function scanPdf(bytes: Uint8Array): InputScan {
  if (bytes.length > MAX_INPUT_BYTES) return { error: "too-big", encrypted: false };
  const { streams, simple, trailers } = lex(bytes);
  const resolve = (v: Value | undefined): Value | undefined => (v?.k === "ref" ? simple.get(v.key) ?? v : v);

  let encrypted = trailers.some((t) => t.has("Encrypt"));
  let error: InputError | null = null;
  let total = 0;
  for (const { dict, start, end } of streams) {
    const type = resolve(dict.get("Type"));
    const known = type?.k === "name" && (type.v === "ObjStm" || type.v === "XRef");
    const unknown = type?.k === "ref"; // مرجع لكائن لم يوجد بقيمة بسيطة
    const count = (k: string) => { const v = resolve(dict.get(k)); return v?.k === "num" && v.v >= 0; };
    if (!known && !unknown && !(count("N") && count("First"))) continue;
    if (type?.k === "name" && type.v === "XRef" && dict.has("Encrypt")) encrypted = true;
    if (error) continue;

    const filter = resolve(dict.get("Filter"));
    if (filter === undefined) continue; // بلا مرشّح لا تمدّد
    const names = filter.k === "name" ? [filter.v] : filter.k === "arr" ? filter.names : null;
    const flate = names?.length === 1 && (names[0] === "FlateDecode" || names[0] === "Fl");
    if (!flate && names && known) { error = "bad-pdf"; continue; } // سلسلة مرشّحات أو غير Flate: لا تُقاس
    if (!flate && names) continue; // نوع مجهول أو مرشّح بمرشّح معروف غير Flate: ليس ما تفكّه المكتبة عند التحميل
    total += inflatedSize(bytes.subarray(start, end), MAX_INFLATED_BYTES - total);
    if (total > MAX_INFLATED_BYTES) error = "bad-pdf";
  }
  return { error, encrypted };
}

export function checkInput(bytes: Uint8Array): InputError | null {
  return scanPdf(bytes).error;
}

type DictLike = { lookup(key: never): unknown; has(key: never): boolean };

/**
 * هل في الملف توقيع رقمي: كل قاموس (كائن مستقل) فيه /ByteRange و/Contents ونوعه /Sig أو /DocTimeStamp أو بلا /Type،
 * وكل /V لحقل /FT /Sig، مستقلاً كان أو مباشراً.
 * يُمرَّر صنف القاموس واسمه من المكتبة المستعملة، فالحماية والفك بـ@cantoo/pdf-lib والضغط بـpdf-lib.
 */
export function hasSignature(objects: [unknown, unknown][], isDict: (o: unknown) => o is DictLike, name: (s: string) => unknown): boolean {
  const [type, sig, ts, range, contents, ft, v] = ["Type", "Sig", "DocTimeStamp", "ByteRange", "Contents", "FT", "V"].map(name) as [never, never, never, never, never, never, never];
  const isSig = (o: unknown) => {
    if (!isDict(o) || !o.has(range) || !o.has(contents)) return false;
    const t = o.lookup(type);
    return t === undefined || t === sig || t === ts;
  };
  return objects.some(([, o]) => isSig(o) || (isDict(o) && o.lookup(ft) === sig && o.lookup(v) !== undefined));
}
