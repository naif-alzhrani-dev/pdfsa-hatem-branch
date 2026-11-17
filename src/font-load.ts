/**
 * تحميل خطوط `/fonts/letter/` في المتصفح بـFontFace، مشتركاً بين «إعداد خطاب» (`src/letter/ui.ts`) وأدوات الكتابة (`src/font-pick.ts`).
 * الثمانية من `src/font-files.ts` (جدول «إعداد خطاب» نفسه)، ومنها المسيري والرقعة (الدفعة ١ من الخطوط، OFL 1.1 مع كلٍّ).
 * اسم العائلة في CSS `L <المفتاح>`، فخطٌّ حُمّل في أداة لا يُحمَّل مرة ثانية.
 */
import { FONTS, type FontFace as FontFile, type FontKey } from "./font-files";

/** مفاتيح خطوط أدوات الكتابة: الثمانية، وهي خطوط «إعداد خطاب» نفسها منذ الدفعة ٣. */
export type WebFontKey = FontKey;

export const WEB_FONTS: Record<WebFontKey, FontFile> = FONTS;

const faceReady = new Map<string, Promise<void>>();
/** وجهٌ واحد: يُنزَّل ويُضاف إلى `document.fonts` مرة، والفشل لا يُحفظ فالطلب التالي يحاول من جديد. */
function loadFace(k: WebFontKey, bold: boolean): Promise<void> {
  const f = WEB_FONTS[k];
  const file = bold ? f.bold! : f.regular;
  let p = faceReady.get(file);
  if (p) return p;
  const face = new FontFace(`L ${k}`, `url(/fonts/letter/${f.dir}/${file})`, { weight: f.bold ? (bold ? "700" : "400") : "100 900" });
  p = face.load().then((x) => { document.fonts.add(x); });
  faceReady.set(file, p);
  p.catch(() => { if (faceReady.get(file) === p) faceReady.delete(file); });
  return p;
}
/**
 * «إعداد خطاب»: وجها الخط (العادي والعريض، أو المتغيّر بمحوره). ويُرفض الوعد إن رُفض `FontFace.load()`
 * (تعذّر التنزيل أو الملف تالف)، لا يُكتفى بـ`document.fonts.load` الذي يُرجع قائمة فارغة بلا خطأ.
 */
export function loadFont(k: WebFontKey): Promise<void> {
  return Promise.all([loadFace(k, false), ...(WEB_FONTS[k].bold ? [loadFace(k, true)] : [])]).then(() => {});
}
/** أدوات الكتابة: الوجه العادي وحده (ترسم بوزن 500 فيأخذ المتصفح 400، والعريض لـ«إعداد خطاب» وحده). */
export const loadRegular = (k: WebFontKey): Promise<void> => loadFace(k, false);
