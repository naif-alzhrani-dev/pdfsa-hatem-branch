/** نصوص «PDF إلى صور»، حرفاً من docs/logs/phase1/copy-huda.md (بعد تدقيق 👩‍🏫 هدى). */
import { ar } from "../strings";
import { SPN } from "./page-numbers-strings";

export const SPJ = {
  name: "PDF ‏←‏ صور", // السهم بـRLM على جانبيه، ويُرسم بـtoolName (src/tool-name.ts)؛ هدى ٢٠٢٦/١١/١٤
  lead: "حوّل كل صفحة إلى صورة",
  formatLabel: "الصيغة",
  formatJpg: "JPG",
  formatPng: "PNG",
  run: "حوّل إلى صور",
  running: (i: number, n: number) => `جارٍ تحويل الصفحة ${ar(i)} من ${ar(n)}…`,
  reduced: (p: number) => `الصفحة ${ar(p)} كبيرة جداً على جهازك، فصُغّر مقاس صورتها.`,
  // زرّ اختيار الملف في الحالة الفارغة: نصّ «ترقيم الصفحات» نفسه، وما زال ينتظر مراجعة 👩‍🏫 هدى (page-numbers-strings.ts)
  pick: SPN.pick,
};
