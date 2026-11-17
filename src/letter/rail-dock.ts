/**
 * إرساء عمود «إعداد خطاب» (الإضافة ١٦): الحساب وحده بلا DOM، ليُختبر في vitest.
 * المواصفة: docs/logs/letter-rail-dock-lama-spec.md (§٢ و§٤)، وتعديلاتها في docs/logs/additions-13-16-lama-spec.md (قسم ١٦).
 * الإحداثيات بالبكسل من أعلى يسار النافذة (getBoundingClientRect)، و«يمين» و«يسار» جهتا الشاشة الفعليّتان.
 */
export type DockName = "right-bottom" | "right-top" | "left-bottom" | "left-top" | "top" | "bottom";
export const DOCKS: readonly DockName[] = ["top", "right-top", "left-top", "right-bottom", "left-bottom", "bottom"];
export const isDock = (v: unknown): v is DockName => typeof v === "string" && (DOCKS as readonly string[]).includes(v);

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/* ───────── التذكّر (§٤ من متطلبات رائد): الموضع على الجهاز وحده، ومفتاح العريض منفصل لأن نافذة ويندوز تعبر 1024 ───────── */
export const DOCK_KEY = "lt-rail-dock";
export const dockKey = (wide: boolean) => (wide ? `${DOCK_KEY}-wide` : DOCK_KEY);
/** الافتراضي: يمين أسفل على الجوال (الحالي)، والشريط أعلى البطاقة على الكمبيوتر */
export const defaultDock = (wide: boolean): DockName => (wide ? "top" : "right-bottom");
type Store = Pick<Storage, "getItem" | "setItem">;
/** التخزين الممنوع أو القيمة المعطوبة يعودان إلى الافتراضي */
export function loadDock(store: Store | null | undefined, wide: boolean): DockName {
  try {
    const v = store?.getItem(dockKey(wide));
    return isDock(v) ? v : defaultDock(wide);
  } catch { return defaultDock(wide); }
}
export function saveDock(store: Store | null | undefined, wide: boolean, d: DockName) {
  try { store?.setItem(dockKey(wide), d); } catch { /* التخزين ممنوع: يبقى الموضع لهذه الجلسة */ }
}

/* ───────── الأقرب: «الحافّة ثم الربع» (§٢) ───────── */
/** المنطقة المتاحة رأسياً: أعلاها «ما فوق الورقة»، وأسفلها فوق القاع */
export type Span = { top: number; bottom: number };
/** 72 = 52 + 20 (قرب الحافّة)، و88 = 52 + 36 (يبقى وسطٌ للأفقيّ)، و12 ممانعة على الحدود */
export const EDGE_NEAR = 72, SIDE_KEEP = 88, HYST = 12;
function rawNarrow(p: Pt, W: number, U: Span): DockName {
  const mid = p.x >= SIDE_KEEP && p.x <= W - SIDE_KEEP;
  if (mid && p.y - U.top < EDGE_NEAR) return "top";
  if (mid && U.bottom - p.y < EDGE_NEAR) return "bottom";
  const side = p.x >= W / 2 ? "right" : "left";
  return `${side}-${p.y < (U.top + U.bottom) / 2 ? "top" : "bottom"}` as DockName;
}
/** مع الممانعة: ما دام الأقرب السابق على 12 من النقطة في أيّ اتجاه يبقى، فلا تتبدّل الإضاءة على الحدّ */
function hold(raw: (q: Pt) => DockName, p: Pt, prev?: DockName): DockName {
  const now = raw(p);
  if (!prev || now === prev) return now;
  for (const [dx, dy] of [[HYST, 0], [-HYST, 0], [0, HYST], [0, -HYST]] as const) if (raw({ x: p.x + dx, y: p.y + dy }) === prev) return prev;
  return now;
}
export const nearestNarrow = (p: Pt, W: number, U: Span, prev?: DockName) => hold((q) => rawNarrow(q, W, U), p, prev);
export const WIDE_EDGE = 84;
/** الكمبيوتر: الأفقيّان إن كان المؤشّر فوق البطاقة وفي ربعها الأعلى أو الأسفل، وإلا الحافّة ثم الربع */
export function nearestWide(p: Pt, W: number, U: Span, card: Box, prev?: DockName): DockName {
  const raw = (q: Pt): DockName => {
    // شريط الحافّة (84 = 52 + 16 + 16، ما تُفسحه الورقة للعمود): للأركان دائماً، وإلا غطّت البطاقةُ الممتدّة إلى الحافّة منطقتَي الركنين العلويّين
    const edge = q.x <= WIDE_EDGE || q.x >= W - WIDE_EDGE;
    if (!edge && q.x >= card.x && q.x <= card.x + card.w && q.y >= card.y && q.y <= card.y + card.h) {
      const top = Math.max(card.y, U.top), bottom = Math.min(card.y + card.h, U.bottom), quarter = (bottom - top) / 4;
      if (q.y <= top + quarter) return "top";
      if (q.y >= bottom - quarter) return "bottom";
    }
    return `${q.x >= W / 2 ? "right" : "left"}-${q.y < (U.top + U.bottom) / 2 ? "top" : "bottom"}` as DockName;
  };
  return hold(raw, p, prev);
}

/* ───────── المغناطيس (قسم ١٦): على 40 من مركز الأقرب يُضاف (1 − d/40) × 0.5 من المتجه إليه ───────── */
export const MAGNET_R = 40, MAGNET_K = 0.5;
export function magnet(c: Pt, target: Pt): Pt {
  const dx = target.x - c.x, dy = target.y - c.y, d = Math.hypot(dx, dy);
  if (d > MAGNET_R) return { x: 0, y: 0 };
  const k = (1 - d / MAGNET_R) * MAGNET_K;
  return { x: dx * k, y: dy * k };
}
/** مقاومة مطّاطية خارج الحدود (0.55): كلّما زاد التجاوز قلّ ما يتبعه العمود */
export const rubber = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

/* ───────── المواضع بأرقامها (§٤) ───────── */
export const RAIL_W = 52, BAR_H = 52;
/** الجوال: W وH النافذة، وA «ما فوق الورقة»، وhead أسفل الرأس، وF القاع، وlen طول العمود الرأسيّ الطبيعي */
export type NarrowM = { W: number; H: number; A: number; head: number; F: number; len: number };
/** مستطيل العمود في الموضع، وأقصى طوله (الرأسيّ يُمرَّر داخله إن قصر المتاح). يسار أسفل يرتفع فوق حبّة التكبير (F+64) */
export function narrowRect(d: DockName, m: NarrowM): Box & { max: number } {
  const lo = m.A + 8;
  if (d === "top") { const y = m.A <= m.head ? m.head : m.A + 8; return { x: 0, y, w: m.W, h: BAR_H, max: BAR_H }; }
  if (d === "bottom") return { x: 0, y: m.H - m.F - BAR_H, w: m.W, h: BAR_H, max: BAR_H };
  const x = d.startsWith("right") ? m.W - RAIL_W : 0;
  const floor = m.H - m.F - (d.startsWith("left") ? 64 : 8);
  const max = Math.max(56, floor - lo);
  const h = Math.min(m.len, max);
  return d.endsWith("bottom") ? { x, y: floor - h, w: RAIL_W, h, max } : { x, y: lo, w: RAIL_W, h, max };
}
/** الكمبيوتر: الأفقيّان شريط البطاقة ملتصقاً بأعلى ما يُرى منها أو بأسفله، والرأسية بفجوة 16 */
export type WideM = { W: number; H: number; head: number; card: Box; len: number };
export function wideRect(d: DockName, m: WideM): Box {
  const { card } = m;
  if (d === "top") return { x: card.x, y: Math.max(card.y, m.head), w: card.w, h: BAR_H };
  if (d === "bottom") return { x: card.x, y: Math.min(card.y + card.h, m.H) - BAR_H, w: card.w, h: BAR_H };
  const x = d.startsWith("right") ? m.W - 16 - RAIL_W : 16;
  const lo = m.head + 16, floor = m.H - (d.startsWith("left") ? 64 : 16);
  const h = Math.min(m.len, Math.max(56, floor - lo));
  return d.endsWith("bottom") ? { x, y: floor - h, w: RAIL_W, h } : { x, y: lo, w: RAIL_W, h };
}
