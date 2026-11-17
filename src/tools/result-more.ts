/**
 * صفّ «مشاركة» و«تحرير الملف» تحت «حفظ الملف» (مواصفة لمى §١)، مشترك بين «Word إلى PDF» و«PDF إلى Word» (docs/logs/pdf2word-edit.md).
 * «تحرير الملف» يُجهَّز في الخلفية بالمحوّل في عامله (`prepareEdit`)، والضغط قبل انتهائه دوّار ثم انتقال. وفوق حدّ المحرّر أو بعد فشله
 * `aria-disabled` والسبب في سطر `<p>-edit-note`، ولا قصّ.
 * والمحوّل والتسليم يُستوردان ديناميكياً وحدهما من src/letter (استثناء مسمّى في حارس الاستيراد، tests/letter-doc.test.ts)، فلا يدخلان الرئيسية.
 */
import { SE } from "../strings";
import { h } from "../dom";

/** المشاركة بالقدرة لا بنوع الجهاز (مواصفة لمى §١): قائمة مشاركة الجهاز تقبل هذا الملف */
export const canShareFile = (file: File) => { try { return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] }); } catch { return false; } };

/** التجهيز في وقت الفراغ (`requestIdleCallback`، وبديله مؤقّت في Safari) */
const idle = (fn: () => void) => { if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 1500 }); else setTimeout(fn, 200); };

export interface MoreOptions {
  /** بادئة `data-test` و`id`: ‏`w2p` أو `pdf2w` */
  p: string;
  /** الملف الذي يُشارَك (ناتج الأداة) */
  file: File;
  /** ملف Word الذي يُفتح في المحرّر، واسمه في شريط /letter */
  docx: Uint8Array;
  docxName: string;
  /** اسم الـPDF عند الحفظ من المحرّر */
  pdfName: string;
  /** الأداة المصدر: تختار صيغة سطر ما لا ينتقل (هدى) */
  from: import("../letter/import-docx").EditSource;
}

export function resultMore(o: MoreOptions) {
  const shareAlert = h("p", { class: "alert", role: "alert", hidden: true, "data-test": `${o.p}-share-alert` });
  const note = h("p", { class: "w2p-edit-note", id: `${o.p}-edit-note`, hidden: true, "data-test": `${o.p}-edit-note` });
  const share = h("button", { class: "btn wash", type: "button", "data-test": `${o.p}-share` }, SE.share) as HTMLButtonElement;
  share.hidden = !canShareFile(o.file);
  share.addEventListener("click", async () => {
    shareAlert.hidden = true;
    share.disabled = true;
    share.setAttribute("aria-busy", "true");
    try { await navigator.share({ files: [o.file] }); } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) { shareAlert.textContent = SE.shareFailed; shareAlert.hidden = false; }
    } finally { share.disabled = false; share.removeAttribute("aria-busy"); }
  });
  const label = h("span", {}, SE.edit);
  const edit = h("button", { class: "btn wash", type: "button", "data-test": `${o.p}-edit` }, label) as HTMLButtonElement;
  type Prep = import("../letter/import-docx").EditPrep;
  let prep: Prep | null = null;
  let waiting = false;
  const say = (t: string) => { note.textContent = t; note.hidden = false; edit.setAttribute("aria-describedby", note.id); };
  const go = async (p: Prep) => {
    if (p.kind !== "ready") return;
    const { putHandoff } = await import("../letter/handoff");
    try {
      await putHandoff({ name: o.docxName, pdfName: o.pdfName, doc: p.doc, notMoved: p.notMoved });
    } catch { return settle({ kind: "failed" }); } // التخزين ممنوع (تصفّح خاص قديم)
    location.assign(new URLSearchParams(location.search).get("debug") === "1" ? "/letter?debug=1" : "/letter"); // تشخيص التمرير (src/letter/scroll-trace.ts)
  };
  const settle = (p: Prep) => {
    prep = p;
    if (p.kind === "ready") { if (p.notMoved.length) say(o.from === "pdf-to-word" ? SE.editorOnlyLine(p.notMoved) : SE.notMovedLine(p.notMoved)); }
    else { edit.setAttribute("aria-disabled", "true"); say(p.kind === "over" ? SE.overEdit(p.chars, p.max) : SE.editFailed); }
    if (waiting) { waiting = false; edit.removeAttribute("aria-busy"); label.replaceChildren(SE.edit); if (p.kind === "ready") void go(p); }
  };
  edit.addEventListener("click", () => {
    if (edit.getAttribute("aria-disabled") === "true" || waiting) return;
    if (prep) return void go(prep);
    waiting = true;
    edit.setAttribute("aria-busy", "true");
    label.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), SE.preparing);
  });
  idle(() => void import("../letter/import-docx").then((m) => m.prepareEdit(o.docx, {}, o.from)).then(settle, () => settle({ kind: "failed" })));
  const more = h("div", { class: "w2p-more", "data-test": `${o.p}-more` }, share, edit);
  return { more, note, shareAlert };
}
