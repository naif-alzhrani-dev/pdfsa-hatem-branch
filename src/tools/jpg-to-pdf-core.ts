/**
 * «صور إلى PDF» بلا DOM: صفحة لكل صورة بـpdf-lib.
 * - **JPEG** يُضمَّن ببايتاته كما هي (`embedJpg`، DCTDecode)، بلا فكّ ولا إعادة ترميز.
 *   والملف لا يحمل اتجاه EXIF إلى قارئ PDF، فيُقرأ الوسم 0x0112 هنا وتُرسم الصورة بمصفوفة تحويل
 *   تديرها أو تعكسها كما يعرضها المعرض (`orientMatrix`).
 * - **PNG** بـ`embedPng`. وما سواهما يحوّله المتصل (canvas) إلى JPEG قبل أن يصل هنا، باتجاهه الصحيح.
 */
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";

export const MAX_IMAGES = 50;
export const A4 = { width: 595.28, height: 841.89 }; // نقاط (210×297 مم)
/** «بحجم الصورة»: بكسل الصورة = بكسل CSS (96 نقطة في البوصة)، أي 0.75 نقطة. */
export const PT_PER_PX = 0.75;
/** أكبر ضلع لصفحة PDF يقبله Acrobat (200 بوصة). */
export const MAX_PAGE_PT = 14_400;

export type PageSize = "a4" | "image";
export type ImageKind = "jpeg" | "png" | "webp" | "other";

/** الصيغة من أول البايتات (لا من الاسم ولا من `type`، فقد يكذبان). */
export function sniff(b: Uint8Array): ImageKind {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return "other";
}

/** وسم الاتجاه في EXIF (1–8)، و1 إن لم يوجد أو لم يصحّ. يقرأ مقاطع JPEG حتى أول SOS. */
export function jpegOrientation(b: Uint8Array): number {
  if (sniff(b) !== "jpeg") return 1;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return 1;
    const marker = b[p + 1]!;
    if (marker === 0xff) { p++; continue; } // حشو
    if (marker === 0xda || marker === 0xd9) return 1; // بداية البيانات أو النهاية: لا EXIF قبلها
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    if (len < 2) return 1;
    const s = p + 4, e = p + 2 + len;
    if (marker === 0xe1 && e <= b.length && e - s >= 14 && b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66 && b[s + 4] === 0 && b[s + 5] === 0) {
      return tiffOrientation(b, s + 6, e);
    }
    p = e;
  }
  return 1;
}

function tiffOrientation(b: Uint8Array, t: number, end: number): number {
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 1;
  const u16 = (o: number) => (o + 2 > end ? -1 : le ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!);
  const u32 = (o: number) => (o + 4 > end ? -1 : le ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 2 ** 24 : b[o]! * 2 ** 24 + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!));
  if (u16(t + 2) !== 42) return 1;
  const ifd = u32(t + 4);
  if (ifd < 8) return 1;
  const n = u16(t + ifd);
  for (let i = 0; i < n && n > 0; i++) {
    const ent = t + ifd + 2 + i * 12;
    if (ent + 12 > end) return 1;
    if (u16(ent) === 0x0112) {
      const v = u16(ent + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** الاتجاهات 5–8 تبادل العرض والارتفاع: الصورة كما تُرى. */
export function displaySize(w: number, h: number, orientation: number) {
  return orientation >= 5 ? { width: h, height: w } : { width: w, height: h };
}

export type Matrix = [number, number, number, number, number, number];

/**
 * مصفوفة رسم صورة (فضاؤها المربع 0..1، وصفّها الأول في أعلاه v=1) في الصندوق (x, y, w, h) على الصفحة
 * بحيث تظهر كما يعرضها المعرض بعد وسم EXIF. `w`×`h` مقاس العرض (بعد التبديل في 5–8).
 * الاشتقاق: لكل وسم موضع البكسل المخزَّن (u من اليسار، t من الأعلى) على الصورة المعروضة (X، T):
 * 1 (u,t) · 2 (1−u,t) · 3 (1−u,1−t) · 4 (u,1−t) · 5 (t,u) · 6 (1−t,u) · 7 (1−t,1−u) · 8 (t,1−u)،
 * ثم X_page = x + w·X و Y_page = y + h·(1 − T)، و t = 1 − v.
 */
export function orientMatrix(o: number, x: number, y: number, w: number, h: number): Matrix {
  switch (o) {
    case 2: return [-w, 0, 0, h, x + w, y];
    case 3: return [-w, 0, 0, -h, x + w, y + h];
    case 4: return [w, 0, 0, -h, x, y + h];
    case 5: return [0, -h, -w, 0, x + w, y + h];
    case 6: return [0, -h, w, 0, x, y + h];
    case 7: return [0, h, w, 0, x, y];
    case 8: return [0, h, -w, 0, x + w, y];
    default: return [w, 0, 0, h, x, y];
  }
}

export interface PageLayout { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number }

/** مقاس الصفحة وموضع الصورة (مقاس عرضها `w`×`h` بكسلاً). A4 بعرض الصورة أو طولها، والصورة في وسطها بلا تمطيط. */
export function layoutFor(size: PageSize, w: number, h: number): PageLayout {
  if (size === "image") {
    const k = Math.min(PT_PER_PX, MAX_PAGE_PT / Math.max(w, h));
    const pw = w * k, ph = h * k;
    return { pageWidth: pw, pageHeight: ph, x: 0, y: 0, width: pw, height: ph };
  }
  const [pw, ph] = w > h ? [A4.height, A4.width] : [A4.width, A4.height];
  const s = Math.min(pw / w, ph / h);
  const dw = w * s, dh = h * s;
  return { pageWidth: pw, pageHeight: ph, x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh };
}

/** صورة جاهزة للضمّ: JPEG ببايتاته واتجاهه، أو PNG. */
export interface PdfImage { kind: "jpeg" | "png"; bytes: Uint8Array }

/** يبني الملف. `fallback` يحوّل صورةً لم يقبلها pdf-lib (JPEG بترميز لا يقرؤه) إلى JPEG من canvas. */
export async function imagesToPdf(images: readonly PdfImage[], size: PageSize, fallback?: (i: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    const im = images[i]!;
    let embedded, orientation = 1;
    try {
      if (im.kind === "png") embedded = await doc.embedPng(im.bytes);
      else { embedded = await doc.embedJpg(im.bytes); orientation = jpegOrientation(im.bytes); }
    } catch (e) {
      if (!fallback) throw e;
      embedded = await doc.embedJpg(await fallback(i));
      orientation = 1; // ما يرسمه canvas قائمٌ أصلاً
    }
    const d = displaySize(embedded.width, embedded.height, orientation);
    const l = layoutFor(size, d.width, d.height);
    const page = doc.addPage([l.pageWidth, l.pageHeight]);
    const name = page.node.newXObject("Image", embedded.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...orientMatrix(orientation, l.x, l.y, l.width, l.height)), drawObject(name), popGraphicsState());
  }
  return doc.save();
}

/** الترتيب الأولي بالاسم، والأرقام بقيمتها (IMG_2 قبل IMG_10). */
const byName = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
export function sortByName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => byName.compare(a.name, b.name));
}
