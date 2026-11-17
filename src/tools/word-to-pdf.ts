/**
 * «Word إلى PDF» (docs/logs/word-to-pdf-lama-spec.md §٤، والنصوص word-to-pdf-strings-huda.md): الحالة الفارغة بنسخة ذاتية
 * كـ«صور إلى PDF» (المنتقي يأخذ Word لا PDF)، والعمل كله على زرّها: «جارٍ تجهيز المحوّل…» ثم «جارٍ التحويل…».
 * ثم النتيجة بقالب «PDF إلى Word»: الصفحة الأولى في منطقة العمل، والاسم والبطاقة و«حفظ الملف» في العمود.
 * المحرّك في عامل (`../word-to-pdf/convert.ts`)، يُحمَّل حين يُختار ملف، والرجوع يُنهيه (`signal`).
 */
import { pagesCount } from "../strings";
import { h, icon } from "../dom";
import { baseName } from "../split-pdf";
import { inAppShell } from "../install-env";
import { MAX_INPUT_BYTES } from "./pdf-checks";
import { checkDocx, type DocxError } from "../word-to-pdf/limits";
import { SWD, engineMb } from "./word-to-pdf-strings";
import { notMovedItems, notMovedLines } from "./word-to-pdf-report";
import type { W2pWarning } from "../word-to-pdf/warning";
import type { ConvertError } from "../word-to-pdf/convert";
import { toolArt } from "./tool-art";
import { previewFirstPage, topbar } from "./tool-ui";
import { resultMore } from "./result-more";
import type { OpenedPdf, ToolHost } from "./host";

export const ACCEPT = ".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword";
/** سطر الحجم إن لم يُجهَّز المحوّل بعد هذا (المواصفة §٤). */
export const NOTE_AFTER_MS = 1500;

/** `<الاسم>.pdf`: يُحذف `.docx` (أو `.doc`) قبل `.pdf`، فلا يخرج «تقرير.docx.pdf». */
export const pdfNameFor = (name: string) => `${baseName(name.replace(/\.docx?$/i, ""))}.pdf`;

/** الأسماء اللاتينية (خطوط، وSmartArt، وWord، و.docx) داخل النص العربي في `<bdi lang="en">` (هدى). */
export function latinRuns(text: string): (string | Node)[] {
  return text.split(/(\.?[A-Za-z][A-Za-z0-9 .+&'_-]*[A-Za-z0-9+]|\.?[A-Za-z])/).filter(Boolean)
    .map((p) => (/^\.?[A-Za-z]/.test(p) ? h("bdi", { lang: "en" }, p) : p));
}

/** نصّ ما يُرفض قبل العامل (`checkDocx`) أو يرفضه المحرّك، ويظهر في تنبيه الحالة الفارغة. */
export function rejectText(e: DocxError): string {
  if (e === "old-format") return SWD.docOld;
  if (e === "encrypted") return SWD.encrypted;
  if (e === "too-big") return SWD.tooBigInside;
  return SWD.badFile;
}

/** ما يُعاد بالملف نفسه: «حاول مرة أخرى» و«اختر ملفاً آخر». */
const RETRY_TEXT: Partial<Record<ConvertError, string>> = { timeout: SWD.timeout, "load-failed": SWD.loadFailed, failed: SWD.failed };

const canRun = () => typeof Worker !== "undefined" && typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";

/** منتقي Word: حقلٌ مخفيّ في الشاشة نفسها (Safari على iOS لا يفتح منتقياً خارج الصفحة)، كـ«صور إلى PDF». */
function wordInput(onFile: (f: File) => void) {
  const input = h("input", { type: "file", accept: ACCEPT, hidden: true, "data-test": "w2p-input" }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    input.value = "";
    if (f) onFile(f);
  });
  return input;
}

export function showWordToPdf(host: ToolHost, file?: File) {
  let stop: AbortController | null = null;
  void import("../letter/handoff").then((m) => m.purgeStaleHandoffs()).catch(() => {}); // نصّ ملف أُغلق تبويبه قبل /letter لا يبقى بلا حدّ
  const bar = topbar({ ...host, exit: () => { stop?.abort(); host.exit(); } }, SWD.name);
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }),
    toolArt("word-to-pdf"));
  const alert = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "w2p-alert" });
  const pick = h("button", { class: "btn primary block", type: "button", "data-test": "w2p-pick" }, h("span", {}, ...latinRuns(SWD.pick))) as HTMLButtonElement;
  const input = wordInput((f) => void start(f));
  pick.addEventListener("click", () => input.click());
  const actions = h("div", { class: "tool-result", hidden: true, "data-test": "w2p-retry-box" });
  host.app.replaceChildren(bar, h("main", { class: "start tool-empty", "data-test": "tool-word-to-pdf" },
    sheet, h("p", { class: "tool-lead" }, ...latinRuns(SWD.lead)), pick, alert, actions, input, ...host.footer("word-to-pdf")));
  window.scrollTo(0, 0);

  if (!canRun()) {
    pick.hidden = true;
    alert.replaceChildren(...latinRuns(SWD.noWasm));
    alert.hidden = false;
    // الورقة التي فُتحت منها الأداة تُغلق بعد حركتها (160ms) فتعيد التركيز إلى من فتحها: يُركَّز الرجوع بعد إغلاقها
    const back = () => bar.querySelector<HTMLButtonElement>('[data-test="back"]')?.focus();
    const open = document.querySelector("dialog[open]");
    if (open) open.addEventListener("close", back, { once: true }); else back();
    return;
  }
  if (file) void start(file); // ملف مُسقَط أو من الدائرة: بمسار «اختر ملف Word» نفسه

  function setPick(label: string | null) {
    if (label === null) {
      pick.disabled = false;
      pick.removeAttribute("aria-busy");
      pick.replaceChildren(h("span", {}, ...latinRuns(SWD.pick)));
      return;
    }
    pick.disabled = true;
    pick.setAttribute("aria-busy", "true");
    pick.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), label);
  }

  function fail(msg: string) {
    setPick(null);
    pick.hidden = false;
    actions.hidden = true;
    alert.replaceChildren(...latinRuns(msg));
    alert.hidden = false;
  }

  /** المهلة وفشل التجهيز أو التحويل: «حاول مرة أخرى» أساسياً بالملف نفسه، و«اختر ملفاً آخر» خافتاً. */
  function retryable(msg: string, f: File) {
    setPick(null);
    pick.hidden = true;
    alert.replaceChildren(...latinRuns(msg));
    alert.hidden = false;
    const retry = h("button", { class: "btn primary block", type: "button", "data-test": "w2p-retry" }, SWD.retry) as HTMLButtonElement;
    retry.addEventListener("click", () => void start(f));
    const other = h("button", { class: "text-btn center quiet", type: "button", "data-test": "w2p-another" }, SWD.another);
    other.addEventListener("click", () => input.click());
    actions.replaceChildren(retry, other);
    actions.hidden = false;
    retry.focus();
  }

  async function start(f: File) {
    stop?.abort();
    const ctl = (stop = new AbortController());
    alert.hidden = true;
    actions.hidden = true;
    pick.hidden = false;
    // الحجم قبل أن يُقرأ الملف (كـ«PDF إلى Word»): ملف بمئات الميغابايت لا يُنسخ إلى الذاكرة ثم يُرفض
    if (f.size > MAX_INPUT_BYTES) return fail(SWD.tooBig);
    setPick(SWD.preparing);
    host.announce(SWD.preparing);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await f.arrayBuffer()); } catch { return fail(SWD.badFile); }
    if (ctl.signal.aborted) return;
    const bad = checkDocx(bytes); // قبل العامل والخطوط: .doc والمحمي والتالف لا يجلبان المحرّك
    if (bad) return fail(rejectText(bad));

    const note = h("p", { class: "pw-status", "data-test": "w2p-note" }, SWD.preparingNote(engineMb()));
    const noteTimer = inAppShell(location.protocol, location.hostname) ? 0 : setTimeout(() => pick.after(note), NOTE_AFTER_MS);
    const ready = () => {
      clearTimeout(noteTimer);
      note.remove();
      setPick(SWD.converting);
      host.announce(SWD.converting);
    };
    let r: Awaited<ReturnType<typeof import("../word-to-pdf/convert").convertDocx>>;
    try {
      const [{ convertDocx }, { fetchFonts }, { mapDocxFonts, fontFilesFor }] = await Promise.all([import("../word-to-pdf/convert"), import("../word-to-pdf/fonts"), import("../word-to-pdf/font-map")]);
      const mapped = mapDocxFonts(bytes); // بدائل خطوط Word، ولا يُنزَّل إلا ما طلبه الملف
      const fonts = await fetchFonts(fontFilesFor(mapped.families));
      if (ctl.signal.aborted) return;
      r = await convertDocx(mapped.docx, fonts, { signal: ctl.signal, onReady: ready });
    } catch {
      r = { ok: false, error: "load-failed" }; // لم تصل قطعة المحرّك أو خطوطه
    }
    clearTimeout(noteTimer);
    note.remove();
    if (ctl.signal.aborted || (!r.ok && r.error === "cancelled")) return; // رجع المستخدم: العامل أُنهي، ولا شاشة بعده
    if (!r.ok) {
      if (r.error === "unsupported") { fail(SWD.noWasm); pick.hidden = true; return; }
      const again = RETRY_TEXT[r.error];
      return again ? retryable(again, f) : fail(rejectText(r.error as DocxError));
    }
    const out = new File([r.pdf as BlobPart], pdfNameFor(f.name), { type: "application/pdf" });
    const src = await host.open(out);
    if (ctl.signal.aborted) return;
    if (typeof src === "string" || src.doc.numPages < 1) return retryable(SWD.failed, f); // ناتج لا يُفتح
    stop = null;
    showResult(host, src, out, r.warnings, bytes, f.name);
  }
}

function context(src: OpenedPdf) {
  return h("div", { class: "tool-context-box" },
    h("p", { class: "tool-context", dir: "rtl", "data-test": "w2p-context" }, h("bdi", {}, src.name), " · ", pagesCount(src.doc.numPages)));
}

/** المعاينة في منطقة العمل، والبطاقة و«حفظ الملف» في العمود (قالب نتيجة «PDF إلى Word»). وتحته «مشاركة» و«تحرير الملف» (الدفعة ٣) */
function showResult(host: ToolHost, src: OpenedPdf, file: File, warnings: W2pWarning[], docx: Uint8Array, docxName: string) {
  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const preview = h("div", { class: "pn-preview", "data-test": "w2p-preview" }, canvas);
  const lines = notMovedLines(notMovedItems(warnings));
  const item = (t: string) => h("li", { class: "iv-item" }, icon("info"), h("span", {}, ...latinRuns(t)));
  const title = h("h2", { class: "iv-title", id: "w2p-title", tabindex: "-1", "data-test": "w2p-title" }, ...latinRuns(SWD.doneTitle));
  const head = h("div", { class: "iv-head" }, title, // بلا أيقونة (نايف ٢٠٢٦/١١/١٥)
    h("p", { class: "iv-line", "data-test": "w2p-line" }, ...latinRuns(SWD.doneLine)));
  const lists: Node[] = lines.length
    ? [h("p", { class: "pw-nm-head", id: "w2p-nm-head" }, ...latinRuns(SWD.notMovedHead)),
      h("ul", { class: "iv-list info", "aria-labelledby": "w2p-nm-head", "data-test": "w2p-not-moved" }, ...lines.map(item))]
    : [];
  const report = h("section", { class: "inspect-report", "data-verdict": "clear", "aria-labelledby": "w2p-title", "data-test": "w2p-report" }, head, ...lists);
  const save = h("button", { class: "btn primary block", type: "button", "data-test": "w2p-save" }, SWD.save) as HTMLButtonElement;
  save.addEventListener("click", () => host.saved(file, src.doc.numPages, "word-to-pdf"));
  const { more, note, shareAlert } = resultMore({ p: "w2p", file, docx, docxName, pdfName: pdfNameFor(docxName), from: "word-to-pdf" });
  const work = h("section", { class: "tool-work" }, preview);
  const rail = h("aside", { class: "tool-rail" }, context(src),
    h("div", { class: "tool-save" }, h("div", { class: "tool-result", "data-test": "w2p-result" }, report, save, more, note, shareAlert)));
  host.app.replaceChildren(topbar(host, SWD.name), h("main", { class: "tool inspect", "data-test": "tool-word-to-pdf" }, work, rail));
  window.scrollTo(0, 0);
  void previewFirstPage(src, work, preview, canvas).catch(() => {});
  title.focus();
  host.announce(SWD.announceDone);
}
