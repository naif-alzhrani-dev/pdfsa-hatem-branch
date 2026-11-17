/**
 * نصوص «Word إلى PDF» حرفاً من تدقيق هدى (docs/logs/word-to-pdf-strings-huda.md)، وهي تحلّ محلّ §٥ في مواصفة لمى.
 * والأعداد بقاعدة `pagesCount` (m = n % 100، والوسط ٣–١٠). والأسماء اللاتينية تُغلَّف في الشاشة بـ`<bdi lang="en">`.
 */
import { S, ar } from "../strings";
import { SRT } from "./run-strings";

/** ١ ← one، ٢ ← two، ٣–١٠ ← few، ١١ فأكثر ← many (كـ`pagesCount`). */
function plural(n: number, one: string, two: string, few: (s: string) => string, many: (s: string) => string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const m = n % 100;
  return n > 2 && m >= 3 && m <= 10 ? few(ar(n)) : many(ar(n));
}

/** «X وY وZ». */
const joinNames = (names: string[]) => names.join(" و");

/** ١: «الخط X»، ٢: «الخطان X وY»، ٣: «الخطوط X وY وZ»، وأكثر: «${n} خطوط» بلا أسماء. */
export function fontsOf(names: string[]): string {
  if (names.length === 1) return `الخط ${names[0]}`;
  if (names.length === 2) return `الخطان ${joinNames(names)}`;
  if (names.length === 3) return `الخطوط ${joinNames(names)}`;
  return `${ar(names.length)} خطوط`;
}

/** حجم المحوّل المنقول أول مرة، مقيساً على Vercel: 9,759,347 بايتاً (المدير ٢٠٢٦/١١/١٣). */
export const ENGINE_TRANSFER_BYTES = 9_759_347;
/** بالميغابايت العشري (10⁶) وخانة عشرية واحدة، بالأرقام الهندية: «٩٫٨». */
export const engineMb = (bytes = ENGINE_TRANSFER_BYTES) =>
  (bytes / 1_000_000).toLocaleString("ar-u-nu-arab", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

export const SWD = {
  name: "Word ‏←‏ PDF", // السهم بـRLM على جانبيه، ويُرسم بـtoolName (src/tool-name.ts)؛ هدى ٢٠٢٦/١١/١٤
  lead: "حوّل مستند Word إلى ملف PDF",
  pick: "اختر ملف Word",
  preparing: "جارٍ تجهيز المحوّل…",
  preparingNote: (mb: string) => `يُنزَّل المحوّل أول مرة، وحجمه نحو ${mb} ميغابايت.`,
  converting: "جارٍ التحويل…",
  doneTitle: "تم التحويل إلى PDF",
  announceDone: "تم التحويل إلى PDF",
  doneLine: "قد يختلف شكل الصفحات عن Word، فراجعها قبل استعمال الملف.",
  notMovedHead: "لم يُنقل كما في Word:",
  fonts: (names: string[], to: string) => `لم يتوفر ${fontsOf(names)}، فكُتب النص بخط ${to}`,
  missingGlyphs: (names: string[]) => `ظهرت مربّعات فارغة بدل بعض الحروف (${fontsOf(names)})`,
  licence: (names: string[]) => `${names.length > 3 ? `${ar(names.length)} خطوط` : joinNames(names)}: لا تسمح رخصة الخط بتضمينه في PDF، فاستُعمل خط بديل`,
  charts: (n: number) => plural(n,
    "رسم بياني واحد قد يختلف شكله",
    "رسمان بيانيان قد يختلف شكلهما",
    (s) => `${s} رسوم بيانية قد يختلف شكلها`,
    (s) => `${s} رسماً بيانياً قد يختلف شكله`),
  imagesBlack: (n: number) => plural(n,
    "صورة واحدة تعذّر رسمها، رُسم مكانها مستطيل أسود بمقاسها",
    "صورتان تعذّر رسمهما، رُسم مكانهما مستطيلان أسودان بمقاسيهما",
    (s) => `${s} صور تعذّر رسمها، رُسمت مكانها مستطيلات سوداء بمقاساتها`,
    (s) => `${s} صورة تعذّر رسمها، رُسمت مكانها مستطيلات سوداء بمقاساتها`),
  images: (n: number) => plural(n,
    "صورة واحدة تالفة في الملف، رُسم ما سلم منها",
    "صورتان تالفتان في الملف، رُسم ما سلم منهما",
    (s) => `${s} صور تالفة في الملف، رُسم ما سلم منها`,
    (s) => `${s} صورة تالفة في الملف، رُسم ما سلم منها`),
  smartart: (n: number) => plural(n, "مخطّط SmartArt واحد", "مخطّطا SmartArt", (s) => `${s} مخطّطات SmartArt`, (s) => `${s} مخطّطاً SmartArt`),
  skipped: (n: number) => plural(n,
    "جزء واحد من المستند لم يُقرأ",
    "جزآن من المستند لم يُقرآ",
    (s) => `${s} أجزاء من المستند لم تُقرأ`,
    (s) => `${s} جزءاً من المستند لم يُقرأ`),
  altChunk: "محتوى مُدرَج من ملف آخر",
  evenHeader: "ترويسة الصفحات الزوجية وتذييلها: حلّت محلّهما ترويسة القسم وتذييله",
  columnBreak: "فاصل العمود صار فاصل صفحة",
  vAlign: "المحاذاة الرأسية للصفحة: يبدأ النص من أعلاها",
  other: (n: number) => plural(n,
    "عنصر آخر لم يُنقل كما هو",
    "عنصران آخران لم يُنقلا كما هما",
    (s) => `${s} عناصر أخرى لم تُنقل كما هي`,
    (s) => `${s} عنصراً آخر لم يُنقل كما هو`),
  more: (k: number) => plural(k, "وبند آخر", "وبندان آخران", (s) => `و${s} بنود أخرى`, (s) => `و${s} بنداً آخر`),
  save: S.save,
  docOld: "هذا الملف بصيغة Word القديمة (.doc). افتحه في Word واحفظه بصيغة .docx، ثم اختر الملف الجديد هنا.",
  encrypted: "الملف محمي بكلمة مرور. أزل الحماية في Word واحفظ الملف، ثم اختره هنا.",
  tooBig: SRT.tooBig,
  tooBigInside: "محتوى الملف أكبر مما يتحمّله المحوّل. قسّمه في Word إلى مستندات أصغر، ثم حوّل كلاً منها.",
  badFile: "تعذّرت قراءة الملف. اختر ملف Word سليماً بصيغة .docx.",
  timeout: "استغرق التحويل أكثر من دقيقة فأُوقف. حاول مرة أخرى، وإن تكرّر فجرّب ملفاً أصغر.",
  /** صيغة الموقع. وصيغة برنامج ويندوز («…وإن تكرّر فأعد تشغيل البرنامج») لدفعة البرنامج، حين يُعرف أن المحوّل مضمَّن في حزمته. */
  loadFailed: "تعذّر تجهيز المحوّل. تحقّق من اتصالك وحاول مرة أخرى.",
  failed: "تعذّر تحويل الملف. حاول مرة أخرى، وإن تكرّر فجرّب ملفاً آخر.",
  retry: "حاول مرة أخرى",
  another: "اختر ملفاً آخر",
  noWasm: "هذا المتصفح لا يشغّل محوّل Word. حدّث المتصفح أو جرّب متصفحاً آخر.",
};
