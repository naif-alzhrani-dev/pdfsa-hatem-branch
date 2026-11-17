/**
 * عامل «PDF إلى Word»: المحرّك كله هنا لا في الصفحة، فملفٌ خبيث (خطوط تعلّق المحلّل، أو تمدّد هائل) يُنهى بـ`terminate()`
 * عند المهلة وتبقى الصفحة تستجيب (ملاحظة 🕵️ أمين على الخطوط). لا يُستدعى مباشرة: الواجهة `runPdfToWord` في `run.ts`.
 * وعامل pdf.js عاملٌ داخل هذا العامل: يُنهى معه، ولا يُحمَّل عامل pdf.js في هذا الخيط (يلتقط رسائله إن حُمِّل فيه).
 */
import "../../uint8-codec";
import "../../promise-try";
import "../../baseline-polyfills";
import pdfWorkerUrl from "../../pdf-worker?worker&url";
import type { ConvertResult } from "./engine";
import { nestedModuleWorker } from "./nested-worker";

export interface WorkerRequest { bytes: Uint8Array; docParams: Record<string, unknown> }
export type WorkerMessage = { type: "page"; done: number; total: number } | { type: "done"; result: ConvertResult | { ok: false; error: "unsupported" | "failed" } };

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  // بلا عامل داخل العامل لا يُشغَّل pdf.js هنا: عامله الوهمي يُحمَّل في هذا الخيط نفسه
  if (typeof Worker === "undefined") { post({ type: "done", result: { ok: false, error: "unsupported" } }); return; }
  let result: WorkerMessage & { type: "done" };
  let sent = false;
  const finish = (r: WorkerMessage & { type: "done" }) => { if (sent) return; sent = true; post(r, r.result.ok ? [r.result.docx.buffer as ArrayBuffer] : []); };
  try {
    const pdfjs = await import("pdfjs-dist");
    // المنفذ صريحاً لا `workerSrc`: pdf.js يقرأ ‏`window.location` ليُنشئ عامله، فيتعطّل هنا ويرجع إلى العامل الوهمي في هذا الخيط
    pdfjs.GlobalWorkerOptions.workerPort = nestedModuleWorker(pdfWorkerUrl, self.location.href, () => finish({ type: "done", result: { ok: false, error: "failed" } }));
    const { convertPdf } = await import("./engine");
    result = { type: "done", result: await convertPdf(e.data.bytes, { pdfjs, docParams: e.data.docParams, onPage: (done, total) => post({ type: "page", done, total }) }) };
  } catch {
    result = { type: "done", result: { ok: false, error: "failed" } };
  }
  // الناتج يُنقل ولا يُنسخ: العامل يُنهى بعده
  finish(result);
};
