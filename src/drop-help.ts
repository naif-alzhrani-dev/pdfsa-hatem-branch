/**
 * زرّ «؟» في رئيسية برنامج ويندوز (الإضافة ١٩، docs/logs/drop-explainer-lama-spec.md §٢أ): يعيد نافذة «كيف تعمل أداة الإفلات».
 * في مكان «تنزيل PDFsa» المخفيّ في البرنامج، ولا يُبنى خارجه (src/main.ts بشرط inWindowsApp).
 * لا أمر IPC للنافذة الرئيسية (desktop/src-tauri/capabilities/default.json): الزرّ ينتقل إلى DROP_HELP_PATH، فيعترضه البرنامج
 * (win.rs app_window، link.rs is_explainer) ويفتح النافذة، ويُلغى التنقّل فتبقى الصفحة كما هي.
 */
import { h } from "./dom";
import { SDH } from "./strings";

/** مسار link.rs EXPLAINER_PATH بنصّه */
export const DROP_HELP_PATH = "/desktop-explainer";

/** دائرة فيها «؟» (العربية: انحناؤها إلى اليسار)، 24px بسُمك أيقونات ICON، مرسومة هنا لا من مكتبة، ولا تُعكس */
const HELP_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 1 0-3.6 2.2c.7.4 1.1.9 1.1 1.6v.4"/><path d="M12 16.6v.1"/></svg>';

export function dropHelpButton(): HTMLButtonElement {
  const b = h("button", {
    class: "icon-btn drop-help", type: "button", "aria-label": SDH.label, title: SDH.label, "data-test": "drop-help",
    onclick: () => location.assign(DROP_HELP_PATH),
  }) as HTMLButtonElement;
  b.innerHTML = HELP_ICON;
  return b;
}
