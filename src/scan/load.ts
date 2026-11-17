/**
 * صورة الكاميرا (ملف) إلى بكسلات بالاتجاه الصحيح. يعمل في المتصفح وحده.
 *
 * **الاتجاه:** صور الجوال تُخزَّن غالباً بالعرض ومعها وسم EXIF يقول «دوّرها».
 *  - `createImageBitmap(file, { imageOrientation: "from-image" })`: يطبّق EXIF (مواصفة WHATWG:
 *    القيمة الافتراضية "from-image"). البيانات من MDN browser-compat-data: الدالّة في Safari 15،
 *    وخيار `imageOrientation` في Safari 15، والقيمة "from-image" بهذا الاسم في Safari 16
 *    (Chrome 112، Firefox 111). فإن رُفضت القيمة (Safari 15) يُعاد النداء بلا خيارات
 *    (الافتراضي في المواصفة هو نفسه، و"none" القديمة أُعيدت تسميتها "from-image")، ثم يُلجأ إلى `<img>`.
 *  - لم يُفحص على جهاز حقيقي أن الاتجاه صحيح في كل هذه المسارات.
 *
 * **HEIC:** Safari يفكّ HEIC منذ 17.0 (WebKit). أما تحويل iOS لصورة HEIC إلى JPEG عند الاختيار
 * فيتبع إصدار iOS وخيار «التنسيق» في منتقي الصور، ونُشر في Safari 27 إصلاحٌ لتحويلٍ خاطئ إلى JPEG؛
 * فلا يُفترض أن الملف يصل JPEG. وChrome على Android لا يفكّ HEIC غالباً (غير مؤكَّد): يرمي الفكّ،
 * فتُعرض رسالة `badImage` الموجودة.
 *
 * **الذاكرة:** لوحة رسم واحدة بمقاس الصورة، تُفرَّغ فور قراءة بكسلاتها. وما زاد على `maxPixels`
 * (افتراضياً 12.6M، فتمرّ صورة 4032×3024 كما هي) يُصغَّر عند الرسم، فصورة 48MP لا تتجاوز حدّ اللوحة.
 */
import type { Img } from "./types";

export const MAX_SOURCE_PIXELS = 12_600_000;

type Source = { draw: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    for (const opts of [{ imageOrientation: "from-image" } as ImageBitmapOptions, undefined]) {
      try {
        const b = await createImageBitmap(file, opts);
        return { draw: b, width: b.width, height: b.height, close: () => b.close() };
      } catch { /* القيمة غير مدعومة، أو الصيغة لا تُفكّ: جرّب التالي */ }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode(); // يرمي إن تعذّر الفكّ
    return { draw: im, width: im.naturalWidth, height: im.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export async function loadImage(file: Blob, maxPixels = MAX_SOURCE_PIXELS): Promise<Img> {
  const src = await decode(file);
  try {
    const s = Math.min(1, Math.sqrt(maxPixels / (src.width * src.height)));
    const w = Math.max(1, Math.floor(src.width * s)), h = Math.max(1, Math.floor(src.height * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src.draw, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    c.width = c.height = 0; // يحرّر ذاكرة اللوحة في Safari
    return id;
  } finally {
    src.close();
  }
}
