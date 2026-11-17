/**
 * شبكة أمان للمغادرة بعملٍ غير محفوظ (قرار نايف «أ» ٢٠٢٦/١١/١٥، docs/logs/swipe-snap.md): نافذة المتصفح «مغادرة الموقع؟»
 * حين تُغادَر الصفحة فعلاً (إغلاق اللسان، أو إعادة التحميل، أو رابط آخر، أو رجوعٌ تخطّى حالاتنا كما يفعل Chrome بالمدخلات «المتخطّاة»).
 * - الشرط نفسه الذي يُظهر نافذة «لم يُحفظ» في الصفحة (`unsaved`)، ولا نصّ مخصّص: المتصفح يعرض نصّه.
 * - لا تعمل داخل تطبيقات PDFsa (inAppShell): نايف رفض نوافذ المتصفح في البرنامج (عنوانها «tauri.localhost»).
 * - `allowLeave()` قبل كل مغادرةٍ مقصودة بعد «الخروج» من نافذتنا، فلا يُسأل المستخدم مرّتين.
 */
import { inAppShell } from "./install-env";

let allowed = false;

/** مغادرةٌ مقصودة منّا تليها مباشرةً: لا نافذة متصفح بعدها. */
export function allowLeave(): void { allowed = true; }
/** المغادرة المقصودة جارية: لا دفع في السجلّ بعدها (pushState أثناء تحميل الصفحة التالية قد يلغيه في WebKit). */
export const leaving = (): boolean => allowed;

// رجوع الصفحة من ذاكرة المتصفح بعد مغادرةٍ مقصودة: تعود الحراسة، ويُدفع ما يلزم في السجلّ (مراجعة أمين م١).
// على مستوى الوحدة وبالالتقاط وقبل فحص inAppShell: يسبق مستمعَي التوازن في src/nav.ts وsrc/letter/back-guard.ts، وإلا رأى
// `sync` فيهما `leaving()` مرفوعاً فلم يُعِد الحالة، فخرج الرجوع التالي بلا نافذتنا. وفي Node (اختبارات الوحدة) لا نافذة.
if (typeof window !== "undefined") addEventListener("pageshow", (e) => { if (e.persisted) allowed = false; }, { capture: true });

export function guardLeave(unsaved: () => boolean): void {
  if (inAppShell(location.protocol, location.hostname)) return;
  addEventListener("beforeunload", (e) => {
    if (allowed || !unsaved()) return;
    e.preventDefault();
    e.returnValue = ""; // المتصفحات الأقدم لا تكفيها preventDefault
  });
}
