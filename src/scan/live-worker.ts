/**
 * عامل الكشف الحيّ (module worker من الأصل نفسه؛ `worker-src 'self'`): يستلم إطاراً مصغّراً (بكسلات `ImageData` منقولة)،
 * ويكشف الورقة بـscanic (ومسار التباين المنخفض إن فشل، وحدّة الورقة: live-detect.ts)، ويعيد النتيجة. فلا يبقى على الخيط الرئيس إلا الرسم.
 * scanic لا تحتاج DOM حين تُعطى `ImageData` (تنشئ `OffscreenCanvas` إن احتاجت لوحاً، ولا `document` هنا).
 */
import { detectFrame, type DetectOpts, type FrameResult } from "./live-detect";
import { meanLuma } from "./live";

export interface LiveJob extends DetectOpts { id: number; w: number; h: number; buf: ArrayBuffer; minConfidence: number }
export interface LiveResult extends FrameResult { id: number; error?: string }

self.onmessage = async (e: MessageEvent<LiveJob>) => {
  const { id, w, h, buf, minConfidence, sharp, low } = e.data;
  const img = new ImageData(new Uint8ClampedArray(buf), w, h);
  let out: LiveResult;
  try { out = { id, ...(await detectFrame(img, minConfidence, { sharp, low })) }; }
  catch (err) { out = { id, corners: null, luma: meanLuma(img), ms: 0, lowTried: false, low: false, error: String((err as Error)?.message ?? err) }; }
  (self as unknown as Worker).postMessage(out);
};
