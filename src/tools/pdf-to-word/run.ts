/**
 * الواجهة الوحيدة لشاشة «PDF إلى Word»: تشغّل المحرّك في عامل جديد وتنهيه بـ`terminate()` عند المهلة أو الإلغاء.
 * مهلتان: لكل صفحة (من رسالة الصفحة السابقة، والأولى من بدء العامل) وللملف كله. والأنواع وحدها تُستورد من المحرّك،
 * فلا يدخل شيء منه حزمة الصفحة.
 */
import type { ConvertError, ConvertResult } from "./engine";
import type { WorkerMessage, WorkerRequest } from "./worker";
import { MAX_INPUT_BYTES } from "../pdf-checks";

/** `timeout`: أُنهي العامل. `cancelled`: ألغاه المستخدم. `unsupported`: لا عامل (أو لا عامل داخل العامل). `failed`: تعطّل العامل. */
export type RunError = ConvertError | "timeout" | "unsupported" | "failed";
export type RunResult = Extract<ConvertResult, { ok: true }> | { ok: false; error: RunError };

/**
 * المقيس (`docs/logs/pdf-to-word-trial.md` والسجلّ): وسيط الصفحة 8–19 ms على حاسوب مكتبي مشغول، والأولى 44–88 ms ومعها
 * تحميل العامل والخطوط. فمهلة الصفحة 15 ث نحو مئتي ضعف الأولى لجوال أبطأ، ومهلة الملف تسع 300 صفحة (`MAX_PAGES`) بنحو 0.6 ث لكلٍّ.
 * والجوال لم يُقس.
 */
export const PAGE_TIMEOUT_MS = 15_000;
export const TOTAL_TIMEOUT_MS = 180_000;

export interface RunOptions {
  signal?: AbortSignal;
  onPage?: (done: number, total: number) => void;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** للاختبارات وحدها. */
  createWorker?: () => Worker;
}

/**
 * مسارات pdf.js من نطاق الموقع نفسه، مطلقة لأن العامل يحلّ النسبيّ من موضع ملفه. وبلا WebAssembly، كالصفحة الرئيسية.
 * ولا `document` في العامل: `useWorkerFetch` صريحاً (وإلا قرأ pdf.js ‏`document.baseURI` ليحسبه فتعطّل)، و`disableFontFace`
 * (لا مستند تُضاف إليه الخطوط، والمحرّك لا يرسم). وهو الافتراضي في Node، وناتج الـ13 فيه مطابق لناتج Chromium حرفاً.
 */
function docParams(): Record<string, unknown> {
  const at = (p: string) => { const rel = `${import.meta.env.BASE_URL}pdfjs/${p}/`; return typeof location === "undefined" ? rel : new URL(rel, location.href).href; };
  return { cMapUrl: at("cmaps"), cMapPacked: true, standardFontDataUrl: at("standard_fonts"), wasmUrl: at("wasm"), iccUrl: at("iccs"), useWasm: false, enableXfa: false, useWorkerFetch: true, disableFontFace: true };
}

export function runPdfToWord(bytes: Uint8Array, { signal, onPage, pageTimeoutMs = PAGE_TIMEOUT_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS, createWorker }: RunOptions = {}): Promise<RunResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, error: "cancelled" });
  // قبل العامل: الملف الكبير لا يُنسخ إليه ثم يُرفض هناك (ملاحظة 🕵️ أمين ١)
  if (bytes.length > MAX_INPUT_BYTES) return Promise.resolve({ ok: false, error: "too-big" });
  if (!createWorker && typeof Worker === "undefined") return Promise.resolve({ ok: false, error: "unsupported" });
  return new Promise<RunResult>((resolve) => {
    let worker: Worker;
    try {
      worker = createWorker ? createWorker() : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve({ ok: false, error: "unsupported" });
      return;
    }
    let done = false;
    let pageTimer = setTimeout(() => finish({ ok: false, error: "timeout" }), pageTimeoutMs);
    const totalTimer = setTimeout(() => finish({ ok: false, error: "timeout" }), totalTimeoutMs);
    const onAbort = () => finish({ ok: false, error: "cancelled" });
    signal?.addEventListener("abort", onAbort, { once: true });
    function finish(out: RunResult) {
      if (done) return;
      done = true;
      clearTimeout(pageTimer);
      clearTimeout(totalTimer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(out);
    }
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "page") {
        clearTimeout(pageTimer);
        pageTimer = setTimeout(() => finish({ ok: false, error: "timeout" }), pageTimeoutMs);
        onPage?.(m.done, m.total);
      } else finish(m.result as RunResult);
    };
    worker.onerror = (e) => { e.preventDefault?.(); finish({ ok: false, error: "failed" }); };
    worker.onmessageerror = () => finish({ ok: false, error: "failed" });
    // تُنسخ البايتات ولا تُنقل: الشاشة قد تعيد المحاولة بالملف نفسه
    worker.postMessage({ bytes, docParams: docParams() } satisfies WorkerRequest);
  });
}
