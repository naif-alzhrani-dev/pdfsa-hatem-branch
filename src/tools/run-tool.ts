/**
 * الواجهة الوحيدة للشاشات: تشغّل الأداة في عامل جديد، وتنهيه بـ`terminate()` إن تجاوز المهلة.
 * هذه الحماية الحقيقية من الملف الخبيث، والحارس النصي في `pdf-checks.ts` طبقة أولى قبلها.
 * الأنواع وحدها تُستورد من الأدوات، فلا يدخل شيء منها الحزمة التي تستورد هذا الملف.
 */
import type { CompressLevel, CompressResult } from "./compress-core";
import type { FillResult } from "./fill-form-core";
import type { InspectResult } from "./inspect-core";
import type { ProtectResult } from "./protect-core";
import type { UnlockResult } from "./unlock-core";

export type ToolKind = "protect" | "unlock" | "compress" | "fill-form" | "inspect";
/** `fill-form`: صورة كل حقل (PNG) تُرسم في الصفحة بخطّ الواجهة، وتُنقل إلى العامل ولا تُنسخ. */
export interface ToolOptions { protect: { password: string }; unlock: { password?: string }; compress: { level: CompressLevel }; "fill-form": { marks: Map<string, Uint8Array | null> }; inspect: Record<string, never> }
interface ToolResults { protect: ProtectResult; unlock: UnlockResult; compress: CompressResult; "fill-form": FillResult; inspect: InspectResult }
/** `timeout`: أُنهي العامل. `unsupported`: لا عامل، أو لا canvas فيه للضغط. `failed`: تعطّل العامل (قطعة لم تُحمَّل، أو نفدت ذاكرته). */
export type RunError = "timeout" | "unsupported" | "failed";
export type RunResult<K extends ToolKind> = ToolResults[K] | { ok: false; error: RunError };
export type ToolRequest = { [K in ToolKind]: { kind: K; bytes: Uint8Array; opts: ToolOptions[K] } }[ToolKind];

/**
 * ٦٠ ثانية. القياس (docs/logs/phase1/core.md، ٢٠٢٦/١١/١٠، حاسوب مكتبي): ملف 99 MB من 42 صورة كاميرا 12 MP،
 * أبطأ أداة 6.6 ث في Chromium و4.7 ث في WebKit، فالمهلة نحو عشرة أضعاف لجوال أبطأ. والجوال لم يُقس.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** `createWorker` للاختبارات وحدها. */
export function runTool<K extends ToolKind>(
  kind: K,
  bytes: Uint8Array,
  opts: ToolOptions[K],
  { timeoutMs = DEFAULT_TIMEOUT_MS, createWorker }: { timeoutMs?: number; createWorker?: () => Worker } = {},
): Promise<RunResult<K>> {
  type Out = RunResult<K>;
  if (!createWorker && typeof Worker === "undefined") return Promise.resolve({ ok: false, error: "unsupported" });
  return new Promise<Out>((resolve) => {
    let worker: Worker;
    try {
      worker = createWorker ? createWorker() : new Worker(new URL("./tool-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve({ ok: false, error: "unsupported" });
      return;
    }
    let done = false;
    const finish = (out: Out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(out);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs);
    worker.onmessage = (e: MessageEvent<Out>) => finish(e.data);
    worker.onerror = (e) => { e.preventDefault?.(); finish({ ok: false, error: "failed" }); };
    worker.onmessageerror = () => finish({ ok: false, error: "failed" });
    // تُنسخ البايتات ولا تُنقل: الشاشة قد تعيد المحاولة بالملف نفسه (كلمة أخرى للفك). وصور الحقول تُنقل: تُرسم من جديد في كل حفظ
    const marks = kind === "fill-form" ? (opts as ToolOptions["fill-form"]).marks.values() : [];
    const transfer = [...new Set([...marks].flatMap((m) => (m ? [m.buffer as ArrayBuffer] : [])))];
    worker.postMessage({ kind, bytes, opts } as ToolRequest, transfer);
  });
}
