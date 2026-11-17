/**
 * الترتيب بالسحب من عمود السهمين: يُستعمل في قائمة ملفات الدمج (محور عمودي) وفي شبكة الصفحات المصغّرة (المحوران).
 * ترتيب الـDOM لا يتغيّر أثناء السحب: العنصر المرفوع والجيران يتحرّكون بـtransform، والتثبيت عند الإفلات (`onDrop`).
 * الحساب (الخانة الهدف، والإزاحة، وسرعة التمرير) دوالّ نقية مختبرة في tests/drag-reorder.test.ts.
 */
export interface Pt { x: number; y: number }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** سرعة التمرير التلقائي (بكسل/ث) لبُعد الإصبع عن حافّة المساحة: `v = 60 + 660 × t²`، و`t = (zone − dist) / zone` محصورة في [0, 1]. */
export function autoScrollSpeed(dist: number, zone: number, reduced = false): number {
  if (dist >= zone) return 0;
  const t = clamp((zone - dist) / zone, 0, 1);
  const v = 60 + 660 * t * t;
  return reduced ? Math.min(v, 480) : v;
}

/** سرعة باتجاهها: سالبة إلى الأعلى، موجبة إلى الأسفل، وصفر خارج المنطقتين. */
export function autoScrollVelocity(y: number, top: number, bottom: number, zone: number, reduced = false): number {
  if (y < top + zone) return -autoScrollSpeed(y - top, zone, reduced);
  if (y > bottom - zone) return autoScrollSpeed(bottom - y, zone, reduced);
  return 0;
}

/** الخانة التي يقع فيها مركز العنصر المرفوع: أقرب مركز خانة. في شبكة منتظمة هذا هو «الخانة التي تحته» (الحدود في منتصف الفجوات). */
export function nearestSlot(centers: readonly Pt[], p: Pt): number {
  let best = 0, bestD = Infinity;
  centers.forEach((c, i) => {
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** خانة العنصر `i` (غير المرفوع) إن نُقل المرفوع من `from` إلى `to`: ما بينهما يتقدّم أو يتأخّر خانةً. */
export function displacedIndex(i: number, from: number, to: number): number {
  if (from < to && i > from && i <= to) return i - 1;
  if (to < from && i >= to && i < from) return i + 1;
  return i;
}

/** الموضع الذي يظهر رقمه على العنصر `i` أثناء السحب (من الصفر). */
export const liveIndex = (i: number, from: number, to: number) => (i === from ? to : displacedIndex(i, from, to));

/**
 * المركز المرفوع محصور بين أدنى مراكز الخانات وأعلاها على المحورين (`clampToSlots`، تعميماً لحصر y في المحور الواحد):
 * يُرجع الإزاحة `d` بعد الحصر لعنصرٍ مركزه الأصلي `c`.
 */
export function clampToSlotBox(centers: readonly Pt[], c: Pt, d: Pt): Pt {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of centers) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x: clamp(d.x, x0 - c.x, x1 - c.x), y: clamp(d.y, y0 - c.y, y1 - c.y) };
}

/**
 * معنى الإيماءة قبل الرفع. بلا `hold` (الافتراضي)، أو بالفأرة: الحركة فوق THRESHOLD سحبٌ، كما كان.
 * ومع `hold` للّمس والقلم: الحركة قبل انقضائه تمرير (يُلغى الضغط المعلّق)، والثبات حتى انقضائه رفع.
 */
export function pressIntent(hold: number, touch: boolean, moved: number, elapsed: number): "wait" | "drag" | "scroll" | "lift" {
  if (!(hold > 0 && touch)) return moved > THRESHOLD ? "drag" : "wait";
  if (moved > THRESHOLD) return "scroll";
  return elapsed >= hold ? "lift" : "wait";
}

export interface ReorderOptions {
  /** عمود السهمين: منه يبدأ السحب. */
  handle: HTMLElement;
  axis: "y" | "xy";
  /** العناصر بترتيبها الحالي (كل عنصر خانة). */
  elements: () => HTMLElement[];
  /** موضع العنصر المسحوب فيها. */
  index: () => number;
  canDrag: () => boolean;
  /** حدود المساحة الظاهرة (y على الشاشة) للتمرير التلقائي. */
  band: () => { top: number; bottom: number };
  zone: number;
  lift: number;
  onStart?: () => void;
  /** تغيّرت الخانة الهدف (والأرقام تتبدّل حيّةً). يُنادى بـ`from` عند الإلغاء. */
  onLive: (from: number, to: number) => void;
  /** بعد الاستقرار، والهدف غير الموضع الأصلي. */
  onDrop: (from: number, to: number) => void;
  /** في كل حال، بعد الإفلات أو الإلغاء (`cancelled`: Esc، أو pointercancel، أو فقدان التركيز). */
  onEnd?: (moved: boolean, cancelled: boolean) => void;
  /** الضغط المطوّل (ms) قبل الرفع، للّمس والقلم وحدهما (pressIntent). الافتراضي 0: الحركة ترفع كما كان. */
  hold?: number;
  /** في `xy`: المركز محصور بين مراكز الخانات (clampToSlotBox). الافتراضي لا حصر. */
  clampToSlots?: boolean;
  /** Esc أثناء السحب يلغيه. الافتراضي لا. */
  escCancel?: boolean;
}

export const THRESHOLD = 8;
const SETTLE_MS = 200;
const QUICK = "160ms cubic-bezier(.23, 1, .32, 1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** هل يجري سحبٌ الآن (في أي مكان)؟ لتعطيل ما يتعارض معه. */
export let dragging = false;
/** النقرة التي تلي السحب لا تُحسب نقرةَ سهم ولا لمسةً على الصفحة (مستمع واحد للصفحة كلها). */
let suppressClick = false;
if (typeof window !== "undefined") {
  window.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
  window.addEventListener("pointerdown", () => { if (!dragging) suppressClick = false; }, true); // إيماءة جديدة
}

/** إلغاء السحب الجاري (إن وُجد): عند ضياع النافذة للتركيز. */
let abortActive: (() => void) | null = null;
if (typeof window !== "undefined") window.addEventListener("blur", () => abortActive?.());

export function attachReorder(o: ReorderOptions): void {
  const h = o.handle;
  let pid: number | null = null;
  let sx = 0, sy = 0, px = 0, py = 0;
  let started = false;
  let els: HTMLElement[] = [], centers: Pt[] = [], cur: number[] = [];
  let from = 0, to = 0, scroll0 = 0, raf = 0, last = 0;
  let touch = false, t0 = 0, timer = 0;
  const hold = o.hold ?? 0;
  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(true); } };

  h.addEventListener("pointerdown", (e) => {
    if (pid !== null || dragging || e.button > 0) return; // الإصبع الثاني يُتجاهل
    pid = e.pointerId;
    sx = px = e.clientX; sy = py = e.clientY;
    started = false; suppressClick = false;
    touch = e.pointerType !== "mouse"; t0 = performance.now();
    if (hold > 0 && touch) timer = window.setTimeout(() => { if (pid !== null && !started && o.canDrag()) begin(); }, hold);
  });
  h.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    px = e.clientX; py = e.clientY;
    if (started) return;
    const moved = o.axis === "y" ? Math.abs(py - sy) : Math.hypot(px - sx, py - sy);
    const it = pressIntent(hold, touch, moved, performance.now() - t0);
    if (it === "scroll") { clearTimeout(timer); pid = null; } // تمرير: يُترك للمتصفّح
    else if (it !== "wait" && o.canDrag()) begin();
  });
  if (hold > 0) {
    // بعد الرفع وحده: الإصبع يسحب الأداة لا الصفحة. وقائمة الضغط المطوّل لا تظهر ما دام الضغط معلّقاً أو الأداة مرفوعة
    h.addEventListener("touchmove", (e) => { if (started && e.cancelable) e.preventDefault(); }, { passive: false });
    h.addEventListener("contextmenu", (e) => { if (pid !== null || started) e.preventDefault(); });
  }
  const finish = (e: PointerEvent, cancel: boolean) => {
    if (e.pointerId !== pid) return;
    stop(cancel);
  };
  const stop = (cancel: boolean) => {
    pid = null;
    clearTimeout(timer);
    if (!started) return;
    abortActive = null;
    document.removeEventListener("keydown", onEsc, true);
    end(cancel);
    // إن لم تأتِ نقرة بعد السحب (اللمس) فلا تُبتلع نقرة لاحقة. وعند الإلغاء قد يبقى الإصبع على السهم (فقدان التركيز)
    // فتأتي نقرة الرفع على السهم نفسه وتنقل الصفحة: تُبتلع هي أيضاً، ويمحو الابتلاعَ أولُ ضغطة تالية
    if (!cancel) setTimeout(() => (suppressClick = false));
  };
  h.addEventListener("pointerup", (e) => finish(e, false));
  h.addEventListener("pointercancel", (e) => finish(e, true));
  // فُقد الالتقاط بلا pointerup ولا pointercancel. الحدث يفور من الهدف الضمنيّ القديم عند نقل الالتقاط إلى المقبض، فلا يُحسب إلا ما كان على المقبض نفسه
  h.addEventListener("lostpointercapture", (e) => { if (e.target === h) finish(e, true); });

  function begin() {
    started = true; dragging = true; suppressClick = true;
    abortActive = () => stop(true);
    clearTimeout(timer);
    if (o.escCancel) document.addEventListener("keydown", onEsc, true);
    try { h.setPointerCapture(pid!); } catch { /* مؤشّر غير فعّال */ }
    const a = document.activeElement as HTMLElement | null;
    if (a && a.tagName === "INPUT") a.blur(); // تُغلق لوحة المفاتيح
    o.onStart?.();
    els = o.elements();
    from = to = o.index();
    cur = els.map((_, i) => i);
    centers = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY };
    });
    scroll0 = window.scrollY;
    const el = els[from]!;
    el.classList.add("lifted");
    // الإزاحة تتبع الإصبع بلا انتقال. وخاصية scale المستقلّة (إن رسمها CSS على .lifted) تنتقل: لا أثر لها عند من لا يرسمها
    el.style.transition = `scale ${QUICK}`;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function offset(): Pt {
    let dx = o.axis === "xy" ? px - sx : 0;
    let dy = py - sy + window.scrollY - scroll0;
    const c = centers[from]!;
    if (o.axis === "y") dy = clamp(dy, centers[0]!.y - c.y, centers[centers.length - 1]!.y - c.y); // بين أول القائمة وآخرها
    else if (o.clampToSlots) return clampToSlotBox(centers, c, { x: dx, y: dy });
    return { x: dx, y: dy };
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const b = o.band();
    const v = autoScrollVelocity(py, b.top, b.bottom, o.zone, reduced());
    if (v) window.scrollBy(0, v * dt);
    const d = offset();
    const lift = reduced() ? 1 : o.lift;
    // خاصية scale المستقلّة (إن رسمها CSS) تُطبَّق بعد transform فتكبّر الإزاحة نفسها: تُقسم عليها ليبقى المركز تحت الإصبع.
    // وعند من لا يرسمها قيمتها "none" فالقسمة على 1
    const k = parseFloat(getComputedStyle(els[from]!).scale) || 1;
    els[from]!.style.transform = `translate(${d.x / k}px, ${d.y / k}px) scale(${lift})`;
    const c = centers[from]!;
    const t = nearestSlot(centers, { x: c.x + d.x, y: c.y + d.y });
    if (t !== to) { to = t; shift(); o.onLive(from, to); }
    raf = requestAnimationFrame(frame);
  }

  /** الجيران بين الموضعين يتقدّمون أو يتأخّرون خانة. عبور طرف الصفّ في الشبكة: تلاشٍ ثم ظهور في الخانة الجديدة، لا عبوراً قطرياً. */
  function shift() {
    const r = reduced();
    els.forEach((el, i) => {
      if (i === from) return;
      const ni = displacedIndex(i, from, to);
      if (ni === cur[i]) return;
      const prev = el.style.transform;
      const next = `translate(${centers[ni]!.x - centers[i]!.x}px, ${centers[ni]!.y - centers[i]!.y}px)`;
      const rowChange = o.axis === "xy" && centers[ni]!.y !== centers[cur[i]!]!.y;
      cur[i] = ni;
      if (r || rowChange) {
        el.style.transition = "none";
        el.style.transform = next;
        const ms = r ? 150 : 160;
        el.animate(
          r ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 1, transform: prev || "none" }, { opacity: 0, transform: prev || "none", offset: 0.5 }, { opacity: 0, transform: next, offset: 0.5 }, { opacity: 1, transform: next }],
          { duration: ms, easing: "ease-out" });
      } else {
        el.style.transition = `transform ${QUICK}`;
        el.style.transform = next;
      }
    });
  }

  function end(cancel: boolean) {
    cancelAnimationFrame(raf);
    // الخانة من موضع المؤشّر الأخير لا من آخر إطار: إن جاء الرفع قبل أن يُرسم إطارٌ (WebKit بإطارات متباعدة) لم يتغيّر `to` بعد
    if (!cancel) {
      const d = offset(), c = centers[from]!;
      const t = nearestSlot(centers, { x: c.x + d.x, y: c.y + d.y });
      if (t !== to) { to = t; shift(); o.onLive(from, to); }
    }
    if (cancel && to !== from) { to = from; shift(); }
    const target = cancel ? from : to;
    const el = els[from]!;
    el.classList.remove("lifted");
    const r = reduced();
    el.style.transition = r ? "none" : `transform ${SETTLE_MS}ms cubic-bezier(.23, 1, .32, 1), scale ${QUICK}`;
    el.style.transform = `translate(${centers[target]!.x - centers[from]!.x}px, ${centers[target]!.y - centers[from]!.y}px)`;
    const done = () => {
      for (const e of els) { e.style.transition = ""; e.style.transform = ""; }
      dragging = false;
      started = false;
      const moved = target !== from;
      if (moved) o.onDrop(from, target);
      else o.onLive(from, from);
      o.onEnd?.(moved, cancel);
    };
    if (r) done(); else setTimeout(done, SETTLE_MS);
  }
}
