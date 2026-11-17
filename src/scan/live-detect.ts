/**
 * كشف إطارٍ واحد في المسح الحيّ، مشتركٌ بين العامل (live-worker.ts) والخيط الرئيس (live-screen.ts) والكشف الدقيق عند الالتقاط:
 *  ١. scanic (`classical`) كما كان.
 *  ٢. إن كان الإطار فاتحاً ووجد scanic رباعيّاً ليست أضلاعه أفتح من خارجها (كتلة كتابة داخل ورقة باهتة على طاولة بيضاء)، رُدّ.
 *     ثم إن لم يبقَ رباعيّ: **مسار التباين المنخفض** (lowcontrast.ts) — كشفٌ ثانٍ على صورة مسطَّحة الإضاءة، ولا يُقبل
 *     إلا رباعيٌّ أضلاعه أفتح من خارجها (`paperLike`)، فلا يخترع ورقةً من طاولة بيضاء فارغة.
 *  ٣. حدّة الورقة داخل الرباعي (sharp.ts) لبوابة الحدّة.
 */
import { scanDocument } from "scanic";
import { acceptDetection, type Corners } from "./geom";
import { meanLuma } from "./live";
import { brightFrame, flatten, paperLike } from "./lowcontrast";
import { sharpness } from "./sharp";

export interface DetectOpts { sharp: boolean; low: boolean }
export interface FrameResult {
  corners: Corners | null; luma: number; ms: number;
  /** حدّة الورقة (إن طُلبت ووُجدت ورقة)، وزمن قياسها. */
  sharp?: number; sharpMs?: number;
  /** جُرِّب مسار التباين المنخفض، ووجد الورقة؛ ورُدّ كشف scanic لأنه ليس شكل ورقة فاتحة. */
  lowTried: boolean; low: boolean; rejected?: boolean;
}

const scan = async (img: ImageData, minConfidence: number) => {
  const r = await scanDocument(img, { mode: "detect", detector: "classical", maxProcessingDimension: Math.max(img.width, img.height) });
  return acceptDetection(r, minConfidence, img.width, img.height);
};

export async function detectFrame(img: ImageData, minConfidence: number, opt: DetectOpts): Promise<FrameResult> {
  const t = performance.now();
  let corners = await scan(img, minConfidence);
  let lowTried = false, low = false, rejected = false;
  const bright = opt.low && brightFrame(img);
  if (corners && bright && !paperLike(img, corners)) { corners = null; rejected = true; }
  if (!corners && bright) {
    lowTried = true;
    const f = flatten(img);
    const c = await scan(new ImageData(f.data as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), minConfidence);
    if (c && paperLike(img, c)) { corners = c; low = true; }
  }
  const ms = performance.now() - t;
  const out: FrameResult = { corners, luma: meanLuma(img), ms, lowTried, low, rejected };
  if (corners && opt.sharp) {
    const s = performance.now();
    out.sharp = sharpness(img, corners);
    out.sharpMs = performance.now() - s;
  }
  return out;
}
