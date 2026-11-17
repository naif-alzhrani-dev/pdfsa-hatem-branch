/**
 * عامل الأدوات: الحماية والفك والضغط وتسطيح النموذج والفحص تعمل هنا لا في الصفحة، فملف خبيث يستهلك المعالج أو الذاكرة
 * يُنهى بـ`terminate()` عند المهلة وتبقى الصفحة تستجيب. لا يُستدعى مباشرة: الواجهة `runTool` في `run-tool.ts`.
 */
import type { ToolRequest } from "./run-tool";

/** الضغط يحتاج canvas في العامل. Safari منذ 16.4 (OffscreenCanvas وconvertToBlob وسياق 2d، MDN browser-compat-data) و15 لـcreateImageBitmap. */
function canvasInWorker(): boolean {
  try {
    if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") return false;
    const c = new OffscreenCanvas(1, 1);
    return typeof c.convertToBlob === "function" && c.getContext("2d") !== null;
  } catch {
    return false;
  }
}

async function run(req: ToolRequest): Promise<{ ok: boolean; bytes?: Uint8Array }> {
  switch (req.kind) {
    case "protect": return (await import("./protect-core")).protectPdf(req.bytes, req.opts.password);
    case "unlock": return (await import("./unlock-core")).unlockPdf(req.bytes, req.opts.password);
    case "compress":
      // لا رجوع إلى الخيط الرئيسي: متصفح بلا canvas في العامل يُعلَم بذلك، والشاشة تقرّر
      if (!canvasInWorker()) return { ok: false, error: "unsupported" } as { ok: false };
      return (await import("./compress-core")).compressPdf(req.bytes, req.opts.level);
    case "fill-form": return (await import("./fill-form-core")).flattenForm(req.bytes, req.opts.marks);
    case "inspect": return (await import("./inspect-core")).inspectPdf(req.bytes);
  }
}

self.onmessage = async (e: MessageEvent<ToolRequest>) => {
  let result: { ok: boolean; bytes?: Uint8Array };
  try {
    result = await run(e.data);
  } catch {
    result = { ok: false, error: "failed" } as { ok: false };
  }
  // الناتج يُنقل ولا يُنسخ: العامل يُنهى بعده
  (self as unknown as Worker).postMessage(result, result.ok && result.bytes ? [result.bytes.buffer] : []);
};
