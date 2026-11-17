/**
 * «PDF إلى صور» بلا DOM: مقياس الرسم، وأسماء الصور، وملف ZIP.
 * الرسم نفسه (pdf.js على canvas، صفحةً صفحة) في pdf-to-jpg.ts.
 */
import { baseName } from "../split-pdf";

export type ImageFormat = "jpg" | "png";
/** الدقة الثابتة: نقطتان من البكسل لكل نقطة PDF (A4 ≈ 1190×1684). */
export const SCALE = 2;
/** حدّ لوحة الرسم في Safari على iOS: 16,777,216 بكسلاً (4096²)؛ فوقه تُرسم اللوحة فارغة أو يتعطّل التبويب. */
export const MAX_CANVAS_PIXELS = 16_777_216;
/** أطول ضلع للوحة يقبله Chrome وSafari. */
export const MAX_CANVAS_SIDE = 16_384;
export const JPEG_QUALITY = 0.92;

/** مقياس صفحة مقاسها `w`×`h` نقطة: SCALE، أو أقلّ منه حتى تتّسع اللوحة، و`reduced` إن صُغّرت. */
export function renderScale(w: number, h: number, want = SCALE, maxPixels = MAX_CANVAS_PIXELS, maxSide = MAX_CANVAS_SIDE) {
  let s = want;
  const px = (k: number) => Math.round(w * k) * Math.round(h * k);
  if (px(s) > maxPixels) s = Math.sqrt(maxPixels / (w * h));
  if (Math.max(w, h) * s > maxSide) s = maxSide / Math.max(w, h);
  while (s > 0 && (px(s) > maxPixels || Math.round(Math.max(w, h) * s) > maxSide)) s *= 0.999; // التقريب لا يتجاوز الحدّ
  return { scale: s, width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), reduced: s < want };
}

/** «خطاب-01.jpg»…: اسم الملف ورقم الصفحة بخانات ثابتة (اثنتان على الأقل) فيصحّ الترتيب عند الفرز. */
export function imageName(fileName: string, page: number, total: number, format: ImageFormat): string {
  const width = Math.max(2, String(total).length);
  return `${baseName(fileName)}-${String(page).padStart(width, "0")}.${format}`;
}

export const zipName = (fileName: string) => `${baseName(fileName)}.zip`;

/** يجمع الصور في ZIP بلا ضغط (JPG وPNG مضغوطتان أصلاً)، صورةً صورة كلما رُسمت. `fflate` يُحمَّل عند الطلب. */
export async function zipWriter() {
  const { Zip, ZipPassThrough } = await import("fflate");
  const chunks: Uint8Array[] = [];
  let failed: Error | null = null;
  const zip = new Zip((err, chunk) => { if (err) failed = err; else chunks.push(chunk); });
  return {
    add(name: string, bytes: Uint8Array) {
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(bytes, true);
    },
    end(): Blob {
      zip.end();
      if (failed) throw failed;
      return new Blob(chunks as BlobPart[], { type: "application/zip" });
    },
  };
}

/* ─── (٢٤) حفظ الصور منفصلة على الجوال (docs/logs/pdf-images-24-lama-spec.md) ─── */
/** أكثر صفحاتٍ تُعرض صورها منفصلة في قائمة المشاركة. وفوقه الملف المضغوط وحده وسطر الحدّ. */
export const SHARE_IMAGES_MAX = 20;
/** iPhone أو iPad أو Android: من `navigator.userAgent` و`platform` و`maxTouchPoints` (iPad يتسمّى Mac). */
export const isPhone = (ua: string, platform = "", touch = 0) =>
  /iPhone|iPad|iPod|Android/i.test(ua) || (platform === "MacIntel" && touch > 1);
/**
 * ما يُعرض مع الملف المضغوط: `share` تُجهَّز الصور منفصلة أثناء التحويل (Safari يُسقط `share` بعد `await` ثقيل)،
 * و`over-limit` سطر الحدّ، و`none` لا تغيير (الكمبيوتر، وصفحة واحدة). وشرط `canShare` الثالث في ورقة «حُفظ الملف».
 */
export function imagesOffer(pages: number, phone: boolean): "share" | "over-limit" | "none" {
  if (!phone || pages <= 1) return "none";
  return pages <= SHARE_IMAGES_MAX ? "share" : "over-limit";
}
export const imageType = (format: ImageFormat) => (format === "png" ? "image/png" : "image/jpeg");
