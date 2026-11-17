/**
 * «قص الصفحات» على قالب `.tool`: الحالة الفارغة، ثم الصفحة الأولى وعليها مستطيلٌ يُسحب جسمه لينتقل وزواياه لتغيّر مقاسه
 * (بالإصبع أو الفأرة، والزوايا بالأسهم من لوحة المفاتيح)، و«كل الصفحات» أو «هذه الصفحة فقط»، ثم «قصّ الصفحات».
 * المستطيل نِسَبٌ من الصفحة كما تُرى، والكتابة في crop-core.ts (`setCropBox`).
 * المقبض دائرة 20px ومساحة لمسه 44px (كمقابض المسح)، والمعاينة تُترك لها حاشية 22px فلا يُقصّ مقبضٌ على حافتها.
 */
import { S, pagesCount } from "../strings";
import { h, icon } from "../dom";
import { outputName } from "../out-name";
import { MIN_FRAC, cropPages, tooSmall, type CropRect, type CropScope } from "./crop-core";
import { SCR } from "./crop-strings";
import type { OpenedPdf, ToolHost } from "./host";
import { busy, previewFirstPage, seg, showEmpty, topbar } from "./tool-ui";

const HIT = 22; // نصف مساحة لمس المقبض
const START: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
const KEY_STEP = 0.01, KEY_STEP_BIG = 0.1; // بالأسهم، ومع Shift
const SPAN_MIN = 0.01; // لا تتقاطع الزوايا (والتحديد دون MIN_FRAC يعطي رسالة الخطأ)
const EPS = 0.0005; // (٢٣) «الصفحة كاملة» بهامش، فلا يُعدّ سحبٌ بفارق جزء من البكسل صفحةً كاملة
const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const FLIP_MS = 200, FLIP_EASE = "cubic-bezier(.23,1,.32,1)";

export function showCrop(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً («أدوات أخرى» بعد الحفظ في main.ts)
  showEmpty(host, { slug: "crop", p: "cr", name: SCR.name, lead: SCR.lead }, (src) => showWork(host, src), error);
}

/** (٢٣) التحديد على الصفحة كاملة (يُعطَّل زرّها حينئذٍ). */
export const isFullPage = (r: CropRect) => r.x <= EPS && r.y <= EPS && r.w >= 1 - EPS && r.h >= 1 - EPS;

type Corner = "tl" | "tr" | "bl" | "br";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** زاوية تنتقل إلى (px, py) والمقابلة ثابتة، ولا تتجاوز الصفحة. */
export function moveCorner(r: CropRect, c: Corner, px: number, py: number): CropRect {
  let [x0, y0, x1, y1] = [r.x, r.y, r.x + r.w, r.y + r.h];
  if (c === "tl" || c === "bl") x0 = clamp(px, 0, x1 - SPAN_MIN); else x1 = clamp(px, x0 + SPAN_MIN, 1);
  if (c === "tl" || c === "tr") y0 = clamp(py, 0, y1 - SPAN_MIN); else y1 = clamp(py, y0 + SPAN_MIN, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  let r: CropRect = { ...START };
  let scope: CropScope = "all";

  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const dim = h("div", { class: "crop-dim", "aria-hidden": "true" }); // يعتّم ما خارج التحديد، داخل المعاينة المقصوصة
  const preview = h("div", { class: "pn-preview", "data-test": "cr-preview" }, canvas, dim);
  const sel = h("div", { class: "crop-sel", "data-test": "cr-sel" });
  const labels: Record<Corner, string> = { tr: SCR.cornerTR, tl: SCR.cornerTL, br: SCR.cornerBR, bl: SCR.cornerBL };
  const handles = (["tr", "tl", "br", "bl"] as Corner[]).map((c) => {
    const b = h("button", { class: `crop-handle ${c}`, type: "button", "aria-label": labels[c], "data-test": `cr-${c}` }) as HTMLButtonElement;
    b.addEventListener("pointerdown", (e) => drag(e, (fx, fy) => { r = moveCorner(r, c, fx, fy); }));
    b.addEventListener("keydown", (e) => {
      const d = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
      const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const px = c === "tl" || c === "bl" ? r.x : r.x + r.w, py = c === "tl" || c === "tr" ? r.y : r.y + r.h;
      r = moveCorner(r, c, px + dx, py + dy);
      paint();
    });
    sel.append(b);
    return b;
  });
  sel.addEventListener("pointerdown", (e) => {
    if (e.target !== sel) return; // المقابض لها سحبها
    const start = { ...r }, p0 = frac(e);
    drag(e, (fx, fy) => {
      r = { ...start, x: clamp(start.x + fx - p0[0], 0, 1 - start.w), y: clamp(start.y + fy - p0[1], 0, 1 - start.h) };
    });
  });
  const layer = h("div", { class: "crop-layer" }, sel);
  const stage = h("div", { class: "crop-stage" }, preview, layer);

  const run = h("button", { class: "btn primary block", type: "button", "data-test": "cr-run" }, SCR.run) as HTMLButtonElement;
  const small = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "cr-small" }, SCR.tooSmall);
  const fail = h("p", { class: "alert", role: "alert", hidden: true });
  const full = h("button", { class: "text-btn crop-full", type: "button", "aria-label": SCR.fullLabel, "data-test": "cr-full" }, icon("maximize"), SCR.full) as HTMLButtonElement;
  const live = h("p", { class: "sr-only", "aria-live": "polite", "data-test": "cr-live" });
  const options = h("div", { class: "tool-options" }, full,
    seg<CropScope>("cr-scope", null, [["all", SCR.all], ["first", SCR.first]], scope, (v) => { scope = v; }));
  const note = SCR.note ? h("p", { class: "tool-note", "data-test": "cr-note" }, SCR.note) : null;
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "cr-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, small, fail, note, run), live);
  const work = h("section", { class: "tool-work" }, stage);
  host.app.replaceChildren(topbar(host, SCR.name), h("main", { class: "tool", "data-test": "tool-crop" }, work, rail));
  window.scrollTo(0, 0);

  await previewFirstPage(src, work, preview, canvas, HIT);
  paint();

  /** موضع المؤشّر نِسَباً من الصفحة المعروضة. */
  function frac(e: PointerEvent): [number, number] {
    const b = layer.getBoundingClientRect();
    return [clamp((e.clientX - b.left) / b.width, 0, 1), clamp((e.clientY - b.top) / b.height, 0, 1)];
  }
  function drag(e: PointerEvent, to: (fx: number, fy: number) => void) {
    if (run.getAttribute("aria-busy")) return;
    e.preventDefault();
    stopFlip(); // الإمساك أثناء حركة «الصفحة كاملة» يلغيها، فيتبع التحديدُ الإصبعَ من حالته الأخيرة
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { to(...frac(ev)); paint(); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  function paint() {
    for (const el of [sel, dim]) {
      el.style.left = `${r.x * 100}%`;
      el.style.top = `${r.y * 100}%`;
      el.style.width = `${r.w * 100}%`;
      el.style.height = `${r.h * 100}%`;
    }
    const isFull = isFullPage(r);
    if (isFull) full.setAttribute("aria-disabled", "true"); else { full.removeAttribute("aria-disabled"); live.textContent = ""; }
    const bad = tooSmall(r);
    small.hidden = !bad;
    run.disabled = bad || !!run.getAttribute("aria-busy");
  }

  function stopFlip() {
    for (const el of [sel, dim, ...handles]) el.getAnimations().forEach((a) => a.cancel());
  }
  /** (٢٣) يعيد الحدود إلى حواف الصفحة: FLIP بـtransform على المستطيل والتعتيم، وتظهر المقابض بعدهما. بلا حركة في reduced-motion. */
  full.addEventListener("click", () => {
    if (full.getAttribute("aria-disabled") || run.getAttribute("aria-busy")) return;
    const old = { ...r };
    r = { ...FULL };
    paint();
    live.textContent = SCR.fullDone;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = { transformOrigin: "0 0", transform: `translate(${old.x * 100}%, ${old.y * 100}%) scale(${old.w}, ${old.h})` };
    // spread التعتيم يتصغّر مع scale، فمن تحديدٍ صغير يُرى الورق بلا عتمة في أول الإطارات: يُكبَّر بمقلوب أصغر نسبة (حتى MIN_FRAC: أكبر منه يُرسم متقطّعاً في Chromium) فيبقى ≥ 100vmax طوال الحركة
    dim.style.setProperty("--dim-spread", `${100 / Math.max(Math.min(old.w, old.h), MIN_FRAC)}vmax`);
    const flip = (el: HTMLElement) => el.animate([from, { transformOrigin: "0 0", transform: "none" }], { duration: FLIP_MS, easing: FLIP_EASE });
    flip(sel);
    const clear = () => dim.style.removeProperty("--dim-spread");
    const a = flip(dim);
    a.addEventListener("finish", clear);
    a.addEventListener("cancel", clear);
    for (const b of handles) b.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: FLIP_MS, easing: FLIP_EASE });
  });

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy") || tooSmall(r)) return;
    const done = busy(run, rail, null);
    for (const b of handles) b.disabled = true;
    full.disabled = true;
    fail.hidden = true;
    let out: File | null = null;
    try {
      const bytes = await cropPages(src.bytes, r, scope);
      out = new File([bytes as BlobPart], outputName("edit", src.name, false), { type: "application/pdf" });
    } catch {
      fail.textContent = S.saveFailed;
      fail.hidden = false;
    } finally {
      done();
      for (const b of handles) b.disabled = false;
      full.disabled = false;
      paint();
    }
    if (out) host.saved(out, n, "crop");
  });
}
