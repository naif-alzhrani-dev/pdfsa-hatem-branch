/**
 * صورة الخلفية (قرار نايف ٢٠٢٦/١١/١٢، مواصفة لمى v2 §٦): تملأ الصفحة بالتغطية والقصّ في الوسط.
 * تُقصّ هنا على نسبة A4 ثم تُصغَّر إلى ١٧٥٤ بكسل ارتفاعاً (A4 بـ١٥٠ نقطة في البوصة) وتُضغط JPEG بجودة .85،
 * فيضمّها المحرّك (`pdf.ts`) مرّة واحدة لكل الصفحات. وتُحفظ على الجهاز كالتوقيع والختم (الدفعة ز، قرار نايف ٢٠٢٦/١١/١٢، `store.ts`).
 */
import { MARGIN_RANGE, type LetterImage } from "./model";

export const BG_H = 1754;
export const BG_W = Math.round((BG_H * 210) / 297); // 1240
export const BG_QUALITY = 0.85;
/** أكبر ملف يُفكّ (ملاحظة 🕵️ أمين على الدفعة ج): ما فوقه يُرفض قبل فكّه، برسالة «تعذّر فتح الصورة» */
export const BG_MAX_BYTES = 25 * 1024 * 1024;

/** ما يُقصّ من الصورة (بكسلها) وما يُخرج: التغطية في الوسط على نسبة A4، ولا تكبير لصورة أصغر. */
export function bgPlan(w: number, h: number): { sx: number; sy: number; sw: number; sh: number; ow: number; oh: number } {
  const ratio = 210 / 297;
  let sw = w, sh = h;
  if (w / h > ratio) sw = h * ratio; else sh = w / ratio;
  const sx = (w - sw) / 2, sy = (h - sh) / 2;
  const k = Math.min(1, BG_H / sh);
  return { sx, sy, sw, sh, ow: Math.max(1, Math.round(sw * k)), oh: Math.max(1, Math.round(sh * k)) };
}

/** من ملف إلى JPEG الخلفية. «not-image» لما ليس صورة، و«bad» لصورة لا تُفتح. */
export async function prepareBackground(file: File): Promise<LetterImage | "not-image" | "bad"> {
  if (file.type && !file.type.startsWith("image/")) return "not-image";
  if (file.size > BG_MAX_BYTES) return "bad";
  // عنصر الصورة كـ`decode` في ui.ts: يحترم اتجاه الصورة في كل المتصفحات، و`createImageBitmap` بخياراته لا يعمل في Safari القديم
  const url = URL.createObjectURL(file);
  const bmp = new Image();
  try { await new Promise((res, rej) => { bmp.onload = res; bmp.onerror = rej; bmp.src = url; }); } catch { URL.revokeObjectURL(url); return file.type ? "bad" : "not-image"; }
  URL.revokeObjectURL(url);
  // صورة بلا أبعاد (SVG بلا width وheight) تخرج خلفيةً بيضاء، فتُرفض كصورة لا تُفتح (ملاحظة أمين)
  if (!bmp.naturalWidth || !bmp.naturalHeight) return "bad";
  const p = bgPlan(bmp.naturalWidth, bmp.naturalHeight);
  const c = document.createElement("canvas");
  c.width = p.ow; c.height = p.oh;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // صورة PNG بشفافية: ما تحتها ورقة بيضاء، وJPEG بلا قناة شفافية
  ctx.fillRect(0, 0, p.ow, p.oh);
  ctx.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, 0, 0, p.ow, p.oh);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", BG_QUALITY));
  if (!blob) return "bad";
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "jpg", w: p.ow, h: p.oh };
}

/* ───────── الضبط التلقائي للهوامش من صورة الخلفية (قرار نايف ٢٠٢٦/١١/١٢، الدفعة ز) ─────────
 * لون الورقة الغالب في منتصف الصورة (٤٠–٦٠٪ من ارتفاعها)، ثم كل صفّ يختلف عنه في ٠٫٥٪ من بكسله فأكثر صفُّ رسم.
 * الترويسة: أول صفّ رسم في أعلى ٦٠ مم، وتمتدّ ما دامت الفجوات بين صفوف الرسم أقلّ من ١٢ مم. والتذييل كذلك من أسفل.
 * فإن بلغ الرسم حدّاً لا يكون معه هامشٌ مسموح (الأعلى ١٤٥ مم، والأسفل ٩٥ مم) فهي خلفية تملأ الصفحة لا ترويسة. وكذلك إن لم يلِه
 * في ٢ مم صفٌّ هادئ (متوسّط فرقه دون ٢٤): فالرسم يتلاشى في الورقة تدرّجاً، ولا حدّ له يُبنى عليه. والحساب كله على الجهاز. */
const SCAN = { diff: 40, quiet: 24, quietMm: 2, rowShare: 0.005, startMm: 60, gapMm: 12, gap: 5 } as const;

/** حدّا الرسم بالمليمتر: أسفل الترويسة من أعلى الصفحة، وأعلى التذييل من أسفلها. وnull لما لا رسم فيه. */
export function scanEdges(px: Uint8ClampedArray, w: number, h: number): { top: number | null; bottom: number | null } {
  const mm = 297 / h;
  // ١. لون الورقة: أكثر الألوان في منتصف الصورة (٤ بتّات لكل قناة)، ثم متوسّط بكسلها
  const bins = new Uint32Array(4096);
  const y0 = Math.floor(h * 0.4), y1 = Math.ceil(h * 0.6);
  for (let y = y0; y < y1; y++) for (let x = 0, i = y * w * 4; x < w; x++, i += 4) bins[((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4)]!++;
  let best = 0;
  for (let b = 1; b < 4096; b++) if (bins[b]! > bins[best]!) best = b;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
    if ((((px[i]! >> 4) << 8) | ((px[i + 1]! >> 4) << 4) | (px[i + 2]! >> 4)) !== best) continue;
    r += px[i]!; g += px[i + 1]!; bl += px[i + 2]!; n++;
  }
  r /= n; g /= n; bl /= n;
  // ٢. صفوف الرسم: الفرق في أيّ قناة فوق ٤٠، في ٠٫٥٪ من الصفّ فأكثر (فلا يُعدّ ضجيج خفيف ولا نقاط متفرّقة)
  const need = Math.max(2, Math.ceil(w * SCAN.rowShare));
  const ink = (y: number) => {
    let c = 0;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      if (Math.abs(px[i]! - r) > SCAN.diff || Math.abs(px[i + 1]! - g) > SCAN.diff || Math.abs(px[i + 2]! - bl) > SCAN.diff) if (++c >= need) return true;
    }
    return false;
  };
  /** صفّ هادئ: متوسّط أكبر فرقٍ في القنوات دون ٢٤ (الضجيج الخفيف ±٢٠ متوسّطه نحو ١٥) */
  const quiet = (y: number) => {
    let t = 0;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) t += Math.max(Math.abs(px[i]! - r), Math.abs(px[i + 1]! - g), Math.abs(px[i + 2]! - bl));
    return t / w < SCAN.quiet;
  };
  // ٣. من الحافّة إلى الداخل: أول رسم في أول ٦٠ مم، ثم ما اتّصل به بفجوات دون ١٢ مم
  const band = (from: (k: number) => number, capMm: number): number | null => {
    const start = Math.ceil(SCAN.startMm / mm), gap = Math.round(SCAN.gapMm / mm), cap = Math.floor(capMm / mm);
    let k = 0;
    while (k < start && !ink(from(k))) k++;
    if (k >= start) return null;
    let last = k;
    for (k = last + 1; k < h && k - last < gap; k++) if (ink(from(k))) { last = k; if (last >= cap) return null; }
    const calm = Math.max(1, Math.round(SCAN.quietMm / mm));
    for (k = last + 1; k <= last + calm && k < h; k++) if (quiet(from(k))) return (last + 1) * mm;
    return null;
  };
  const top = band((k) => k, MARGIN_RANGE.top[1] - SCAN.gap);
  const bottom = band((k) => h - 1 - k, MARGIN_RANGE.bottom[1] - SCAN.gap);
  return { top, bottom };
}

/**
 * الأعلى والأسفل من حدّي الرسم مع فسحة ٥ مم، مرفوعَين إلى المليمتر التالي، داخل المدى المسموح (والأدنى `min` مع الإطار)
 * ومجموعهما ≤ ٢١٧. وما لا رسم عنده يبقى كما هو. وnull إن لم يتغيّر شيء.
 */
export function edgeMargins(e: { top: number | null; bottom: number | null }, cur: { top: number; bottom: number }, min = 0): { top: number; bottom: number } | null {
  if (e.top === null && e.bottom === null) return null;
  const fit = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, min, Math.ceil(v + SCAN.gap - 1e-9)));
  const top = e.top === null ? cur.top : fit(e.top, MARGIN_RANGE.top);
  const bottom = Math.min(e.bottom === null ? cur.bottom : fit(e.bottom, MARGIN_RANGE.bottom), MARGIN_RANGE.sum - top);
  return { top, bottom };
}

/** حدّا الرسم في صورة الخلفية كما تُرسم (JPEG المُعدّ)، أو null إن تعذّر فكّها */
export async function backgroundEdges(img: LetterImage): Promise<{ top: number | null; bottom: number | null } | null> {
  const url = URL.createObjectURL(new Blob([img.bytes.slice().buffer], { type: img.type === "png" ? "image/png" : "image/jpeg" }));
  try {
    const el = new Image();
    await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = url; });
    const c = document.createElement("canvas");
    c.width = el.naturalWidth; c.height = el.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(el, 0, 0);
    return scanEdges(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
