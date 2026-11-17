/**
 * «PDF إلى Word» (docs/logs/pdf-to-word-lama-spec.md §٣): الحالة الفارغة (`showEmpty`)، ثم التحويل يبدأ حين يُفتح الملف بلا زرّ
 * ولا خيارات: معاينة الصفحة الأولى، وسطر «جارٍ تحويل الصفحة…» وشريط «PDF إلى صور». ثم بطاقة «فحص ملف» بالنتيجة
 * و«ما لم يُنقل» بنوداً صادقة من تقرير المحرّك وحده، أو بطاقة الممسوح أو الطبقة الفاسدة.
 * المحرّك في عامل (`./pdf-to-word/run.ts`، يُحمَّل عند أول تحويل)، والرجوع يُلغيه (`signal`) فيُنهى العامل.
 */
import { S, SF, pagesCount } from "../strings";
import { h, icon } from "../dom";
import { baseName } from "../split-pdf";
import { MAX_INPUT_BYTES } from "./pdf-checks";
import { RUN_ERRORS, SRT } from "./run-strings";
import { SPW } from "./pdf-to-word-strings";
import type { ConvertReport } from "./pdf-to-word/engine";
import type { RunResult } from "./pdf-to-word/run";
import type { OpenedPdf, ToolHost } from "./host";
import { previewFirstPage, showEmpty, topbar } from "./tool-ui";
import { resultMore } from "./result-more";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** اسم ملف Word الناتج، واسم الـPDF عند الحفظ من المحرّر بعد «تحرير الملف»: كلاهما من اسم الـPDF الأصلي، لا من `pdfNameFor` (رائد) */
export const editNames = (pdfName: string) => ({ docxName: `${baseName(pdfName)}.docx`, pdfName: `${baseName(pdfName)}.pdf` });

/** «Word» داخل النص العربي بـ`lang="en"` (هدى: «Word داخل العربية»). */
export function withWord(text: string): (string | Node)[] {
  return text.split(/(Word)/).filter(Boolean).map((p) => (p === "Word" ? h("span", { lang: "en" }, p) : p));
}

/** بنود «لم يُنقل إلى المستند:» بترتيب هدى، ولا بند إلا لما أعاده المحرّك (شرط الصدق، المواصفة §٣). */
export function notMovedLines(r: ConvertReport): string[] {
  const has = (k: string) => r.notMoved.some((m) => m.kind === k);
  const img = r.notMoved.find((m) => m.kind === "image");
  return [
    ...(has("header") || has("footer") ? [SPW.headerFooter] : []),
    ...(has("page-number") ? [SPW.pageNumbers] : []),
    ...(img?.count ? [SPW.images(img.count)] : []),
    ...(r.scannedPages.length ? [SPW.scanned(r.scannedPages)] : []),
  ];
}

/** الصفحات التقريبية: سطر للعمودين، وسطر لمربّعات النص، وسطر للجدول الذي خرج فقرات، كلٌّ بصفحاته. */
export function approxLines(r: ConvertReport): string[] {
  const of = (reason: string) => [...new Set(r.approximate.filter((a) => a.reason === reason).map((a) => a.page))];
  const cols = of("columns"), boxes = of("text-box"), table = of("table");
  return [...(cols.length ? [SPW.approxCols(cols)] : []), ...(boxes.length ? [SPW.approxBoxes(boxes)] : []), ...(table.length ? [SPW.approxTable(table)] : [])];
}

/** الإعادة بالملف نفسه لا تفيد إلا في هذين، وغيرهما «اختر ملفاً آخر» (قرار المدير، ملاحظة أمين الدنيا ١ وهدى). */
const RETRYABLE = new Set(["failed", "timeout"]);

/** رسالة الفشل في شاشة العمل. المحمي والتالف يعودان إلى الحالة الفارغة بتنبيهها (`null` هنا). */
function failText(e: Exclude<RunResult, { ok: true }>["error"]): string | null {
  if (e === "password" || e === "bad-pdf" || e === "cancelled") return null;
  if (e === "too-big") return SRT.tooBig;
  if (e === "unsupported") return RUN_ERRORS.unsupported;
  if (e === "too-many-pages") return SPW.tooManyPages;
  return SPW.failed; // timeout · failed
}

export function showPdfToWord(host: ToolHost, src?: OpenedPdf) {
  void import("../letter/handoff").then((m) => m.purgeStaleHandoffs()).catch(() => {}); // كـ«Word إلى PDF»: نصّ ملف أُغلق تبويبه قبل /letter لا يبقى بلا حدّ (أمين)
  if (src) return void showWork(host, src); // ملف مفتوح سلفاً («أدوات أخرى» بعد الحفظ)
  showStart(host);
}

function showStart(host: ToolHost, error?: string) {
  // الحجم قبل أن يُقرأ الملف (ملاحظة 🕵️ أمين ١): ملف بمئات الميغابايت لا يُنسخ إلى الذاكرة ثم يُرفض
  const open = async (file: File) => {
    if (file.size > MAX_INPUT_BYTES) return SRT.tooBig;
    const src = await host.open(file);
    if (typeof src === "string" || src.doc.numPages < 1) return src === "encrypted" ? SF.encryptedTool : S.badPdf;
    void showWork(host, src);
    return null;
  };
  return showEmpty(host, { slug: "pdf-to-word", p: "pw", name: SPW.name, lead: SPW.lead, note: SPW.limits, open }, async () => {}, error);
}

/** رأس الشاشة: الرجوع يُلغي التحويل الجاري قبل أن يغادر. */
function bar(host: ToolHost, stop?: AbortController) {
  return topbar({ ...host, exit: () => { stop?.abort(); host.exit(); } }, SPW.name);
}

function context(src: OpenedPdf) {
  return h("div", { class: "tool-context-box" },
    h("p", { class: "tool-context", dir: "rtl", "data-test": "pw-context" }, h("bdi", {}, src.name), " · ", pagesCount(src.doc.numPages)));
}

async function convert(bytes: Uint8Array, opts: Parameters<typeof import("./pdf-to-word/run").runPdfToWord>[1]): Promise<RunResult> {
  try {
    const { runPdfToWord } = await import("./pdf-to-word/run");
    return await runPdfToWord(bytes, opts);
  } catch {
    return { ok: false, error: "failed" }; // لم تصل قطعة المحرّك
  }
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  const stop = new AbortController();
  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const preview = h("div", { class: "pn-preview", "data-test": "pw-preview" }, canvas);
  const line = document.createTextNode(SPW.running(1, n));
  const status = h("p", { class: "pw-status", role: "status", "data-test": "pw-status" }, line);
  // شريط «PDF إلى صور»: يظهر إن طال العمل أكثر من 400ms، ويمتلئ صفحةً صفحة
  const fill = h("div", { class: "pbar-fill" });
  const pbar = h("div", { class: "pbar", "aria-hidden": "true", "data-test": "pw-progress" }, fill);
  const rail = h("aside", { class: "tool-rail" }, context(src), h("div", { class: "tool-save" }, h("div", { class: "pj-run" }, status, pbar)));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(bar(host, stop), h("main", { class: "tool", "data-test": "tool-pdf-to-word" }, work, rail));
  window.scrollTo(0, 0);
  void previewFirstPage(src, work, preview, canvas).catch(() => {});

  const show = setTimeout(() => pbar.classList.add("show"), 400);
  const r = await convert(src.bytes, {
    signal: stop.signal,
    onPage: (done, total) => {
      fill.style.transform = `scaleX(${done / total})`;
      line.data = SPW.running(Math.min(done + 1, total), total);
    },
  });
  clearTimeout(show);
  if (stop.signal.aborted) return; // رجع المستخدم: العامل أُنهي، ولا شاشة بعده
  if (!r.ok) {
    const msg = failText(r.error);
    if (msg === null) { showStart(host, r.error === "password" ? SF.encryptedTool : S.badPdf); return; }
    pbar.remove();
    let next: HTMLButtonElement;
    if (RETRYABLE.has(r.error)) {
      next = h("button", { class: "btn primary block", type: "button", "data-test": "pw-retry" }, SPW.retry) as HTMLButtonElement;
      next.addEventListener("click", () => void showWork(host, src));
    } else next = another(host, true);
    status.replaceWith(h("p", { class: "alert", role: "alert", "data-test": "pw-alert" }, msg), next);
    next.focus();
    return;
  }
  const file = new File([r.docx as BlobPart], editNames(src.name).docxName, { type: DOCX_TYPE });
  const rep = r.report;
  // المعاينة المرسومة أثناء التحويل تبقى في النتيجة، لا يُعاد رسمها (pdf-to-word-result-lama-spec.md §٢)
  if (rep.scannedPages.length === rep.pages) return showCard(host, src, preview, SPW.scanTitle, SPW.scanLine, "pw-scan");
  if (rep.textLayer.corrupt) return showCard(host, src, preview, SPW.brokenTitle, SPW.brokenLine, "pw-broken", () => showResult(host, src, preview, file, r.docx, rep));
  showResult(host, src, preview, file, r.docx, rep);
}

/** «اختر ملفاً آخر»: المنتقي مباشرة. إن أُلغي بقيت الشاشة، وإن اختير ملف عادت الحالة الفارغة منتظرةً (كـ«افحص ملفاً آخر»). */
function another(host: ToolHost, primary: boolean) {
  const b = h("button", { class: `btn ${primary ? "primary" : "wash"} block`, type: "button", "data-test": "pw-another" }, SPW.another) as HTMLButtonElement;
  b.addEventListener("click", () => host.pickPdf((f) => showStart(host)(f)));
  return b;
}

/** بطاقة نتيجة بلا أيقونة في الرأس (نايف ٢٠٢٦/١١/١٥: «الايقونه تحذف»)، والرأس في الوسط (style.css) */
function card(title: string, lineText: string | null, test: string, lists: Node[] = []) {
  const t = h("h2", { class: "iv-title", id: "pw-title", tabindex: "-1", "data-test": "pw-title" }, ...withWord(title));
  const head = h("div", { class: "iv-head" }, t,
    lineText === null ? null : h("p", { class: "iv-line", "data-test": "pw-line" }, ...withWord(lineText)));
  return { title: t, el: h("section", { class: "inspect-report", "data-verdict": "clear", "aria-labelledby": "pw-title", "data-test": test }, head, ...lists) };
}

/** المعاينة في منطقة العمل، والبطاقة وأزرارها في العمود فوق موضع الحفظ (§٢). */
function place(host: ToolHost, src: OpenedPdf, preview: HTMLElement, report: HTMLElement, actions: Node[]) {
  const rail = h("aside", { class: "tool-rail" }, context(src),
    h("div", { class: "tool-save" }, h("div", { class: "tool-result", "data-test": "pw-result" }, report, ...actions)));
  host.app.replaceChildren(bar(host), h("main", { class: "tool inspect", "data-test": "tool-pdf-to-word" }, h("section", { class: "tool-work" }, preview), rail));
  window.scrollTo(0, 0);
}

/** بطاقة الممسوح كله أو الطبقة الفاسدة. `asIs` (الفاسدة وحدها): «حوّل رغم ذلك» يعرض الناتج نفسه، فالتحويل جرى سلفاً. */
function showCard(host: ToolHost, src: OpenedPdf, preview: HTMLElement, title: string, lineText: string, test: string, asIs?: () => void) {
  const c = card(title, lineText, test);
  const actions: Node[] = [another(host, true)];
  if (asIs) {
    const b = h("button", { class: "text-btn center quiet", type: "button", "data-test": "pw-as-is" }, SPW.asIs);
    b.addEventListener("click", asIs);
    actions.push(b);
  }
  place(host, src, preview, c.el, actions);
  c.title.focus();
}

/** وتحت «حفظ الملف» «مشاركة» و«تحرير الملف» كـ«Word إلى PDF» (`resultMore`)، وسطر المحرّر ملاصق للزرّ (`pdf2w-edit-note`) */
function showResult(host: ToolHost, src: OpenedPdf, preview: HTMLElement, file: File, docx: Uint8Array, r: ConvertReport) {
  const item = (t: string) => h("li", { class: "iv-item" }, icon("info"), h("span", {}, t));
  const moved = notMovedLines(r), approx = approxLines(r);
  const lists: Node[] = [];
  if (moved.length) lists.push(h("p", { class: "pw-nm-head", id: "pw-nm-head" }, SPW.notMovedHead), h("ul", { class: "iv-list info", "aria-labelledby": "pw-nm-head", "data-test": "pw-not-moved" }, ...moved.map(item)));
  if (approx.length) lists.push(h("ul", { class: "iv-list info", "data-test": "pw-approx" }, ...approx.map(item)));
  const c = card(SPW.doneTitle, null, "pw-report", lists);
  const save = h("button", { class: "btn primary block", type: "button", "data-test": "pw-save" }, SPW.save) as HTMLButtonElement;
  save.addEventListener("click", () => host.saved(file, r.pages));
  const { more, note, shareAlert } = resultMore({ p: "pdf2w", file, docx, docxName: file.name, pdfName: editNames(src.name).pdfName, from: "pdf-to-word" });
  place(host, src, preview, c.el, [save, more, note, shareAlert]);
  c.title.focus();
  host.announce(SPW.announceDone);
}
