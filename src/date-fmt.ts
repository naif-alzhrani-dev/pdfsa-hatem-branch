/**
 * التاريخ: هجري بتقويم أم القرى، أو ميلادي، سطراً واحداً دائماً.
 *
 * التاريخ يُمثَّل رقمَ يوم مدنيّ (الأيام منذ 1970-01-01)، فلا منطقة زمنية ولا ساعة.
 * والهجري من جدول أم القرى (`umalqura-data.ts`، مولَّد من .NET UmAlQuraCalendar بـ`scripts/gen-umalqura.ps1`)
 * لا من `Intl`: Safari على iOS لا يعطي ما يعطيه Chromium، فكان الحارس يُطفئ الهجري هناك.
 * والميلادي من `Date` بتوقيت UTC. والكتابة بالأرقام («٢٨/٥/١٤٤٨هـ»)، فلا `Intl` في الحساب ولا في الكتابة.
 */
import { ar } from "./strings";
import { UQ_DAY0, UQ_DAY1, UQ_MONTHS, UQ_Y0, UQ_Y1 } from "./umalqura-data";

export type DateMode = "hijri" | "gregorian";
export type DateUnit = "day" | "month" | "year";
export interface Ymd { y: number; m: number; d: number }

/**
 * علامة RLM بعد كل رقم: الأرقام الهندية وبينها «/» تُعدّ في خوارزمية الاتجاه رقماً واحداً يُقرأ من اليسار
 * (فيظهر ١٤٤٨ يميناً واليوم يساراً). وبالعلامة يصير كل جزء وحده، فيُقرأ من اليمين: اليوم ثم الشهر ثم السنة.
 */
const RLM = "‏";
const numeric = (p: Ymd, suffix: string) => `${ar(p.d)}${RLM}/${ar(p.m)}${RLM}/${ar(p.y)}${suffix}`;

const DAY_MS = 86_400_000;
/** منتصف نهار اليوم بتوقيت UTC، فلا ينزلق اليوم بفارق المنطقة. */
const noon = (day: number) => new Date(day * DAY_MS + DAY_MS / 2);

/** القيد المرجعي: ٨ نوفمبر ٢٠٢٦ = ٢٨ جمادى الأولى ١٤٤٨ (من .NET UmAlQuraCalendar في خطاب سابق). */
export const ANCHOR_DAY = Date.UTC(2026, 10, 8) / DAY_MS;

let starts: Int32Array | undefined;
/** أول يوم لكل شهر في الجدول، والعنصر الأخير اليوم التالي لآخر يوم فيه. */
function monthStarts(): Int32Array {
  if (starts) return starts;
  const n = (UQ_Y1 - UQ_Y0 + 1) * 12;
  starts = new Int32Array(n + 1);
  starts[0] = UQ_DAY0;
  for (let i = 0; i < n; i++) {
    const bits = parseInt(UQ_MONTHS.slice((i / 12 | 0) * 3, (i / 12 | 0) * 3 + 3), 16);
    starts[i + 1] = starts[i]! + ((bits >> (i % 12)) & 1 ? 30 : 29);
  }
  return starts;
}

/** هل اليوم داخل جدول أم القرى (١٤٢٠–١٥٠٠هـ)؟ */
export const inHijriRange = (day: number) => day >= UQ_DAY0 && day <= UQ_DAY1;

function hijriParts(day: number): Ymd {
  if (!inHijriRange(day)) throw new RangeError(`day ${day} outside Umm al-Qura table`);
  const s = monthStarts();
  let lo = 0, hi = s.length - 2; // آخر شهر أوّله <= day
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= day) lo = mid; else hi = mid - 1;
  }
  return { y: UQ_Y0 + (lo / 12 | 0), m: lo % 12 + 1, d: day - s[lo]! + 1 };
}

/**
 * هل يُعرض الهجري؟ نعم ما دام اليوم داخل الجدول. وخارجه الصيغة الافتراضية الميلادي.
 */
export function hijriAvailable(now = new Date()): boolean {
  return inHijriRange(todayDay(now));
}

export const defaultMode = (): DateMode => (hijriAvailable() ? "hijri" : "gregorian");

/** الصيغة من قيمة قد تكون قديمة: كل ما ليس «ميلادي» هجري (ومنه «both» الذي حُذف). */
export const asMode = (m: unknown): DateMode => (m === "gregorian" ? "gregorian" : "hijri");

/** يوم اليوم بتقويم الجهاز المحلي. */
export function todayDay(now = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

export function gregorianOf(day: number): Ymd {
  const t = noon(day);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export function dayOfGregorian(y: number, m: number, d: number): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // Date.UTC يحوّل السنوات 0–99 إلى 19xx
  return Math.round(t.getTime() / DAY_MS);
}
export function gregorianMonthLength(y: number, m: number): number {
  return dayOfGregorian(y, m + 1, 1) - dayOfGregorian(y, m, 1);
}

export const hijriOf = hijriParts;

const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;

/** رقم اليوم لتاريخ هجري (أم القرى) من الجدول. */
export function dayOfHijri(y: number, m: number, d: number): number {
  const i = (y - UQ_Y0) * 12 + (m - 1);
  const s = monthStarts();
  if (!Number.isInteger(i) || i < 0 || i >= s.length - 1 || m < 1 || m > 12 || d < 1 || d > s[i + 1]! - s[i]!)
    throw new RangeError(`no Umm al-Qura day for ${y}-${m}-${d}`);
  return s[i]! + d - 1;
}

/** طول الشهر الهجري: من أوله إلى أول الشهر التالي. */
export function hijriMonthLength(y: number, m: number): number {
  const i = (y - UQ_Y0) * 12 + (m - 1), s = monthStarts();
  if (i < 0 || i >= s.length - 1 || m < 1 || m > 12) throw new RangeError(`no Umm al-Qura month ${y}-${m}`);
  return s[i + 1]! - s[i]!;
}

/** «٢٨/٥/١٤٤٨هـ» (بعلامة RLM بعد كل رقم) */
export function formatHijri(day: number): string {
  return numeric(hijriParts(day), "هـ");
}
/** «٨/١١/٢٠٢٦م» (بعلامة RLM بعد كل رقم) */
export function formatGregorian(day: number): string {
  return numeric(gregorianOf(day), "م");
}
/** سطر التاريخ بالصيغة، واحد دائماً. وخارج الجدول الميلادي. */
export function formatLines(day: number, mode: DateMode): string[] {
  return [asMode(mode) === "gregorian" || !inHijriRange(day) ? formatGregorian(day) : formatHijri(day)];
}

/** نقل شهرٍ أو سنة مع قصّ اليوم إلى طول الشهر الهدف. */
function shift(p: Ymd, unit: "month" | "year", delta: number): Ymd {
  if (unit === "year") return { ...p, y: p.y + delta };
  const k = p.y * 12 + (p.m - 1) + delta;
  return { y: Math.floor(k / 12), m: (k % 12 + 12) % 12 + 1, d: p.d };
}

/**
 * ضبط التاريخ في التقويم الظاهر: اليوم ±1، والشهر ±1، والسنة ±1، ويُقصّ اليوم إن تجاوز طول الشهر.
 * وفي الهجري لا يخرج الضبط من الجدول: يبقى التاريخ كما هو.
 */
export function adjust(day: number, mode: DateMode, unit: DateUnit, delta: number): number {
  if (unit === "day") return mode === "gregorian" || inHijriRange(day + delta) || !inHijriRange(day) ? day + delta : day;
  if (mode === "gregorian" || !inHijriRange(day)) {
    const t = shift(gregorianOf(day), unit, delta);
    return dayOfGregorian(t.y, t.m, Math.min(t.d, gregorianMonthLength(t.y, t.m)));
  }
  const t = shift(hijriParts(day), unit, delta);
  if (t.y < UQ_Y0 || t.y > UQ_Y1) return day;
  return dayOfHijri(t.y, t.m, Math.min(t.d, hijriMonthLength(t.y, t.m)));
}

/* ───── الإضافة ١١: التاريخ يُكتب، والتقويم (docs/logs/additions-10-11-lama-spec.md) ───── */

/** الصيغة الظاهرة فعلاً: الهجري خارج الجدول يُعرض ميلادياً (كـformatLines وadjust). */
export const shownMode = (day: number, mode: DateMode): DateMode => (mode === "gregorian" || !inHijriRange(day) ? "gregorian" : "hijri");
/** اليوم والشهر والسنة في الصيغة الظاهرة. */
export const partsOf = (day: number, mode: DateMode): Ymd => (shownMode(day, mode) === "gregorian" ? gregorianOf(day) : hijriParts(day));

/** مدى السنة: الهجري جدول أم القرى (١٤٢٠–١٥٠٠)، والميلادي ١٩٠٠–٢١٠٠. */
export const GREG_Y0 = 1900, GREG_Y1 = 2100;
export const yearRange = (mode: DateMode): [number, number] => (mode === "hijri" ? [UQ_Y0, UQ_Y1] : [GREG_Y0, GREG_Y1]);
export const monthLength = (mode: DateMode, y: number, m: number) => (mode === "hijri" ? hijriMonthLength(y, m) : gregorianMonthLength(y, m));
export const dayOf = (mode: DateMode, y: number, m: number, d: number) => (mode === "hijri" ? dayOfHijri(y, m, d) : dayOfGregorian(y, m, d));
/** أول يوم وآخر يوم في مدى الصيغة. */
export const dayBounds = (mode: DateMode): [number, number] =>
  mode === "hijri" ? [UQ_DAY0, UQ_DAY1] : [dayOfGregorian(GREG_Y0, 1, 1), dayOfGregorian(GREG_Y1, 12, 31)];

/** يوم الأسبوع: ٠ الأحد … ٦ السبت (١٩٧٠/١/١ خميس). */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;
/** يوم الأسبوع لأول الشهر: عدد الخلايا الفارغة قبله في تقويم يبدأ بالأحد. */
export const firstWeekday = (mode: DateMode, y: number, m: number) => weekdayOf(dayOf(mode, y, m, 1));

/** حدود الحقل في الصيغة الظاهرة: اليوم ١..طول الشهر، والشهر ١–١٢، والسنة مدى الصيغة. */
export function unitRange(day: number, mode: DateMode, unit: DateUnit): [number, number] {
  const md = shownMode(day, mode), p = partsOf(day, mode);
  if (unit === "day") return [1, monthLength(md, p.y, p.m)];
  if (unit === "month") return [1, 12];
  return yearRange(md);
}
/**
 * يكتب `n` في الحقل: يُرجع اليوم الجديد، أو null إن خرج `n` من حدود الحقل.
 * تغيير الشهر أو السنة يقصّ اليوم إلى طول الشهر الهدف.
 */
export function setUnit(day: number, mode: DateMode, unit: DateUnit, n: number): number | null {
  const [lo, hi] = unitRange(day, mode, unit);
  if (!Number.isInteger(n) || n < lo || n > hi) return null;
  const md = shownMode(day, mode), p = partsOf(day, mode);
  const q = { ...p, [unit === "day" ? "d" : unit === "month" ? "m" : "y"]: n } as Ymd;
  return dayOf(md, q.y, q.m, Math.min(q.d, monthLength(md, q.y, q.m)));
}

const LATIN = (s: string) => s.replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)));
/** ما يُكتب في الحقل: يُبقي الأرقام (اللاتينية والهندية والفارسية) ويعرضها هندية. */
export const fieldDigits = (s: string) => LATIN(s).replace(/\D/g, "").replace(/\d/g, (c) => String.fromCharCode(0x0660 + Number(c)));
/** قيمة الحقل رقماً، أو null إن لم يكن أرقاماً وحدها. */
export function parseUnit(raw: string): number | null {
  const s = LATIN(raw).trim();
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
}
