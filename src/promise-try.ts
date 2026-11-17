// `Promise.try` جاء في Safari 18.2 (iOS 18.2، ديسمبر ٢٠٢٤). وpdf.js 6 يستدعيه بلا فحص في عامله لكل طلبٍ له ردّ
// (GetDocRequest وGetPage…)، فيرمي في آيفون أقدم ولا يصل ردّ، ويبقى «جارٍ فتح الملف…» إلى الأبد.
const P = Promise as unknown as { try?: unknown };
if (typeof P.try !== "function") {
  P.try = <T>(fn: (...a: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) => new Promise<T>((resolve) => resolve(fn(...args)));
}
export {};
