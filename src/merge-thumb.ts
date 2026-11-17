/**
 * صورة الصفحة الأولى في بطاقة «دمج ملف» (رسم لمى المعتمد، docs/logs/merge-thumb.md).
 * تُرسم مرة واحدة باتجاه الملف الأصلي، وتدويره بعدها `transform` وحده. والقائمة يُعاد بناؤها مع كل تغيير
 * (`showMerge`)، فالإطار وورقته ولوحتها تُحفظ هنا بمفتاح الصفحة الأولى، وتُلحق من جديد ولا تُنشأ.
 */
import type * as pdfjs from "pdfjs-dist";
import { normRotation, viewportSize, type PageGeom } from "./coords";
import { h, icon } from "./dom";

export interface ThumbPage { uid: string; proxy: pdfjs.PDFPageProxy; geom: PageGeom }
type Kind = "page" | "locked" | "bad";
interface Thumb {
  kind: Kind; frame: HTMLElement; paper: HTMLElement; canvas: HTMLCanvasElement | null; page: ThumbPage | null;
  state: "queued" | "done" | "failed" | "static"; task: pdfjs.RenderTask | null;
}

const LONG_PX = 144; // الضلع الطويل للوحة بالبكسل الفعلي
const A4 = 297 / 210;
/** مهلة رسم صورة واحدة. الاختبار يختصرها بـ`window.__thumbStallMs`. */
const THUMB_STALL_MS = 10_000;
const thumbStallMs = () => (window as unknown as { __thumbStallMs?: number }).__thumbStallMs ?? THUMB_STALL_MS;
let wide: MediaQueryList | null = null; // عند أول صورة، لا عند التحميل (الوحدة تُختبر في node)
const frameSize = () => (wide?.matches ? { fw: 56, fh: 72 } : { fw: 44, fh: 60 });
const cache = new Map<string, Thumb>();
let queue: string[] = [];
let paused = false, pumping = false;

/** الورقة داخل الإطار: مقاسها باتجاهها الأصلي (نسبة الارتفاع إلى العرض r)، ومقياس يُدخلها الإطار إذا دارت ربعاً فردياً. */
export function thumbBox(r: number, turns: number, fw: number, fh: number) {
  let w = fw, ht = fw * r;
  if (ht > fh) { ht = fh; w = fh / r; }
  const k = turns % 2 ? Math.min(fw / ht, fh / w) : 1;
  return { w, h: ht, k, transform: `rotate(${turns * 90}deg) scale(${k})` };
}

/** كم دار المستخدم الصفحة فوق اتجاهها الأصلي، أرباعاً مع العقارب. */
const turnsOf = (p: ThumbPage) => ((p.geom.rotate - normRotation(p.proxy.rotate)) / 90 + 4) % 4;
function ratio(t: Thumb) {
  if (!t.page) return A4;
  const s = viewportSize({ view: t.page.geom.view, rotate: normRotation(t.page.proxy.rotate) }, 1);
  return s.height / s.width;
}
/** يضع الورقة بمقاسها ودورانها الحاليين، ويعيد المقياس k. */
function layout(t: Thumb) {
  const { fw, fh } = frameSize();
  const b = thumbBox(ratio(t), t.page ? turnsOf(t.page) : 0, fw, fh);
  t.paper.style.inlineSize = `${b.w}px`;
  t.paper.style.blockSize = `${b.h}px`;
  t.paper.style.transform = b.transform;
  return b.k;
}

/** إطار الصورة لملف: من المحفوظ إن وُجد. `page` الصفحة الأولى، أو null لملف لم يُفتح (محمي أو تالف) ومفتاحه هويّته. */
export function fileThumb(key: string, page: ThumbPage | null, kind: Kind): HTMLElement {
  if (!wide) {
    wide = matchMedia("(min-width: 1024px)"); // كإطار .file-thumb في style.css
    wide.addEventListener("change", () => { for (const t of cache.values()) layout(t); });
  }
  let t = cache.get(key);
  if (!t) {
    const canvas = page ? h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement : null;
    const paper = h("div", { class: `ft-page blank${kind === "bad" ? " failed" : ""}`, "data-test": "thumb-page" }, canvas, kind === "locked" ? icon("lock") : null);
    const frame = h("div", { class: "file-thumb", "aria-hidden": "true", "data-test": "file-thumb" }, paper);
    t = { kind, frame, paper, canvas, page, state: page ? "queued" : "static", task: null };
    cache.set(key, t);
  }
  layout(t);
  return t.frame;
}

/** يدير الورقة من دورانها السابق (مقياسه kPrev) إلى الحالي بحركة العارض نفسها (src/main.ts: turnPages). */
export function turnThumb(key: string, kPrev: number, reduced: boolean) {
  const t = cache.get(key);
  if (!t) return;
  const k = layout(t);
  if (reduced) t.paper.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  else t.paper.animate([{ transform: `rotate(-90deg) scale(${kPrev / k})` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.23, 1, .32, 1)", composite: "add" });
}
/** المقياس الحالي لورقة، قبل تدويرها. */
export function thumbScale(key: string) {
  const t = cache.get(key);
  return t ? layout(t) : 1;
}

function free(t: Thumb) {
  t.task?.cancel();
  t.task = null;
  if (t.canvas) { t.canvas.width = 0; t.canvas.height = 0; }
}
/** يُبقي صور هذه المفاتيح وحدها: ما سواها يُلغى رسمه وتُصفَّر لوحته (ملفٌّ حُذف، أو تغيّرت صفحته الأولى، أو خرج من الدمج). */
export function keepThumbs(keys: Set<string>) {
  for (const [key, t] of cache) if (!keys.has(key)) { free(t); cache.delete(key); }
  queue = queue.filter((k) => keys.has(k));
}
/** يوقف الرسم (فتح ملفات أو الخروج إلى العارض): الجاري يُلغى ويعود إلى الطابور. */
export function pauseThumbs() {
  paused = true;
  for (const t of cache.values()) if (t.task) { free(t); t.state = "queued"; t.paper.classList.add("blank"); }
}
/** يرسم الصور الناقصة واحدةً بعد واحدة بترتيب القائمة، بعد أن تظهر البطاقات. */
export function drawThumbs(keys: string[]) {
  queue = keys;
  paused = false;
  requestAnimationFrame(() => setTimeout(() => void pump()));
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (!paused) {
      const key = queue.find((k) => { const t = cache.get(k); return t?.state === "queued" && t.frame.isConnected; });
      if (!key) break;
      await draw(cache.get(key)!);
      await new Promise((r) => setTimeout(r)); // يُعطى الخيط الرئيسي نفَساً بين ملف وملف
    }
  } finally { pumping = false; }
}
async function draw(t: Thumb) {
  const p = t.page!, c = t.canvas!;
  const rotation = normRotation(p.proxy.rotate);
  const s = viewportSize({ view: p.geom.view, rotate: rotation }, 1);
  const vp = p.proxy.getViewport({ scale: LONG_PX / Math.max(s.width, s.height), rotation });
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const fail = () => {
    free(t);
    t.state = "failed";
    t.paper.classList.add("failed"); // تبقى بنسبتها وتُدار
  };
  let task: pdfjs.RenderTask;
  try { task = p.proxy.render({ canvas: c, viewport: vp }); } catch { fail(); return; }
  t.task = task;
  // مهلة لكل رسم: عاملٌ قتله النظام (ضغط الذاكرة في iOS) يُبقي الوعد معلّقاً، والطابور تسلسليّ فيتوقّف كل ما بعده.
  // fail يستدعي free فيُلغي المهمّة (task.cancel) قبل أن يمضي الطابور
  let timer = 0;
  const guard = new Promise<never>((_, no) => { timer = window.setTimeout(() => no(new Error("stalled")), thumbStallMs()); });
  try { await Promise.race([task.promise, guard]); } catch { if (t.task === task) fail(); return; } // وإلا أُلغيت (حذفٌ أو إيقاف): free صفّر t.task
  finally { clearTimeout(timer); }
  if (t.task !== task) return;
  t.task = null;
  t.state = "done";
  t.paper.classList.remove("blank");
  c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
}
