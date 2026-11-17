/**
 * نصوص دائرة السحب (docs/logs/phase1/copy-huda-polish.md §دائرة السحب). وأسماء الخيارات من مصادر أدواتها لا من هنا.
 * و`mixed` و`unsupported` و`manyWord` حرفاً من docs/logs/drop-explainer-word-texts-huda.md §٢٠ (قبول Word، كدائرة ويندوز).
 */
export const SDW = {
  dropHere: "أفلت الملف هنا",
  mixed: "لا يمكن الجمع بين أنواع مختلفة. اختر PDF أو صوراً أو ملف Word.",
  // جملتان في مفتاحين، كلٌّ في سطر (صقل 1.0.2 §١٠، هدى ٢٠٢٦/١١/١٥)
  unsupported: "هذا النوع من الملفات غير مدعوم.",
  unsupportedAccepted: "المقبول: PDF أو صور أو ملف Word بصيغة docx.",
  manyWord: "تقبل هذه الأداة ملف Word واحداً في المرة.",
} as const;
