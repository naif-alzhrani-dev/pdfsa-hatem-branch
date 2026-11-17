/**
 * جدول ملفات الخطوط الثمانية في `public/fonts/letter/` (OFL 1.1): الستّة، ومعها المسيري والرقعة (الدفعة ٣: في «إعداد خطاب» أيضاً)، خارج src/letter لأن أدوات الكتابة (src/font-load.ts) تقرؤه
 * ولا تستورد من src/letter (حارس أمين ن٣ في tests/letter-doc.test.ts). و`src/letter/fonts.ts` يعيد تصديره كما هو.
 */
export type FontKey = "naskh" | "amiri" | "markazi" | "plex" | "almarai" | "kufi" | "messiri" | "ruqaa";

export interface FontFace {
  /** اسم العائلة في CSS (للمقارنة بالمتصفح) */
  family: string;
  dir: string;
  regular: string;
  /** ملف العريض؛ وإن لم يوجد فالخط متغيّر (`wght`) ويُثبَّت محوره على 700 */
  bold: string | null;
}

export const FONTS: Record<FontKey, FontFace> = {
  naskh: { family: "Noto Naskh Arabic", dir: "noto-naskh", regular: "NotoNaskhArabic-VF.ttf", bold: null },
  amiri: { family: "Amiri", dir: "amiri", regular: "Amiri-Regular.ttf", bold: "Amiri-Bold.ttf" },
  markazi: { family: "Markazi Text", dir: "markazi", regular: "MarkaziText-VF.ttf", bold: null },
  plex: { family: "IBM Plex Sans Arabic", dir: "plex", regular: "IBMPlexSansArabic-Regular.ttf", bold: "IBMPlexSansArabic-Bold.ttf" },
  almarai: { family: "Almarai", dir: "almarai", regular: "Almarai-Regular.ttf", bold: "Almarai-Bold.ttf" },
  kufi: { family: "Noto Kufi Arabic", dir: "noto-kufi", regular: "NotoKufiArabic-VF.ttf", bold: null },
  messiri: { family: "El Messiri", dir: "el-messiri", regular: "ElMessiri-VF.ttf", bold: null },
  ruqaa: { family: "Aref Ruqaa", dir: "aref-ruqaa", regular: "ArefRuqaa-Regular.ttf", bold: "ArefRuqaa-Bold.ttf" },
};
