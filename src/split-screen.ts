/**
 * «تقسيم ملف» (docs/design-spec-batch4.md §٦): شبكة مصغّرات باختيار متعدّد، وحقل «الصفحات» هو المرجع، ثم «قسّم الملف».
 * المنطق كله في `split-ranges` (النطاقات) و`split-pdf` (الإخراج والـZIP)، وهذه الشاشة تربطهما بالواجهة وحدها.
 * الملف يُفتح في main.ts (`openSource`) ويُعطى هنا مفتوحاً، ويُغلق عند الرجوع إلى الرئيسية.
 */
import type * as pdfjs from "pdfjs-dist";
import { S, S4, ar } from "./strings";
import { h, icon } from "./dom";
import { viewportSize, type PageGeom } from "./coords";
import { canExtract, everyPage, fileOfPage, formatRanges, parseRanges, toggle, type Files, type Parsed, type RangeIssue } from "./split-ranges";
import { buildSplit, packSplit, type OutFile } from "./split-pdf";

export interface SplitSource { name: string; bytes: Uint8Array }
export interface SplitPage { proxy: pdfjs.PDFPageProxy; geom: PageGeom }
export interface SplitHost {
  app: HTMLElement;
  exit: () => void; // الرجوع إلى الرئيسية (يغلق الملف)
  announce: (msg: string) => void;
  /** زرّ «الأدوات» تحت «حفظ أو مشاركة» حين يخرج ملف واحد (tools-sheet.ts). `leave` يغلق موارد الشاشة قبل فتح الأداة. */
  tools?: (file: File, pages: number, leave: () => void) => HTMLElement;
}

/** أيقونة «تقسيم ملف»: ورقتا الدمج متباعدتين، بينهما خطّ قصّ متقطّع، بلا مقصّ (§٥، كما في عيّنة نايف ab-home). */
export function splitIcon(): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="8" height="11" rx="1.5"/><rect x="13.5" y="10.5" width="8" height="11" rx="1.5"/><path d="M4 21.5L20 2.5" stroke-dasharray="2 3"/></svg>';
  return t.content.firstElementChild as SVGElement;
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

interface Thumb { page: SplitPage; el: HTMLButtonElement; canvas: HTMLCanvasElement; dot: HTMLElement; rendered: boolean; task: pdfjs.RenderTask | null }

let observer: IntersectionObserver | null = null;
let panelObs: ResizeObserver | null = null;
let offWide: (() => void) | null = null;

/** يُغلق موارد الشاشة (المراقبان والرسم الجاري). */
function teardown(thumbs: Thumb[]) {
  observer?.disconnect(); observer = null;
  panelObs?.disconnect(); panelObs = null;
  offWide?.(); offWide = null;
  for (const t of thumbs) { t.task?.cancel(); t.canvas.width = 0; t.canvas.height = 0; }
}

export function showSplit(host: SplitHost, src: SplitSource, pages: SplitPage[]) {
  const total = pages.length;
  let files: Files = [];
  let busy = false;

  /* ─── الشبكة ─── */
  const WIDE = matchMedia("(min-width: 1024px)");
  const widthNow = () => WIDE.matches ? 168 : Math.floor((Math.min(document.documentElement.clientWidth - 24, 900) - 24) / 3); // 114px على 390، كشبكة العارض (ج-٢)
  let thumbW = widthNow();
  const thumbs: Thumb[] = pages.map((page, i) => {
    const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
    const dot = h("span", { class: "split-dot", "aria-hidden": "true", "data-test": "split-dot" });
    const el = h("button", {
      class: "split-page", type: "button", role: "checkbox", "aria-checked": "false",
      "aria-label": S.page(i + 1, total), "data-test": "split-page", "data-page": i + 1,
      onclick: () => onTouch(i + 1),
    }, canvas, h("span", { class: "page-badge", "aria-hidden": "true" }, ar(i + 1)), dot) as HTMLButtonElement;
    return { page, el, canvas, dot, rendered: false, task: null };
  });
  function sizeThumbs() {
    for (const t of thumbs) {
      const size = viewportSize(t.page.geom, thumbW / viewportSize(t.page.geom, 1).width);
      t.el.style.inlineSize = `${size.width}px`;
      t.el.style.blockSize = `${Math.round(size.height)}px`;
    }
  }
  sizeThumbs();
  const grid = h("div", { class: "split-grid", "data-test": "split-grid" }, ...thumbs.map((t) => t.el));

  /* ─── الورقة السفلية ─── */
  const input = h("input", {
    class: "split-input", id: "split-pages", type: "text", inputmode: "text", dir: "rtl", autocomplete: "off",
    spellcheck: "false", placeholder: S4.pagesExample, "aria-describedby": "split-msg", "data-test": "split-input",
  }) as HTMLInputElement;
  const msg = h("p", { class: "split-msg", id: "split-msg", "aria-live": "polite", "data-test": "split-msg" });
  const everyBtn = h("button", { class: "btn every", type: "button", "data-test": "split-every", onclick: () => void run(everyPage(total), everyBtn) }, S4.everyPage) as HTMLButtonElement;
  const extractBtn = h("button", { class: "btn primary", type: "button", "data-test": "split-extract", onclick: () => void run(files, extractBtn) }, S4.extract) as HTMLButtonElement;
  const form = h("div", { class: "split-form" },
    h("label", { class: "split-label", for: "split-pages" }, S4.pagesLabel), input, msg,
    h("div", { class: "split-actions" }, everyBtn, extractBtn));
  const panel = h("div", { class: "split-panel", "data-test": "split-panel" }, form);

  const main = h("main", { class: "split" }, grid, panel);
  const header = h("header", { class: "topbar" },
    h("button", { class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back", onclick: leave }, icon("back")),
    h("h1", { class: "route-title" }, S4.splitFile),
    h("span", { class: "icon-spacer" }));
  host.app.replaceChildren(header, main);
  window.scrollTo(0, 0);

  panelObs = new ResizeObserver(() => main.style.setProperty("--split-panel-h", `${panel.offsetHeight}px`));
  panelObs.observe(panel);

  /* ─── الرسم الكسول: القريبة من الشاشة تُرسم، والبعيدة تُحرَّر (iOS يحدّ ذاكرة اللوحات) ─── */
  const byEl = new Map(thumbs.map((t) => [t.el as Element, t]));
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = byEl.get(e.target)!;
      if (e.isIntersecting) void render(t);
      else free(t);
    }
  }, { rootMargin: "800px 0px" });
  for (const t of thumbs) observer.observe(t.el);

  // عبور 1024 في الجلسة نفسها: المقاس والرسم من جديد، ويعيد المراقب رسم القريب
  const onWide = () => {
    thumbW = widthNow();
    sizeThumbs();
    observer?.disconnect();
    for (const t of thumbs) { free(t); observer?.observe(t.el); }
  };
  WIDE.addEventListener("change", onWide);
  offWide = () => WIDE.removeEventListener("change", onWide);

  async function render(t: Thumb) {
    if (t.rendered || t.task) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = t.page.proxy.getViewport({ scale: (thumbW / viewportSize(t.page.geom, 1).width) * dpr });
    t.canvas.width = Math.floor(vp.width);
    t.canvas.height = Math.floor(vp.height);
    const task = t.page.proxy.render({ canvas: t.canvas, viewport: vp });
    t.task = task;
    try {
      await task.promise;
      if (t.task === task) t.rendered = true;
    } catch { /* أُلغي */ } finally {
      if (t.task === task) t.task = null;
    }
  }
  function free(t: Thumb) {
    t.task?.cancel();
    t.task = null;
    t.rendered = false;
    if (t.canvas.width || t.canvas.height) { t.canvas.width = 0; t.canvas.height = 0; }
  }

  /* ─── التزامن: الحقل هو المرجع ─── */
  let parsed: Parsed = parseRanges("", total);

  function paint() {
    const of = fileOfPage(files);
    for (const [i, t] of thumbs.entries()) {
      const n = of.get(i + 1);
      const on = n !== undefined;
      if ((t.el.getAttribute("aria-checked") === "true") !== on) t.el.setAttribute("aria-checked", String(on));
      t.dot.textContent = on ? ar(n) : "";
    }
    const ok = canExtract(parsed);
    extractBtn.disabled = busy || !ok;
    everyBtn.disabled = busy;
  }
  function setMsg(text: string, error: boolean) {
    msg.textContent = text;
    msg.classList.toggle("error", error);
    if (error) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  /** الحالة الهادئة: لا خطأ، وتلميح «اختر صفحات…» إن لم يُحدَّد شيء. */
  function hint() {
    setMsg(files.some((f) => f.length) ? "" : S4.splitNone, false);
  }
  const issueText = (it: RangeIssue) =>
    it.kind === "out" ? S4.splitOut(it.page, total) : it.kind === "overlap" ? S4.splitOverlap(it.page) : S4.splitSyntax;

  /** الكتابة: التحديد الصالح حيّ، والأخطاء تنتظر الخروج من الحقل أو Enter. */
  function onInput() {
    parsed = parseRanges(input.value, total);
    files = parsed.files;
    if (!parsed.issues.length || !msg.classList.contains("error")) hint(); // الخطأ الظاهر يبقى حتى يُصلَح
    paint();
  }
  /** الخروج من الحقل أو Enter: الخطأ الأول يظهر، أو يُوحَّد النصّ (هندية، «،»، والمقلوب مستقيماً). */
  function commit() {
    parsed = parseRanges(input.value, total);
    files = parsed.files;
    if (parsed.issues.length) setMsg(issueText(parsed.issues[0]!), true);
    else {
      if (input.value.trim()) input.value = format(files);
      hint();
    }
    paint();
  }
  /** «١-٣، ٥» والملف الفارغ الأخير (الجاري) يبقى «،» في آخر الحقل، فاللمس التالي يضيف إليه. */
  function format(f: Files): string {
    const text = formatRanges(f);
    const last = f[f.length - 1];
    return text && last && !last.length ? `${text}، ` : text;
  }
  function onTouch(page: number) {
    if (busy) return;
    // الحقل المرجع: إن كان فيه خطأ، فاللمس يبدأ من صالحه، ويُعاد كتابته بلا الجزء المرفوض
    files = toggle(parseRanges(input.value, total).files, page);
    input.value = format(files);
    parsed = parseRanges(input.value, total);
    files = parsed.files;
    hint();
    paint();
  }
  input.addEventListener("input", onInput);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
  });

  /* ─── الإخراج ─── */
  async function run(list: Files, btn: HTMLButtonElement) {
    if (busy || !list.some((f) => f.length)) return;
    busy = true;
    const label = btn.textContent ?? "";
    btn.setAttribute("aria-busy", "true");
    btn.replaceChildren(h("span", { class: btn === extractBtn ? "spinner light" : "spinner", "aria-hidden": "true" }), label);
    input.disabled = true;
    paint();
    let out: OutFile[] | null = null;
    try {
      out = packSplit(await buildSplit(src.bytes, list, src.name), src.name);
    } catch {
      setMsg(S.saveFailed, true);
    } finally {
      busy = false;
      btn.removeAttribute("aria-busy");
      btn.replaceChildren(label);
      input.disabled = false;
      paint();
    }
    if (out) deliver(out.map((f) => new File([f.bytes as BlobPart], f.name, { type: f.name.endsWith(".zip") ? "application/zip" : "application/pdf" })), list.flat().length);
  }

  /** ملفّان أو أقلّ: مشاركة دفعة واحدة على iPhone، وتنزيل في غيره. وأكثر: ZIP واحد (من `packSplit`). */
  function deliver(out: File[], pagesOut: number) {
    const share = isIOS() && !!navigator.canShare?.({ files: out });
    if (!share) for (const f of out) download(f);
    const back = () => { panel.replaceChildren(form); hint(); paint(); };
    const many = out.length > 1; // ملفّان: العنوان بالجمع، وZIP ملفٌّ واحد
    const title = share ? (many ? S4.readyMany : S.ready) : (many ? S4.savedMany : S.saved);
    const primary = share
      ? h("button", { class: "btn primary block", type: "button", "data-test": "share", onclick: () => void navigator.share({ files: out }).catch(() => {}) }, S.share)
      : h("button", { class: "btn primary block", type: "button", "data-test": "done", onclick: back }, S.done);
    const done = h("div", { class: "split-done", "data-test": "split-done" },
      h("div", { class: "saved" },
        h("div", { class: "check marks" }, icon("check")),
        h("h2", {}, title),
        ...out.map((f) => h("p", { class: "saved-name", dir: "rtl", "data-test": "saved-name" }, h("bdi", {}, f.name)))),
      primary,
      // «الأدوات» لملف PDF واحد وحده (لا بعد ملفّين ولا بعد ZIP): الملف يُفتح من الذاكرة في أداة أخرى
      out.length === 1 && out[0]!.type === "application/pdf" && host.tools ? host.tools(out[0]!, pagesOut, () => teardown(thumbs)) : null,
      h("div", { class: "text-row" }, h("button", { class: "text-btn", type: "button", onclick: leave }, S.newFile)));
    panel.replaceChildren(done);
    // «تم الحفظ»: اللوحة بلا حركة دخول، فالعلامة والأقواس تظهر من الإطار التالي (.landed في CSS)
    requestAnimationFrame(() => requestAnimationFrame(() => done.classList.add("landed")));
    host.announce(title);
    (primary as HTMLButtonElement).focus();
  }

  function leave() {
    teardown(thumbs);
    host.exit();
  }

  hint();
  paint();
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: file.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
