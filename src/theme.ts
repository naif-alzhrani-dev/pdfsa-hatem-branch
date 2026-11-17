// المظهر بثلاث حالات (ملاحظة نايف ٣ في 1.0.2، قرار المدير، مواصفة لمى §٣، نصوص هدى): تلقائي (الافتراضي) ونهاري وليلي.
// التلقائي بساعة الجهاز: ليلي من 18:00 إلى 06:00، ويتبدّل والصفحة مفتوحة (مؤقّت إلى الحدّ التالي، وفحص عند visibilitychange).
// الاختيار يُحفظ على هذا الجهاز وحده (`pdfsa.theme`)، ويُطبَّق على كل الشاشات بـ:root[data-theme].
// public/theme-boot.js يطبّق الشيء نفسه قبل الرسم الأول، ويحرس تطابقهما tests/theme.test.ts.
import { h, icon } from "./dom";
import { ST } from "./strings";

export const THEME_KEY = "pdfsa.theme";
export const THEME_COLOR = { light: "#F8F8FB", dark: "#000E1F" } as const;
/** ساعتا الحدّ بوقت الجهاز: الليلي من NIGHT_FROM إلى DAY_FROM. */
export const DAY_FROM = 6, NIGHT_FROM = 18;
export type Mode = keyof typeof THEME_COLOR;
export type Pref = "auto" | Mode;
export const PREFS: readonly Pref[] = ["auto", "light", "dark"];

/** وضع الساعة: ليلي من 18:00 حتى قبل 06:00. */
export function clockMode(now: Date): Mode {
  const hr = now.getHours();
  return hr >= NIGHT_FROM || hr < DAY_FROM ? "dark" : "light";
}

/** الحدّ التالي (06:00 أو 18:00) بعد `now`، بوقت الجهاز. */
export function nextBoundary(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAY_FROM);
  if (d > now) return d;
  d.setHours(NIGHT_FROM);
  if (d > now) return d;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, DAY_FROM);
}

/** ما يُرسم للاختيار في هذه اللحظة. */
export const modeFor = (pref: Pref, now: Date): Mode => (pref === "auto" ? clockMode(now) : pref);

/** اسم الزرّ المسموع (هدى): «المظهر: تلقائي، ليلي الآن» وأخواتها. */
export function themeLabel(pref: Pref, now: Date): string {
  return pref === "auto" ? ST.labelAuto(clockMode(now)) : ST.label(pref);
}

let sessionPref: Pref | null = null; // التخزين ممنوع: يبقى الاختيار للجلسة الحالية
export function readPref(): Pref {
  if (sessionPref) return sessionPref;
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "auto" ? v : "auto";
  } catch { return "auto"; }
}

function apply(m: Mode) {
  document.documentElement.dataset.theme = m;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", THEME_COLOR[m]);
}

const listeners = new Set<() => void>();
let timer = 0;
/** يطبّق الاختيار الحالي الآن، ويضبط مؤقّت الحدّ التالي إن كان تلقائياً. */
function refresh() {
  clearTimeout(timer);
  const pref = readPref(), now = new Date();
  apply(modeFor(pref, now));
  if (pref === "auto") timer = window.setTimeout(refresh, Math.max(1000, nextBoundary(now).getTime() - now.getTime() + 500));
  for (const f of listeners) f();
}

export function setPref(p: Pref) {
  sessionPref = null;
  try { localStorage.setItem(THEME_KEY, p); } catch { sessionPref = p; }
  refresh();
}

if (typeof document !== "undefined") {
  refresh();
  // المؤقّت يتأخّر والصفحة في الخلفية أو الجهاز نائم: يُعاد الحساب حين تعود ظاهرة
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}

const ICONS: Record<Pref, "sunMoon" | "sun" | "moon"> = { auto: "sunMoon", light: "sun", dark: "moon" };
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const closeMs = () => (reduced() ? 120 : 160);

/**
 * زرّ المظهر وقائمته الصغيرة: أيقونة الزرّ الحال، والصفّ ثلاث حبّات راديو (تلقائي، نهاري، ليلي) بنمط `seg()`،
 * وتحتها سطر وصف التلقائي. Esc يغلق ويعيد التركيز، وTab خارج الصفّ يغلق، والضغط خارجها يغلق.
 * تحت 1024 الصفّ في مستوى الزرّ، وإن قلّت المسافة بينه وبين «تنزيل PDFsa» عن 8px نزل تحته (`th-below`).
 */
export function themeToggle(): HTMLElement {
  const btn = h("button", {
    class: "icon-btn theme-toggle", type: "button", "aria-expanded": "false", "aria-controls": "th-row", "data-test": "theme-toggle",
  }, ...PREFS.map((p) => h("span", { class: `tt tt-${p}` }, icon(ICONS[p])))) as HTMLButtonElement;

  const inputs: HTMLInputElement[] = [];
  const pills = PREFS.map((p) => {
    const input = h("input", { class: "sr-only", type: "radio", name: "th", value: p, "data-test": `th-${p}` }) as HTMLInputElement;
    input.addEventListener("change", () => { if (input.checked) setPref(p); });
    inputs.push(input);
    return h("label", { class: "th-pill" }, input, icon(ICONS[p]), h("span", {}, ST[p]));
  });
  const row = h("div", { id: "th-row", class: "th-row", role: "radiogroup", "aria-label": ST.group, hidden: true, "data-test": "th-row" }, ...pills);
  const pop = h("div", { class: "th-pop" }, row);
  const scrim = h("div", { class: "th-scrim", hidden: true, "data-test": "th-scrim", onclick: () => close(row.contains(document.activeElement)) });
  const root = h("div", { class: "th", "data-test": "th" }, btn, scrim, pop);

  const sync = () => {
    if (root.dataset.mounted && !root.isConnected) { listeners.delete(sync); return; } // غادر الرئيسية (تُبنى من جديد في كل زيارة)
    const pref = readPref();
    btn.dataset.pref = pref;
    btn.setAttribute("aria-label", themeLabel(pref, new Date()));
    for (const i of inputs) i.checked = i.value === pref;
  };
  sync();
  listeners.add(sync);

  /** حارس المسافة (مواصفة لمى §٣): الصفّ في مستوى الزرّ ما بقيت 8px بينه وبين زرّ «تنزيل PDFsa»، وإلا ينزل تحته. */
  const GAP = 8;
  function fit() {
    root.classList.remove("th-below");
    const dl = document.querySelector(".dl-toggle");
    const r = row.getBoundingClientRect();
    if (dl && dl.getClientRects().length) {
      const d = dl.getBoundingClientRect();
      const sameLevel = r.top < d.bottom && r.bottom > d.top;
      const gap = Math.max(d.left - r.right, r.left - d.right); // سالبة إن تداخلا
      if (sameLevel && gap < GAP - 0.01) root.classList.add("th-below");
    }
    // نقطة الانبثاق: مركز الزرّ لكل حبّة (transform-origin لا يتحرّك، فلا يكلّف إطاراً)
    const b = btn.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    for (const el of pills) {
      const p = el.getBoundingClientRect();
      el.style.transformOrigin = `${(bx - p.left).toFixed(1)}px ${(by - p.top).toFixed(1)}px`;
    }
  }

  let hideTimer = 0;
  function open() {
    clearTimeout(hideTimer);
    row.hidden = false;
    scrim.hidden = false;
    fit();
    void row.offsetWidth; // يثبّت البداية قبل الانتقال
    root.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", fit);
    (inputs.find((i) => i.checked) ?? inputs[0]!).focus({ preventScroll: true });
  }
  function close(refocus: boolean) {
    if (!root.classList.contains("open")) return;
    root.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", fit);
    scrim.hidden = true;
    if (refocus) btn.focus({ preventScroll: true });
    hideTimer = window.setTimeout(() => { row.hidden = true; }, closeMs());
  }
  btn.onclick = () => (root.classList.contains("open") ? close(false) : open());
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { document.removeEventListener("keydown", onKey); return; } // غادر الرئيسية
    const a = document.activeElement;
    if (e.key === "Escape" && (root.contains(a) || a === document.body || a === null)) { e.preventDefault(); close(true); }
  };
  row.addEventListener("focusout", (e) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (to && !row.contains(to) && to !== btn) close(false);
  });
  queueMicrotask(() => { root.dataset.mounted = "1"; });
  return root;
}
