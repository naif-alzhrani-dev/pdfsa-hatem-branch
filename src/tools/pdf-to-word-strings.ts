/**
 * نصوص «PDF إلى Word»، حرفاً من docs/logs/pdf-to-word-strings-huda.md (تدقيق 👩‍🏫 هدى ٢٠٢٦/١١/١٣) على مسوّدة لمى §٤.
 * نصوص قراءة الصور (`reading` و`ocrLine` و`scanLineWin` و`readImages` و`noArabicOcr`) لا تُكتب هنا حتى تُبنى في برنامج ويندوز.
 * «Word» داخل العربية يُلفّ بـ`<span lang="en">` عند العرض (pdf-to-word.ts، `withWord`).
 */
import { S, ar, pageList, pagesCount } from "../strings";
import { SPN } from "./page-numbers-strings";
import { SPJ } from "./pdf-to-jpg-strings";

/** عدد الصور بقاعدة `pagesCount` (CLDR، على n % 100): ١ «صورة واحدة»، و٢ «صورتان»، و٣–١٠ «… صور»، وغيرها «… صورة». */
export function imagesCount(n: number): string {
  if (n === 1) return "صورة واحدة";
  if (n === 2) return "صورتان";
  const m = n % 100;
  if (n > 2 && m >= 3 && m <= 10) return `${ar(n)} صور`;
  return `${ar(n)} صورة`;
}

/** الصفحات بالرفع: «الصفحة ٤»، و«الصفحتان ٤ و٩»، و«الصفحات ٤ و٩ و١١»، وأكثر من عشر بعددها بقاعدة `pagesCount`. */
export function pageLabel(ns: number[]): string {
  const list = pageList(ns);
  if (ns.length === 1) return `الصفحة ${list}`;
  if (ns.length === 2) return `الصفحتان ${list}`;
  return ns.length <= 10 ? `الصفحات ${list}` : pagesCount(ns.length);
}

export const SPW = {
  name: "PDF ‏←‏ Word", // السهم بـRLM على جانبيه، ويُرسم بـtoolName (src/tool-name.ts)؛ هدى ٢٠٢٦/١١/١٤
  lead: "استخرج نصوص الملف وجداوله إلى مستند Word تعدّله",
  /** حدود التحويل تحت الوصف في الحالة الفارغة (هدى ٢٠٢٦/١١/١٤، ملاحظة نايف ٧). */
  limits: "يُنقل النص والجداول المرسومة بخطوط، ولا تُنقل الصور ولا الترويسة والتذييل ولا أرقام الصفحات.",
  pick: SPN.pick,
  running: SPJ.running,
  doneTitle: "تم التحويل إلى Word",
  notMovedHead: "لم يُنقل إلى المستند:",
  headerFooter: "الترويسة والتذييل",
  pageNumbers: "أرقام الصفحات",
  images: imagesCount,
  scanned: (ns: number[]) => `${pageLabel(ns)}: ${ns.length === 2 ? "لا نصّ فيهما" : "لا نصّ فيها"}`,
  approxCols: (ns: number[]) => `${pageLabel(ns)}: ترتيب الفقرات تقريبي (نصّ بعمودين).`,
  approxBoxes: (ns: number[]) => `${pageLabel(ns)}: ترتيب الفقرات تقريبي (نصّ في مربّعات منفصلة).`,
  approxTable: (ns: number[]) => `${pageLabel(ns)}: نُقل ما فيها من جدول فقرات لا خانات.`,
  save: S.save,
  scanTitle: "صفحات هذا الملف صور",
  scanLine: "لا نصّ فيها يُنقل إلى Word.",
  brokenTitle: "نصّ هذا الملف لا يُنقل صحيحاً",
  brokenLine: "يظهر الملف سليماً على الشاشة، لكن نصّه مخزَّن بطريقة تُخرج في Word رموزاً لا تُقرأ.",
  asIs: "حوّل رغم ذلك",
  another: "اختر ملفاً آخر",
  failed: "تعذّر تحويل الملف. حاول مرة أخرى، وإن تكرّر فجرّب ملفاً آخر.",
  retry: "حاول مرة أخرى",
  tooManyPages: "الملف أكثر من ٣٠٠ صفحة. اختر ملفاً أقصر، أو قسّمه أولاً بأداة «تقسيم ملف».",
  announceDone: "تم التحويل إلى Word",
};
