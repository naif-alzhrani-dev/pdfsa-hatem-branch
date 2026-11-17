/**
 * «فك الحماية» على قالب `.tool`. بعد اختيار الملف يُشغَّل الفك بلا كلمة في العامل أولاً (core.md، نقطة التسليم):
 * - نجح ← الملف عليه قيود فقط ويُفتح بلا كلمة: البيان و«أزل القيود»، دون طلب كلمة مرور.
 * - `password-required` ← حقل كلمة المرور و«أزل الحماية».
 * - غيرهما ← نصّ الرمز في الحالة الفارغة (`not-encrypted`: «الملف غير محمي.»).
 * لا معاينة: الملف المحمي لا يُرسم قبل فكّه، فمكانها ورقة الحالة الفارغة.
 */
import { S } from "../strings";
import { h, icon } from "../dom";
import { outputName } from "../out-name";
import { SUL, UNLOCK_ERRORS } from "./unlock-strings";
import type { ToolHost } from "./host";
import type { RunResult } from "./run-tool";
import { busy, showEmpty, topbar } from "./tool-ui";
import { passwordField, resultSlot } from "./run-ui";

/**
 * قيود فقط بلا كلمة فتح: الصيغة (أ) زرّ مباشر، و(ب) معها خانة إقرار والزرّ معطّل حتى تُحدَّد (copy-huda-tools2.md).
 * القرار عند نايف، وتطبيقه بتغيير هذا السطر وحده.
 */
export const UNLOCK_CONSENT: boolean = false;

interface Locked { name: string; bytes: Uint8Array }

async function unlock(bytes: Uint8Array, password?: string): Promise<RunResult<"unlock">> {
  try {
    const { runTool } = await import("./run-tool");
    return await runTool("unlock", bytes, password === undefined ? {} : { password });
  } catch {
    return { ok: false, error: "failed" }; // لم تصل قطعة العامل
  }
}

export function showUnlock(host: ToolHost, error?: string, file?: File) {
  const open = async (file: File) => {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { return S.badPdf; }
    const probe = await unlock(bytes);
    if (probe.ok) { showWork(host, { name: file.name, bytes }, "restricted"); return null; }
    if (probe.error === "password-required") { showWork(host, { name: file.name, bytes }, "password"); return null; }
    return UNLOCK_ERRORS[probe.error];
  };
  // ملف مُسقط (دائرة السحب في main.ts): يُقرأ بالمسار نفسه، وخطؤه في الحالة الفارغة
  if (file) return open(file).then((msg) => { if (msg !== null) showUnlock(host, msg); });
  showEmpty(host, { slug: "unlock", p: "ul", name: SUL.name, lead: SUL.lead, open }, async () => {}, error);
}

function showWork(host: ToolHost, src: Locked, kind: "restricted" | "password") {
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }));
  const lock = icon("lock");
  lock.classList.add("ul-lock"); // الملف مقفل والورقة بلا معاينة (polish-lama.md، البند 4ب)
  sheet.append(lock);
  const restricted = kind === "restricted";
  const run = h("button", { class: "btn primary block", type: "button", "data-test": "ul-run", disabled: !restricted || UNLOCK_CONSENT },
    restricted ? SUL.runRestricted : SUL.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "ul-fail" });
  const result = resultSlot("ul", run);

  let pw: ReturnType<typeof passwordField> | null = null;
  const options: Node[] = [];
  if (restricted) {
    options.push(h("p", { class: "tool-statement", "data-test": "ul-restricted" }, SUL.restricted));
    if (UNLOCK_CONSENT) {
      const box = h("input", { type: "checkbox", id: "ul-consent", "data-test": "ul-consent" }) as HTMLInputElement;
      box.addEventListener("change", () => { run.disabled = !box.checked; });
      options.push(h("label", { class: "tool-check", for: "ul-consent" }, box, h("span", {}, SUL.consent)));
    }
  } else {
    pw = passwordField({
      id: "ul-password", label: SUL.passwordLabel, show: SUL.show, autocomplete: "current-password",
      onInput: () => { run.disabled = !pw!.input.value; fail.hidden = true; result.clear(); },
    });
    options.push(h("p", { class: "tool-statement", role: "status", "data-test": "ul-needs" }, UNLOCK_ERRORS["password-required"]), pw.field);
  }
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "ul-context" }, h("bdi", {}, src.name));
  const rail = h("aside", { class: "tool-rail" }, h("div", { class: "tool-options" }, ...options), h("div", { class: "tool-context-box" }, context),
    h("div", { class: "tool-save" }, fail, result.slot, run));
  const work = h("section", { class: "tool-work ul-work" }, sheet);
  host.app.replaceChildren(topbar(host, SUL.name), h("main", { class: "tool", "data-test": "tool-unlock" }, work, rail));
  window.scrollTo(0, 0);

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy") || (pw && !pw.input.value)) return;
    const done = busy(run, rail, restricted ? SUL.runningRestricted : null);
    if (pw) pw.show.disabled = true;
    fail.hidden = true;
    const r = await unlock(src.bytes, pw ? pw.input.value : undefined);
    done();
    if (pw) pw.show.disabled = false;
    if (!r.ok) {
      fail.textContent = UNLOCK_ERRORS[r.error];
      fail.hidden = false;
      if (pw && r.error === "wrong-password") { pw.input.setAttribute("aria-invalid", "true"); pw.input.focus(); }
      return;
    }
    const out = new File([r.bytes as BlobPart], outputName("unlocked", src.name, false), { type: "application/pdf" });
    const save = () => host.saved(out, r.pages, "unlock");
    if (restricted) result.offer({ line: SUL.doneRestricted, signed: r.signed, save });
    else if (r.signed) result.offer({ signed: true, save });
    else save();
  });
}
