/**
 * بطاقة «أضف PDFsa إلى شاشتك الرئيسية»: في الرئيسية على الجوال واللوحيّ وحدهما، أول ما يدخل.
 * - لا تظهر على الكمبيوتر، ولا إن فُتح الموقع من الشاشة الرئيسية، ولا داخل تطبيق PDFsa (inAppShell)، ولا بعد appinstalled.
 * - X يغلقها لهذه الزيارة (فتح الصفحة من جديد يعيدها)، ومع «لا تُظهر هذا مرة أخرى» لا تعود أبداً (localStorage).
 * - موضعها (قرار نايف ٢٠٢٦/١١/٠٩ بعد تجربة مصوّرة): بطاقة زجاجية تحت «توقيع ملف» تغطّي صفّ الأدوات الأربع وتتحرّك مع الصفحة،
 *   فلا تحجب تذييل مَحالة ورابط واتساب. أول ما في .home-row (main.ts)، فتأتي في Tab بعد «توقيع ملف» وقبل الأدوات. بلا غطاء معتم ولا حبس للتركيز.
 *   حوار غير نمطي: role="dialog" وaria-modal="false"، وX وEscape يغلقانها، ويعود التركيز إن كان فيها.
 */
import { SI, ar } from "./strings";
import { h, icon } from "./dom";
import { inAppShell, installEnv, shouldShowCard } from "./install-env";

export const NEVER_KEY = "pdfsa.installCard";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
let closedThisVisit = false;
let current: { el: HTMLElement; render: () => void; remove: () => void } | null = null;

// يُسجَّل عند تحميل الوحدة: الحدث قد يصل قبل رسم الرئيسية
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // نافذة المتصفح التلقائية لا تظهر، والزرّ في البطاقة يفتحها
  deferred = e as InstallPromptEvent;
  current?.render();
});
addEventListener("appinstalled", () => {
  installed = true;
  deferred = null;
  current?.remove();
});

function readNever(): boolean {
  try { return localStorage.getItem(NEVER_KEY) === "never"; } catch { return false; }
}
function saveNever() {
  try { localStorage.setItem(NEVER_KEY, "never"); } catch { /* التخزين ممنوع: تعود في الزيارة القادمة */ }
}
function standalone(): boolean {
  return inAppShell(location.protocol, location.hostname) || matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** البطاقة إن لزم ظهورها، أو null. `fallbackFocus`: أين يذهب التركيز عند الإغلاق إن لم يكن له موضع سابق. */
export function installCard(fallbackFocus: () => HTMLElement | null): HTMLElement | null {
  const env = installEnv(navigator.userAgent, navigator.maxTouchPoints);
  if (!shouldShowCard({ env, standalone: standalone(), installed, never: readNever(), closedThisVisit })) return null;

  const body = h("div", { class: "install-body" });
  const never = h("input", { type: "checkbox", "data-test": "install-never" }) as HTMLInputElement;
  const closeBtn = h("button", { class: "icon-btn install-close", type: "button", "aria-label": SI.close, "data-test": "install-close", onclick: () => close() }, icon("close"));
  const card = h("section", {
    class: "install-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "install-title", "aria-describedby": "install-line", "data-test": "install-card",
  },
  closeBtn,
  h("h2", { id: "install-title", class: "install-title" }, SI.title),
  h("p", { id: "install-line", class: "install-line" }, SI.line),
  body,
  h("label", { class: "install-never" }, never, h("span", {}, SI.never)));

  function render() {
    if (env === "ios") {
      // مسافة لا تنكسر قبل ⋯ فلا ينزل الرمز وقوسه وحدهما إلى سطر
      body.replaceChildren(h("ol", { class: "install-steps", "data-test": "install-ios" }, ...SI.iosSteps.map((s, i) => {
        const t = s.replace(" ⋯", " ⋯");
        const text: (Node | string)[] = [t];
        const cut = i === 0 ? t.indexOf("»") + 1 : 0; // أيقونة «مشاركة» بعد اسم الزرّ
        if (cut > 0) text.splice(0, 1, t.slice(0, cut), " ", h("span", { class: "install-share" }, icon("share")), t.slice(cut));
        return h("li", {}, h("span", { class: "install-n", "aria-hidden": "true" }, ar(i + 1)), h("span", {}, ...text));
      })));
    } else if (env === "inapp") {
      body.replaceChildren(h("p", { class: "install-hint", "data-test": "install-inapp" }, SI.inApp));
    } else if (deferred) {
      const btn = h("button", { class: "btn primary block", type: "button", "data-test": "install-btn", onclick: () => void ask() }, SI.installBtn);
      body.replaceChildren(btn);
    } else {
      body.replaceChildren(h("p", { class: "install-hint", "data-test": "install-menu" }, SI.androidMenu));
    }
  }
  async function ask() {
    const e = deferred;
    if (!e) return;
    deferred = null; // الحدث يُستعمل مرة واحدة
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") { installed = true; remove(); } else render(); // رفض: تعليمة القائمة بدل الزرّ
  }

  // التركيز يعود حيث كان قبل دخوله البطاقة
  let before: HTMLElement | null = null;
  card.addEventListener("focusin", (e) => {
    const from = (e as FocusEvent).relatedTarget as HTMLElement | null;
    if (from && !card.contains(from)) before = from;
  });
  const onKey = (e: KeyboardEvent) => {
    if (!card.isConnected) { document.removeEventListener("keydown", onKey); return; } // غادر الرئيسية فأُزيلت معها
    if (e.key !== "Escape") return;
    const a = document.activeElement;
    if (card.contains(a) || a === document.body || a === null) { e.preventDefault(); close(); }
  };
  document.addEventListener("keydown", onKey);

  function remove() {
    document.removeEventListener("keydown", onKey);
    if (current?.el === card) current = null;
    const hadFocus = card.contains(document.activeElement);
    card.remove();
    if (hadFocus) (before?.isConnected ? before : fallbackFocus())?.focus();
  }
  function close() {
    if (current?.el !== card) return;
    if (never.checked) saveNever();
    closedThisVisit = true;
    current = null;
    document.removeEventListener("keydown", onKey);
    const hadFocus = card.contains(document.activeElement);
    const target = before?.isConnected ? before : fallbackFocus();
    if (hadFocus) target?.focus(); // قبل الحركة: لا يضيع التركيز إلى body
    card.classList.add("closing");
    setTimeout(() => card.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 160);
  }

  render();
  current?.remove(); // بطاقة زيارة سابقة للرئيسية في الصفحة نفسها (أُزيلت مع الشاشة)
  current = { el: card, render, remove };
  return card;
}
