/**
 * العلامة المائية بلا DOM: نصٌّ مائل 45° في وسط كل صفحة كما يراها القارئ، بعتمة خفيفة أو متوسطة.
 * النصّ صورة PNG يرسمها المتصل (canvas بخطّ المنصة، src/tools/watermark.ts)، لأن pdf-lib لا يشكّل العربية.
 * والصورة تُضمَّن مرة واحدة وتُرسم على كل صفحة، والعتمة من `opacity` في pdf-lib (ExtGState)، لا من ألفا الصورة.
 */
import { PDFDocument, degrees } from "pdf-lib";
import { normRotation, viewportSize, viewportToPdf, type PageGeom } from "../coords";

export type Strength = "light" | "medium";
/** العتمة: خفيفة 20%، ومتوسطة 35% (قاعدة رائد والتكليف). */
export const OPACITY: Record<Strength, number> = { light: 0.2, medium: 0.35 };
/** لون العلامة: رماديّ محايد. */
export const GRAY = "#808080";
/** الميل على الصفحة المعروضة: يصعد من أسفل اليسار إلى أعلى اليمين. */
export const ANGLE = 45;
/** أكبر حجم للخط بالنقاط، وأقصى طول للعلامة نسبةً إلى قطر الصفحة المعروضة. */
export const FONT_MAX_PT = 72;
export const FIT = 0.8;

/** صورة العلامة: PNG، وعرضها وارتفاعها بالنقاط عند FONT_MAX_PT. */
export interface MarkImage { png: Uint8Array; w: number; h: number }

/** مقاس العلامة على صفحة معروضة W×H: حجمها الأكبر، أو أصغر حتى لا يزيد طولها على FIT من القطر. */
export function markSize(W: number, H: number, w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, (FIT * Math.hypot(W, H)) / w);
  return { w: w * k, h: h * k };
}

/** يرسم العلامة في وسط كل صفحة ويُرجع الملف الجديد. الصفحة المعروضة صندوقها CropBox ∩ MediaBox، كما يعرضها pdf.js. */
export async function watermarkPages(bytes: Uint8Array, img: MarkImage, strength: Strength): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const image = await doc.embedPng(img.png);
  for (const page of doc.getPages()) {
    const m = page.getMediaBox(), c = page.getCropBox();
    const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
    const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
    const geom: PageGeom = { view: [x0, y0, x1, y1], rotate: normRotation(page.getRotation().angle) };
    const { width: W, height: H } = viewportSize(geom, 1);
    const { w, h } = markSize(W, H, img.w, img.h);
    const [cx, cy] = viewportToPdf(geom, 1, W / 2, H / 2); // وسط ما يُرى، في فضاء الصفحة
    // الصورة تُدار حول زاويتها السفلى اليسرى: /Rotate لتظهر قائمة، ثم الميل. فتُزاح الزاوية ليقع وسطها في الوسط
    const a = ((geom.rotate + ANGLE) * Math.PI) / 180;
    const x = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
    const y = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
    page.drawImage(image, { x, y, width: w, height: h, rotate: degrees(geom.rotate + ANGLE), opacity: OPACITY[strength] });
  }
  return doc.save();
}
