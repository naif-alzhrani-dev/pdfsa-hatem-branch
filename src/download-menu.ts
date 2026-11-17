/**
 * زرّ «تنزيل PDFsa» في الرئيسية (طلب نايف ٢٠٢٦/١١/١١، مواصفة لمى docs/logs/download-buttons-lama-spec.md، نصوص هدى).
 * - في زاوية البداية (اليمين) يقابل زرّ الوضع الليلي، ويفتح صفّ ثلاث حبّات نصّية للمتاجر بلا شعار متجر.
 * - الحبّة «قريباً» زرّ aria-disabled، وضغطها يكتب سطر الحالة (role="status"). والمتجر «live» رابطٌ إليه.
 * - الحبّات تنبثق من مركز الزرّ: --dl-from يُحسب من الموضع الحقيقي عند الفتح، والحركة transform وopacity وحدهما (style.css).
 * - يُخفى ما دامت بطاقة «أضف إلى الشاشة الرئيسية» ظاهرة، ويظهر بعد إغلاقها.
 * - S2 (ملاحظة نايف ٢٠٢٦/١١/١١ «تغطي الكلام»): تحت 1024 الصفّ في مستوى الزرّ إلى يساره، والشعار يبهت ما دامت مفتوحة (style.css).
 */
import { h, icon } from "./dom";
import { SD } from "./strings";
import { inWindowsApp } from "./install-env";

/** شارة متجر مايكروسوفت الرسمية (public/ms-badge، منسوخة بلا تعديل: «Don't alter the artwork»)، من 'self' فلا اتصال بخوادم مايكروسوفت.
 *  الداكنة نهاراً والفاتحة ليلاً (style.css). مقاسها الأصلي 161×44، ولا شيء ملاصق لها («Keep it clear»). */
const MS_BADGE = { dark: `${import.meta.env.BASE_URL}ms-badge/ar-dark.svg`, light: `${import.meta.env.BASE_URL}ms-badge/ar-light.svg` };

export type StoreId = "windows" | "ios" | "android";
export type StoreState = { state: "soon" } | { state: "live"; url: string };

/** حالة كل متجر في مكان واحد: تحويل متجر إلى «live» سطرٌ هنا. الترتيب من اليمين: ويندوز، ثم آيفون، ثم أندرويد. */
export const STORES: Record<StoreId, StoreState> = {
  // منشور في متجر مايكروسوفت (تحقّق المدير ٢٠٢٦/١١/١٤: 200)، وقرار نايف ١١/١٣ «نعم، بعد القبول»
  windows: { state: "live", url: "https://apps.microsoft.com/detail/9NNZ57LXK7XK" },
  ios: { state: "soon" },
  android: { state: "soon" },
};
export const STORE_ORDER: readonly StoreId[] = ["windows", "ios", "android"];

/** نطاق كل متجر (S5، مراجعة 🕵️ أمين): رابط «live» لا يُقبل إلا https ونطاقه نطاق متجره بالضبط (لا لاحقة ولا نطاق متجر آخر). */
const STORE_HOST: Record<StoreId, string> = { windows: "apps.microsoft.com", ios: "apps.apple.com", android: "play.google.com" };
/** الرابط كما هو إن صحّ، وإلا null (فترجع الحبّة إلى «قريباً»). */
export function safeStoreUrl(id: StoreId, url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === STORE_HOST[id] ? url : null;
  } catch { return null; }
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** مدة الإغلاق في style.css (160ms، ومع تقليل الحركة 120ms)، وبعدها تخرج الحبّات من التخطيط. */
const closeMs = () => (reduced() ? 120 : 160);

/** سطر الحالة: الاسم اللاتيني يُلفّ بـ<bdi lang="en"> (هدى). */
function statusLine(id: StoreId): (Node | string)[] {
  const s = SD.stores[id];
  return s.latin ? [SD.soonOn, " ", h("bdi", { lang: "en" }, s.name)] : [`${SD.soonOn} ${s.name}`];
}

export function downloadMenu(installCard: HTMLElement | null): HTMLElement {
  // داخل برنامج ويندوز لا معنى لـ«تنزيل PDFsa» (مواصفة لمى 1.0.2): عنصر مخفيّ مكانه
  if (inWindowsApp(location.protocol, location.hostname, navigator.userAgent, navigator.maxTouchPoints)) return h("div", { class: "dl", hidden: true, "data-test": "dl" });
  const toggle = h("button", {
    class: "icon-btn dl-toggle", type: "button", "aria-label": SD.label, title: SD.label,
    "aria-expanded": "false", "aria-controls": "dl-row", "data-test": "dl-toggle",
  }, h("span", { class: "dl-ic dl-dev" }, icon("download")), h("span", { class: "dl-ic dl-x" }, icon("close"))) as HTMLButtonElement;

  const status = h("p", { class: "dl-status", role: "status", "data-test": "dl-status" });
  const pills = STORE_ORDER.map((id) => {
    const s = SD.stores[id];
    const st = STORES[id];
    const live = st.state === "live" ? safeStoreUrl(id, st.url) : null;
    const name = h("span", { class: "dl-name", lang: s.latin ? "en" : undefined }, s.name);
    // تحت 1024 يُرسم اسم المنصّة بدل اسم المتجر (S2)، ويُسمع اسم المنصّة أولاً ثم اسم المتجر (S5)
    const plat = h("span", { class: "dl-plat" }, s.plat);
    // الاسم المسموع يبدأ بالنصّ المرئي في كل عرض (WCAG 2.5.3، 👩‍🏫 هدى): الكمبيوتر «اسم المتجر قريباً، وصف المنصّة»، وتحت 1024 «المنصّة قريباً، اسم المتجر» (style.css)
    const hint = h("span", { class: "sr-only dl-hint" }, s.hint);
    const storeSr = h("span", { class: "sr-only dl-sr-store" }, "، ", s.latin ? h("bdi", { lang: "en" }, s.name) : s.name);
    if (live && id === "windows") {
      // شارة المتجر الرسمية مكان الحبّة: الاسم المسموع getSr وحده، والصورتان زخرفيّتان (alt فارغ) فلا يتكرّر النصّ
      return h("a", { class: "dl-pill dl-badge", href: live, target: "_blank", rel: "noopener", dir: "rtl", "aria-label": SD.getSr(s.name), "data-store": id, "data-test": `dl-${id}` },
        h("img", { class: "dl-ms dl-ms-dark", "data-src": MS_BADGE.dark, alt: "", width: 161, height: 44 }),
        h("img", { class: "dl-ms dl-ms-light", "data-src": MS_BADGE.light, alt: "", width: 161, height: 44 }));
    }
    if (live) {
      // سطرها الثاني «حمّله» بأسلوب «قريباً»، والاسم المسموع يبدأ بالمرئي ثم «حمّل PDFsa من متجر …» (مواصفة لمى 1.0.2، نصّ هدى)
      return h("a", { class: "dl-pill", href: live, target: "_blank", rel: "noopener", dir: "rtl", "data-store": id, "data-test": `dl-${id}` },
        name, plat, h("span", { class: "dl-soon dl-get" }, SD.get), h("span", { class: "sr-only" }, "، ", SD.getSr(s.name)));
    }
    return h("button", {
      class: "dl-pill", type: "button", "aria-disabled": "true", dir: "rtl", "data-store": id, "data-test": `dl-${id}`,
      onclick: () => status.replaceChildren(...statusLine(id)),
    }, name, plat, h("span", { class: "dl-soon" }, SD.soon), hint, storeSr);
  });
  // تحت 1024 الشارة وحدها في سطر الزرّ و«آيفون» و«أندرويد» تحتها (style.css)؛ الفاصل لا يُرسم من 1024
  pills.forEach((el, i) => el.style.setProperty("--dl-d", `${[20, 70, 120][i]}ms`));
  const rowKids: HTMLElement[] = pills[0]!.classList.contains("dl-badge") ? [pills[0]!, h("span", { class: "dl-break", "aria-hidden": "true" }), ...pills.slice(1)] : pills;
  const row = h("div", { id: "dl-row", class: "dl-row", hidden: true, "data-test": "dl-row" }, ...rowKids);
  const pop = h("div", { class: "dl-pop" }, row, status);
  // طبقة شفّافة بلا تعتيم: الضغطة خارج القائمة تغلقها ولا تمرّ إلى ما تحتها
  const scrim = h("div", { class: "dl-scrim", hidden: true, "data-test": "dl-scrim", onclick: () => close(row.contains(document.activeElement)) });
  const root = h("div", { class: "dl", "data-test": "dl" }, toggle, scrim, pop);

  /** S4: سطر الحالة يُرسم إن اتّسعت الفجوة بين أسفل الحبّات وأعلى «توقيع ملف» له بهامش 8 من كل جهة (36 ارتفاعه في style.css)،
   *  وإلا يبقى في الشجرة لقارئ الشاشة وحده (role="status" يُعلَن) ولا يُرسم: «قريباً» مكتوبة في كل حبّة. يُقاس عند الفتح وعند تغيّر المقاس. */
  const STATUS_H = 36, STATUS_GAP = 8;
  const narrow = matchMedia("(max-width: 1023.98px)");
  function fitStatus() {
    const sign = document.querySelector(".home-sign");
    if (!sign) return;
    const need = pop.getBoundingClientRect().top + row.offsetTop + row.offsetHeight + STATUS_GAP + STATUS_H + STATUS_GAP;
    // تحت 1024 (الصفّ الثاني للحبّتين يأخذ مكان سطر الحالة): لا يُرسم، ويبقى لقارئ الشاشة
    root.classList.toggle("dl-nofit", narrow.matches || sign.getBoundingClientRect().top < need - 0.01);
  }

  let hideTimer = 0;
  function open() {
    clearTimeout(hideTimer);
    const fresh = row.hidden;
    row.hidden = false;
    scrim.hidden = false;
    // الصورة الظاهرة بحسب المظهر وحدها تُطلب (والأخرى لا تُطلب أبداً ما لم يتبدّل المظهر ثم تُفتح القائمة)
    for (const img of row.querySelectorAll<HTMLImageElement>(".dl-ms")) if (!img.getAttribute("src") && getComputedStyle(img).display !== "none") img.src = img.dataset.src!;
    if (fresh) {
      // نقطة البداية: مركز الزرّ، من الموضع الحقيقي (offset لا يتأثّر بـtransform الجاري)
      const b = toggle.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      root.classList.add("dl-snap");
      for (const el of pills) {
        const cx = p.left + el.offsetLeft + el.offsetWidth / 2, cy = p.top + el.offsetTop + el.offsetHeight / 2;
        el.style.setProperty("--dl-from", `translate(${(bx - cx).toFixed(1)}px, ${(by - cy).toFixed(1)}px) scale(.4)`);
      }
      void row.offsetWidth; // يثبّت نقطة البداية قبل الانتقال
      root.classList.remove("dl-snap");
    }
    root.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", fitStatus);
    fitStatus();
    pills[0]!.focus({ preventScroll: true });
  }
  function close(refocus: boolean) {
    if (!root.classList.contains("open")) return;
    root.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", fitStatus);
    scrim.hidden = true;
    status.replaceChildren();
    if (refocus) toggle.focus({ preventScroll: true });
    hideTimer = window.setTimeout(() => { row.hidden = true; }, closeMs());
  }

  toggle.onclick = () => (root.classList.contains("open") ? close(false) : open());
  // Esc على المستند: في Safari الضغط على زرّ لا يركّزه، فيبقى التركيز على body ولا يمرّ الحدث بالقائمة
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { document.removeEventListener("keydown", onKey); return; } // غادر الرئيسية
    const a = document.activeElement;
    if (e.key === "Escape" && (root.contains(a) || a === document.body || a === null)) { e.preventDefault(); close(true); }
  };
  // Tab بعد آخر حبّة (أو أي خروج للتركيز من الصفّ إلى غير الزرّ) يغلق القائمة، ولا حبس للتركيز
  row.addEventListener("focusout", (e) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (to && !row.contains(to) && to !== toggle) close(false);
  });

  // البطاقة ظاهرة: الزرّ مخفيّ، ويظهر بتلاشٍ بعد أن تُزال (install-card.ts يزيلها بعد حركة إغلاقها)
  if (installCard) {
    root.hidden = true;
    const watch = new MutationObserver(() => {
      if (installCard.isConnected) return;
      watch.disconnect();
      if (!root.isConnected) return;
      root.hidden = false;
      root.classList.add("dl-in");
    });
    queueMicrotask(() => {
      if (installCard.parentNode) watch.observe(installCard.parentNode, { childList: true });
      else root.hidden = false;
    });
  }
  return root;
}
