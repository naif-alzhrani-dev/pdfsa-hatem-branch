/**
 * قص الصفحات بلا DOM: المستطيل نِسَبٌ من الصفحة كما يراها القارئ (0..1 من أعلاها يساراً)، يُحوَّل إلى فضاء كل صفحة
 * بـ`viewportToPdf` نفسها التي تضع التوقيع، ثم `setCropBox`. فيُقصّ الجزء الذي اختاره المستخدم ولو كانت الصفحة مدوّرة.
 * القص يخفي عند العرض: المحتوى خارج المستطيل يبقى داخل الملف.
 */
import { PDFDocument } from "pdf-lib";
import { normRotation, viewportSize, viewportToPdf, type PageGeom } from "../coords";

/** نِسَب المستطيل على الصفحة المعروضة: x وy من أعلاها يساراً، وw وh من عرضها وارتفاعها. */
export interface CropRect { x: number; y: number; w: number; h: number }
export type CropScope = "all" | "first";
/** أصغر تحديد يُقبل: 5% من عرض الصفحة (ومن ارتفاعها). */
export const MIN_FRAC = 0.05;

export const tooSmall = (r: CropRect) => r.w < MIN_FRAC || r.h < MIN_FRAC;

/** صندوق القص الجديد لصفحة (نقاط، فضاء الصفحة): x0,y0,x1,y1. */
export function cropBoxFor(geom: PageGeom, r: CropRect): [number, number, number, number] {
  const { width: W, height: H } = viewportSize(geom, 1);
  const [ax, ay] = viewportToPdf(geom, 1, r.x * W, r.y * H);
  const [bx, by] = viewportToPdf(geom, 1, (r.x + r.w) * W, (r.y + r.h) * H);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** يقصّ كل الصفحات أو الأولى وحدها، ويُرجع الملف الجديد. الصفحة المعروضة صندوقها CropBox ∩ MediaBox، كما يعرضها pdf.js. */
export async function cropPages(bytes: Uint8Array, r: CropRect, scope: CropScope): Promise<Uint8Array> {
  if (tooSmall(r)) throw new Error("crop: too small");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  for (const page of scope === "all" ? pages : pages.slice(0, 1)) {
    const m = page.getMediaBox(), c = page.getCropBox();
    const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
    const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
    const [a, b, e, f] = cropBoxFor({ view: [x0, y0, x1, y1], rotate: normRotation(page.getRotation().angle) }, r);
    page.setCropBox(a, b, e - a, f - b);
  }
  return doc.save();
}
