/**
 * حفظ الإخفاء (docs/logs/pen-raed.md «الحفظ» و«ما يحمل النص خارج الصفحة»):
 * الصفحة التي عليها غطاء تُرسم صورةً (بتعليقاتها وحقولها مسطّحة فيها) ثم يُطلى الغطاء أسود في البكسلات نفسها،
 * فلا يبقى من نصّها شيء في الملف. وما يحمل نصاً خارج الصفحات (المرفقات والإشارات والبيانات الوصفية) يُعرف هنا ليُذكر قبل الحفظ،
 * ويزول لأن الملف الناتج يُبنى جديداً (buildOutput في main.ts).
 */
import * as pdfjs from "pdfjs-dist";
import { burnScale, inkRef, growToInk, ringInk, freeInk, farReach, freeSpan, BURN_GROW_PT, BURN_RING, type Box, type Lum } from "./redact";
import { viewportSize, type PageGeom } from "./coords";

/** مستطيل في فضاء الصفحة الأصلي (نقاط PDF، قبل أي تدوير): x0, y0, x1, y1. */
export type PdfRect = [number, number, number, number];

/** يحوّل مستطيل PDF إلى مستطيل على العرض (x, y, w, h) بمنظور pdf.js نفسه الذي رُسمت به الصفحة. */
export function toView(vp: pdfjs.PageViewport, r: PdfRect) {
  const [a, b] = vp.convertToViewportPoint(r[0], r[1]) as [number, number], [c, d] = vp.convertToViewportPoint(r[2], r[3]) as [number, number];
  return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
}
export function toPdf(vp: pdfjs.PageViewport, x0: number, y0: number, x1: number, y1: number): PdfRect {
  const [a, b] = vp.convertToPdfPoint(x0, y0), [c, d] = vp.convertToPdfPoint(x1, y1);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** فحص القلم يمنع الحفظ: حبرٌ أو علامةٌ خارج الغطاء بعد مدّه (لا عطلٌ عامّ)، فيُذكر برسالته (SP.penRefused). */
export class BurnRefused extends Error {}

/* ───────── اتجاه النصّ عند الغطاء (docs/logs/redact-rotate.md) ─────────
 * فحوص الحرق في redact.ts (`inkRef` و`growToInk` و`freeInk` و`ownMarks`) تفترض نصّاً أفقياً: السطر المجاور فوق الغطاء أو تحته،
 * والكلمة المجاورة عن يمينه ويساره، و`size` ارتفاعه. فعلى الصفحة المدارة ربعاً يصير النصّ رأسياً على لوحة الحرق، ويُعدّ حرفُ الكلمة
 * المجاورة («و» من «ووقّع» تحت «زيد») علامةً فوق الغطاء، فيمتنع الحفظ. فإن كان النصّ عند الغطاء رأسياً تُنقل إضاءة المنطقة والغطاء
 * (x↔y) قبل الفحوص، فيصير النصّ أفقياً (معكوساً، والفحوص لا تفرّق بين الجهتين)، وتُعاد الإحداثيات بعدها. */

/** إضاءةٌ منقولة: البكسل (x, y) يصير (y, x). */
export function transposeLum(g: Lum): Lum {
  const d = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) d[x * g.h + y] = g.d[y * g.w + x]!;
  return { w: g.h, h: g.w, d };
}
export const transposeBox = (b: Box): Box => ({ x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1 });

/** قطعة نصّ من pdf.js كما تلزم هنا: مصفوفتها وعرضها بنقاط الصفحة. */
export interface TextItemLike { str: string; transform: number[]; width: number }
/** ما يُحسم به الاتجاه (ملاحظة أمين ١): قطع النصّ التي يتداخل مستطيلها والغطاء نفسه (بلا هامش) تغطّي معاً نصف مساحته على الأقلّ.
 * فالمطموس نفسه نصٌّ، لا قطعةٌ تجاوره وتحته صورة (ممسوحة) أو مسارات أو حقل نموذج. والنصف بالقياس: في p1h-zayd وp1h-reem كل حرفٍ قطعة،
 * وأكبرها يغطّي ‎0.31–0.32 من الغطاء وحدها، والقطع معاً ‎0.66–0.69 بالأرباع الأربعة (docs/logs/redact-rotate.md «ملاحظات أمين»). */
const OVERLAP = 0.5;
/** ولا تُعدّ قطعةٌ ارتفاعُ خطّها (طول المتّجه (c, d) بعد المنظور) دون ‎0.3 من ضلع الغطاء الأقصر: نصٌّ صغير بجانب المطموس أو فوقه.
 * وفي الملفّين ‎1.43. */
const MIN_HEIGHT = 0.3;
/** المحور: المكوّن الأكبر من متّجه السطر أكبر من الآخر بأربعة أضعاف على الأقلّ (≈ 14°)، وإلا فالقطعة مائلة. */
const AXIS_RATIO = 4;
/**
 * اتجاه النصّ عند الغطاء `b` (بكسلات العرض، و`m` مصفوفة منظور الحرق `vp.transform`): من متّجه سطر كل قطعة نصّ بعد المنظور، لا من مقدار
 * التدوير (ملفٌّ محتواه مُدار يبدو أفقياً مع `/Rotate 90`). "h" أفقي، و"v" رأسي، وnull إن لم يغطِّ النصّ نصف الغطاء (`OVERLAP`)، أو مالت
 * قطعةٌ، أو اختلفت قطعه: والفحص حينها كما كان (نصّ أفقي)، فالشكّ يمنع الحفظ ولا يخفّف الفحص.
 */
export function textAxis(items: TextItemLike[], m: number[], b: Box): "h" | "v" | null {
  const k = Math.hypot(m[0]!, m[1]!), minH = MIN_HEIGHT * Math.min(b.x1 - b.x0, b.y1 - b.y0);
  let axis: "h" | "v" | null = null;
  const hit: Box[] = []; // تداخل كل قطعة والغطاء
  for (const it of items) {
    if (!it.str.trim() || !(it.width > 0)) continue;
    const [a, bb, c, d, e, f] = pdfjs.Util.transform(m, it.transform) as [number, number, number, number, number, number];
    const n = Math.hypot(a, bb);
    if (!(n > 0) || Math.hypot(c, d) < minH) continue;
    const ux = (a / n) * it.width * k, uy = (bb / n) * it.width * k; // مدى القطعة على سطرها، و(c, d) ارتفاع الخط
    const xs = [e, e + ux, e + c, e + ux + c], ys = [f, f + uy, f + d, f + uy + d];
    const q: Box = { x0: Math.max(b.x0, Math.min(...xs)), y0: Math.max(b.y0, Math.min(...ys)), x1: Math.min(b.x1, Math.max(...xs)), y1: Math.min(b.y1, Math.max(...ys)) };
    if (!(q.x1 > q.x0 && q.y1 > q.y0)) continue;
    const here = Math.abs(a) >= AXIS_RATIO * Math.abs(bb) ? "h" : Math.abs(bb) >= AXIS_RATIO * Math.abs(a) ? "v" : null;
    if (!here || (axis && axis !== here)) return null;
    axis = here;
    hit.push(q);
  }
  return axis && covered(hit, b) >= OVERLAP * (b.x1 - b.x0) * (b.y1 - b.y0) ? axis : null;
}
/** مساحة اتّحاد المستطيلات `qs` (داخل `b`)، صفّاً صفّاً بمراكز البكسلات: القطع المتراكبة (نصٌّ مكرّر) لا تُعدّ مرّتين. */
function covered(qs: Box[], b: Box): number {
  let s = 0;
  for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++) {
    const row = qs.filter((q) => q.y0 <= y + 0.5 && y + 0.5 < q.y1).map((q) => [q.x0, q.x1] as const).sort((p, r) => p[0] - r[0]);
    let x = -Infinity;
    for (const [x0, x1] of row) { const from = Math.max(x0, x); if (x1 > from) { s += x1 - from; x = x1; } }
  }
  return s;
}

/** مصدر الإضاءة: لوحةٌ بعرضها وارتفاعها، وإضاءة مستطيلٍ منها. */
export interface LumSource { w: number; h: number; read(ox: number, oy: number, w: number, h: number): Uint8Array }
/**
 * مدّ الغطاء `b` (بكسلات اللوحة) إلى حبرٍ بقي خارجه، وما يُستثنى حوله (`freeInk`)، وعدد بكسلات علامات الحرف خارجه (`stray`)، على
 * اللوحة قبل الطلي. و`vert` نصٌّ رأسي عند الغطاء: تُنقل الإضاءة والغطاء قبل الفحوص. `cap` سقف المدّ، و`reach` المدى البعيد.
 */
export function fitCover(src: LumSource, b: Box, cap: number, reach: number, vert: boolean) {
  // الهامش يتّسع لنافذة freeInk حول الغطاء بعد مدّه (ارتفاعه يزيد 2×cap على الأكثر)، وارتفاعه هو ما بعد النقل
  const t = vert ? transposeBox(b) : b, pad = cap + BURN_RING + freeSpan({ ...t, y1: t.y1 + 2 * cap }, reach) + 2;
  const reg = lumAround(src, b, pad, vert), ref = inkRef(reg.g, reg.local(b));
  const box = reg.global(growToInk(reg.g, reg.local(b), cap, ref, freeInk(reg.g, reg.local(b), ref, reach)).box);
  // الاستثناء يُعاد حسابه حول الغطاء بعد مدّه، على اللوحة قبل الطلي
  const fin = lumAround(src, box, pad, vert), free = freeInk(fin.g, fin.local(box), ref, reach);
  return { box, ref, stray: free.stray, free: (x: number, y: number) => free(...fin.at(x, y)) };
}

/** يرسم الصفحة بمقياس الحرق وعليها الأغطية سوداء، ويعيدها JPEG. `geom` هندستها كما تُعرض (بالتدوير).
 * ويرمي إن بقي حبر حول غطاء بعد مدّه (ملاحظة أمين ٢)، فيفشل الحفظ. */
export async function burnPage(proxy: pdfjs.PDFPageProxy, geom: PageGeom, rects: PdfRect[]): Promise<Uint8Array> {
  const { width, height } = viewportSize(geom, 1);
  const { k } = burnScale(width, height);
  const vp = proxy.getViewport({ scale: k, rotation: geom.rotate });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  try {
    // AnnotationMode.ENABLE: مظاهر التعليقات والحقول تُرسم في الصورة (تسطيح)، ثم لا يُنقل منها شيء إلى الملف
    await proxy.render({ canvas: c, viewport: vp, background: "#ffffff", annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const src = canvasLum(ctx, c);
    // قطع النصّ لاتجاهه عند كل غطاء (`textAxis`)، وبلا نصّ (ممسوحة) لا اتجاه فيبقى الفحص كما كان
    const items = rects.length ? ((await proxy.getTextContent().catch(() => ({ items: [] }))).items.filter((it) => "str" in it) as TextItemLike[]) : [];
    // إلى البكسل الكامل خارجاً: لا يبقى نصف بكسل من حافّة حرف مضيئاً بالتنعيم. ثم يُمدّ إلى حبرٍ بقي خارجه على هذه اللوحة نفسها
    // وما ليس من الحرف (تسطير وحدّ جدول وتظليل وسطر مجاور، `freeInk`) لا يُمدّ إليه ولا يُعدّ في الحلقة (ملاحظة أمين م٣، P1f)
    const cap = Math.max(2, Math.ceil(BURN_GROW_PT * k)), reach = farReach(cap);
    const boxes = rects.map((r) => {
      const v = toView(vp, r);
      const b: Box = { x0: Math.floor(v.x), y0: Math.floor(v.y), x1: Math.ceil(v.x + v.w), y1: Math.ceil(v.y + v.h) };
      const fit = fitCover(src, b, cap, reach, textAxis(items, vp.transform, b) === "v");
      // نقطة حرفٍ أو حركته فوق الغطاء أو تحته، منفصلةٌ وأبعد من الحلقة، وهي له (P1j): لم يبلغها الغطاء على الشاشة، فلا يُحفظ الملف
      if (fit.stray) throw new BurnRefused("mark outside cover");
      return fit;
    });
    ctx.fillStyle = "#000000";
    for (const { box: b } of boxes) ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    // الحلقة حول كل غطاء بعد الطلي: إن بقي فيها حبر لا يُحفظ الملف (`BurnRefused`، فتظهر `SP.penRefused` بمواضع الصفحات)
    const painted = (x: number, y: number) => boxes.some(({ box: b }) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
    for (const { box, ref, free } of boxes) {
      const reg = lumAround(src, box, cap + BURN_RING + 2, false); // الحلقة لا اتجاه لها
      if (ringInk(reg.g, reg.local(box), ref, (x, y) => painted(x + reg.ox, y + reg.oy) || free(x + reg.ox, y + reg.oy))) throw new BurnRefused("ink outside cover");
    }
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    if (!blob) throw new Error("toBlob");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    c.width = c.height = 0; // ذاكرة اللوحات في iOS
  }
}

/** إضاءة اللوحة. */
function canvasLum(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement): LumSource {
  return {
    w: c.width, h: c.height,
    read(ox, oy, w, hh) {
      const px = ctx.getImageData(ox, oy, w, hh).data;
      const d = new Uint8Array(w * hh);
      for (let i = 0; i < d.length; i++) d[i] = (px[4 * i]! * 77 + px[4 * i + 1]! * 150 + px[4 * i + 2]! * 29) >> 8;
      return d;
    },
  };
}

/** إضاءة المنطقة حول المستطيل على اللوحة (بهامش `pad`)، منقولةً إن كان `vert`، وتحويلات الإحداثيات بينها وبين اللوحة:
 * `local` و`global` للمستطيلات، و`at` لبكسلٍ من اللوحة إلى المنطقة. */
function lumAround(src: LumSource, b: Box, pad: number, vert: boolean) {
  const ox = Math.max(0, b.x0 - pad), oy = Math.max(0, b.y0 - pad);
  const w = Math.max(1, Math.min(src.w, b.x1 + pad) - ox), hh = Math.max(1, Math.min(src.h, b.y1 + pad) - oy);
  const g0: Lum = { w, h: hh, d: src.read(ox, oy, w, hh) }, g = vert ? transposeLum(g0) : g0;
  const tr = (q: Box) => (vert ? transposeBox(q) : q);
  return {
    g, ox, oy,
    local: (q: Box): Box => tr({ x0: q.x0 - ox, y0: q.y0 - oy, x1: q.x1 - ox, y1: q.y1 - oy }),
    global: (q: Box): Box => { const p = tr(q); return { x0: p.x0 + ox, y0: p.y0 + oy, x1: p.x1 + ox, y1: p.y1 + oy }; },
    at: (x: number, y: number): [number, number] => (vert ? [y - oy, x - ox] : [x - ox, y - oy]),
  };
}

export interface FileExtras { title: string; attachments: boolean; outlines: boolean; metadata: boolean }
/** ما في الملف خارج صفحاته مما يحمل نصاً، وعنوانه. */
export async function fileExtras(doc: pdfjs.PDFDocumentProxy): Promise<FileExtras> {
  const [meta, att, out] = await Promise.all([
    doc.getMetadata().catch(() => null),
    doc.getAttachments().catch(() => null),
    doc.getOutline().catch(() => null),
  ]);
  // getAttachments في pdf.js 6 يعيد Map
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof info[k] === "string" ? (info[k] as string).trim() : "");
  const metadata = !!meta?.metadata || ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"].some((k) => str(k) !== "");
  return { title: str("Title"), attachments: !!att && (att instanceof Map ? att.size : Object.keys(att).length) > 0, outlines: !!out && out.length > 0, metadata };
}

/** في الصفحة حقول نموذج أو تعليقات (غير الروابط)؟ */
export async function pageHasAnnots(proxy: pdfjs.PDFPageProxy): Promise<boolean> {
  const list = await proxy.getAnnotations().catch(() => []);
  return list.some((a: { subtype?: string }) => a.subtype !== "Link");
}
