/** نصوص «صور إلى PDF»، حرفاً من docs/logs/phase1/copy-huda.md (بعد تدقيق 👩‍🏫 هدى). و`badImage` من S الموجودة. */
import { ar } from "../strings";

export const SJP = {
  name: "صور ‏←‏ PDF", // السهم بـRLM على جانبيه، ويُرسم بـtoolName (src/tool-name.ts)؛ هدى ٢٠٢٦/١١/١٤
  lead: "اجمع صورك في ملف واحد",
  sizeLabel: "حجم الصفحة",
  sizeA4: "A4",
  sizeImage: "بحجم الصورة",
  pick: "اختر الصور",
  add: "أضف صوراً", // زرّ الإضافة بعد وجود صور (لا يستبدلها)
  run: "حوّل إلى PDF",
  heic: "تعذّر فتح هذه الصيغة على جهازك. احفظ الصورة بصيغة JPG أو PNG ثم اخترها من جديد.",
  tooMany: (max: number) => `الحد الأقصى ${ar(max)} صورة في المرة.`,
};
