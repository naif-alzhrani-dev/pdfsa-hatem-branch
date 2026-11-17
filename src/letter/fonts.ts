/**
 * الخطوط الستة للخطاب (OFL 1.1)، في `public/fonts/letter/<المجلد>/` ومع كلٍّ OFL.txt. مصادرها مثبّتة بـcommit في
 * google/fonts (مراجعة 🕵️ أمين، `docs/logs/letter-deps-amin.md`)، وبصماتها في `tests/letter-fonts.test.ts`.
 * شرط أمين: fontkit لا يُعطى إلا هذه الملفات، فلا دالّة في المحرّك تقبل بايتات خطّ من خارجها.
 */
export { FONTS, type FontFace, type FontKey } from "../font-files";
import { FONTS, type FontKey } from "../font-files";

export const FONT_KEYS = Object.keys(FONTS) as FontKey[];
export const DEFAULT_FONT: FontKey = "naskh";
/** للحروف التي ليست في الخط المختار (اللاتينية في نوتو نسخ مثلاً)، كما في التجربة. */
export const FALLBACK_FONT: FontKey = "amiri";

/** مسار الملف تحت `/fonts/letter/` */
export const fontPath = (k: FontKey, bold: boolean): string => `${FONTS[k].dir}/${bold && FONTS[k].bold ? FONTS[k].bold : FONTS[k].regular}`;
