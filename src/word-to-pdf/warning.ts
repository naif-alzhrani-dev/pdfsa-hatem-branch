/**
 * تحذير المحرّك بحقوله كلها (`ConversionWarning` في wasm.rs:35-86)، والغائب `null`.
 * ملف بلا استيراد: يستعمله العامل والواجهة معاً.
 */
export interface W2pWarning { kind: string; format: string; message: string; from: string | null; to: string | null; element: string | null; detail: string | null; reason: string | null }

/** كائن wasm-bindgen: الحقول الاختيارية `undefined` حين تغيب. */
export type EngineWarning = { [K in keyof W2pWarning]?: W2pWarning[K] | undefined };

/** نسخة عادية تعبر `postMessage`: كائن wasm-bindgen يحمل مؤشراً لا ينتقل، وحقوله getters على نموذجه لا خصائص. */
export function plainWarning(w: EngineWarning): W2pWarning {
  return { kind: w.kind ?? "", format: w.format ?? "", message: w.message ?? "", from: w.from ?? null, to: w.to ?? null, element: w.element ?? null, detail: w.detail ?? null, reason: w.reason ?? null };
}
