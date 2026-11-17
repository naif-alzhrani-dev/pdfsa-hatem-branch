/**
 * علامات القلمين «تحديد» و«رسم» (الملاحظة ٨ من تحديث 1.0.2، docs/logs/pens-lama-spec.md §٢ و§٣ و§٤، قرار نايف «أ»):
 * تُحفظ في محتوى الصفحة نفسه، لا تعليقاً `/Highlight`، ولا تُحوّل الصفحة صورة، ولا تدخل صورة الطمس.
 * والمواضع بنقاط الصفحة غير المُدارة (فضاء PDF قبل /Rotate)، كأغطية الطمس، فتبقى في مكانها مع التدوير والنقل.
 */
import { BlendMode, LineCapStyle, rgb, type PDFPage } from "pdf-lib";
import { snapText, snapInk, type Box, type Lum, type Pt, type TLine } from "./redact";
import type { PdfRect } from "./redact-save";

export type PenTool = "redact" | "highlight" | "draw";
export const PEN_TOOLS: PenTool[] = ["redact", "highlight", "draw"];
/** تحديد: مستطيل لكل سطر. */
export interface Highlight { kind: "hl"; id: string; pageUid: string; rects: PdfRect[] }
/** رسم: خطّ بنقاطه (x, y متتاليتين)، بسماكة ثابتة بالنقاط ولون حبر المشروع. */
export interface Ink { kind: "ink"; id: string; pageUid: string; pts: number[]; width: number; color: string }

/** الأصفر #FFE14D بشفافية ‎0.45 ومزج multiply (§٢)، في الملف وعلى الشاشة (`--mark-hl-paper`). */
export const HL_RGB: [number, number, number] = [1, 0.882, 0.302];
export const HL_OPACITY = 0.45;
/** السماكات بالنقاط (§٣)، والمتوسط افتراضي. */
export const INK_WIDTHS = { thin: 1.5, mid: 3, wide: 6 } as const;
export type InkWidth = keyof typeof INK_WIDTHS;
// hasOwn لا `in`: القيمة من localStorage، و«toString» و«constructor» موروثان في كل كائن (pens-fixes §٢)
export const isInkWidth = (v: unknown): v is InkWidth => typeof v === "string" && Object.hasOwn(INK_WIDTHS, v);
export const isPenTool = (v: unknown): v is PenTool => typeof v === "string" && (PEN_TOOLS as string[]).includes(v);
/** أدنى مسافة بين نقطتين متتاليتين في الخطّ، ببكسلات الشاشة (§٣). */
export const INK_MIN_PX = 0.75;
/** شريط التحديد في صفحة بلا نصّ ولا حبر تحت السحب: ارتفاعه بالنقاط (§٢). */
export const HL_BLANK_PT = 14;
/** ما يُزاد فوق السطر وتحته من ارتفاعه (§٢). */
export const HL_PAD = 0.15;

/**
 * مسار SVG للخطّ: تنعيم تربيعي بين منتصفات النقاط، و`map` يحوّل كل نقطة إلى فضاء الرسم.
 * والنقطة الواحدة (ضغطة بلا حركة) خطٌّ قصير جداً، فيرسمها الطرف المستدير نقطةً.
 */
export function inkPath(pts: number[], map: (x: number, y: number) => [number, number]): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) p.push(map(pts[i]!, pts[i + 1]!));
  if (!p.length) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  const [x0, y0] = p[0]!;
  if (p.length === 1) return `M${f(x0)} ${f(y0)}L${f(x0 + 0.01)} ${f(y0)}`;
  let d = `M${f(x0)} ${f(y0)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i]!, [nx, ny] = p[i + 1]!;
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [xl, yl] = p.at(-1)!;
  return `${d}L${f(xl)} ${f(yl)}`;
}

/**
 * مستطيلات التحديد في شبكة الإضاءة لمدى السحب a→b: في صفحة فيها نصّ يلتقط الكلمات كالطمس (`snapText`) أفقياً،
 * وارتفاعه ارتفاع السطر وفوقه وتحته ‎0.15 منه، ويُقصّ عند منتصف المسافة إلى السطر المجاور.
 * وبلا نصّ: الحبر تحت السحب (`snapInk`)، وإلا شريط `band` بكسلاً بعرض السحب.
 */
export function hlBoxes(g: Lum, lines: TLine[], a: Pt, b: Pt, band: number): Box[] {
  if (!lines.length) {
    const ink = snapInk(g, a, b);
    if (ink.length) return ink;
    const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(g.w, Math.max(a.x, b.x)), yc = (a.y + b.y) / 2;
    if (x1 - x0 < 1) return [];
    return [{ x0, x1, y0: Math.max(0, yc - band / 2), y1: Math.min(g.h, yc + band / 2) }];
  }
  const sorted = [...lines].sort((p, q) => p.base - q.base);
  return snapText(g, lines, a, b).map((bx) => {
    const cy = (bx.y0 + bx.y1) / 2;
    // سطر المستطيل: أقرب خطّ قاعدة إلى قلب الحروف (base − ‎0.35h)
    const i = sorted.reduce((best, l, k) => (Math.abs(l.base - 0.35 * l.h - cy) < Math.abs(sorted[best]!.base - 0.35 * sorted[best]!.h - cy) ? k : best), 0);
    const l = sorted[i]!, up = sorted[i - 1], down = sorted[i + 1];
    let y0 = l.base - l.h - HL_PAD * l.h, y1 = l.base + HL_PAD * l.h;
    if (up) y0 = Math.max(y0, (up.base + (l.base - l.h)) / 2);
    if (down) y1 = Math.min(y1, (l.base + (down.base - down.h)) / 2);
    return { x0: bx.x0, x1: bx.x1, y0: Math.max(0, y0), y1: Math.min(g.h, y1) };
  });
}

/**
 * المستطيل بعد طرح عمود كل غطاء يمسّه (`cuts`): يبقى منه ما على يسار الغطاء ويمينه، بارتفاعه كاملاً. بفضاء PDF نفسه [x0, y0, x1, y1].
 * للصفحة المطموسة: التحديد يلتصق بحبر الكلمات تحت الغطاء، فلولا الطرح لحمل الملف حدود كل كلمة مخفية (ملاحظة أمين، pens-fixes §١).
 * ويُطرح العمود لا مساحة الغطاء وحدها: التحديد أطول من الغطاء بـ‎0.15 من السطر فوقه وتحته، وشريطاه هناك يبدآن من حدّ الكلمة المخفية.
 */
export function cutRects(r: PdfRect, cuts: PdfRect[]): PdfRect[] {
  let out: PdfRect[] = [r];
  for (const c of cuts) out = out.flatMap((a): PdfRect[] => {
    const [x0, y0, x1, y1] = a;
    if (c[0] >= x1 || c[2] <= x0 || c[1] >= y1 || c[3] <= y0) return [a];
    const res: PdfRect[] = [];
    if (c[0] > x0) res.push([x0, y0, c[0], y1]);
    if (c[2] < x1) res.push([c[2], y0, x1, y1]);
    return res;
  });
  return out;
}

// اللون من العلامة المحفوظة: غير #RRGGBB يُرسم أسود، فلا يُكتب NaN في الملف (بند أمين). تعبيرٌ محليّ إلى أن يُدمج isHexInk
const HEX6 = /^#[0-9A-F]{6}$/i;
const hex = (c: string) => (!HEX6.test(c) ? rgb(0, 0, 0) : rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255));

/**
 * يرسم التحديد ثم الرسم في محتوى الصفحة (§٤): مستطيلات بمزج Multiply، وخطوط بطرف مستدير. لا تعليق ولا صورة.
 * `map` من فضاء PDF الأصلي إلى فضاء الصفحة الناتجة: الهويّة للصفحة المنسوخة، وللمطموسة (صفحة جديدة قائمة بمقاس العرض) العرضُ مقلوباً رأسياً.
 */
export function drawMarks(page: PDFPage, hls: Highlight[], inks: Ink[], map: (x: number, y: number) => [number, number] = (x, y) => [x, y]): void {
  for (const m of hls) for (const r of m.rects) {
    const [ax, ay] = map(r[0], r[1]), [bx, by] = map(r[2], r[3]);
    page.drawRectangle({
      x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay),
      color: rgb(...HL_RGB), opacity: HL_OPACITY, blendMode: BlendMode.Multiply,
    });
  }
  for (const m of inks) {
    // drawSvgPath يقلب المحور الرأسي (scale 1 −1 من x, y): فيُعطى المسارُ y سالباً من الأصل
    const d = inkPath(m.pts, (x, y) => { const [u, v] = map(x, y); return [u, -v]; });
    if (d) page.drawSvgPath(d, { x: 0, y: 0, borderColor: hex(m.color), borderWidth: m.width, borderLineCap: LineCapStyle.Round });
  }
}
