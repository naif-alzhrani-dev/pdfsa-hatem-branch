/**
 * مسار التباين المنخفض (نايف ٢٠٢٦/١١/٠٩: «إذا كانت الطاولة بيضاء يصعب تحديد الزوايا»).
 *
 * ورقة بيضاء على طاولة بيضاء: الفرق بينهما بضع درجات، وتظليل أطراف العدسة والإضاءة غير المتساوية أكبر منه،
 * فعتبات Canny التكيّفية في scanic (من توزيع التدرّج كله) تذهب إلى الضجيج. فيُجرَّب كشفٌ ثانٍ على صورة مصحَّحة:
 *  ١. **تسطيح الإضاءة:** الإضاءة ÷ متوسطها المحلي في نافذة كبيرة (`FLAT_R` من الضلع القصير، بصورة تكاملية)، فيزول التظليل
 *     ويبقى الفرق الحادّ عند حافّة الورقة.
 *  ٢. **مدّ التباين:** بين المئين `LO_PCT` و`HI_PCT` من الناتج إلى 0–255.
 * لا يُستعمل إلا حين يفشل الكشف المعتاد والإطار فاتح (`brightFrame`)، فلا يمسّ الورقة على سطح داكن.
 */
import type { Img } from "./types";

export const FLAT_R = 0.12;
export const LO_PCT = 0.01;
export const HI_PCT = 0.99;
/** إطار فاتح: عُشر بكسلاته الأغمق أفتح من هذا (الكتابة داخل الورقة أقلّ من العُشر، والطاولة الداكنة أكثر منه). */
export const BRIGHT_P10 = 120;

/** المئين العاشر للإضاءة (0–255)، بعيّنة كل رابع بكسل. */
export function lumaP10(img: Img): number {
  const d = img.data, hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 16) { hist[(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) | 0]!++; n++; }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= 0.1 * n) return v; }
  return 255;
}

export const brightFrame = (img: Img) => lumaP10(img) >= BRIGHT_P10;

/** الصورة المصحَّحة (رمادية في القنوات الثلاث)، بالمقاس نفسه. */
export function flatten(img: Img): Img {
  const { width: w, height: h, data } = img;
  const N = w * h;
  const g = new Float32Array(N);
  for (let k = 0, i = 0; k < N; k++, i += 4) g[k] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! + 1;
  // صورة تكاملية (w+1)×(h+1)
  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]!; S[(y + 1) * W + x + 1] = S[y * W + x + 1]! + row; }
  }
  const r = Math.max(2, Math.round(FLAT_R * Math.min(w, h)));
  const ratio = new Float32Array(N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const m = (S[yb * W + xb]! - S[ya * W + xb]! - S[yb * W + xa]! + S[ya * W + xa]!) / ((yb - ya) * (xb - xa));
      const v = g[y * w + x]! / m;
      ratio[y * w + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // المئينان بمدرّج من 1024 خانة
  const B = 1024, hist = new Uint32Array(B), span = hi - lo || 1;
  for (let k = 0; k < N; k++) hist[Math.min(B - 1, ((ratio[k]! - lo) / span * B) | 0)]!++;
  let acc = 0, a = lo, b = hi, gotA = false;
  for (let i = 0; i < B; i++) {
    acc += hist[i]!;
    if (!gotA && acc >= LO_PCT * N) { a = lo + (i / B) * span; gotA = true; }
    if (acc >= HI_PCT * N) { b = lo + ((i + 1) / B) * span; break; }
  }
  const k = 255 / (b - a || 1);
  const out = new Uint8ClampedArray(N * 4);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const v = (ratio[p]! - a) * k;
    out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** خطوة الإضاءة عبر الحافّة: الأفتح داخل الورقة بهذا القدر على الأقل (درجات من 255)، بمتوسط عيّنات الضلع. */
export const EDGE_MIN = 2;
/** بُعد العيّنة عن الحافّة داخلاً وخارجاً: نسبة من الضلع القصير، ولا تقلّ عن 3px. */
export const EDGE_D = 0.03;

/**
 * خطوة الإضاءة (داخل − خارج) عبر كل ضلع من أضلاع الرباعي: **وسيط** `n` عيّنة على الثلثين الأوسطين من الضلع
 * (الوسيط لا المتوسط: سطر كتابة قريب من الحافّة يقع على بعض العيّنات الداخلية فيقلب المتوسط).
 * الورقة أفتح من الطاولة أو ظلّها، فخطوتها موجبة على الأضلاع كلها؛ ورباعيٌّ من ضجيجٍ أو عرقٍ تتبعثر خطواته حول الصفر.
 */
export function edgeSteps(img: Img, c: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } }, n = 24): number[] {
  const { width: w, height: h, data } = img;
  const q = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  const cx = q.reduce((a, p) => a + p.x, 0) / 4, cy = q.reduce((a, p) => a + p.y, 0) / 4;
  let short = Infinity;
  for (let k = 0; k < 4; k++) short = Math.min(short, Math.hypot(q[(k + 1) % 4]!.x - q[k]!.x, q[(k + 1) % 4]!.y - q[k]!.y));
  const d = Math.max(3, EDGE_D * short);
  const lum = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x))), yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    const i = (yi * w + xi) * 4;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const A = q[k]!, B = q[(k + 1) % 4]!;
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; } // العمود نحو الداخل
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = 1 / 6 + ((i + 0.5) / n) * (2 / 3);
      const px = A.x + t * (B.x - A.x), py = A.y + t * (B.y - A.y);
      if (px - d < 0 || py - d < 0 || px + d > w - 1 || py + d > h - 1) continue; // خارج الصورة: لا يُحكم
      v.push(lum(px + nx * d, py + ny * d) - lum(px - nx * d, py - ny * d));
    }
    v.sort((a, b) => a - b);
    out.push(v.length >= n / 2 ? v[v.length >> 1]! : NaN);
  }
  return out;
}

/**
 * شكل ورقة فاتحة: ثلاثة أضلاع على الأقل خطوتها ≥ `EDGE_MIN`. والرابع لا يُشترط: قد يقع على حافّة الإطار،
 * أو يضمّ الكاشف ظلّ الورقة إليها فتنقلب خطوته (قيس: −13 إلى −21 على الضلع السفلي في 4 من 6 إطارات صحيحة).
 */
export function paperLike(img: Img, c: Parameters<typeof edgeSteps>[1]): boolean {
  const s = edgeSteps(img, c).filter((v) => !Number.isNaN(v));
  return s.filter((v) => v >= EDGE_MIN).length >= 3;
}
