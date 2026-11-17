/**
 * هندسة التدوير ٩٠° مع عقارب الساعة.
 *
 * العنصر الموضوع (توقيع أو ختم أو تاريخ) محفوظ كسوراً من الصفحة المعروضة (`fx fy fw fh`، كما في main.ts)،
 * وهو يدور مع ورقته: بعد التدوير يبقى على المكان نفسه من الورقة، ويظهر مُداراً معها.
 * فللعنصر `turn`: كم يظهر مُداراً مع العقارب على الشاشة (0 عند وضعه، و+90 مع كل تدوير لصفحته).
 * والمستطيل المحفوظ هو صندوقه على الشاشة؛ فإن كان `turn` 90 أو 270 فعرض الصورة نفسها ارتفاع الصندوق.
 */
import { degrees, type PDFPage } from "pdf-lib";
import { normRotation, viewportToPdf, type PageGeom, type Rect, type Rotation } from "./coords";

export interface FracRect { fx: number; fy: number; fw: number; fh: number }

/** يُبقي الدوران في 0–3 أرباع. */
const quarters = (turns: number) => ((Math.round(turns) % 4) + 4) % 4;

/**
 * صندوق العنصر بعد تدوير صفحته `turns` مرة مع العقارب، كسوراً من الصفحة المدارة.
 * نقطة (x, y) من الصفحة المعروضة (y إلى الأسفل) تصير بعد ربع دورة (H − y, x)، وعرض الصفحة الجديد H.
 */
export function rotateFrac(r: FracRect, turns = 1): FracRect {
  switch (quarters(turns)) {
    case 0: return { ...r };
    case 1: return { fx: 1 - r.fy - r.fh, fy: r.fx, fw: r.fh, fh: r.fw };
    case 2: return { fx: 1 - r.fx - r.fw, fy: 1 - r.fy - r.fh, fw: r.fw, fh: r.fh };
    default: return { fx: r.fy, fy: 1 - r.fx - r.fw, fw: r.fh, fh: r.fw };
  }
}

/** دوران العنصر على الشاشة بعد تدوير صفحته. */
export const rotateTurn = (turn: number, turns = 1): Rotation => normRotation(turn + 90 * turns);

/** هندسة الصفحة بعد تدويرها: يُضاف إلى /Rotate الموجود. */
export function rotateGeom(g: PageGeom, turns = 1): PageGeom {
  return { view: g.view, rotate: normRotation(g.rotate + 90 * turns) };
}

/** يكتب التدوير في الملف: `/Rotate` الموجود (ولو موروثاً) + ٩٠ لكل ربع. */
export function rotatePage(page: PDFPage, turns = 1): void {
  page.setRotation(degrees(normRotation(page.getRotation().angle + 90 * turns)));
}

/**
 * معامِلات `page.drawImage` لعنصر صندوقه r على الشاشة (بمقياس s)، وهو يظهر مُداراً `turn` مع العقارب.
 * عند `turn = 0` هي `placement` في coords.ts نفسها.
 *
 * pdf-lib يُدير الصورة عكس العقارب حول زاويتها السفلية اليسرى (x, y)، والعارض يُدير الصفحة مع العقارب بـ/Rotate،
 * فالصافي على الشاشة `g.rotate − rotate` مع العقارب، ونريده `turn`. والزاوية السفلية اليسرى للصورة نفسها
 * تقع على الشاشة: 0 ← أسفل اليسار، 90 ← أعلى اليسار، 180 ← أعلى اليمين، 270 ← أسفل اليمين.
 */
export function placementTurned(g: PageGeom, s: number, r: Rect, turn: number) {
  const t = normRotation(turn);
  const corner: [number, number] =
    t === 0 ? [r.x, r.y + r.h] : t === 90 ? [r.x, r.y] : t === 180 ? [r.x + r.w, r.y] : [r.x + r.w, r.y + r.h];
  const [x, y] = viewportToPdf(g, s, corner[0], corner[1]);
  const sideways = t % 180 !== 0;
  return {
    x, y,
    width: (sideways ? r.h : r.w) / s,
    height: (sideways ? r.w : r.h) / s,
    rotate: normRotation(g.rotate - t),
  };
}
