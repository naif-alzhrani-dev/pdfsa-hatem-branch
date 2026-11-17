/**
 * «حماية ملف» على قالب `.tool`: الحالة الفارغة، ثم معاينة الصفحة الأولى وحقل كلمة المرور بتلميحه وتحذيره،
 * ثم «احمِ الملف». العمل في عامل (`runTool("protect")`)، وكل رمز يعود له نصّه في PROTECT_ERRORS.
 * وفي الملف توقيع رقمي (`signed`) ← السطر الثابت وزرّ «احفظ دون التوقيع الرقمي»، وإلا فورقة الحفظ مباشرة.
 */
import { pagesCount } from "../strings";
import { h } from "../dom";
import { outputName } from "../out-name";
import { PROTECT_ERRORS, SPR } from "./protect-strings";
import type { OpenedPdf, ToolHost } from "./host";
import type { RunResult } from "./run-tool";
import { busy, previewFirstPage, showEmpty, topbar } from "./tool-ui";
import { passwordField, resultSlot } from "./run-ui";

export function showProtect(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً (دائرة السحب في main.ts)
  showEmpty(host, { slug: "protect", p: "pr", name: SPR.name, lead: SPR.lead, encrypted: SPR.alreadyEncrypted }, (src) => showWork(host, src), error);
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const preview = h("div", { class: "pn-preview", "data-test": "pr-preview" }, canvas);

  const pw = passwordField({
    id: "pr-password", label: SPR.passwordLabel, show: SPR.show, autocomplete: "new-password",
    notes: [h("p", { class: "tool-hint", id: "pr-hint" }, SPR.hint), h("p", { class: "tool-warn", id: "pr-warn" }, SPR.warning)],
    onInput: () => { run.disabled = !pw.input.value; fail.hidden = true; result.clear(); },
  });
  pw.input.setAttribute("aria-describedby", "pr-hint pr-warn");
  const run = h("button", { class: "btn primary block", type: "button", "data-test": "pr-run", disabled: true }, SPR.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "pr-fail" });
  const result = resultSlot("pr", run);
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "pr-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, h("div", { class: "tool-options" }, pw.field), h("div", { class: "tool-context-box" }, context),
    h("div", { class: "tool-save" }, fail, result.slot, run));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(topbar(host, SPR.name), h("main", { class: "tool", "data-test": "tool-protect" }, work, rail));
  window.scrollTo(0, 0);
  void previewFirstPage(src, work, preview, canvas);

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy") || !pw.input.value) return;
    const done = busy(run, rail, null);
    pw.show.disabled = true;
    fail.hidden = true;
    let r: RunResult<"protect">;
    try {
      const { runTool } = await import("./run-tool");
      r = await runTool("protect", src.bytes, { password: pw.input.value });
    } catch {
      r = { ok: false, error: "failed" }; // لم تصل قطعة العامل
    } finally {
      done();
      pw.show.disabled = false;
    }
    if (!r.ok) {
      fail.textContent = PROTECT_ERRORS[r.error];
      fail.hidden = false;
      if (r.error === "too-short" || r.error === "bad-chars") { pw.input.setAttribute("aria-invalid", "true"); pw.input.focus(); }
      return;
    }
    const out = new File([r.bytes as BlobPart], outputName("protected", src.name, false), { type: "application/pdf" });
    if (r.signed) result.offer({ signed: true, save: () => host.saved(out, n) });
    else host.saved(out, n);
  });
}
