/**
 * «معاينة الصفحة» من `engine.layout()` لا من تدفّق DOM (شرط أمين): كل حرفٍ يُرسم بمساره من الخط نفسه وفي موضعه
 * الذي يكتبه المحرّك في PDF، والترويسة والإطار بالدوالّ نفسها (`headerRect`، `frameLines`). فما يُرى هو ما يُحفظ.
 */
import { frameLines, headerRect, PAGE_H, PAGE_W, type Float, type Page, type Run } from "./layout";
import type { LetterImage, PageSetup } from "./model";
import { containIn, coverPage } from "./pdf";
import type { Face } from "./shape";

const paths = new WeakMap<Face, Map<number, Path2D>>();
function glyph(face: Face, gid: number): Path2D {
  let m = paths.get(face);
  if (!m) paths.set(face, (m = new Map()));
  let p = m.get(gid);
  if (!p) m.set(gid, (p = new Path2D(face.path(gid))));
  return p;
}

const bitmaps = new WeakMap<LetterImage, Promise<ImageBitmap>>();
const bitmap = (i: LetterImage) =>
  bitmaps.get(i) ?? bitmaps.set(i, createImageBitmap(new Blob([i.bytes.slice().buffer], { type: i.type === "png" ? "image/png" : "image/jpeg" }))).get(i)!;

/** يرسم الصفحة على اللوحة بعرض `cssW` (بكسل CSS) وكثافة الجهاز. */
export async function drawPage(c: HTMLCanvasElement, page: Page, index: number, setup: PageSetup, cssW: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = cssW / PAGE_W;
  const w = Math.round(cssW * dpr), h = Math.round(PAGE_H * k * dpr);
  const hd = headerRect(setup, index);
  const hdBmp = hd ? await bitmap(setup.header!.img) : null;
  const bgBmp = setup.background ? await bitmap(setup.background).catch(() => null) : null; // معطوبة: الصفحة بلا خلفية، والتصدير يُبلغ (م٦)
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0); // من النقطة إلى بكسل اللوحة
  if (bgBmp) { const r = coverPage(setup.background!); ctx.drawImage(bgBmp, r.x, r.y, r.w, r.h); } // تحت الترويسة، بلا شفافية
  if (hd && hdBmp) { const r = containIn(hd, setup.header!.img); ctx.drawImage(hdBmp, r.x, r.y, r.w, r.h); }
  ctx.strokeStyle = "#000000";
  for (const f of frameLines(setup)) { ctx.lineWidth = f.width; ctx.strokeRect(f.inset, f.inset, PAGE_W - 2 * f.inset, PAGE_H - 2 * f.inset); }
  ctx.fillStyle = "#000000";
  for (const r of page.rules) ctx.fillRect(r.x, r.y, r.w, r.h); // حدود الجداول
  drawRuns(ctx, page.runs);
}

/** القطع بأسود، والسياق بالنقطة من أعلى الصفحة ويسارها */
function drawRuns(ctx: CanvasRenderingContext2D, runs: Run[]) {
  ctx.fillStyle = "#000000";
  for (const run of runs) {
    const s = run.size / run.face.upem;
    const extra = run.space && run.glyphs.length ? (run.width - run.glyphs.reduce((a, g) => a + g.ax, 0) * s) / run.glyphs.length : 0;
    let pen = run.x;
    for (const g of run.glyphs) {
      ctx.save();
      ctx.translate(pen + g.dx * s, run.y - g.dy * s);
      ctx.scale(s, -s);
      ctx.fill(glyph(run.face, g.gid));
      ctx.restore();
      pen += g.ax * s + extra;
    }
  }
}

/** حاشية لوحة العنصر النصّي حول صندوقه (بالنقطة): ما يتجاوز صندوق السطر من الحروف لا يُقصّ */
export const FLOAT_PAD = 6;

/**
 * التاريخ أو مربّع النصّ على لوحته (v2 الدفعة و): بقطع المحرّك نفسها، واللوحة صندوقه وحوله `FLOAT_PAD`، شفّافة.
 * فيُسحب العنصر بنصّه، ولا يُرسم في لوحة الصفحة.
 */
export function drawFloat(c: HTMLCanvasElement, f: Float, cssW: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = cssW / PAGE_W;
  const w = Math.max(1, Math.round((f.box.w + 2 * FLOAT_PAD) * k * dpr)), h = Math.max(1, Math.round((f.box.h + 2 * FLOAT_PAD) * k * dpr));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, (FLOAT_PAD - f.box.x) * k * dpr, (FLOAT_PAD - f.box.y) * k * dpr);
  drawRuns(ctx, f.runs);
}
