/**
 * «تعبئة نموذج» على قالب `.tool`: الحالة الفارغة، ثم صفحات الملف كلها وحقول HTML فوق كل صفحة في مواضع حقولها،
 * ثم «احفظ الملف». الحقول من pdf.js (`getAnnotations`: نص، وخانة، وراديو، ومنسدلة/قائمة)، والصفحة تُرسم بلا حقولها
 * (`AnnotationMode.ENABLE_FORMS`) فلا تتراكب القيمتان. والحفظ مسطّح (fill-form-core.ts): نصّ كل حقل يُرسم هنا بـcanvas
 * بخطّ المنصة، فتصحّ العربية واتجاهها، والخانة والراديو علامة. ولا يُشغَّل JavaScript الحقول، ولا يُقرأ XFA (`enableXfa: false`).
 * الخطّ في الحقل 16px أو أكبر، والأصغر يُصغَّر بـtransform: سفاري iOS يكبّر الصفحة عند التركيز على حقل خطّه أقل من 16px.
 * ونوع الخط (src/font-pick.ts، قرار نايف): للحقل المحدَّد وحده. والحقل الذي لم يُكتب فيه ولم يُختر له خطٌّ يتبع آخر خط اختاره المستخدم،
 * ويثبت خطّه عند أول كتابة فيه. والرقعة تختفي من الشبكة حين يكون حجم الحقل المحدَّد أقل من 18px.
 */
import * as pdfjs from "pdfjs-dist";
import { pagesCount } from "../strings";
import { h } from "../dom";
import { outputName } from "../out-name";
import { normRotation, viewportSize } from "../coords";
import type { RunResult } from "./run-tool";
import { FILL_ERRORS, SFF } from "./fill-form-strings";
import type { OpenedPdf, ToolHost } from "./host";
import { busy, showEmpty, topbar } from "./tool-ui";
import { resultSlot } from "./run-ui";
import type { WebFontKey } from "../font-load";
import { ensurePickFont, familyOf, fontPicker, loadPickFont, readyInitial, usableIn } from "../font-pick";

export function showFillForm(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً («أدوات أخرى» بعد الحفظ في main.ts)
  showEmpty(host, { slug: "fill-form", p: "ff", name: SFF.name, lead: SFF.lead }, (src) => showWork(host, src), error);
}

/** ما يقرؤه pdf.js من حقل (`getAnnotations`، بيانات WidgetAnnotation). */
interface Widget {
  id: string; fieldName: string; fieldType?: string; rect: [number, number, number, number]; annotationFlags?: number;
  fieldValue?: string | string[] | null; readOnly?: boolean; multiLine?: boolean; maxLen?: number; textAlignment?: number | null;
  checkBox?: boolean; radioButton?: boolean; pushButton?: boolean; exportValue?: string; buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[]; alternativeText?: string;
  defaultAppearanceData?: { fontSize?: number; fontColor?: ArrayLike<number> };
}
type Kind = "text" | "check" | "radio" | "choice";
/** `px`: حجم خطّ الحقل بالبكسل عند 100٪ (لحدّ الرقعة)، و`font` خطّه إن ثبت (كُتب فيه أو اختير له). */
interface Field { w: Widget; kind: Kind; el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; wPt: number; hPt: number; px: number; font?: WebFontKey }
const textish = (f: Field) => f.kind === "text" || f.kind === "choice";

const HIDDEN = 0x02, NOVIEW = 0x20; // /F: Hidden وNoView
/**
 * يُكتب فيه: غير المقروء فقط، وله مرجع في الملف («12R»، `refKey` في fill-form-core.ts). والحقل المكتوب مباشرة في /Annots
 * يعطيه pdf.js معرّفاً من عدّاده («annot_p0_1») لا يقابله شيء في الملف، فيُعرض كالمقروء فقط ويُسطَّح مظهره المحفوظ.
 */
const editable = (w: Widget) => !w.readOnly && /^\d+R\d*$/.test(w.id);
function kindOf(w: Widget): Kind | null {
  if (w.fieldType === "Tx") return "text";
  if (w.fieldType === "Ch") return "choice";
  if (w.fieldType === "Btn") return w.checkBox ? "check" : w.radioButton ? "radio" : null; // الزرّ يرسمه pdf.js في الصفحة
  return null; // حقل التوقيع يرسمه pdf.js، ولا يُعبّأ
}

/**
 * حجم الخطّ بالنقاط، والشاشة والملف به: من /DA إن كان، وإلا نحو ثلثي الارتفاع للسطر الواحد.
 * والمتعدد الأسطر 12 على الأكثر: برامج النماذج (pdf-lib منها) تكتب في /DA حجماً يملأ الحقل كله بسطر واحد (74 في نموذج الاختبار).
 */
function fontPt(w: Widget, hPt: number): number {
  const da = w.defaultAppearanceData?.fontSize ?? 0;
  if (w.multiLine) return da > 0 ? Math.min(da, 12) : 12;
  return Math.min(da > 0 ? da : hPt * 0.62, hPt * 0.85);
}
function colorOf(w: Widget): string {
  const c = w.defaultAppearanceData?.fontColor;
  return c && c.length >= 3 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : "#000";
}
/** الاتجاه كما يحسبه `dir="auto"` في الحقل: أول حرف قويّ، وبلا حرف قويّ (أرقام وحدها) ltr. */
function autoDir(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    if (/[֐-ࣿיִ-﷿ﹰ-﻾]/.test(ch)) return "rtl";
    if (/\p{L}/u.test(ch)) return "ltr";
  }
  return "ltr";
}
/** /Q: ‏1 وسط، و2 يمين، و0 (الافتراضي) بداية النصّ، فالعربي من اليمين كما في الحقل. */
const alignOf = (w: Widget, dir: "rtl" | "ltr"): "left" | "right" | "center" =>
  w.textAlignment === 1 ? "center" : w.textAlignment === 2 ? "right" : dir === "rtl" ? "right" : "left";

/** مستمعو الشاشة الحالية: يُلغَون عند فتح ملف جديد وعند مغادرة الأداة، فلا يبقى الملف السابق في الذاكرة بهم. */
let workAbort: AbortController | null = null;

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  const pages: { proxy: pdfjs.PDFPageProxy; widgets: Widget[] }[] = [];
  let fillable = 0;
  for (let i = 1; i <= n; i++) {
    const proxy = await src.doc.getPage(i);
    const all = (await proxy.getAnnotations({ intent: "display" })) as (Widget & { annotationType: number })[];
    const widgets = all.filter((a) => a.annotationType === pdfjs.AnnotationType.WIDGET && kindOf(a) !== null && !((a.annotationFlags ?? 0) & (HIDDEN | NOVIEW)));
    fillable += widgets.filter(editable).length;
    pages.push({ proxy, widgets });
  }
  if (fillable === 0) { showFillForm(host, SFF.noFields); return; }

  const run = h("button", { class: "btn primary block", type: "button", "data-test": "ff-run" }, SFF.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "ff-fail" });
  const result = resultSlot("ff", run);
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "ff-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  let lastFont: WebFontKey = loadPickFont(), active: Field | null = null;
  const fontOf = (f: Field) => usableIn(f.font ?? lastFont, f.px);
  const restyle = () => { for (const f of fields) if (textish(f)) f.el.style.fontFamily = familyOf(fontOf(f)); };
  const wideMq = matchMedia("(min-width: 1024px)");
  const wide = wideMq.matches;
  const picker = fontPicker({ value: lastFont, testId: "ff-font", onChange: (k) => {
    lastFont = k;
    if (active) active.font = k;
    restyle();
    result.clear();
    if (stripOpen()) active?.el.focus({ preventScroll: true }); // الشريط على الجوال: يبقى الحقل مركَّزاً ولوحة المفاتيح مفتوحة
  } });
  const options = h("div", { class: "tool-options" });
  // تحت 1024px: الشبكة نفسها شريط ثابت فوق لوحة المفاتيح، يظهر حين يتحدّد حقل نصّي (docs/logs/fonts-layout-lama-spec.md ٢)
  const strip = h("div", { class: "ff-font-strip", hidden: true, "data-test": "ff-font-strip" });
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, fail, result.slot, run));
  const list = h("div", { class: "ff-pages" });
  const work = h("section", { class: "tool-work" }, list);
  const main = h("main", { class: "tool", "data-test": "tool-fill-form" }, work, rail, strip);
  workAbort?.abort();
  const ac = (workAbort = new AbortController()), { signal } = ac;
  signal.addEventListener("abort", () => clearTimeout(hideT));
  host.app.replaceChildren(topbar(host, SFF.name), main);
  // مغادرة الأداة (الرئيسية، أو شاشة الحفظ، أو غيرها): حين يخرج main من الصفحة
  const leaving = new MutationObserver(() => { if (!main.isConnected) ac.abort(); });
  leaving.observe(host.app, { childList: true });
  signal.addEventListener("abort", () => leaving.disconnect());
  window.scrollTo(0, 0);
  const stripOpen = () => !strip.hidden && !strip.classList.contains("closing");
  const place = () => {
    options.hidden = !wideMq.matches;
    (wideMq.matches ? options : strip).append(picker.el);
    if (wideMq.matches) { clearTimeout(hideT); strip.hidden = true; strip.classList.remove("closing"); }
  };
  let hideT = 0;
  const vv = window.visualViewport;
  /** فوق لوحة المفاتيح: الشريط مثبّت بأسفل الصفحة، ويرتفع بقدر ما غطّته اللوحة من أسفلها. */
  const syncKb = () => { if (vv) strip.style.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`); };
  vv?.addEventListener("resize", syncKb, { signal });
  vv?.addEventListener("scroll", syncKb, { signal });
  function showStrip() {
    if (wideMq.matches) return;
    clearTimeout(hideT);
    strip.classList.remove("closing");
    strip.hidden = false;
    syncKb();
    // المختار في وسط الشريط (scrollLeft بالبكسل يصحّ في rtl ولا يمرّر الصفحة كما قد يفعل scrollIntoView)
    const grid = picker.el.querySelector<HTMLElement>(".lt-fonts"), on = picker.el.querySelector("label:has(:checked)");
    if (grid && on) {
      const g = grid.getBoundingClientRect(), r = on.getBoundingClientRect();
      grid.scrollLeft += r.left + r.width / 2 - (g.left + g.width / 2);
    }
  }
  function hideStrip() {
    if (!stripOpen()) return;
    strip.classList.add("closing");
    hideT = window.setTimeout(() => { strip.hidden = true; strip.classList.remove("closing"); }, 120);
  }
  // الضغط على خانة لا يأخذ التركيز من الحقل (فلا تُغلق لوحة المفاتيح)، وما أخذه بالضغط يُعاد إلى الحقل
  let viaPointer = false;
  strip.addEventListener("pointerdown", (e) => { viaPointer = true; e.preventDefault(); });
  strip.addEventListener("mousedown", (e) => e.preventDefault());
  strip.addEventListener("click", () => setTimeout(() => { viaPointer = false; }));
  // باللمس: منعُ pointerdown قد يمنع النقرة في WebKit، فتُختار الخانة عند رفع الإصبع (نقرة لاحقة على المختار لا تُغيّر شيئاً)
  strip.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    const input = (e.target as Element).closest("label")?.querySelector("input");
    if (input && !input.checked && !input.disabled) input.click();
  });
  strip.addEventListener("focusin", () => { if (viaPointer) active?.el.focus({ preventScroll: true }); });
  place();
  wideMq.addEventListener("change", place, { signal });

  const cs = getComputedStyle(work);
  const maxW = Math.min(wide ? 720 : Infinity, work.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd)); // 720: --work-w
  const fields: Field[] = [];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); (e.target as HTMLElement & { paint?: () => void }).paint?.(); }
  }, { rootMargin: "100% 0px" });

  pages.forEach(({ proxy, widgets }, i) => {
    const geom = { view: proxy.view as [number, number, number, number], rotate: normRotation(proxy.rotate) };
    const { width: pw, height: ph } = viewportSize(geom, 1);
    const s = maxW / pw;
    const vp = proxy.getViewport({ scale: s });
    const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
    const layer = h("div", { class: "ff-layer" });
    const box = h("div", { class: "pn-preview ff-page", "data-test": `ff-page-${i + 1}` }, canvas, layer) as HTMLElement & { paint?: () => void };
    box.style.inlineSize = `${Math.round(pw * s)}px`;
    box.style.blockSize = `${Math.round(ph * s)}px`;
    box.paint = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const v = proxy.getViewport({ scale: s * dpr });
      canvas.width = Math.round(v.width);
      canvas.height = Math.round(v.height);
      void proxy.render({ canvas, viewport: v, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise.catch(() => {});
    };
    for (const w of widgets) {
      const [x1, y1] = vp.convertToViewportPoint(w.rect[0], w.rect[1]) as number[];
      const [x2, y2] = vp.convertToViewportPoint(w.rect[2], w.rect[3]) as number[];
      const r = { x: Math.min(x1!, x2!), y: Math.min(y1!, y2!), w: Math.abs(x2! - x1!), h: Math.abs(y2! - y1!) };
      const f = fieldEl(w, kindOf(w)!, r, s);
      layer.append(f.node);
      if (editable(w)) fields.push({ w, kind: kindOf(w)!, el: f.el, wPt: r.w / s, hPt: r.h / s, px: (fontPt(w, r.h / s) * 96) / 72 });
    }
    list.append(box);
    io.observe(box);
  });

  restyle();
  readyInitial(picker, (k) => { lastFont = k; restyle(); });
  // تحديد حقل: الشبكة على خطّه، والرقعة بحسب حجمه. والحقل نفسه يعود إليه التركيز من الشريط فلا يُعاد ضبطها وخطّه يتنزّل
  list.addEventListener("focusin", (e) => {
    const f = fields.find((x) => x.el === e.target);
    if (!f || !textish(f)) return;
    if (f !== active || !stripOpen()) {
      active = f;
      picker.limit(f.px);
      picker.set(fontOf(f));
    }
    showStrip();
  });
  // يختفي الشريط حين يخرج التركيز من الحقول النصّية والشريط معاً، بعد إطار: التنقّل بين حقلين لا يُخفيه
  const leave = () => requestAnimationFrame(() => {
    const a = document.activeElement;
    const f = fields.find((x) => x.el === a);
    if ((a && strip.contains(a)) || (f && textish(f))) return;
    hideStrip();
  });
  list.addEventListener("focusout", leave);
  strip.addEventListener("focusout", leave);
  // حقول بالاسم نفسه (حقل له أكثر من مظهر) تبقى متساوية، وأي تعديل بعد النتيجة يُسقطها
  list.addEventListener("input", (e) => {
    const el = e.target as Field["el"];
    const own = fields.find((x) => x.el === el);
    if (own && textish(own) && !own.font) own.font = fontOf(own); // أول كتابة تثبّت خطّه
    for (const f of fields) {
      if (f.el === el || f.w.fieldName !== el.dataset.name || f.kind !== el.dataset.kind) continue;
      if (f.kind === "check") (f.el as HTMLInputElement).checked = (el as HTMLInputElement).checked;
      else if (f.kind !== "radio") f.el.value = el.value;
    }
    fail.hidden = true;
    result.clear();
  });
  keepFocusedVisible(list, signal, () => (stripOpen() ? strip.getBoundingClientRect().height : 0));

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy")) return;
    const done = busy(run, rail, null);
    fail.hidden = true;
    let r: RunResult<"fill-form">;
    try {
      const { runTool } = await import("./run-tool");
      r = await runTool("fill-form", src.bytes, { marks: await marksOf(fields, lastFont) }); // في عامل بمهلة، والصور تُرسم هنا بخطّ الواجهة
    } catch {
      r = { ok: false, error: "failed" };
    } finally {
      done();
    }
    if (!r.ok) {
      fail.textContent = FILL_ERRORS[r.error];
      fail.hidden = false;
      return;
    }
    const out = new File([r.bytes as BlobPart], outputName("edit", src.name, false), { type: "application/pdf" });
    if (r.signed) result.offer({ signed: true, save: () => host.saved(out, n, "fill-form") });
    else host.saved(out, n, "fill-form");
  });
}

/** عنصر الحقل في مستطيله `r` (بكسل CSS على الصفحة المعروضة). الخطّ 16px على الأقل، والأصغر بـscale. */
function fieldEl(w: Widget, kind: Kind, r: { x: number; y: number; w: number; h: number }, s: number) {
  const label = w.alternativeText || w.fieldName;
  const common = { class: "ff-field", "aria-label": label, "data-test": "ff-field", "data-id": w.id, "data-name": w.fieldName, "data-kind": kind, disabled: !editable(w) };
  if (kind === "check" || kind === "radio") {
    const el = h("input", { ...common, type: kind === "check" ? "checkbox" : "radio", name: kind === "radio" ? `ff-${w.fieldName}` : undefined }) as HTMLInputElement;
    el.checked = kind === "check" ? !!w.exportValue && w.exportValue !== "Off" && w.fieldValue === w.exportValue : w.fieldValue === w.buttonValue;
    const side = Math.max(12, Math.min(r.w, r.h));
    el.style.inlineSize = el.style.blockSize = `${side}px`;
    // مساحة اللمس 24px على الأقل حول الخانة، ووسطها وسط المستطيل
    const hw = Math.max(24, r.w), hh = Math.max(24, r.h);
    const hit = h("label", { class: "ff-hit" }, el);
    Object.assign(hit.style, { left: `${r.x + r.w / 2 - hw / 2}px`, top: `${r.y + r.h / 2 - hh / 2}px`, width: `${hw}px`, height: `${hh}px` });
    return { node: hit, el };
  }
  const value = typeof w.fieldValue === "string" ? w.fieldValue : "";
  let el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (kind === "choice") {
    const sel = Array.isArray(w.fieldValue) ? w.fieldValue : value ? [value] : [];
    const opts = w.options ?? [];
    const select = h("select", common,
      ...(opts.some((o) => sel.includes(o.exportValue)) ? [] : [h("option", { value: "" }, "")]),
      ...opts.map((o) => h("option", { value: o.exportValue, selected: sel.includes(o.exportValue) }, o.displayValue))) as HTMLSelectElement;
    el = select;
  } else {
    el = h(w.multiLine ? "textarea" : "input", { ...common, type: w.multiLine ? undefined : "text", dir: "auto", autocomplete: "off", enterkeyhint: "next" }) as HTMLInputElement;
    el.value = value;
    if (w.maxLen && w.maxLen > 0) (el as HTMLInputElement).maxLength = w.maxLen;
    el.style.textAlign = w.textAlignment === 1 ? "center" : w.textAlignment === 2 ? "right" : "start";
  }
  el.style.color = colorOf(w);
  const px = fontPt(w, r.h / s) * s;
  const k = Math.min(1, px / 16);
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w / k}px`, height: `${r.h / k}px`, fontSize: `${Math.max(16, px)}px` });
  if (k < 1) el.style.transform = `scale(${k})`;
  return { node: el, el };
}

/**
 * الحقل النشط فوق لوحة المفاتيح: عند التركيز، وكلما صغُر ما يُرى من الصفحة (لوحة المفاتيح تظهر فيصغر visualViewport)،
 * يُعاد الحقل إلى وسط ما يُرى إن خرج منه. و`reserve`: ما يغطّيه شريط الخطوط من أسفل ما يُرى.
 */
function keepFocusedVisible(list: HTMLElement, signal: AbortSignal, reserve: () => number) {
  const fix = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !list.contains(el)) return;
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0, bottom = top + (vv ? vv.height : innerHeight);
    const r = el.getBoundingClientRect();
    if (r.top < top + 8 || r.bottom > bottom - 8 - reserve()) el.scrollIntoView({ block: "center", inline: "nearest" });
  };
  let fixT = 0;
  signal.addEventListener("abort", () => clearTimeout(fixT));
  list.addEventListener("focusin", () => { requestAnimationFrame(fix); clearTimeout(fixT); fixT = window.setTimeout(fix, 350); });
  window.visualViewport?.addEventListener("resize", fix, { signal });
  addEventListener("resize", fix, { signal });
}

/** صورة كل حقل قابل للتعبئة في اتجاه القارئ، أو null للفارغ وغير المحدَّد. */
async function marksOf(fields: Field[], font: WebFontKey): Promise<Map<string, Uint8Array | null>> {
  const out = new Map<string, Uint8Array | null>();
  for (const f of fields) {
    let c: HTMLCanvasElement | null = null;
    if (f.kind === "check" || f.kind === "radio") {
      if ((f.el as HTMLInputElement).checked) c = markCanvas(f.kind, f.wPt, f.hPt, colorOf(f.w));
    } else {
      const sel = f.el as HTMLSelectElement;
      const text = f.kind === "choice" ? (sel.selectedOptions[0]?.textContent ?? "") : f.el.value;
      if (text.trim()) c = await textCanvasForField(f.kind === "choice" ? { ...f.w, multiLine: false } : f.w, text, f.wPt, f.hPt, usableIn(f.font ?? font, f.px));
    }
    out.set(f.w.id, c ? await pngOf(c) : null);
  }
  return out;
}

/** بكسلات لكل نقطة في صورة الحقل (نحو 288 نقطة في البوصة)، وأقل في حقل ضخم حتى لا تتجاوز اللوحة 4 ملايين بكسل. */
function ppt(wPt: number, hPt: number) {
  return Math.min(4, Math.sqrt(4e6 / Math.max(1, wPt * hPt)));
}

/** نصّ الحقل بخطّه: سطر واحد يصغُر خطّه حتى يتّسع، أو أسطر تُلفّ بالكلمات من أعلى الحقل. */
async function textCanvasForField(w: Widget, text: string, wPt: number, hPt: number, font: WebFontKey): Promise<HTMLCanvasElement> {
  const k = ppt(wPt, hPt);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(wPt * k));
  c.height = Math.max(1, Math.round(hPt * k));
  await ensurePickFont(font);
  const family = familyOf(font);
  let fs = fontPt(w, hPt) * k;
  await document.fonts.load(`400 ${fs}px ${family}`, text);
  const ctx = c.getContext("2d")!;
  const dir = autoDir(text);
  const pad = 2 * k;
  const set = () => { ctx.font = `400 ${fs}px ${family}`; };
  set();
  ctx.direction = dir; // لوحة خارج الصفحة اتجاهها ltr
  ctx.fillStyle = colorOf(w);
  const align = alignOf(w, dir);
  ctx.textAlign = align;
  const x = align === "center" ? c.width / 2 : align === "right" ? c.width - pad : pad;
  if (!w.multiLine) {
    while (ctx.measureText(text).width > c.width - 2 * pad && fs > 4 * k) { fs *= 0.92; set(); }
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, c.height / 2);
    return c;
  }
  ctx.textBaseline = "top";
  // كل فقرة باتجاهها كما في الحقل (unicode-bidi: plaintext على textarea)
  const lines: { text: string; dir: "rtl" | "ltr" }[] = [];
  for (const para of text.split(/\r?\n/)) {
    const pdir = autoDir(para);
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > c.width - 2 * pad) { lines.push({ text: line, dir: pdir }); line = word; } else line = next;
    }
    lines.push({ text: line, dir: pdir });
  }
  const fit = (c.height - 2 * pad) / (lines.length * 1.2); // الأسطر كلها داخل الحقل: يصغُر الخطّ ولا يُقصّ سطر
  if (fs > fit) { fs = Math.max(fit, k); set(); }
  lines.forEach((l, i) => {
    const a = alignOf(w, l.dir);
    ctx.direction = l.dir;
    ctx.textAlign = a;
    ctx.fillText(l.text, a === "center" ? c.width / 2 : a === "right" ? c.width - pad : pad, pad + i * fs * 1.2);
  });
  return c;
}

/** علامة الخانة (صحّ) والراديو (دائرة مملوءة) في وسط المستطيل. */
function markCanvas(kind: "check" | "radio", wPt: number, hPt: number, color: string): HTMLCanvasElement {
  const k = ppt(wPt, hPt);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(wPt * k));
  c.height = Math.max(1, Math.round(hPt * k));
  const ctx = c.getContext("2d")!;
  const side = Math.min(c.width, c.height), cx = c.width / 2, cy = c.height / 2;
  ctx.fillStyle = ctx.strokeStyle = color;
  if (kind === "radio") {
    ctx.beginPath();
    ctx.arc(cx, cy, side * 0.28, 0, 2 * Math.PI);
    ctx.fill();
  } else {
    ctx.lineWidth = side * 0.12;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - side * 0.3, cy);
    ctx.lineTo(cx - side * 0.08, cy + side * 0.24);
    ctx.lineTo(cx + side * 0.32, cy - side * 0.26);
    ctx.stroke();
  }
  return c;
}

const pngOf = (c: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) =>
  c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("toBlob"))), "image/png"));
