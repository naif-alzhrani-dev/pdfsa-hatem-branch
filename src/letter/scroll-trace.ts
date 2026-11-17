/**
 * تشخيص التمرير في «إعداد خطاب» و«تحرير الملف» (بلاغ نايف ٢٠٢٦/١١/١٧: «يظهر آخر صفحه ولا اقدر ارفع لاعلى صفحه»، تشخيص فهد
 * docs/logs/letter-scroll-diag-fahd.md، السجلّ docs/logs/letter-gap-scroll.md). يعمل مع `?debug=1` وحده، وبلاه لا يُلمس شيء.
 * يسجّل كل `scrollTo`/`scrollBy`/`scrollIntoView` ومصدره (`note()` من الكود، وإلا أول سطر من المكدّس)، وكل حدث scroll وpopstate،
 * بالتمرير بعده، في `window.__letterScrollTrace` (آخر 200)، وآخرها في سطر صغير أسفل الشاشة. بلا شبكة: يبقى في الصفحة.
 */
const MAX = 200;
export interface TraceEntry { t: number; kind: string; y: number; arg?: string; src?: string }

let on = false;
let label = "";
const log: TraceEntry[] = [];
let line: HTMLElement | null = null;
let t0 = 0;

export const scrollDebug = () => { try { return new URLSearchParams(location.search).get("debug") === "1"; } catch { return false; } };

/** حدثٌ من الكود بلا تمرير (دفع الحالة، والنزول، والإبقاء) ليُقرأ مع التمرير في السجلّ نفسه */
export function mark(kind: string, arg?: string) { if (on) push({ t: Math.round(performance.now() - t0), kind, y: scrollY, arg }); }

/** مصدر الاستدعاء التالي (`back-guard:keep` مثلاً)، فيُعرف في المكدّس المضغوط */
export function note(src: string) { if (on) label = src; }

function push(e: TraceEntry) {
  log.push(e);
  if (log.length > MAX) log.splice(0, log.length - MAX);
  if (line) line.textContent = `${e.kind} y=${Math.round(e.y)}${e.arg ? ` ${e.arg}` : ""}${e.src ? ` ← ${e.src}` : ""}`;
}

const caller = () => (new Error().stack ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(2, 3).join("").slice(0, 120);

export function installScrollTrace(host: HTMLElement = document.body) {
  if (on || !scrollDebug()) return;
  on = true;
  t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  (window as unknown as { __letterScrollTrace: TraceEntry[] }).__letterScrollTrace = log;
  const wrap = <K extends "scrollTo" | "scrollBy">(k: K) => {
    const orig = window[k].bind(window) as (...a: unknown[]) => void;
    (window as unknown as Record<K, (...a: unknown[]) => void>)[k] = (...a: unknown[]) => {
      const src = label || caller();
      label = "";
      orig(...a);
      push({ t: now(), kind: k, y: scrollY, arg: JSON.stringify(a).slice(0, 60), src });
    };
  };
  wrap("scrollTo");
  wrap("scrollBy");
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, ...a: Parameters<Element["scrollIntoView"]>) {
    const src = label || caller();
    label = "";
    siv.apply(this, a);
    push({ t: now(), kind: "scrollIntoView", y: scrollY, arg: (this as HTMLElement).className?.toString().slice(0, 30), src });
  };
  addEventListener("scroll", () => push({ t: now(), kind: "scroll", y: scrollY }), { passive: true });
  addEventListener("popstate", (e) => push({ t: now(), kind: "popstate", y: scrollY, arg: JSON.stringify(e.state) }));
  line = document.createElement("div");
  line.dataset.test = "lt-scroll-diag";
  line.setAttribute("aria-hidden", "true");
  line.style.cssText = "position:fixed;inset-inline:0;inset-block-end:0;z-index:2147483647;font:11px/1.3 monospace;direction:ltr;background:rgb(0 0 0/.7);color:#fff;padding:2px 6px;pointer-events:none;white-space:nowrap;overflow:hidden";
  host.append(line);
  push({ t: 0, kind: "start", y: scrollY });
}
