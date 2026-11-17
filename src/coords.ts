/**
 * تحويل موضع على الشاشة (بكسل داخل صفحة معروضة) إلى إحداثيات PDF.
 *
 * الصفحة تُعرض من صندوقها المرئيّ `view` (CropBox ∩ MediaBox عند pdf.js)،
 * ثم تُدار مع عقارب الساعة بقيمة /Rotate. والصورة تُرسم في فضاء الصفحة
 * غير المُدار، فتُدار عكس العقارب بالقيمة نفسها لتظهر قائمةً كما وُضعت.
 */
export type Rotation = 0 | 90 | 180 | 270;
export interface PageGeom {
  view: [number, number, number, number]; // x0, y0, x1, y1 بالنقاط
  rotate: Rotation;
}
export interface Rect { x: number; y: number; w: number; h: number }

export function normRotation(r: number): Rotation {
  return ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** أبعاد الصفحة المعروضة بالبكسل عند المقياس s. */
export function viewportSize(g: PageGeom, s: number): { width: number; height: number } {
  const w = (g.view[2] - g.view[0]) * s;
  const h = (g.view[3] - g.view[1]) * s;
  return g.rotate % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export function viewportToPdf(g: PageGeom, s: number, vx: number, vy: number): [number, number] {
  const W = (g.view[2] - g.view[0]) * s; // قبل الإدارة
  const H = (g.view[3] - g.view[1]) * s;
  let ux: number, uy: number; // موضع على الصفحة قبل إدارتها
  switch (g.rotate) {
    case 0: ux = vx; uy = vy; break;
    case 90: ux = vy; uy = H - vx; break;
    case 180: ux = W - vx; uy = H - vy; break;
    case 270: ux = W - vy; uy = vx; break;
  }
  return [g.view[0] + ux / s, g.view[3] - uy / s];
}

/** معامِلات `page.drawImage` في pdf-lib لصورة تملأ المستطيل r على الشاشة قائمةً. */
export function placement(g: PageGeom, s: number, r: Rect) {
  const [x, y] = viewportToPdf(g, s, r.x, r.y + r.h); // الزاوية السفلية اليسرى للصورة
  return { x, y, width: r.w / s, height: r.h / s, rotate: g.rotate };
}
