/**
 * عامل pdf.js داخل عامل «PDF إلى Word» من blob يستورد رابطه المطلق، لا من الرابط مباشرة.
 * في PDFsa 1.0.1 (WebView2 بمخطط Tauri) يُلغى طلب سكربت العامل المتداخل (`net::ERR_ABORTED`)، والاستيراد من داخل العامل يعمل:
 * قيس بـCDP في `docs/logs/pdf2word-table-fix.md`. وفشل التحميل لا يُرمى، فـ`onFail` يُبلغ به فوراً بدل مهلة الصفحة (15 ث).
 */
export function nestedModuleWorker(url: string, base: string, onFail: () => void, make: (u: string) => Worker = (u) => new Worker(u, { type: "module" })): Worker {
  const src = URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL(url, base).href)};`], { type: "text/javascript" }));
  const w = make(src);
  // يُحرَّر بعد أول ردّ أو فشل، لا فور الإنشاء: لا يُضمن أن كل محرّك جلب السكربت قبل أن يعود المُنشئ
  const free = () => URL.revokeObjectURL(src);
  w.addEventListener("message", free, { once: true });
  for (const ev of ["error", "messageerror"]) w.addEventListener(ev, () => { free(); onFail(); }, { once: true });
  return w;
}
