/**
 * عدّاد الزوار (Vercel Web Analytics) لنايف وحده: لا يظهر للزائر شيء، ولا معرّف للمستخدم. والحدث المخصّص الوحيد `whatsapp` بخاصية `from` (home|privacy).
 * السكربت الرسمي من النطاق نفسه (`/_vercel/insights/script.js`)، فيكفيه `script-src 'self'` و`connect-src 'self'` في vercel.json.
 * يُحمَّل في الإنتاج وحده، فلا 404 في الكونسول محلياً ولا في الاختبارات.
 * المرجع: https://vercel.com/docs/analytics/quickstart (HTML)، و`inject()` في @vercel/analytics (المصدر الافتراضي نفسه و`defer`).
 */
export const ANALYTICS_SRC = "/_vercel/insights/script.js";
const PROD_HOSTS = new Set(["pdfsa.app", "www.pdfsa.app"]);

export function shouldLoadAnalytics(hostname: string): boolean {
  return PROD_HOSTS.has(hostname.toLowerCase());
}

/** يضيف السكربت مرة واحدة. يُستدعى من الصفحتين (src/analytics-boot.ts). */
export function loadAnalytics(doc: Document = document, hostname: string = location.hostname): boolean {
  if (!shouldLoadAnalytics(hostname)) return false;
  if (doc.head.querySelector(`script[src="${ANALYTICS_SRC}"]`)) return false;
  // طابور الاستدعاءات كما في مقتطف Vercel الرسمي، هنا لا في سكربت مضمَّن (CSP)
  const w = doc.defaultView as (Window & { va?: (...a: unknown[]) => void; vaq?: unknown[][] }) | null;
  if (w && !w.va) w.va = (...a: unknown[]) => { (w.vaq = w.vaq || []).push(a); };
  const s = doc.createElement("script");
  s.src = ANALYTICS_SRC;
  s.defer = true;
  doc.head.append(s);
  return true;
}

type VaWindow = { location: { hostname: string }; va?: (...a: unknown[]) => void };
/**
 * حدث مخصّص (موافقة نايف ٢٠٢٦/١١/٠٩: عدّ ضغطات واتساب وحده)، بالشكل الذي ترسله `track()` في @vercel/analytics:
 * `va("event", { name, data })`. في الإنتاج وحده، وإلى الطابور إن لم يصل السكربت بعد (أو حجبه مانع إعلانات، فلا يُرسل شيء).
 */
export function trackEvent(name: string, data: Record<string, string>, w: VaWindow = window): boolean {
  if (!shouldLoadAnalytics(w.location.hostname) || !w.va) return false;
  w.va("event", { name, data });
  return true;
}

/** ضغطة على رابط فيه data-wa-from (الرئيسية و/privacy) ← حدث `whatsapp` بخاصية `from`. الرابط يفتح كما هو، فلا preventDefault. */
export function trackWhatsappClicks(doc: Document = document) {
  doc.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[data-wa-from]");
    if (a) trackEvent("whatsapp", { from: a.getAttribute("data-wa-from")! });
  });
}
