/**
 * ١٢) مقبض التمرير في «تحرير ملف» (docs/logs/additions-12-15-18-lama-spec.md §١٢، والنصوص من
 * docs/logs/additions-12-18-texts-huda.md). شريط تمرير سريع كعارضات PDF: مكانه على الحافّة موضعك في الملف،
 * وسحبه ينقل إلى أوله أو آخره، وسهماه صفحة صفحة.
 *
 * عنصر ثابت في جذر التطبيق خارج حاوية الصفحات، فلا تراه مستمعات القلم (main.ts: attachPen):
 * لا يبدأ خطّاً، ولا يُحسب إصبعاً ثانياً.
 */
import { h, icon } from "./dom";
import { ar, S, SH } from "./strings";

export const HANDLE_H = 112; // منطقة اللمس 48×112: سهم 44 ورقم 24 وسهم 44
export const TAP_PX = 10; // حركة أقلّ ضغطة، وما فوقها سحب للمقبض كله (كـTAP_PX في main.ts)
const HOLD_MS = 400, REPEAT_MS = 120; // كـholdRepeat في main.ts
const GAP = 12; // بُعد المسار عن الشريط العلوي و.dock
const IDLE_MS = 1200; // خارج القلم: يختفي بعد هذا من آخر تمرير أو ضغطة أو تركيز (ملحق docs/logs/int2-fixes-lama-spec.md)
const AIM_MS = 700; // ضغطات السهم المتتالية تُحسب من هدف التمرير السلس لا من موضعه الجاري

/** موضع المقبض في مساره: scrollY ÷ (ارتفاع المستند − ارتفاع النافذة) × (طول المسار − المقبض). */
export function thumbPos(scrollY: number, docH: number, viewH: number, track: number, hh = HANDLE_H): number {
  const room = track - hh, max = docH - viewH;
  if (room <= 0 || max <= 0) return 0;
  return Math.max(0, Math.min(room, (scrollY / max) * room));
}
/** العكس: التمرير الذي يضع المقبض في موضعه. */
export function scrollFor(pos: number, docH: number, viewH: number, track: number, hh = HANDLE_H): number {
  const room = track - hh, max = docH - viewH;
  if (room <= 0 || max <= 0) return 0;
  return Math.max(0, Math.min(max, (pos / room) * max));
}
/** يظهر متى كان طول المستند أكثر من 1.2 × ارتفاع النافذة. */
export const showFor = (docH: number, viewH: number) => docH > 1.2 * viewH;

/** آخر صفحة يبدأ أعلاها عند y أو قبله (الصفحات مرتّبة بأعلاها في القائمة والمصغّر)، بحث ثنائيّ. */
export function pageAt(n: number, top: (i: number) => number, y: number): number {
  let lo = 0, hi = n - 1, best = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (top(m) <= y) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return best;
}
/** أعلى الصفحة السابقة أو التالية (صفّاً في المصغّر) بإحداثيات المستند، أو null إن لم توجد. */
export function stepTop(n: number, top: (i: number) => number, cur: number, dir: -1 | 1): number | null {
  const t0 = top(cur);
  if (dir > 0) {
    for (let i = cur + 1; i < n; i++) if (top(i) > t0 + 1) return top(i);
    return null;
  }
  let j = cur;
  while (j > 0 && Math.abs(top(j - 1) - t0) <= 1) j--; // أول الصفّ الحالي
  return j > 0 ? top(j - 1) : null;
}

export interface HandleOpts {
  /** المساحة الظاهرة بإحداثيات النافذة: أسفل الشريط العلوي (والحبّة) وأعلى .dock. */
  band(): { top: number; bottom: number };
  /** ظاهر دائماً بلا تمرير (وضع القلم). وخارجه يظهر مع التمرير ويختفي بعد IDLE_MS. */
  always(): boolean;
  /** أوراق الصفحات بترتيبها. */
  pages(): HTMLElement[];
  /** خطّ قلم جارٍ: يُتجاهل المقبض. */
  busy(): boolean;
  reduced(): boolean;
  /** ما يتغيّر حجمه فيتغيّر المسار أو طول المستند. */
  watch: Element[];
}
export interface ScrollHandle {
  el: HTMLElement;
  dragging(): boolean;
  /** أثناء سحب عنصر موضوع: يختفي ولا يُلمس، ثم يعود. */
  mute(on: boolean): void;
  update(): void;
  destroy(): void;
}

/* يظهر مع اللمس وحده: (pointer: coarse)، أو أول pointerdown من نوع touch في الجلسة */
let touchSeen = false;
const live = new Set<() => void>();
let listening = false;
function listenTouch() {
  if (listening) return;
  listening = true;
  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || touchSeen) return;
    touchSeen = true;
    for (const f of live) f();
  }, { capture: true, passive: true });
}

export function createScrollHandle(o: HandleOpts): ScrollHandle {
  listenTouch();
  const coarse = matchMedia("(pointer: coarse)");
  const upBtn = h("button", { type: "button", class: "sh-arrow", "aria-label": SH.prev, "data-test": "sh-prev" }, icon("chevUp")) as HTMLButtonElement;
  const downBtn = h("button", { type: "button", class: "sh-arrow", "aria-label": SH.next, "data-test": "sh-next" }, icon("chevDown")) as HTMLButtonElement;
  const num = h("span", { class: "sh-num", "aria-hidden": "true", "data-test": "sh-num" });
  const bubble = h("span", { class: "sh-bubble", "aria-hidden": "true", "data-test": "sh-bubble" });
  const status = h("span", { class: "sr-only", role: "status", "data-test": "sh-status" });
  const el = h("div", { class: "scroll-handle", role: "group", "aria-label": SH.group, "data-test": "scroll-handle" }, upBtn, num, downBtn, bubble, status);

  const docH = () => document.documentElement.scrollHeight;
  const maxScroll = () => Math.max(0, docH() - innerHeight);
  const track = () => { const b = o.band(); return { top: b.top + GAP, len: b.bottom - GAP - (b.top + GAP) }; };
  const tops = () => { const ps = o.pages(), y = scrollY; return { n: ps.length, top: (i: number) => ps[i]!.getBoundingClientRect().top + y }; };
  let aim: { y: number; t: number } | null = null;
  const nowScroll = () => (aim && performance.now() - aim.t < AIM_MS ? aim.y : scrollY);
  /** رقم الصفحة (من ١) التي يقع عليها منتصف المساحة الظاهرة. */
  const pageNow = (sy = scrollY) => {
    const { n, top } = tops();
    if (!n) return { n: 0, total: 0 };
    const b = o.band();
    return { n: pageAt(n, top, sy + (b.top + b.bottom) / 2) + 1, total: n };
  };

  let drag: { id: number; y0: number; grab: number; moved: boolean; btn: HTMLButtonElement | null; t1: number; t2: number; repeated: boolean } | null = null;
  let pendingY = 0, frame = 0, bubbleTimer = 0;
  // يقظ: يظهر خارج القلم مع التمرير والسهمين والتركيز، ولا يختفي أثناء السحب ولا والتركيز داخله
  let awake = false, idle = 0, wasAlways = false;
  function sleep() {
    if (drag || el.contains(document.activeElement)) { idle = window.setTimeout(sleep, IDLE_MS); return; }
    awake = false;
    schedule();
  }
  function wake() {
    awake = true;
    clearTimeout(idle);
    idle = window.setTimeout(sleep, IDLE_MS);
    schedule();
  }
  const off = (b: HTMLButtonElement) => b.getAttribute("aria-disabled") === "true";

  function place(pos: number, t = track()) {
    el.style.transform = `translateY(${t.top + pos}px)`;
  }
  function update() {
    if (!el.isConnected) return;
    const always = o.always();
    if (wasAlways && !always) wake(); // الخروج من القلم: يبقى IDLE_MS ثم يختفي
    wasAlways = always;
    const show = (coarse.matches || touchSeen) && showFor(docH(), innerHeight) && (awake || always);
    el.classList.toggle("shown", show);
    if (!show) return;
    const t = track(), max = maxScroll();
    if (!drag?.moved) place(thumbPos(scrollY, docH(), innerHeight, t.len), t);
    upBtn.setAttribute("aria-disabled", String(scrollY <= 0.5));
    downBtn.setAttribute("aria-disabled", String(scrollY >= max - 0.5));
    const p = pageNow();
    num.textContent = p.total ? ar(p.n) : "";
    if (drag?.moved) bubble.textContent = S.page(p.n, p.total);
  }
  let queued = 0;
  const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; update(); }); };

  /** الضغطة إلى أعلى الصفحة السابقة/التالية، 12px تحت الشريط العلوي. وعند الحدّ إلى أول الملف أو آخره. */
  function step(btn: HTMLButtonElement): boolean {
    if (off(btn)) return false;
    const dir = btn === upBtn ? -1 : 1, sy = nowScroll(), b = o.band();
    const { n, top } = tops();
    if (!n) return false;
    const cur = pageAt(n, top, sy + (b.top + b.bottom) / 2);
    const t = stepTop(n, top, cur, dir);
    const max = maxScroll();
    const y = Math.max(0, Math.min(max, t === null ? (dir > 0 ? max : 0) : t - (b.top + GAP)));
    aim = { y, t: performance.now() };
    window.scrollTo({ top: y, behavior: o.reduced() ? "auto" : "smooth" });
    status.textContent = S.page(pageNow(y).n, n);
    return dir > 0 ? y < max - 0.5 : y > 0.5;
  }

  const clearTimers = () => { if (drag) { clearTimeout(drag.t1); clearInterval(drag.t2); } };
  function finish() {
    clearTimers();
    cancelAnimationFrame(frame);
    frame = 0;
    const moved = drag?.moved;
    drag = null;
    el.classList.remove("pressed", "dragging");
    wake();
    if (moved) {
      status.textContent = bubble.textContent ?? "";
      clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => el.classList.remove("bubble"), 600); // تخرج بعد 600ms من الإفلات
    }
    update();
  }

  el.addEventListener("pointerdown", (e) => {
    if (drag || o.busy() || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* حدث مصنوع */ }
    const btn = (e.target as Element).closest("button") as HTMLButtonElement | null;
    drag = { id: e.pointerId, y0: e.clientY, grab: e.clientY - el.getBoundingClientRect().top, moved: false, btn, t1: 0, t2: 0, repeated: false };
    el.classList.add("pressed"); // مضغوطة من أول لمسة
    if (btn && !off(btn)) {
      const d = drag;
      d.t1 = window.setTimeout(() => {
        if (drag !== d || d.moved) return;
        d.repeated = true;
        if (step(btn)) d.t2 = window.setInterval(() => { if (!step(btn)) clearInterval(d.t2); }, REPEAT_MS);
      }, HOLD_MS);
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.y0) < TAP_PX) return;
      drag.moved = true;
      aim = null;
      clearTimers();
      clearTimeout(bubbleTimer);
      el.classList.add("dragging", "bubble");
    }
    pendingY = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!drag?.moved) return;
      // يتبع الإصبع مع حفظ موضع الإمساك، ويقف حيث يُترك بلا التصاق
      const t = track(), pos = Math.max(0, Math.min(t.len - HANDLE_H, pendingY - drag.grab - t.top));
      place(pos, t);
      window.scrollTo(0, scrollFor(pos, docH(), innerHeight, t.len)); // مرة لكل إطار، بلا انتقال (لا scroll-behavior في style.css)
      update();
    });
  });
  el.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    if (!d.moved && !d.repeated && d.btn) step(d.btn);
    finish();
  });
  el.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.id) finish(); });
  // لوحة المفاتيح: Enter وSpace على السهم (الضغطة بالإصبع من pointerup أعلاه)
  for (const b of [upBtn, downBtn]) b.addEventListener("click", (e) => { if (e.detail === 0) step(b); });

  addEventListener("scroll", wake, { passive: true });
  el.addEventListener("focusin", wake);
  addEventListener("resize", schedule);
  coarse.addEventListener("change", schedule);
  const ro = new ResizeObserver(schedule);
  for (const w of o.watch) ro.observe(w);
  live.add(schedule);
  schedule();

  return {
    el,
    dragging: () => !!drag,
    mute: (on) => el.classList.toggle("muted", on),
    update: schedule,
    destroy() {
      if (drag) finish();
      clearTimeout(bubbleTimer);
      clearTimeout(idle);
      cancelAnimationFrame(queued);
      removeEventListener("scroll", wake);
      removeEventListener("resize", schedule);
      coarse.removeEventListener("change", schedule);
      ro.disconnect();
      live.delete(schedule);
      el.remove();
    },
  };
}
