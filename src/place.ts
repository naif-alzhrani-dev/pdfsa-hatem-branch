/**
 * هندسة العنصر الموضوع داخل صفحته (بكسل الشاشة). العنصر لا يخرج من صفحته أبداً،
 * ونسبته ثابتة.
 */
import type { Rect } from "./coords";

export type Kind = "signature" | "stamp";
const EPS = 0.5;

/** أكبر عرض يتّسع في الصفحة مع حفظ النسبة. */
export function maxWidth(aspect: number, W: number, H: number): number {
  return Math.min(W, H * aspect);
}
/** أصغر عرض: ٨٪ من عرض الصفحة، ولا أقل من 32px على الشاشة. */
export function minWidth(aspect: number, W: number, H: number): number {
  return Math.min(Math.max(0.08 * W, 32), maxWidth(aspect, W, H));
}

/** يُزاح المستطيل إلى داخل الصفحة، ويُصغَّر أولاً إن كان أكبر منها. */
export function clampRect(r: Rect, W: number, H: number): Rect {
  let { w, h } = r;
  const aspect = w / h;
  const mw = maxWidth(aspect, W, H);
  if (w > mw) { w = mw; h = w / aspect; }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const x = Math.max(0, Math.min(W - w, cx - w / 2));
  const y = Math.max(0, Math.min(H - h, cy - h / 2));
  return { x, y, w, h };
}

/** نقل محصور: يبقى الحجم، ويُمنع الخروج. */
export function moveRect(r: Rect, x: number, y: number, W: number, H: number): Rect {
  return { ...r, x: Math.max(0, Math.min(W - r.w, x)), y: Math.max(0, Math.min(H - r.h, y)) };
}

/** موضع العنصر عند وضعه: ٣٥٪ للتوقيع و٢٥٪ للختم، في المركز المعطى. وإن كان أكبر من الصفحة صُغِّر إلى ٩٠٪ من البعد الأضيق. */
export function initialRect(kind: Kind, aspect: number, W: number, H: number, cx: number, cy: number): Rect {
  let w = (kind === "signature" ? 0.35 : 0.25) * W;
  if (w > W || w / aspect > H) w = Math.min(0.9 * W, 0.9 * H * aspect);
  const h = w / aspect;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, W, H);
}

/** تكبير أو تصغير حول المركز بين الحدّين، ثم حصر. */
export function scaleRect(r: Rect, factor: number, W: number, H: number) {
  const aspect = r.w / r.h;
  const lo = minWidth(aspect, W, H), hi = maxWidth(aspect, W, H);
  const w = Math.max(lo, Math.min(hi, r.w * factor));
  const h = w / aspect;
  const rect = clampRect({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h }, W, H);
  return { rect, ...limits(rect, W, H) };
}

export function limits(r: Rect, W: number, H: number) {
  const aspect = r.w / r.h;
  return { canGrow: r.w < maxWidth(aspect, W, H) - EPS, canShrink: r.w > minWidth(aspect, W, H) + EPS };
}

/* ───────── ١٨) القرص لكل عنصر ومقابض الزوايا (docs/logs/additions-12-15-18-lama-spec.md §١٨) ───────── */
type P = { x: number; y: number };
/** القرص للعنصر إذا كان محدَّداً، وأحد الإصبعين عليه أو في هامش 24px حوله (عند نزول الثاني). بإحداثيات واحدة. */
export function pinchHitsItem(sel: Rect | null, a: P, b: P, margin = 24): boolean {
  if (!sel) return false;
  const near = (p: P) => p.x >= sel.x - margin && p.x <= sel.x + sel.w + margin && p.y >= sel.y - margin && p.y <= sel.y + sel.h + margin;
  return near(a) || near(b);
}
/** إطار القرص: من r0 عند نزول الإصبع الثاني لا تراكماً، بنسبة d/d0 بين الحدّين، ثم إزاحة المركز بفرق منتصف الإصبعين. */
export function pinchRect(r0: Rect, d0: number, d: number, m0: P, m: P, W: number, H: number) {
  const s = scaleRect(r0, d0 > 0 ? d / d0 : 1, W, H);
  const rect = moveRect(s.rect, s.rect.x + m.x - m0.x, s.rect.y + m.y - m0.y, W, H);
  return { rect, canGrow: s.canGrow, canShrink: s.canShrink };
}
export type Corner = "nw" | "ne" | "sw" | "se";
/** سحب زاوية بالفأرة: النسبة محفوظة والزاوية المقابلة ثابتة، والعرض بين الحدّين وما يتّسع من الزاوية الثابتة. p بإحداثيات الصفحة. */
export function cornerRect(r0: Rect, c: Corner, p: P, W: number, H: number): Rect {
  const aspect = r0.w / r0.h;
  const west = c === "nw" || c === "sw", north = c === "nw" || c === "ne";
  const ax = west ? r0.x + r0.w : r0.x, ay = north ? r0.y + r0.h : r0.y; // الزاوية الثابتة
  const room = Math.min(west ? ax : W - ax, (north ? ay : H - ay) * aspect);
  const want = Math.max(west ? ax - p.x : p.x - ax, (north ? ay - p.y : p.y - ay) * aspect);
  const w = Math.max(Math.min(minWidth(aspect, W, H), room), Math.min(want, room, maxWidth(aspect, W, H)));
  const h = w / aspect;
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
}
