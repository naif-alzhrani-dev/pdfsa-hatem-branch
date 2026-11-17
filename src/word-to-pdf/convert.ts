/**
 * «Word إلى PDF» على الجهاز: `convertDocx(bytes, fonts)` يحوّل ملف .docx في عامل جديد يُنهى بـ`terminate()` عند المهلة،
 * كـ`runTool` (`../tools/run-tool.ts`). والمحرّك `office2pdf` 0.10.0 المصلَح (docs/logs/word-to-pdf-engine.md) ملفان ثابتان
 * تحت `<BASE>word-to-pdf/<إصدار>/` (`ENGINE_DIR`) يجلبهما العامل وحده حين يُستدعى، فلا يدخلان حزمة أي صفحة.
 * الأنواع وحدها تُستورد من العامل.
 */
import { checkOffice, type DocxError, type OfficeFormat } from "./limits";
import type { W2pWarning } from "./warning";

export type { W2pWarning };

/**
 * `timeout`: تجاوز التحويل مهلته بعد التجهيز. `load-failed`: لم يُجهَّز المحرّك (شبكة، أو سياسة الأمان، أو مهلة التحميل، أو تعطّل العامل قبل `ready`).
 * `failed`: تعطّل العامل بعد التجهيز. `unsupported`: لا عامل. `cancelled`: أُلغي بـ`signal` فأُنهي العامل.
 */
export type ConvertError = DocxError | "timeout" | "load-failed" | "unsupported" | "failed" | "cancelled";
export type ConvertResult = { ok: true; pdf: Uint8Array; warnings: W2pWarning[] } | { ok: false; error: ConvertError };

export interface W2pRequest { bytes: Uint8Array; format: OfficeFormat; fonts: Uint8Array[]; lastResort: string | null; base: string }
export type W2pMessage =
  | { type: "ready" }
  | { type: "done"; pdf: Uint8Array; warnings: W2pWarning[] }
  | { type: "error"; stage: "load" | "convert" };

/** مهلة التحويل بعد تحميل المحرّك، كمهلة الأدوات (`DEFAULT_TIMEOUT_MS` في run-tool.ts). لا يُستورد منه: استيراده يُدخل عامل الأدوات كله الحزمة. */
export const CONVERT_TIMEOUT_MS = 60_000;
export const DEFAULT_LAST_RESORT = "IBM Plex Sans Arabic";
/** تحميل المحرّك (9,759,347 بايتاً منقولاً، مقيساً على Vercel) قبل بدء مهلة التحويل: على جوال بطيء قد يطول. */
export const LOAD_TIMEOUT_MS = 120_000;

/** مجلد المحرّك باسم إصداره (office2pdf 0.10.0 + رقع العربية والاتجاه، النسخة 2)، وله في vercel.json تخزين `immutable`: نسخة جديدة مجلد جديد. */
export const ENGINE_DIR = "word-to-pdf/0.10.0-ar2/";

export function engineBase(): string {
  return new URL(`${import.meta.env.BASE_URL}${ENGINE_DIR}`, location.href).href;
}

export interface ConvertOptions {
  /** عائلة الخط لما لا يجد خطّه بين `fonts`. */
  lastResort?: string | null;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  base?: string;
  /** يُنهي العامل ويعيد `cancelled` (الرجوع أثناء التحويل). */
  signal?: AbortSignal;
  /** حين يُجهَّز المحرّك ويبدأ التحويل. */
  onReady?: () => void;
  /** للاختبارات وحدها. */
  createWorker?: () => Worker;
}

/** `fonts`: ملفات خطوط كاملة (ttf/otf/ttc)، تُنسخ إلى العامل. */
export function convertDocx(bytes: Uint8Array, fonts: Uint8Array[], o: ConvertOptions = {}): Promise<ConvertResult> {
  return convertOffice(bytes, "docx", fonts, o);
}

/** Excel وPowerPoint لدفعتيهما، وللحارس على الملفات الخمسة. */
export function convertOffice(bytes: Uint8Array, format: OfficeFormat, fonts: Uint8Array[], o: ConvertOptions = {}): Promise<ConvertResult> {
  const bad = checkOffice(bytes, format);
  if (bad) return Promise.resolve({ ok: false, error: bad });
  if (!o.createWorker && typeof Worker === "undefined") return Promise.resolve({ ok: false, error: "unsupported" });
  if (o.signal?.aborted) return Promise.resolve({ ok: false, error: "cancelled" });
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = o.createWorker ? o.createWorker() : new Worker(new URL("./w2p-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve({ ok: false, error: "unsupported" });
      return;
    }
    let done = false;
    let ready = false;
    let timer = setTimeout(() => finish({ ok: false, error: "load-failed" }), o.loadTimeoutMs ?? LOAD_TIMEOUT_MS);
    const abort = () => finish({ ok: false, error: "cancelled" });
    o.signal?.addEventListener("abort", abort, { once: true });
    function finish(out: ConvertResult) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(out);
    }
    worker.onmessage = (e: MessageEvent<W2pMessage>) => {
      const m = e.data;
      if (m.type === "ready") {
        if (ready || done) return;
        ready = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ok: false, error: "timeout" }), o.timeoutMs ?? CONVERT_TIMEOUT_MS);
        o.onReady?.();
      } else if (m.type === "done") finish({ ok: true, pdf: m.pdf, warnings: m.warnings });
      else finish({ ok: false, error: m.stage === "convert" ? "bad-file" : "load-failed" });
    };
    const crashed = () => finish({ ok: false, error: ready ? "failed" : "load-failed" });
    worker.onerror = (e) => { e.preventDefault?.(); crashed(); };
    worker.onmessageerror = crashed;
    const req: W2pRequest = { bytes, format, fonts, lastResort: o.lastResort === undefined ? DEFAULT_LAST_RESORT : o.lastResort, base: o.base ?? engineBase() };
    worker.postMessage(req);
  });
}
