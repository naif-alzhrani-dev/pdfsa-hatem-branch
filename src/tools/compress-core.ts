/**
 * ضغط ملف PDF: يعيد ترميز صور JPEG المضمّنة (`DCTDecode`) بجودة وأبعاد أقل عبر canvas، ولا يلمس غيرها.
 * لا تُلمس: Flate وJBIG2 وJPX، والصور ذات القناع والصور التي هي قناع، وCMYK وما لا يُعرف لون مكوّناته.
 * والصفحات لا تُحوَّل إلى صور، فالنص القابل للتحديد باقٍ.
 */
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFContext, type PDFObject } from "pdf-lib";
import { hasSignature, scanPdf } from "./pdf-checks";

export type CompressLevel = "light" | "strong";
export type CompressError = "too-big" | "bad-pdf" | "encrypted" | "no-images" | "already-small" | "failed";
export type SkipReason = "not-jpeg" | "masked" | "colorspace" | "small" | "too-large" | "undecodable" | "no-smaller";

/** كم صورة أعيد ترميزها، وكم تُركت ولماذا: المنع يُعدّ ولا يقع بصمت. */
export interface CompressStats {
  images: number;
  reencoded: number;
  skipped: Partial<Record<SkipReason, number>>;
}
/** `signed`: في الملف توقيع رقمي، والضغط يعيد كتابته فيبطل التوقيع. */
export type CompressResult =
  | { ok: true; bytes: Uint8Array; before: number; after: number; stats: CompressStats; signed: boolean }
  | { ok: false; error: CompressError; stats?: CompressStats };

/** يُعيد JPEG جديداً بالأبعاد المطلوبة، أو null إن تعذّر فك الصورة. */
export type Reencoder = (jpeg: Uint8Array, target: { width: number; height: number; quality: number }) => Promise<Uint8Array | null>;

export const LEVELS: Record<CompressLevel, { quality: number; maxSide: number }> = {
  light: { quality: 0.6, maxSide: 2000 },
  strong: { quality: 0.45, maxSide: 1400 },
};
/** شرط الوعد: أقل من ٥٪ توفيراً في الملف كله لا يُسلَّم. */
export const MIN_FILE_GAIN = 0.05;
/** الصورة لا تُستبدل إلا إن وفّرت ١٠٪ من حجمها، فإعادة الترميز خسارة في الجودة. */
const MIN_IMAGE_GAIN = 0.1;
/** الأصغر من هذا (شعار أو ختم) لا يستحق خسارة الجودة. */
const MIN_IMAGE_BYTES = 20_000;
/** فوق هذا من البكسلات (٤٠ مليوناً، نحو ١٦٠ MB في canvas) لا تُفك الصورة، فترويسة JPEG قد تعلن ما لا تحمله الذاكرة. */
export const MAX_IMAGE_PIXELS = 40_000_000;

const name = (s: string) => PDFName.of(s);
const DCT = name("DCTDecode");

interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** الصورة بلا APP1–APP13 وAPP15: يسقط اتجاه EXIF وملف ICC، فالعارض لا يعمل بهما، والمتصفح لو قرأهما لدوّر الصورة أو غيّر ألوانها. */
  clean: Uint8Array;
}

/** يقرأ ترويسات JPEG حتى بداية البيانات. null لما ليس JPEG بثماني بتّات. */
export function parseJpeg(b: Uint8Array): JpegInfo | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let info: Omit<JpegInfo, "clean"> | null = null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1]!;
    if (marker === 0xff) { p++; continue; } // حشو
    if (marker === 0xda) {
      if (!info) return null;
      parts.push(b.subarray(p));
      const clean = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const x of parts) { clean.set(x, at); at += x.length; }
      return { ...info, clean };
    }
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (b[p + 4] !== 8) return null;
      info = { height: (b[p + 5]! << 8) | b[p + 6]!, width: (b[p + 7]! << 8) | b[p + 8]!, components: b[p + 9]! };
    }
    const dropped = marker >= 0xe1 && marker <= 0xef && marker !== 0xee; // APP14 (Adobe) يبيّن تحويل الألوان فيبقى
    if (!dropped) parts.push(b.subarray(p, p + 2 + len));
    p += 2 + len;
  }
  return null;
}

/** عدد مكوّنات لون الصورة، و0 لما لا يصح لمسه (CMYK وLab وSeparation وIndexed…). */
function colorComponents(cs: PDFObject | undefined, ctx: PDFContext): number {
  const value = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (value === name("DeviceRGB")) return 3;
  if (value === name("DeviceGray")) return 1;
  if (value instanceof PDFArray && value.lookup(0) === name("ICCBased")) {
    const profile = value.lookup(1);
    const n = profile instanceof PDFRawStream ? profile.dict.lookup(name("N")) : undefined;
    const count = n instanceof PDFNumber ? n.asNumber() : 0;
    return count === 1 || count === 3 ? count : 0;
  }
  return 0;
}

function isSoleDct(filter: PDFObject | undefined): boolean {
  return filter === DCT || (filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === DCT);
}

/** كل الصور التي تُستعمل قناعاً لغيرها: تغيير أبعادها أو ألوانها يفسد ما تقنّعه. */
function maskRefs(ctx: PDFContext): Set<PDFRef> {
  const out = new Set<PDFRef>();
  for (const [, object] of ctx.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (!dict) continue;
    for (const key of ["SMask", "Mask"]) {
      const v = dict.get(name(key));
      if (v instanceof PDFRef) out.add(v);
    }
  }
  return out;
}

async function canvasReencode(jpeg: Uint8Array, target: { width: number; height: number; quality: number }): Promise<Uint8Array | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
  } catch {
    return null;
  }
  try {
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(target.width, target.height);
      const g = c.getContext("2d", { alpha: false })!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bitmap, 0, 0, target.width, target.height);
      blob = await c.convertToBlob({ type: "image/jpeg", quality: target.quality });
      c.width = c.height = 0;
    } else {
      const c = document.createElement("canvas");
      c.width = target.width; c.height = target.height;
      const g = c.getContext("2d", { alpha: false })!;
      g.imageSmoothingQuality = "high";
      g.drawImage(bitmap, 0, 0, target.width, target.height);
      blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", target.quality));
      c.width = c.height = 0;
    }
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    bitmap.close();
  }
}

/** `reencode` يُمرَّر في الاختبارات فقط، فالمتصفح وحده يملك canvas. */
export async function compressPdf(bytes: Uint8Array, level: CompressLevel, reencode: Reencoder = canvasReencode): Promise<CompressResult> {
  // التشفير من قواميس الذيول وجداول XRef التي يقرؤها الفحص البنيوي، لا من نص الملف: «/Encrypt» داخل محتوى صفحة لا تُعدّ
  const scan = scanPdf(bytes);
  if (scan.error) return { ok: false, error: scan.error };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib الحالية تتعثّر في الكائنات المضغوطة المشفَّرة قبل أن تبلغ فحص التشفير
    return { ok: false, error: e instanceof EncryptedPDFError || scan.encrypted ? "encrypted" : "bad-pdf" };
  }
  // ومحلِّل pdf-lib يكتب trailerInfo من آخر جدول XRef يقرؤه، فالملف المهيّأ للويب (/Encrypt في جدول الصفحة الأولى) يُحمَّل بلا خطأ
  if (scan.encrypted || doc.context.trailerInfo.Encrypt !== undefined) return { ok: false, error: "encrypted" };
  let pageCount: number;
  try {
    pageCount = doc.getPageCount();
  } catch {
    return { ok: false, error: "bad-pdf" };
  }
  const signed = hasSignature(doc.context.enumerateIndirectObjects(), (o): o is PDFDict => o instanceof PDFDict, (s) => PDFName.of(s));

  const { quality, maxSide } = LEVELS[level];
  const ctx = doc.context;
  const masks = maskRefs(ctx);
  const stats: CompressStats = { images: 0, reencoded: 0, skipped: {} };
  const skip = (reason: SkipReason) => { stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1; };

  for (const [ref, object] of ctx.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.lookup(name("Subtype")) !== name("Image")) continue;
    stats.images++;
    const dict = object.dict;
    const has = (key: string) => dict.has(name(key));

    if (!isSoleDct(dict.lookup(name("Filter")))) { skip("not-jpeg"); continue; }
    if (has("SMask") || has("Mask") || has("ImageMask") || masks.has(ref)) { skip("masked"); continue; }
    if (has("Decode") || has("DecodeParms")) { skip("colorspace"); continue; }
    if (object.contents.length < MIN_IMAGE_BYTES) { skip("small"); continue; }

    const source = parseJpeg(object.contents);
    const components = colorComponents(dict.get(name("ColorSpace")), ctx);
    if (!source) { skip("undecodable"); continue; }
    if (components === 0 || components !== source.components) { skip("colorspace"); continue; }
    if (source.width * source.height > MAX_IMAGE_PIXELS) { skip("too-large"); continue; }

    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    let encoded: Uint8Array | null;
    try {
      encoded = await reencode(source.clean, { width, height, quality });
    } catch {
      encoded = null;
    }
    const out = encoded && parseJpeg(encoded);
    if (!encoded || !out || out.width !== width || out.height !== height) { skip("undecodable"); continue; }
    if (encoded.length > object.contents.length * (1 - MIN_IMAGE_GAIN)) { skip("no-smaller"); continue; }
    // canvas يُخرج JPEG بثلاثة مكوّنات حتى لصورة رمادية، والعارض يتبع /ColorSpace
    if (out.components !== components) {
      if (out.components !== 3) { skip("undecodable"); continue; }
      dict.set(name("ColorSpace"), name("DeviceRGB"));
    }

    dict.set(name("Width"), PDFNumber.of(width));
    dict.set(name("Height"), PDFNumber.of(height));
    dict.set(name("BitsPerComponent"), PDFNumber.of(8));
    ctx.assign(ref, PDFRawStream.of(dict, encoded));
    stats.reencoded++;
  }

  if (stats.reencoded === 0) return { ok: false, error: "no-images", stats };

  let saved: Uint8Array;
  try {
    saved = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
  } catch {
    return { ok: false, error: "failed", stats };
  }
  if (saved.length > bytes.length * (1 - MIN_FILE_GAIN)) return { ok: false, error: "already-small", stats };
  // الناتج يُقرأ من جديد قبل إعلان النجاح: صفحة ضاعت في الحفظ أسوأ من ملف لم يصغر
  try {
    if ((await PDFDocument.load(saved, { updateMetadata: false })).getPageCount() !== pageCount) return { ok: false, error: "failed", stats };
  } catch {
    return { ok: false, error: "failed", stats };
  }
  return { ok: true, bytes: saved, before: bytes.length, after: saved.length, stats, signed };
}
