/**
 * نطاقات «تقسيم ملف»: النصّ المكتوب ← ملفات، وكل ملف قائمة صفحات (من ١) مرتّبة تصاعدياً.
 * الحقل هو المرجع: اللمس يعدّل الملفات، ثم يُعاد كتابة الحقل بـ`formatRanges`.
 *
 * الصيغة: الملفات تُفصل بـ«،» أو «,»، وداخل الملف تُربط الأجزاء بـ«و» أو «+»، والنطاق «-» أو «–».
 * والأرقام هندية أو فارسية أو لاتينية. والمقلوب «٥-٣» يُقبل «٣-٥».
 */
import { toLatinDigits } from "./numerals";
import { ar } from "./strings";

export type Files = number[][];
export type RangeIssue =
  | { kind: "out"; page: number } // لا توجد هذه الصفحة
  | { kind: "overlap"; page: number } // الصفحة في أكثر من ملف
  | { kind: "syntax" }; // حرف غير صالح أو جزء ناقص
export interface Parsed { files: Files; issues: RangeIssue[] }

const FILE_SEP = /[،,]/;
const JOIN = /[و+]/;
const ITEM = /^(\d+)(?:[-–](\d+))?$/;

/**
 * يحلّل الحقل. ما صحّ من الأجزاء يُحدَّد (التحديد حيّ أثناء الكتابة)، وما لم يصحّ يُرفع في `issues` ولا يُحدَّد:
 * النطاق الخارج عن المدى كله، والصفحة المتداخلة من الملف الثاني فما بعده.
 * وفاصل الملفات في آخر الحقل يفتح ملفاً فارغاً أخيراً (اللمس التالي يضيف إليه). والحقل الفارغ لا خطأ فيه.
 */
export function parseRanges(text: string, total: number): Parsed {
  const issues: RangeIssue[] = [];
  const files: Files = [];
  const seen = new Set<number>();
  const segs = toLatinDigits(text).replace(/\s+/g, "").split(FILE_SEP);
  segs.forEach((seg, i) => {
    if (seg === "") {
      if (i === segs.length - 1 && files.length) files.push([]); // «١-٣،» ملف جديد فارغ ينتظر
      return;
    }
    const pages = new Set<number>();
    for (const item of seg.split(JOIN)) {
      const m = ITEM.exec(item);
      if (!m) { pushOnce(issues, { kind: "syntax" }); continue; }
      let a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > total) { issues.push({ kind: "out", page: b > total ? b : a }); continue; }
      for (let p = a; p <= b; p++) pages.add(p);
    }
    const own: number[] = [];
    for (const p of [...pages].sort((x, y) => x - y)) {
      if (seen.has(p)) { issues.push({ kind: "overlap", page: p }); continue; }
      seen.add(p);
      own.push(p);
    }
    if (own.length) files.push(own);
  });
  return { files, issues };
}

function pushOnce(list: RangeIssue[], it: RangeIssue) {
  if (!list.some((x) => x.kind === it.kind)) list.push(it);
}

/** «١-٣ و٥، ٦-٨»: المتتالي نطاق، والأجزاء بـ« و»، والملفات بـ«، »، والفارغ يُترك. */
export function formatRanges(files: Files): string {
  return files
    .filter((f) => f.length)
    .map((f) => runs([...f].sort((a, b) => a - b)).map(([a, b]) => (a === b ? ar(a) : `${ar(a)}-${ar(b)}`)).join(" و"))
    .join("، ");
}

function runs(sorted: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else if (!last || p !== last[1]) out.push([p, p]);
  }
  return out;
}

/**
 * لمس صفحة: المختارة تُزال من ملفها، وغير المختارة تُضاف إلى آخر ملف (أو تصير ملفاً أول).
 * والملف الذي يفرغ يُحذف، إلا الأخير فيبقى فارغاً لأنه الملف الجاري.
 */
export function toggle(files: Files, page: number): Files {
  const at = files.findIndex((f) => f.includes(page));
  if (at >= 0) {
    const out = files.map((f, i) => (i === at ? f.filter((p) => p !== page) : f.slice()));
    return out.filter((f, i) => f.length || i === out.length - 1);
  }
  if (!files.length) return [[page]];
  return files.map((f, i) => (i === files.length - 1 ? [...f, page].sort((a, b) => a - b) : f.slice()));
}

/** «كل صفحة في ملف»: الملف كله، صفحةً في كل ملف. */
export function everyPage(total: number): Files {
  return Array.from({ length: total }, (_, i) => [i + 1]);
}

/** رقم الملف الناتج (من ١) لكل صفحة مختارة، لدوائر الشبكة. */
export function fileOfPage(files: Files): Map<number, number> {
  const m = new Map<number, number>();
  files.forEach((f, i) => f.forEach((p) => m.set(p, i + 1)));
  return m;
}

/** هل يصحّ الاستخراج: صفحة واحدة على الأقل، ولا خطأ. */
export const canExtract = (p: Parsed) => p.issues.length === 0 && p.files.some((f) => f.length > 0);
