/**
 * حدّة الكتابة في الورقة (طلب نايف ٢٠٢٦/١١/٠٩: «بعض الأحيان يلتقط سريعاً ولكن الكتابة لا تكون واضحة… لا يلتقط حتى يثبت الزوم على الورقة بضبط»).
 *
 * المقياس: **تباين اللابلاسيان** (Variance of Laplacian، نواة 4-جوار) على الإضاءة، داخل الرباعي مُنكمِشاً نحو مركزه (`INSET`)،
 * فلا تدخله حافّة الورقة مع الطاولة (تباينها لا علاقة له بالتركيز).
 * اختير بالقياس على Tenengrad (Sobel) ببثٍّ مصطنع بمقاس الكشف (286×615، ضجيج σ4، عشرون بذرة): ضبابية نصف بكسل تُنزل
 * اللابلاسيان إلى 0.64 من الحادّ وTenengrad إلى 0.82 فقط، وبكسل واحد 0.45 مقابل 0.83، وتذبذب الإطارات المتماثلة 1–5% في الاثنين.
 * القيمة نسبية: لا معنى لها إلا مقارنةً بقيم الورقة نفسها في الإطارات المجاورة، فالورق والإضاءة والمسافة تختلف.
 */
import type { Corners } from "./geom";
import type { Img } from "./types";

/** الرباعي يُنكمش نحو مركزه بهذه النسبة قبل القياس. */
export const INSET = 0.12;

/** حدّة الصورة كلها (`c` = null)، أو داخل الرباعي `c` بإحداثياتها. 0 إن لم يقع داخله بكسل. */
export function sharpness(img: Img, c: Corners | null, inset = INSET): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  // نطاق كل صفّ (من x0 إلى x1) داخل الرباعي المنكمش، أو الصورة كلها
  let q: { x: number; y: number }[] | null = null;
  let y0 = 1, y1 = h - 2;
  if (c) {
    const p = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
    const cx = (p[0]!.x + p[1]!.x + p[2]!.x + p[3]!.x) / 4, cy = (p[0]!.y + p[1]!.y + p[2]!.y + p[3]!.y) / 4;
    q = p.map((v) => ({ x: cx + (v.x - cx) * (1 - inset), y: cy + (v.y - cy) * (1 - inset) }));
    y0 = Math.max(1, Math.ceil(Math.min(...q.map((v) => v.y))));
    y1 = Math.min(h - 2, Math.floor(Math.max(...q.map((v) => v.y))));
  }
  // الإضاءة لصفوف النطاق وجاراتها فقط
  const gy0 = Math.max(0, y0 - 1), gy1 = Math.min(h - 1, y1 + 1);
  const g = new Float32Array(w * (gy1 - gy0 + 1));
  for (let y = gy0; y <= gy1; y++) {
    let i = y * w * 4, o = (y - gy0) * w;
    for (let x = 0; x < w; x++, i += 4) g[o + x] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  let s1 = 0, s2 = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    let x0 = 1, x1 = w - 2;
    if (q) {
      // تقاطع الصفّ مع أضلاع الرباعي المحدّب
      let a = Infinity, b = -Infinity;
      const yc = y + 0.5;
      for (let k = 0; k < 4; k++) {
        const P = q[k]!, Q = q[(k + 1) % 4]!;
        if ((P.y <= yc && Q.y > yc) || (Q.y <= yc && P.y > yc)) {
          const x = P.x + ((yc - P.y) / (Q.y - P.y)) * (Q.x - P.x);
          a = Math.min(a, x); b = Math.max(b, x);
        }
      }
      if (a > b) continue;
      x0 = Math.max(1, Math.ceil(a)); x1 = Math.min(w - 2, Math.floor(b));
    }
    const r = (y - gy0) * w, u = r - w, d = r + w;
    for (let x = x0; x <= x1; x++) {
      const v = g[u + x]! + g[d + x]! + g[r + x - 1]! + g[r + x + 1]! - 4 * g[r + x]!;
      s1 += v; s2 += v * v;
      n++;
    }
  }
  return n ? s2 / n - (s1 / n) ** 2 : 0;
}
