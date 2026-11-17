/**
 * أدوات نقية لشاشات التصوير (تُختبر في Node بلا DOM): التصغير قبل الكشف، والتدوير، وتحويل الزوايا
 * بين مقاس المعاينة ومقاس الأصل.
 *
 * الزوايا بشكل `CornerPoints` في scanic: `{ topLeft, topRight, bottomRight, bottomLeft }` بإحداثيات البكسل،
 * و(0,0) أعلى يسار الصورة.
 */
import type { CornerPoints } from "scanic";
import type { Img } from "./types";

export type Corners = CornerPoints;
export const CORNER_KEYS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

/** تصغير بمتوسط المساحة (كل بكسل ناتج متوسط ما يغطيه من الأصل)، حتى يصير أطول ضلع `maxSide`. لا يكبّر. */
export function downscale(src: Img, maxSide: number): Img {
  const { width: w, height: h, data } = src;
  const k = Math.max(w, h) / maxSide;
  if (k <= 1) return src;
  const ow = Math.max(1, Math.round(w / k)), oh = Math.max(1, Math.round(h / k));
  const out = new Uint8ClampedArray(ow * oh * 4);
  const xs = new Int32Array(ow + 1);
  for (let x = 0; x <= ow; x++) xs[x] = Math.min(w, Math.round((x * w) / ow));
  const acc = new Float64Array(ow * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.round((oy * h) / oh), y1 = Math.max(y0 + 1, Math.min(h, Math.round(((oy + 1) * h) / oh)));
    acc.fill(0);
    for (let y = y0; y < y1; y++) {
      const row = y * w * 4;
      for (let ox = 0; ox < ow; ox++) {
        const x1 = Math.max(xs[ox]! + 1, xs[ox + 1]!);
        let r = 0, g = 0, b = 0, a = 0;
        for (let x = xs[ox]!, i = row + x * 4; x < x1; x++, i += 4) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; a += data[i + 3]!; }
        const j = ox * 4;
        acc[j] = acc[j]! + r; acc[j + 1] = acc[j + 1]! + g; acc[j + 2] = acc[j + 2]! + b; acc[j + 3] = acc[j + 3]! + a;
      }
    }
    for (let ox = 0; ox < ow; ox++) {
      const n = (Math.max(xs[ox]! + 1, xs[ox + 1]!) - xs[ox]!) * (y1 - y0);
      const j = ox * 4, o = (oy * ow + ox) * 4;
      out[o] = acc[j]! / n; out[o + 1] = acc[j + 1]! / n; out[o + 2] = acc[j + 2]! / n; out[o + 3] = acc[j + 3]! / n;
    }
  }
  return { data: out, width: ow, height: oh };
}

/** تدوير ربع دورة مع عقارب الساعة: الصورة w×h تصير h×w. */
export function rotateCW(src: Img): Img {
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  const u32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const o32 = new Uint32Array(out.buffer);
  // البكسل (x, y) يصير (h − 1 − y, x) في صورة عرضها h
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o32[x * h + (h - 1 - y)] = u32[y * w + x]!;
  return { data: out, width: h, height: w };
}

/**
 * الزوايا بعد تدوير صورتها w×h ربع دورة مع عقارب الساعة (إحداثيات متصلة): النقطة (x, y) تصير (h − y, x).
 * وتُعاد تسمية الزوايا: ما كان أسفل-يسار صار أعلى-يسار.
 */
export function rotateCornersCW(c: Corners, _w: number, h: number): Corners {
  const r = (p: { x: number; y: number }) => ({ x: h - p.y, y: p.x });
  return { topLeft: r(c.bottomLeft), topRight: r(c.topLeft), bottomRight: r(c.topRight), bottomLeft: r(c.bottomRight) };
}

export function scaleCorners(c: Corners, kx: number, ky: number): Corners {
  const s = (p: { x: number; y: number }) => ({ x: p.x * kx, y: p.y * ky });
  return { topLeft: s(c.topLeft), topRight: s(c.topRight), bottomRight: s(c.bottomRight), bottomLeft: s(c.bottomLeft) };
}

/** مستطيل بهامش نسبته `f` من كل ضلع (المواصفة (هـ): 8%) حين لا تُكتشف الحواف. */
export function insetCorners(w: number, h: number, f = 0.08): Corners {
  const x0 = w * f, y0 = h * f, x1 = w - x0, y1 = h - y0;
  return { topLeft: { x: x0, y: y0 }, topRight: { x: x1, y: y0 }, bottomRight: { x: x1, y: y1 }, bottomLeft: { x: x0, y: y1 } };
}

/** «على الحافّة تماماً»: ضمن 0.5% من بُعد الصورة (وبكسلين على الأقل). scanic يعيد ضلع الإطار على 0 أو w − 1. */
export const FRAME_EDGE_TOL = 0.005;

/**
 * الكاشف أعاد إطار الصورة (كلّه أو بعضه) لا الورقة: ضلعٌ من أضلاع الرباعيّ **على حافّة الصورة تماماً**،
 * أي طرفاه كلاهما على الحافّة نفسها (ضمن `FRAME_EDGE_TOL`). والإطار كلّه أضلاعه الأربعة كذلك.
 *
 * أما الورقة الحقيقيّة القريبة من الحوافّ فتُقبل مهما كبرت مساحتها: بينها وبين الحافّة شريط خلفية، وأضلاعها
 * مائلة لا تلتصق بالحافّة من طرفيها. (القاعدة السابقة — مساحة ≥ 95%، أو قرب الحوافّ الأربع ≤ 2% مع مساحة ≥ 80% —
 * كانت ترفض الورقة التي يقترب بها المصوّر حتى تملأ الإطار: قيس في docs/logs/scan-fix2.md.)
 */
export function coversFrame(c: Corners, w: number, h: number): boolean {
  const p = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  const tx = Math.max(2, FRAME_EDGE_TOL * w), ty = Math.max(2, FRAME_EDGE_TOL * h);
  const borders = [(q: { x: number; y: number }) => q.x <= tx, (q: { x: number; y: number }) => q.x >= w - tx, (q: { x: number; y: number }) => q.y <= ty, (q: { x: number; y: number }) => q.y >= h - ty];
  for (let i = 0; i < 4; i++) {
    const u = p[i]!, v = p[(i + 1) % 4]!;
    if (borders.some((on) => on(u) && on(v))) return true;
  }
  return false;
}

/**
 * نتيجة الكشف تُقبل إن نجح، وفيه زوايا، وثقته لا تقلّ عن الحدّ (إن أعطى ثقة)، ولم يأخذ الإطار كلّه
 * (مقاس الصورة `w`×`h` الذي كُشف عليه). وإلا فمستطيل الهامش.
 */
export function acceptDetection(r: { success: boolean; corners: Corners | null; confidence?: number | null }, minConfidence: number, w: number, h: number): Corners | null {
  if (!r.success || !r.corners) return null;
  if (typeof r.confidence === "number" && r.confidence < minConfidence) return null;
  if (coversFrame(r.corners, w, h)) return null;
  return r.corners;
}
