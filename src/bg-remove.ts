/**
 * تفريغ خلفية صورة التوقيع أو الختم.
 *
 * الفكرة من منصة علاج أطفالنا (`autoThreshold`: الورق هو الأفتح، فما كان أفتح من حدٍّ
 * دون لون الورق صار شفافاً، ثم قصّ). وزيد عليها ثلاثة:
 *  - **خلفية محلية** لا حدّ واحد: صورة الجوال فيها ظلّ متدرّج، فيُقدَّر لون الورق في
 *    كل مربّع صغير (أفتح ١٠٪ منه) ثم يُستوفى بين المربّعات.
 *  - **لون الحبر محفوظ**: يُقسم كل لون على لون الورق تحته (فيبيضّ الورق ولا يتغيّر
 *    لون الحبر)، ثم يُفكّ المزج على أبيض، فالختم الأزرق يبقى أزرق.
 *  - **حافة ناعمة**: الشفافية متدرّجة بين الحدّ وضعفه لا قطعٌ حادّ.
 */

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const INK_ALPHA = 25; // ما فوقه يُعدّ حبراً عند القصّ (وعند فحص «مُسح كله» في الممحاة)
const TRIM_PAD = 4;
const T_MIN = 0.02;
const T_SPAN = 0.28;

/** قوة التفريغ (٠–١٠٠) ↔ الحدّ النسبيّ للعتمة. */
export function strengthToThreshold(s: number): number {
  return T_MIN + (Math.max(0, Math.min(100, s)) / 100) * T_SPAN;
}
function thresholdToStrength(t: number): number {
  return Math.round(((t - T_MIN) / T_SPAN) * 100);
}

interface Bg {
  l: Float32Array; // إضاءة الورق المقدّرة لكل بكسل
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/** يركّب البكسل على أبيض (صورة PNG فيها شفافية أصلاً). */
function flatRgb(a: Uint8ClampedArray, i: number): [number, number, number] {
  const al = a[i + 3]! / 255;
  return [a[i]! * al + 255 * (1 - al), a[i + 1]! * al + 255 * (1 - al), a[i + 2]! * al + 255 * (1 - al)];
}
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function estimateBackground(src: Rgba): Bg {
  const { data, width: w, height: h } = src;
  const bs = Math.max(8, Math.ceil(Math.max(w, h) / 24));
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  const gL = new Float32Array(gw * gh);
  const gR = new Float32Array(gw * gh);
  const gG = new Float32Array(gw * gh);
  const gB = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);

  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      const x0 = bx * bs, y0 = by * bs;
      const x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [r, g, b] = flatRgb(data, (y * w + x) * 4);
          hist[Math.round(lum(r, g, b))]!++;
          n++;
        }
      }
      // أفتح ١٠٪ من المربّع هو الورق (لا يملأ الحبرُ مربّعاً كاملاً إلا نادراً)
      let acc = 0, p = 255;
      for (let v = 255; v >= 0; v--) {
        acc += hist[v]!;
        if (acc >= n * 0.1) { p = v; break; }
      }
      let sr = 0, sg = 0, sb = 0, sl = 0, k = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [r, g, b] = flatRgb(data, (y * w + x) * 4);
          const l = lum(r, g, b);
          if (Math.round(l) >= p) { sr += r; sg += g; sb += b; sl += l; k++; }
        }
      }
      const gi = by * gw + bx;
      gL[gi] = sl / k; gR[gi] = sr / k; gG[gi] = sg / k; gB[gi] = sb / k;
    }
  }

  // مرشّح أقصى ٣×٣: مربّعٌ غلب عليه الحبر يأخذ ورق جاره
  const mL = new Float32Array(gL), mR = new Float32Array(gR), mG = new Float32Array(gG), mB = new Float32Array(gB);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let best = by * gw + bx;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx, ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (gL[ni]! > gL[best]!) best = ni;
        }
      }
      const gi = by * gw + bx;
      mL[gi] = gL[best]!; mR[gi] = gR[best]!; mG[gi] = gG[best]!; mB[gi] = gB[best]!;
    }
  }

  // استيفاء خطّي بين مراكز المربّعات
  const n = w * h;
  const out: Bg = { l: new Float32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(gh - 1, (y + 0.5) / bs - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(gw - 1, (x + 0.5) / bs - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const i00 = y0 * gw + x0, i01 = y0 * gw + x1, i10 = y1 * gw + x0, i11 = y1 * gw + x1;
      const mix = (g: Float32Array) =>
        (g[i00]! * (1 - tx) + g[i01]! * tx) * (1 - ty) + (g[i10]! * (1 - tx) + g[i11]! * tx) * ty;
      const p = y * w + x;
      out.l[p] = mix(mL); out.r[p] = mix(mR); out.g[p] = mix(mG); out.b[p] = mix(mB);
    }
  }
  return out;
}

function darkness(src: Rgba, bg: Bg): Float32Array {
  const n = src.width * src.height;
  const d = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const [r, g, b] = flatRgb(src.data, p * 4);
    const bl = Math.max(bg.l[p]!, 1);
    d[p] = Math.max(0, (bl - lum(r, g, b)) / bl);
  }
  return d;
}

/** ما يُحسب مرة واحدة لكل صورة (تقدير الورق والعتمة)، فتحريك «قوة التفريغ» لا يعيده. */
export interface Prepared { src: Rgba; bg: Bg; d: Float32Array; auto: number }

/*
 * صورة توقيع خلفيتها مفرَّغة مسبقاً قد تصل مسطّحة على أسود (تحويل PNG الشفاف إلى JPEG
 * يملأ الشفاف بالأسود)، فيصير «الورق» أغمق من الحبر وتنقلب الخوارزمية: يبقى الأسود معتماً
 * ويُمحى الحبر. فتُعاد هذه الصورة إلى أبيض قبل كل شيء، ثم تمضي كغيرها.
 * والكشف شرطان معاً: أغلب الصورة أسود أو يقاربه (وسيط الإضاءة؛ فلا طاولة بنية ولا ورقة هي الأغلب)،
 * والفاتح عنه خطوط رفيعة لا مساحة مصمتة (ورقة على طاولة سوداء داخلُها بعيدٌ عن كل داكن).
 */
const DARK_BG_MAX = 30; // وسيط الإضاءة فوقه: ليس سواد الشفاف المسطّح
const DARK_BG_INK_DIST = 40; // بُعد اللون عن الخلفية فوقه: حبر
const DARK_BG_SOLID_MAX = 0.5; // نسبة الحبر المحاط بحبر من جهاته الأربع فوقها: مساحة مصمتة (ورقة)

function darkBackgroundToWhite(src: Rgba): Rgba | null {
  const { data, width: w, height: h } = src;
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 40000));
  const L: number[] = [];
  for (let p = 0; p < n; p += step) { const [r, g, b] = flatRgb(data, p * 4); L.push(lum(r, g, b)); }
  const med = [...L].sort((a, b) => a - b)[Math.floor(L.length / 2)]!;
  if (med > DARK_BG_MAX) return null;

  // لون الخلفية: متوسط ما قارب الوسيط
  let br = 0, bgG = 0, bb = 0, k = 0;
  for (let p = 0, j = 0; p < n; p += step, j++) {
    if (Math.abs(L[j]! - med) > 10) continue;
    const [r, g, b] = flatRgb(data, p * 4);
    br += r; bgG += g; bb += b; k++;
  }
  const B = [br / k, bgG / k, bb / k] as const;
  const isInk = (q: number) => { const c = flatRgb(data, q * 4); return Math.hypot(c[0] - B[0], c[1] - B[1], c[2] - B[2]) > DARK_BG_INK_DIST; };

  // لون الحبر: متوسط أبعد ٣٠٪ عن الخلفية مما تجاوز حدّ الحبر
  const R = Math.max(6, Math.round(Math.min(w, h) / 40));
  const ink: { d: number; c: [number, number, number] }[] = [];
  let solid = 0;
  for (let p = 0; p < n; p += step) {
    const c = flatRgb(data, p * 4);
    const d = Math.hypot(c[0] - B[0], c[1] - B[1], c[2] - B[2]);
    if (d <= DARK_BG_INK_DIST) continue;
    ink.push({ d, c });
    const x = p % w, y = (p - x) / w;
    if (x >= R && y >= R && x + R < w && y + R < h && isInk(p - R) && isInk(p + R) && isInk(p - R * w) && isInk(p + R * w)) solid++;
  }
  if (ink.length === 0 || solid / ink.length > DARK_BG_SOLID_MAX) return null;
  ink.sort((a, b) => b.d - a.d);
  const top = ink.slice(0, Math.max(1, Math.ceil(ink.length * 0.3)));
  const I = [0, 1, 2].map((q) => top.reduce((s, e) => s + e.c[q]!, 0) / top.length);
  const v = [I[0]! - B[0], I[1]! - B[1], I[2]! - B[2]];
  const vv = v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!;

  // التغطية c بإسقاط البكسل على خطّ الخلفية←الحبر، ثم يُركَّب على أبيض: P + (1−c)(255−B)
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const P = flatRgb(data, i);
    const c = Math.max(0, Math.min(1, ((P[0] - B[0]) * v[0]! + (P[1] - B[1]) * v[1]! + (P[2] - B[2]) * v[2]!) / vv));
    out[i] = P[0] + (1 - c) * (255 - B[0]);
    out[i + 1] = P[1] + (1 - c) * (255 - B[1]);
    out[i + 2] = P[2] + (1 - c) * (255 - B[2]);
    out[i + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

export function prepare(input: Rgba): Prepared {
  const src = darkBackgroundToWhite(input) ?? input;
  const bg = estimateBackground(src);
  const d = darkness(src, bg);
  // القوة التلقائية: الحدّ فوق ضجيج الورق (وسيط العتمة في الصورة كلها، وأغلبها ورق)
  const step = Math.max(1, Math.floor(d.length / 20000));
  const s: number[] = [];
  for (let i = 0; i < d.length; i += step) s.push(d[i]!);
  s.sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)] ?? 0;
  const t = Math.max(0.06, Math.min(0.22, 0.06 + 3 * med));
  return { src, bg, d, auto: thresholdToStrength(t) };
}

export function autoStrength(src: Rgba): number {
  return prepare(src).auto;
}

/**
 * يعيد صورة بخلفية شفافة مقصوصة على حدود الحبر، أو null إن لم يُعثر على حبر
 * (فلا يُحفظ فراغٌ باسم توقيع).
 */
export function removeBackground(src: Rgba, strength?: number): Rgba | null {
  if (src.width === 0 || src.height === 0) return null;
  return extract(prepare(src), strength);
}

/**
 * `erase`: قناع بحجم `src` (١ = ممسوح بالممحاة)، يُسقط بكسله قبل حساب حدود القصّ، فتصغر الحدود إن مُسحت شائبة طرفية.
 * `crop: false`: الإطار كاملاً بعرض `src` وطوله ولو خلا من الحبر (لمسرح الممحاة وحده).
 */
export function extract(prep: Prepared, strength?: number, opts?: { erase?: Uint8Array; crop?: boolean }): Rgba | null {
  const { src, bg, d } = prep;
  const erase = opts?.erase;
  const { width: w, height: h, data } = src;
  const t = strengthToThreshold(strength ?? prep.auto);
  const out = new Uint8ClampedArray(w * h * 4);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let p = 0; p < w * h; p++) {
    if (erase?.[p]) continue;
    const a = Math.max(0, Math.min(1, (d[p]! - t) / t)); // حافة ناعمة بين t و2t
    if (a <= 0) continue;
    const [r, g, b] = flatRgb(data, p * 4);
    // يبيضّ الورق ويبقى لون الحبر، ثم يُفكّ المزج على أبيض
    const nr = Math.min(255, (r / Math.max(bg.r[p]!, 1)) * 255);
    const ng = Math.min(255, (g / Math.max(bg.g[p]!, 1)) * 255);
    const nb = Math.min(255, (b / Math.max(bg.b[p]!, 1)) * 255);
    const i = p * 4;
    out[i] = 255 - (255 - nr) / a;
    out[i + 1] = 255 - (255 - ng) / a;
    out[i + 2] = 255 - (255 - nb) / a;
    out[i + 3] = Math.round(a * 255);
    if (out[i + 3]! > INK_ALPHA) {
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (opts?.crop === false) return { data: out, width: w, height: h };
  if (maxX < minX || maxY < minY) return null;

  const sx = Math.max(0, minX - TRIM_PAD), sy = Math.max(0, minY - TRIM_PAD);
  const sw = Math.min(w, maxX + 1 + TRIM_PAD) - sx;
  const sh = Math.min(h, maxY + 1 + TRIM_PAD) - sy;
  const cropped = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    cropped.set(out.subarray(((sy + y) * w + sx) * 4, ((sy + y) * w + sx + sw) * 4), y * sw * 4);
  }
  return { data: cropped, width: sw, height: sh };
}
