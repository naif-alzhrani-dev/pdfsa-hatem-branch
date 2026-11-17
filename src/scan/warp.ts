/**
 * تقويم المنظور: الرباعيّ في الصورة يُفرد مستطيلاً.
 *
 * هوموغرافيا من أربع نقاط (نظام 8×8 بحذف غاوس)، ومعاينة عكسية: لكل بكسل في الناتج يُحسب موضعه
 * في الأصل ويُؤخذ لونه بعيّنة ثنائية الخطّ.
 *
 * **سقف الدقّة: الضلع الأطول 2000px.** حدود لوحة الرسم في Safari على iOS الأقدم
 * (نحو 16.7M بكسل للوحة الواحدة، و384MB لمجموع لوحات الرسم في iOS 15 — الرقمان من موجز المهمة،
 * ولم أتحقّق منهما من مصدر رسمي). صفحة 2000×1414 = 2.8M بكسل (11.3MB)، تكفي لقراءة خطاب A4
 * (نحو 170 نقطة في البوصة)، وتبقي مكاناً للوحة الصورة الأصلية (4032×3024 = 12.2M) ولوحة ترميز JPEG.
 */
import type { Img, Pt, Quad } from "./types";

export const MAX_SIDE = 2000;

/** المصفوفة h (9 قيم، h[8]=1) التي تنقل from[i] إلى to[i]. */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i]!, { x, y } = to[i]!;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // حذف غاوس مع اختيار المحور الأكبر
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-12) throw new Error("degenerate quad");
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    const row = A[c]!;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r]![c]! / row[c]!;
      if (k === 0) continue;
      for (let j = c; j < 9; j++) A[r]![j]! -= k * row[j]!;
    }
  }
  const h = A.map((row, i) => row[8]! / row[i]!);
  h.push(1);
  return h;
}

export function applyH(h: number[], p: Pt): Pt {
  const d = h[6]! * p.x + h[7]! * p.y + 1;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / d, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / d };
}

/**
 * مقاس الناتج من أطوال الأضلاع: العرض أطول الضلعين الأفقيين، والارتفاع أطول العموديين،
 * ثم يُصغَّر بالنسبة نفسها إن تجاوز الأطول `maxSide`.
 *
 * والأضلاع وحدها تخطئ النسبة تحت المنظور (ورقة A4 مائلة 25° خرجت 1.28 بدل 1.41 في الاختبار)،
 * فإن عُرف مقاس الصورة الأصلية `frame` صُحّحت النسبة بطريقة Zhang وHe (2003، «Whiteboard scanning
 * and image enhancement»): يُقدَّر البعد البؤري من الرباعيّ بافتراض أن المركز البصري وسط الصورة،
 * ثم النسبة الحقيقية. ويبقى أطول الأضلاع هو البعد الأطول. وإن لم يصلح التقدير (أضلاع متوازية، أو بعدٌ
 * بؤريّ غير معقول) بقيت نسبة الأضلاع.
 */
export function outputSize(c: Quad, maxSide = MAX_SIDE, frame?: { width: number; height: number }): { width: number; height: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(d(c[0], c[1]), d(c[3], c[2]));
  let h = Math.max(d(c[0], c[3]), d(c[1], c[2]));
  const r = frame ? trueAspect(c, frame.width / 2, frame.height / 2) : null;
  if (r) {
    const long = Math.max(w, h);
    if (r >= 1) { w = long; h = long / r; } else { h = long; w = long * r; }
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  w *= s; h *= s;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** النسبة الحقيقية عرض÷ارتفاع للمستطيل المصوَّر (Zhang & He)، أو null إن لم يصلح التقدير. */
export function trueAspect(c: Quad, cx: number, cy: number): number | null {
  // m1 أعلى-يسار، m2 أعلى-يمين، m3 أسفل-يسار، m4 أسفل-يمين، بإحداثيات منسوبة إلى المركز البصري
  const v = (p: Pt) => [p.x - cx, p.y - cy, 1] as const;
  const m1 = v(c[0]), m2 = v(c[1]), m3 = v(c[3]), m4 = v(c[2]);
  const crs = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const k2 = dot(crs(m1, m4), m3) / dot(crs(m2, m4), m3);
  const k3 = dot(crs(m1, m4), m2) / dot(crs(m3, m4), m2);
  const n2 = m2.map((x, i) => k2 * x - m1[i]!);
  const n3 = m3.map((x, i) => k3 * x - m1[i]!);
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const sideRatio = (d(c[0], c[1]) + d(c[3], c[2])) / (d(c[0], c[3]) + d(c[1], c[2]));
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return null;
  const diag2 = (cx * 2) ** 2 + (cy * 2) ** 2;
  // البعد البؤري لا يُقدَّر إن توازى ضلعان متقابلان (نقطة تلاشٍ واحدة، كورقة مائلة للأمام فقط)،
  // أو خرج عن المعقول (بين ربع قطر الإطار وأربعة أضعافه). فيُفترض حينها بعد الكاميرا الرئيسة في
  // الجوال: نحو 26 مم مكافئ = 0.6 من قطر الإطار.
  const den = n2[2]! * n3[2]!;
  const est = Math.abs(den) > 1e-12 ? -(n2[0]! * n3[0]! + n2[1]! * n3[1]!) / den : NaN;
  const f2 = est > diag2 / 16 && est < diag2 * 16 ? est : 0.36 * diag2;
  const r = Math.sqrt((n2[0]! ** 2 + n2[1]! ** 2 + f2 * n2[2]! ** 2) / (n3[0]! ** 2 + n3[1]! ** 2 + f2 * n3[2]! ** 2));
  if (!Number.isFinite(r) || r <= 0 || r / sideRatio > 2 || sideRatio / r > 2) return null;
  return r;
}

/** يفرد الرباعيّ `corners` (أعلى-يسار، أعلى-يمين، أسفل-يمين، أسفل-يسار) مستطيلاً. */
export function warp(src: Img, corners: Quad, size = outputSize(corners, MAX_SIDE, src)): Img {
  const { width: W, height: H } = size;
  const rect: Quad = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const h = homography(rect, corners); // من الناتج إلى الأصل (معاينة عكسية)
  const sd = src.data, sw = src.width, sh = src.height;
  const out = new Uint8ClampedArray(W * H * 4);
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [number, number, number, number, number, number, number, number];

  for (let v = 0; v < H; v++) {
    const vc = v + 0.5;
    const bx = h1 * vc + h2, by = h4 * vc + h5, bd = h7 * vc + 1;
    let o = v * W * 4;
    for (let u = 0; u < W; u++, o += 4) {
      const uc = u + 0.5;
      const d = h6 * uc + bd;
      // مركز البكسل في الأصل عند (x+0.5)، فيُطرح نصفٌ للعيّنة
      let x = (h0 * uc + bx) / d - 0.5;
      let y = (h3 * uc + by) / d - 0.5;
      if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
      if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const tx = x - x0, ty = y - y0;
      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4, i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      out[o] = sd[i00]! * w00 + sd[i01]! * w01 + sd[i10]! * w10 + sd[i11]! * w11;
      out[o + 1] = sd[i00 + 1]! * w00 + sd[i01 + 1]! * w01 + sd[i10 + 1]! * w10 + sd[i11 + 1]! * w11;
      out[o + 2] = sd[i00 + 2]! * w00 + sd[i01 + 2]! * w01 + sd[i10 + 2]! * w10 + sd[i11 + 2]! * w11;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}
