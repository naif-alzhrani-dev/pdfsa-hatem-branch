/**
 * ترقيم الصفحات بلا DOM: موضع الرقم على الصفحة كما يراها القارئ، وكتابته في الملف بـpdf-lib.
 * الرقم صورة PNG يرسمها المتصل (canvas بخطّ المنصة في المتصفح، src/tools/page-numbers.ts)، فلا `fontkit` ولا خطّ مضمَّن.
 * والموضع يُحسب على الصفحة المعروضة (بعد /Rotate) ثم يُحوَّل بـ`placement` نفسها التي تضع التوقيع، فيقع الرقم أسفل
 * الصفحة كما تُقرأ ولو كانت أفقية أو مدوّرة.
 */
import { PDFDocument, degrees } from "pdf-lib";
import { normRotation, placement, viewportSize, type PageGeom, type Rect } from "../coords";

export type NumberPos = "center" | "right" | "left";
export type Digits = "arab" | "latn";
export interface NumberOpts { pos: NumberPos; start: number; digits: Digits }
export const DEFAULTS: NumberOpts = { pos: "center", start: 1, digits: "arab" };

/** حجم الرقم بالنقاط (قاعدة رائد: 11)، والمسافة من حافة الصفحة السفلى ومن الجانب. */
export const FONT_PT = 11;
export const MARGIN_BOTTOM = 24;
export const MARGIN_SIDE = 36;
/** أكبر رقم أول يُقبل في الحقل. */
export const START_MAX = 9999;

/** الرقم كما يُكتب: عربي هندي (١٢٣) أو لاتيني (123)، بلا فاصلة آلاف. */
export function numberLabel(n: number, digits: Digits): string {
  return digits === "arab" ? n.toLocaleString("ar-u-nu-arab", { useGrouping: false }) : String(n);
}

/** صندوق الرقم على الصفحة المعروضة (نقاط، من أعلاها يساراً): أسفلها، في الوسط أو اليمين أو اليسار. */
export function numberRect(W: number, H: number, w: number, h: number, pos: NumberPos): Rect {
  const x = pos === "center" ? (W - w) / 2 : pos === "right" ? W - MARGIN_SIDE - w : MARGIN_SIDE;
  return { x, y: H - MARGIN_BOTTOM - h, w, h };
}

/** صورة الرقم: PNG، وعرضها وارتفاعها في الملف بالنقاط. */
export interface NumberImage { png: Uint8Array; w: number; h: number }

/**
 * يكتب رقم كل صفحة أسفلها ويُرجع الملف الجديد. `render` يرسم نصّ الرقم صورةً.
 * الصفحة المعروضة صندوقها CropBox ∩ MediaBox، كما يعرضها pdf.js (src/coords.ts).
 */
export async function numberPages(bytes: Uint8Array, opts: NumberOpts, render: (label: string) => Promise<NumberImage>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const img = await render(numberLabel(opts.start + i, opts.digits));
    const m = page.getMediaBox(), c = page.getCropBox();
    const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
    const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
    const geom: PageGeom = { view: [x0, y0, x1, y1], rotate: normRotation(page.getRotation().angle) };
    const { width: W, height: H } = viewportSize(geom, 1);
    const pl = placement(geom, 1, numberRect(W, H, img.w, img.h, opts.pos));
    page.drawImage(await doc.embedPng(img.png), { x: pl.x, y: pl.y, width: pl.width, height: pl.height, rotate: degrees(pl.rotate) });
  }
  return doc.save();
}
