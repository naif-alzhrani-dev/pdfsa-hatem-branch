/**
 * الصفحات الممسوحة إلى ملف PDF: كل صفحة صورة JPEG مضمّنة بـpdf-lib.
 *
 * - **مقاس الصفحة:** A4 إن كانت نسبة الورقة ضمن ٨٪ من نسبة A4 (عمودية أو أفقية)، وتوضع الصورة
 *   في وسطها بلا تمطيط (فالدائرة تبقى دائرة؛ والهامش أبيض كالورق). وإلا فعرض A4 وارتفاعٌ بنسبة الصورة.
 * - **الجودة:** JPEG بجودة 0.85، فإن تجاوزت الصفحة `MAX_PAGE_BYTES` أُعيد ترميزها بجودة أقل.
 * - **«أبيض وأسود» (خيارات المسح):** صورة بتٍّ واحد للبكسل (DeviceGray، 1 أبيض و0 أسود) مضغوطة بـFlate.
 *   على ورقة حقيقية 1246×1610 (٢٠٢٦/١١/٠٨): 36 KB مقابل 342 KB لـJPEG الرمادي، وبلا هالات JPEG حول الحروف،
 *   لأن الصورة بعد العتبة أبيض وأسود أصلاً (رماديّها الوسط 0.06% من البكسلات).
 */
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import type { Img } from "./types";

export const A4 = { width: 595.28, height: 841.89 }; // نقاط PDF (210×297 مم)
const A4_RATIO = A4.height / A4.width;
const A4_TOLERANCE = 0.08;
export const JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.55];
export const MAX_PAGE_BYTES = 1_500_000;

export interface JpegPage {
  jpeg: Uint8Array;
  width: number; // بكسلات الصورة
  height: number;
}

/** صفحة أبيض وأسود: صفوفٌ من البتّات، كل صف مكمَّل إلى بايت، والبتّ الأعلى أولاً؛ 1 أبيض و0 أسود. */
export interface BitsPage {
  bits: Uint8Array;
  width: number;
  height: number;
}
export type PdfPage = JpegPage | BitsPage;

/** يحوّل صورة (القناة الحمراء، فالأبيض والأسود رماديّ) إلى بتّات: ≥128 أبيض. */
export function packBits(img: Img): Uint8Array {
  const { data, width: w, height: h } = img, row = Math.ceil(w / 8);
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4]! >= 128) out[y * row + (x >> 3)]! |= 0x80 >> (x & 7);
  return out;
}

export interface Layout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** مقاس الصفحة وموضع الصورة فيها، بالنقاط. */
export function layoutPage(w: number, h: number): Layout {
  const r = h / w;
  const near = (a: number) => Math.abs(r / a - 1) <= A4_TOLERANCE;
  let pw: number, ph: number;
  if (near(A4_RATIO)) { pw = A4.width; ph = A4.height; }
  else if (near(1 / A4_RATIO)) { pw = A4.height; ph = A4.width; }
  else return { pageWidth: A4.width, pageHeight: A4.width * r, x: 0, y: 0, width: A4.width, height: A4.width * r };
  const s = Math.min(pw / w, ph / h);
  const dw = w * s, dh = h * s;
  return { pageWidth: pw, pageHeight: ph, x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh };
}

export async function buildPdf(pages: PdfPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("no pages");
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const l = layoutPage(p.width, p.height);
    const page = doc.addPage([l.pageWidth, l.pageHeight]);
    if ("jpeg" in p) {
      page.drawImage(await doc.embedJpg(p.jpeg), { x: l.x, y: l.y, width: l.width, height: l.height });
      continue;
    }
    const ref = doc.context.register(doc.context.flateStream(p.bits, {
      Type: "XObject", Subtype: "Image", Width: p.width, Height: p.height, ColorSpace: "DeviceGray", BitsPerComponent: 1,
    }));
    const name = page.node.newXObject("Image", ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(l.width, 0, 0, l.height, l.x, l.y), drawObject(name), popGraphicsState());
  }
  return doc.save();
}

/** يرمّز بأعلى جودة لا يتجاوز ناتجها السقف، وإلا فبأدنى جودة في القائمة. */
export async function encodeCapped(
  img: Img,
  encode: (img: Img, quality: number) => Promise<Uint8Array>,
  maxBytes = MAX_PAGE_BYTES,
): Promise<Uint8Array> {
  let bytes: Uint8Array | null = null;
  for (const q of JPEG_QUALITIES) {
    bytes = await encode(img, q);
    if (bytes.byteLength <= maxBytes) return bytes;
  }
  return bytes!;
}

/** ترميز JPEG في المتصفح (لوحة رسم واحدة بمقاس الصفحة، تُفرَّغ بعده). لا يعمل في Node. */
export async function encodeJpeg(img: Img, quality: number): Promise<Uint8Array> {
  const id = new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height);
  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext("2d")!.putImageData(id, 0, 0);
    blob = await c.convertToBlob({ type: "image/jpeg", quality });
    c.width = c.height = 0;
  } else {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d")!.putImageData(id, 0, 0);
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", quality));
    c.width = c.height = 0;
  }
  return new Uint8Array(await blob.arrayBuffer());
}
