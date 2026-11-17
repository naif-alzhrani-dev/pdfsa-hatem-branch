/**
 * «ضغط ملف» على قالب `.tool`: الحالة الفارغة، ثم معاينة الصفحة الأولى و«قوة الضغط» (خفيفة · قوية)، ثم «اضغط الملف».
 * العمل في عامل (`runTool("compress")`). النجاح ← سطر بالحجمين الفعليين وزرّ الحفظ (وتنبيه التوقيع عند `signed`)،
 * و`no-images` و`already-small` ← نصّهما بنمط الملاحظة المحايد (`.tool-note`) لا بالأحمر وبلا زرّ حفظ. وتغيير القوة بعد النتيجة يُسقطها ويعيد زرّ الضغط.
 */
import { pagesCount } from "../strings";
import { h } from "../dom";
import { outputName } from "../out-name";
import type { CompressLevel } from "./compress-core";
import { COMPRESS_ERRORS, SCM } from "./compress-strings";
import type { OpenedPdf, ToolHost } from "./host";
import type { RunResult } from "./run-tool";
import { busy, previewFirstPage, seg, showEmpty, topbar } from "./tool-ui";
import { resultSlot } from "./run-ui";

export function showCompress(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً (دائرة السحب في main.ts)
  showEmpty(host, { slug: "compress", p: "cm", name: SCM.name, lead: SCM.lead }, (src) => showWork(host, src), error);
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  let level: CompressLevel = "light";
  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const preview = h("div", { class: "pn-preview", "data-test": "cm-preview" }, canvas);

  const run = h("button", { class: "btn primary block", type: "button", "data-test": "cm-run" }, SCM.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "cm-fail" });
  const note = h("p", { class: "tool-note", role: "status", hidden: true, "data-test": "cm-note" });
  const result = resultSlot("cm", run);
  const options = h("div", { class: "tool-options" },
    seg<CompressLevel>("cm-level", SCM.levelLabel, [["light", SCM.light], ["strong", SCM.strong]], level, (v) => { level = v; fail.hidden = true; note.hidden = true; result.clear(); }));
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "cm-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, fail, note, result.slot, run));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(topbar(host, SCM.name), h("main", { class: "tool", "data-test": "tool-compress" }, work, rail));
  window.scrollTo(0, 0);
  void previewFirstPage(src, work, preview, canvas);

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy")) return;
    const done = busy(run, rail, null);
    fail.hidden = true;
    note.hidden = true;
    let r: RunResult<"compress">;
    try {
      const { runTool } = await import("./run-tool");
      r = await runTool("compress", src.bytes, { level });
    } catch {
      r = { ok: false, error: "failed" }; // لم تصل قطعة العامل
    } finally {
      done();
    }
    if (!r.ok) {
      const neutral = r.error === "no-images" || r.error === "already-small"; // ليس خطأً: الملف سليم ولا شيء يُصغَّر
      const el = neutral ? note : fail;
      el.textContent = COMPRESS_ERRORS[r.error];
      el.hidden = false;
      return;
    }
    const out = new File([r.bytes as BlobPart], outputName("edit", src.name, false), { type: "application/pdf" });
    result.offer({ line: SCM.result(r.before, r.after), signed: r.signed, save: () => host.saved(out, n, "compress") });
  });
}
