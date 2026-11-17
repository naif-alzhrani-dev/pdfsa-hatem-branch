/**
 * عامل «Word إلى PDF»: يجلب المحرّك من `base` (ملف wasm-bindgen ‎--target web وملف .wasm)، ويسجّل الخطوط بالبايتات، ويحوّل.
 * لا يُستدعى مباشرة: الواجهة `convertDocx` في `convert.ts`، وهي تنهيه بعد الجواب أو عند المهلة.
 * وتشغيل wasm هنا يحتاج 'wasm-unsafe-eval' في سياسة أمان هذا الملف نفسه (ترويسة استجابته)، لا الصفحة (السجلّ: CSP).
 */
import type { W2pMessage, W2pRequest } from "./convert";
import { plainWarning, type EngineWarning, type W2pWarning } from "./warning";

interface Engine {
  default: (o: { module_or_path: string }) => Promise<unknown>;
  Office2PdfConverter: new () => {
    registerFont(b: Uint8Array): void;
    setLastResortFontFamily(f: string): void;
    convertToPdf(b: Uint8Array, format: string): { pdf: Uint8Array; warningCount: number; warningAt(i: number): (EngineWarning & { free(): void }) | undefined; free(): void };
    free(): void;
  };
}

const post = (m: W2pMessage, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (e: MessageEvent<W2pRequest>) => {
  const { bytes, format, fonts, lastResort, base } = e.data;
  let engine: Engine;
  let c: InstanceType<Engine["Office2PdfConverter"]>;
  try {
    engine = (await import(/* @vite-ignore */ `${base}o2p_wasm.js`)) as Engine;
    await engine.default({ module_or_path: `${base}o2p_wasm_bg.wasm` });
    c = new engine.Office2PdfConverter();
    for (const f of fonts) c.registerFont(f); // خطّ بلا وجه صالح يرمي: خطأ عندنا لا في الملف
    if (lastResort) c.setLastResortFontFamily(lastResort);
  } catch {
    post({ type: "error", stage: "load" });
    return;
  }
  post({ type: "ready" });
  try {
    const r = c.convertToPdf(bytes, format);
    const pdf = r.pdf;
    const warnings: W2pWarning[] = [];
    for (let i = 0; i < r.warningCount; i++) { const w = r.warningAt(i); if (w) { warnings.push(plainWarning(w)); w.free(); } }
    post({ type: "done", pdf, warnings }, [pdf.buffer]);
  } catch {
    post({ type: "error", stage: "convert" });
  }
};
