/**
 * نصوص مشتركة بين «ضغط ملف» و«حماية ملف» و«فك الحماية»، حرفاً من docs/logs/phase1/copy-huda-tools2.md (👩‍🏫 هدى).
 * كل رمز من `runTool` له نصّه في جدول أداته (`*-strings.ts`)، والجداول بنوع `Record` فرمزٌ بلا نصّ لا يُبنى.
 */
import type { RunError } from "./run-tool";

export const SRT = {
  tooBig: "الملف أكبر من ١٠٠ ميغابايت. اختر ملفاً أصغر.",
  /** التوقيع الرقمي (`signed: true`): سطر ثابت فوق زرّ الحفظ، والزرّ بنصّه. */
  signedNote: "في الملف توقيع رقمي موثَّق، وسيزول عند الحفظ. توقيعك المرسوم على الورقة لا يتأثر.",
  saveUnsigned: "احفظ دون التوقيع الرقمي",
};

/** رموز العامل نفسه (`run-tool.ts`)، وهي في جدول كل أداة. */
export const RUN_ERRORS: Record<RunError, string> = {
  timeout: "استغرق العمل أكثر من دقيقة فأُوقف. جرّب ملفاً أصغر.",
  unsupported: "هذه الأداة لا تعمل في هذا المتصفح. حدّث المتصفح أو جرّب متصفحاً آخر.",
  failed: "تعذّر إكمال العمل. أعد المحاولة، وإن تكرّر فتأكد من اتصالك أو جرّب ملفاً أصغر.",
};

/**
 * الحجمان بالميغابايت (1,048,576 بايتاً، كحدّ ١٠٠ ميغابايت في pdf-checks.ts) بالأرقام الهندية: بخانة عشرية واحدة،
 * وبخانتين إن كان أصغرهما دون ميغابايت (فلا يُقرأ «٠٫٠»)، وتزيد خانة إن تساويا («١٫٠ بدل ١٫٠»).
 */
export function megabytes(a: number, b: number): [string, string] {
  const fmt = (n: number, d: number) => (n / 1_048_576).toLocaleString("ar-u-nu-arab", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
  let d = Math.min(a, b) < 1_048_576 ? 2 : 1;
  while (d < 4 && fmt(a, d) === fmt(b, d)) d++;
  return [fmt(a, d), fmt(b, d)];
}
