/**
 * كشف حواف الورقة في صورة كاميرا.
 *
 * الورقة في الغالب أفتح من الطاولة تحتها، فالطريقة:
 *  ١. تصغير بمتوسط المساحة إلى نحو 512px (الكشف لا يحتاج أكثر، وهو أسرع ١٠٠ مرة تقريباً).
 *  ٢. إضاءة، ثم تنعيم (تمويه صندوقي مرّتين ≈ غاوسي).
 *  ٣. عتبة Otsu، ثم «فتح» صغير يقطع الجسور الرفيعة بين الورقة وبقع فاتحة حولها.
 *  ٤. أكبر مكوّن فاتح متصل، وتُملأ ثقوبه (الكتابة داخل الورقة).
 *  ٥. غلافه المحدّب، ثم يُختزل إلى أربعة رؤوس بحذف الرأس الأقلّ أثراً في كل مرة
 *     (فينجح مع الورقة المائلة ٤٥°، حيث تخطئ طريقة أقصى x+y وx−y).
 *  ٦. يُرفض الناتج إن كانت المساحة صغيرة، أو الزوايا غير معقولة، أو لا يملأ المكوّنُ الرباعيَّ،
 *     أو الفرق بين الورقة وما حولها ضعيف.
 */
import type { Img, Pt, Quad } from "./types";

const TARGET = 512;
const MIN_AREA_FRAC = 0.15; // الورقة أقل من هذا من الصورة: ليست ورقة مصوَّرة
const MIN_ANGLE = 40;
const MAX_ANGLE = 140;
const MIN_FILL = 0.85; // المكوّن المملوء ÷ مساحة الرباعي
const MAX_FILL = 1.15;
const MIN_CONTRAST = 15; // درجات رمادي بين الورقة وما حولها
const MIN_CONFIDENCE = 0.2;

export interface Detection {
  corners: Quad;
  confidence: number;
}

export function detectQuad(img: Img): Detection | null {
  const W = img.width, H = img.height;
  if (W < 16 || H < 16) return null;
  const f = Math.max(1, Math.ceil(Math.max(W, H) / TARGET));
  const w = Math.ceil(W / f), h = Math.ceil(H / f);

  const gray = blur(downGray(img, f, w, h), w, h);
  const thr = otsu(gray);
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = gray[i]! > thr ? 1 : 0;
  const mask = dilate(erode(raw, w, h, 2), w, h, 2);

  const comp = largestComponent(mask, w, h);
  if (!comp) return null;
  const filled = fillHoles(comp.mask, w, h);

  const hull = convexHull(rowExtremes(filled.mask, w, h));
  if (hull.length < 4) return null;
  const small = refine(order(reduceToFour(hull)), filled.mask, w, h);

  const area = polyArea(small);
  if (area < MIN_AREA_FRAC * w * h) return null;
  for (const a of angles(small)) if (a < MIN_ANGLE || a > MAX_ANGLE) return null;
  const fill = filled.area / area;
  if (fill < MIN_FILL || fill > MAX_FILL) return null;

  // التباين: متوسط الورقة مقابل متوسط ما خارجها
  let sIn = 0, nIn = 0, sOut = 0, nOut = 0;
  for (let i = 0; i < gray.length; i++) {
    if (filled.mask[i]) { sIn += gray[i]!; nIn++; } else { sOut += gray[i]!; nOut++; }
  }
  // ورقة تملأ الإطار كله تقريباً: لا «خارج» يُقاس عليه، فيُعدّ التباين مقبولاً بالحدّ الأدنى
  const contrast = nOut > 0.01 * w * h ? sIn / nIn - sOut / nOut : MIN_CONTRAST + 15;
  if (contrast < MIN_CONTRAST) return null;

  const fillScore = clamp01(1 - Math.max(0, Math.abs(1 - fill) - 0.03) / 0.12);
  const contrastScore = clamp01((contrast - MIN_CONTRAST) / 45);
  // زاوية على حافة الإطار تخمين (الورقة خرجت منه)
  const onEdge = small.filter((p) => p.x <= 1 || p.y <= 1 || p.x >= w - 1 || p.y >= h - 1).length;
  const confidence = fillScore * contrastScore * (1 - 0.15 * onEdge);
  if (confidence < MIN_CONFIDENCE) return null;

  const corners = small.map((p) => ({
    x: Math.min(W, Math.max(0, p.x * f)),
    y: Math.min(H, Math.max(0, p.y * f)),
  })) as Quad;
  return { corners, confidence: Math.round(confidence * 1000) / 1000 };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** تصغير بمتوسط المساحة إلى إضاءة (0–255). */
function downGray(img: Img, f: number, w: number, h: number): Float32Array {
  const { data, width: W, height: H } = img;
  const sum = new Float32Array(w * h);
  const cnt = new Float32Array(w * h);
  const col = new Int32Array(W);
  for (let x = 0; x < W; x++) col[x] = (x / f) | 0;
  for (let y = 0; y < H; y++) {
    const row = ((y / f) | 0) * w;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const k = row + col[x]!;
      sum[k] = sum[k]! + 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      cnt[k] = cnt[k]! + 1;
    }
  }
  for (let k = 0; k < sum.length; k++) sum[k] = sum[k]! / cnt[k]!;
  return sum;
}

/** تمويه صندوقي نصف قطره ٢، أفقياً ثم عمودياً، مرّتين. */
function blur(src: Float32Array, w: number, h: number): Float32Array {
  let a = src;
  const r = 2;
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < w) { s += a[y * w + xx]!; n++; }
        }
        t[y * w + x] = s / n;
      }
    }
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < h) { s += t[yy * w + x]!; n++; }
        }
        o[y * w + x] = s / n;
      }
    }
    a = o;
  }
  return a;
}

/** عتبة Otsu: الحدّ الذي يعظّم التباين بين الفئتين. */
function otsu(g: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, Math.round(g[i]!)))]!++;
  const total = g.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]!;
  let wB = 0, sumB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT + 0.5;
}

function morph(m: Uint8Array, w: number, h: number, r: number, keep: 0 | 1): Uint8Array {
  // تآكل (keep=1: يبقى 1 إن كان كل الجوار 1) أو تمدّد (keep=0: يصير 1 إن كان في الجوار 1)، مربّع منفصل
  const pass = (src: Uint8Array, horiz: boolean) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = keep;
        for (let d = -r; d <= r; d++) {
          const xx = horiz ? x + d : x, yy = horiz ? y : y + d;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const s = src[yy * w + xx]!;
          if (keep === 1 && s === 0) { v = 0; break; }
          if (keep === 0 && s === 1) { v = 1; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(m, true), false);
}
const erode = (m: Uint8Array, w: number, h: number, r: number) => morph(m, w, h, r, 1);
const dilate = (m: Uint8Array, w: number, h: number, r: number) => morph(m, w, h, r, 0);

/** أكبر مكوّن متصل (جوار ٤) من البكسلات 1. */
function largestComponent(m: Uint8Array, w: number, h: number): { mask: Uint8Array } | null {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let next = 0, bestLabel = 0, bestSize = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++;
    let head = 0, tail = 0;
    queue[tail++] = s;
    label[s] = next;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && !label[p - 1]) { label[p - 1] = next; queue[tail++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !label[p + 1]) { label[p + 1] = next; queue[tail++] = p + 1; }
      if (y > 0 && m[p - w] && !label[p - w]) { label[p - w] = next; queue[tail++] = p - w; }
      if (y < h - 1 && m[p + w] && !label[p + w]) { label[p + w] = next; queue[tail++] = p + w; }
    }
    if (tail > bestSize) { bestSize = tail; bestLabel = next; }
  }
  if (!bestLabel) return null;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === bestLabel ? 1 : 0;
  return { mask: out };
}

/** يملأ الثقوب: كل ما لا يصل إلى حافة الصورة من خارج المكوّن صار منه. */
function fillHoles(m: Uint8Array, w: number, h: number): { mask: Uint8Array; area: number } {
  const outside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  const seed = (p: number) => { if (!m[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  let head = 0;
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w, y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  const out = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < out.length; i++) if (!outside[i]) { out[i] = 1; area++; }
  return { mask: out, area };
}

/** زوايا مربّعات البكسلات الطرفية في كل صفّ (حدود المكوّن الخارجية بالإحداثي المتصل). */
function rowExtremes(m: Uint8Array, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (m[y * w + x]) { if (a < 0) a = x; b = x; }
    if (a < 0) continue;
    pts.push({ x: a, y }, { x: a, y: y + 1 }, { x: b + 1, y }, { x: b + 1, y: y + 1 });
  }
  return pts;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** الغلاف المحدّب (السلسلة الرتيبة). */
function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** يحذف الرأس الذي يصنع مع جاريه أصغر مثلث، حتى تبقى أربعة رؤوس. */
function reduceToFour(hull: Pt[]): Pt[] {
  const p = hull.slice();
  while (p.length > 4) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = Math.abs(cross(p[(i - 1 + p.length) % p.length]!, p[i]!, p[(i + 1) % p.length]!));
      if (a < ba) { ba = a; bi = i; }
    }
    p.splice(bi, 1);
  }
  return p;
}

/**
 * تدقيق الزوايا: رؤوس الغلاف تقع داخل الزاوية الحقيقية (التنعيم والفتح يدوّران الرأس)، أما
 * الأضلاع فمستقيمة. فيُطابَق خطٌّ مستقيم على نقاط حدود كل ضلع (بعيداً عن طرفيه)، وتُؤخذ الزاوية
 * من تقاطع الخطّين المتجاورين. وإن قلّت النقاط أو ابتعد التقاطع، بقي الرأس الأول.
 */
function refine(q: Quad, m: Uint8Array, w: number, h: number): Quad {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (m[y * w + x]) { if (a < 0) a = x; b = x; }
    if (a >= 0) pts.push({ x: a, y: y + 0.5 }, { x: b + 1, y: y + 0.5 });
  }
  for (let x = 0; x < w; x++) {
    let a = -1, b = -1;
    for (let y = 0; y < h; y++) if (m[y * w + x]) { if (a < 0) a = y; b = y; }
    if (a >= 0) pts.push({ x: x + 0.5, y: a }, { x: x + 0.5, y: b + 1 });
  }
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let s = 0; s < 4; s++) {
    const A = q[s]!, B = q[(s + 1) % 4]!;
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    // مرّتان: الأولى بسماحٍ واسع حول الضلع التقريبي (رؤوسه على حافة الزاوية المقطوعة، فيبتعد
    // عن الحافة الحقيقية بضعة بكسلات)، والثانية بسماحٍ ضيّق حول الخطّ المطابَق
    let L = { px: A.x, py: A.y, dx: (B.x - A.x) / len, dy: (B.y - A.y) / len };
    for (const tol of [6, 1.5]) {
      let n = 0, sx = 0, sy = 0;
      const sel: Pt[] = [];
      for (const p of pts) {
        const t = (p.x - A.x) * L.dx + (p.y - A.y) * L.dy;
        const d = Math.abs((p.x - L.px) * L.dy - (p.y - L.py) * L.dx);
        if (t > 0.12 * len && t < 0.88 * len && d < tol) { sel.push(p); sx += p.x; sy += p.y; n++; }
      }
      if (n < 8) return q;
      const mx = sx / n, my = sy / n;
      let cxx = 0, cxy = 0, cyy = 0;
      for (const p of sel) { const ax = p.x - mx, ay = p.y - my; cxx += ax * ax; cxy += ax * ay; cyy += ay * ay; }
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // اتجاه المحور الرئيس
      let dx = Math.cos(th), dy = Math.sin(th);
      if (dx * L.dx + dy * L.dy < 0) { dx = -dx; dy = -dy; } // يبقى باتجاه A ← B
      L = { px: mx, py: my, dx, dy };
    }
    lines.push(L);
  }
  const out: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const L1 = lines[(k + 3) % 4]!, L2 = lines[k]!; // الضلع الداخل إلى الرأس k والخارج منه
    const den = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(den) < 1e-6) return q;
    const t = ((L2.px - L1.px) * L2.dy - (L2.py - L1.py) * L2.dx) / den;
    const p = { x: L1.px + t * L1.dx, y: L1.py + t * L1.dy };
    if (Math.hypot(p.x - q[k]!.x, p.y - q[k]!.y) > 12) return q;
    out.push(p);
  }
  return out as Quad;
}

/** يرتّب: أعلى-يسار، أعلى-يمين، أسفل-يمين، أسفل-يسار (مع عقارب الساعة على الشاشة). */
export function order(q: Pt[]): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const s = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (s[i]!.x + s[i]!.y < s[start]!.x + s[start]!.y) start = i;
  return [s[start]!, s[(start + 1) % 4]!, s[(start + 2) % 4]!, s[(start + 3) % 4]!];
}

function polyArea(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!, n = q[(i + 1) % q.length]!;
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** الزوايا الداخلية بالدرجات. */
function angles(q: Pt[]): number[] {
  return q.map((p, i) => {
    const a = q[(i - 1 + q.length) % q.length]!, b = q[(i + 1) % q.length]!;
    const v1x = a.x - p.x, v1y = a.y - p.y, v2x = b.x - p.x, v2y = b.y - p.y;
    const c = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  });
}
