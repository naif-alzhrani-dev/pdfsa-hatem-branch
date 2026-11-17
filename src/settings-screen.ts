/**
 * شاشة «الإعدادات» (الإضافة ٢١، docs/logs/settings-21-lama-spec.md، النصوص SG من settings-21-texts-huda.md).
 * صفحة لا ورقة، بشريط صفحات الأدوات («رجوع إلى الرئيسية»، والرجوع بالسحب من src/nav.ts لأنها ليست الأساس).
 * المعاينة قسم «أدوات الرئيسية» نفسه: «توقيع ملف» ثابت بلا زرّ (قرار نايف «نعم يبقى ثابتا»)، والبلاطات الأربع أزرار.
 * التبادل بلمستين: أداة من الرئيسية ثم أداة من «أدوات أخرى». يُحفظ فور اللمسة الثانية، والحركة ظلّ فوقها.
 * وقسم دائرة الإفلات لبرنامج ويندوز وحده: يملؤه البرنامج لاحقاً بـ`ring` (لا يُعرض في الموقع).
 * والترتيب داخل كل قسم (docs/logs/settings-21-reorder-lama-spec.md): السحب بالفأرة، والضغط المطوّل ثم السحب باللمس
 * (المحرّك src/drag-reorder.ts)، وشريط «قدّم/أخّر» والأسهم للأداة النشطة. لا عبور بين القسمين.
 * «النشطة»: في الرئيسية المحدَّدة للتبادل، وفي «أدوات أخرى» الملموسة في السكون. واحدة في الشاشة كلها.
 */
import { S, SF, SG } from "./strings";
import { h, icon } from "./dom";
import { toolName, toolNameText } from "./tool-name";
import { loadLayout, moveWithin, saveLayout, sameLayout, swapTools, type Layout } from "./home-layout";
import { attachReorder, dragging } from "./drag-reorder";

export interface SettingsTool { label: string; art: () => Element }

export interface SettingsHost {
  app: HTMLElement;
  /** منطقة aria-live=polite الواحدة في التطبيق. */
  announce: (msg: string) => void;
  /** «رجوع إلى الرئيسية». */
  exit: () => void;
  footer: (from: string) => Node[];
  /** اسم الأداة المعروض وأيقونتها، كما في بلاطات الرئيسية. */
  tool: (slug: string) => SettingsTool;
  defaults: Layout;
  /** قسم «أدوات دائرة الإفلات» (h2 ‏SG.ringTools): لبرنامج ويندوز وحده، يُلحق آخر الصفحة. وغيابه = لا قسم (الموقع). */
  ring?: () => HTMLElement | null;
}

type Part = "home" | "more";
/** الأداة النشطة: قسمها وموضعها، وموضعها وترتيب قسمها حين نشطت (Esc يعيدهما). */
interface Active { part: Part; i: number; origin: number; before: readonly string[] }

const FLY_MS = 260; // الطيران، والظلّ يتلاشى في آخر 60 منه (200→260)
const FADE_AT = 200 / FLY_MS;
const SEL_OUT_MS = 200; // اختفاء التحديد عن الخانة بعد الطيران
const FLY_EASE = "cubic-bezier(.77,0,.175,1)";
const QUICK_EASE = "cubic-bezier(.23, 1, .32, 1)";

/**
 * تلميح السحب (docs/logs/settings-sort-hint-lama-spec.md): الخانتان ١ و٢ تتبادلان ثم تعودان، في كل فتح حتى أول رفع،
 * وثلاث مرات على الأكثر. القيم "1" و"2" و"3" (مرّات الظهور) أو "done". وعلامة الجلسة تمنع التكرار فيها، ولو حُجب التخزين.
 */
const HINT_KEY = "pdfsa.sortHint";
let hintThisSession = false;
const readHint = () => { try { return localStorage.getItem(HINT_KEY); } catch { return null; } };
const writeHint = (v: string) => { try { localStorage.setItem(HINT_KEY, v); } catch { /* تخزين محجوب: علامة الجلسة وحدها */ } };
/** رفعٌ أو نقلٌ بالشريط أو الأسهم: لا تلميح بعده. واللمسة القصيرة (التبادل) لا تُحتسب. */
const hintDone = () => { hintThisSession = true; writeHint("done"); };

export function showSettings(host: SettingsHost) {
  let layout = loadLayout(host.defaults);
  let act: Active | null = null;
  let flights: Animation[] = [];
  let hold: { timer: number; done: () => void } | null = null;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const name = (slug: string) => toolNameText(host.tool(slug).label);

  const fill = (tile: HTMLButtonElement, slug: string) => {
    const t = host.tool(slug);
    tile.dataset.slug = slug;
    tile.replaceChildren(t.art(), h("span", {}, toolName(t.label)));
  };

  const alert = h("p", { class: "alert set-alert", role: "alert", hidden: true, "data-test": "settings-alert" }, SG.saveFailed);
  const sortable = { "aria-roledescription": SG.sortRole, "aria-description": SG.sortDesc };
  const slots = layout.home.map((_, i) => {
    const b = h("button", { class: "home-tile sp-tile", type: "button", "aria-pressed": "false", "data-test": "set-slot", ...sortable, onclick: () => slotTap(i) }) as HTMLButtonElement;
    return b;
  });
  const picks = layout.more.map((_, j) => {
    const b = h("button", { class: "home-tile", type: "button", "aria-pressed": "false", "data-test": "set-pick", ...sortable, onclick: (e: Event) => pickTap(j, e as MouseEvent) }) as HTMLButtonElement;
    return b;
  });
  const tiles = (p: Part) => (p === "home" ? slots : picks);
  const restore = h("button", { class: "text-btn set-restore", type: "button", "data-test": "set-restore", "aria-describedby": "set-restore-hint", onclick: () => restoreTap() }, SG.restore) as HTMLButtonElement;
  const grid = h("div", { class: "home-row tools-grid set-more", "data-test": "set-more" }, ...picks);
  const layer = h("div", { class: "swap-layer", "aria-hidden": "true" });

  /** شريط «قدّم/أخّر» للقسم: يظهر حين تنشط فيه أداة. «قدّم» في البداية (يمين)، والسهمان مُداران (style.css). */
  const bar = (p: Part) => {
    const btn = (dir: -1 | 1) => h("button", { class: "icon-btn ob-btn", type: "button", "data-test": dir < 0 ? "ob-before" : "ob-after", onclick: () => barMove(p, dir) }, icon(dir < 0 ? "up" : "down"));
    return h("div", { class: "order-bar", hidden: true, "data-test": `order-bar-${p}` }, btn(-1), h("span", { class: "ob-name", "data-test": "ob-name" }), btn(1));
  };
  const bars: Record<Part, HTMLElement> = { home: bar("home"), more: bar("more") };

  const preview = h("div", { class: "set-preview", role: "group", "aria-label": SG.preview, "data-test": "set-preview" },
    h("div", { class: "sp-sign" }, S.signFile), // ثابت: يُرسم بلا زرّ ولا مرور
    h("div", { class: "home-row sp-row" }, ...slots),
    h("div", { class: "sp-more" }, SF.moreTools));
  const ringSec = host.ring?.() ?? null; // فتحة قسم الدائرة: البرنامج وحده
  const topbar = h("header", { class: "topbar" },
    h("button", { class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back", onclick: () => host.exit() }, icon("back")),
    h("h1", { class: "route-title" }, SG.title),
    h("span", { class: "icon-spacer" }));

  const main = h("main", { class: "start settings", "data-test": "settings" },
    h("div", { class: "set-side" },
      h("div", { class: "set-leads" },
        h("p", { class: "set-lead" }, SG.lead),
        // السطر الثاني: يُختار بالـCSS (فأرة أم لمس)، والنصّان في الصفحة
        h("p", { class: "set-lead lead-touch", "data-test": "lead-touch" }, SG.leadSortTouch),
        h("p", { class: "set-lead lead-mouse", "data-test": "lead-mouse" }, SG.leadSortMouse)),
      alert,
      h("section", { class: "set-sec set-home", "aria-labelledby": "set-home-h" },
        h("h2", { id: "set-home-h" }, SG.homeTools), preview, bars.home),
      h("div", { class: "set-restore-wrap" }, restore, h("p", { class: "set-hint", id: "set-restore-hint" }, SG.restoreHint))),
    h("div", { class: "set-main" },
      h("section", { class: "set-sec", "aria-labelledby": "set-more-h" },
        h("h2", { id: "set-more-h" }, SF.moreTools), grid, bars.more),
      ringSec,
      ...host.footer("settings")),
    layer);

  render();
  host.app.replaceChildren(topbar, main);
  window.scrollTo(0, 0);

  // Esc يلغي التحديد (ويعيد ما نُقل منذ النشاط). ويُنزع المستمع حين تُغادر الشاشة. وأثناء السحب يلغيه المحرّك (escCancel)
  const onKey = (e: KeyboardEvent) => {
    if (!main.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "Escape" && act && !dragging) { e.preventDefault(); end("cancel"); }
  };
  document.addEventListener("keydown", onKey);

  for (const p of ["home", "more"] as const) tiles(p).forEach((t, k) => {
    t.addEventListener("keydown", (e) => arrowKey(p, k, e));
    attachReorder({
      handle: t, axis: "xy", clampToSlots: true, hold: 400, escCancel: true, lift: 1, // الحجم 1.04 من CSS بخاصية scale
      elements: () => tiles(p),
      index: () => k,
      canDrag: () => true,
      // «أدوات أخرى» تمرّر الصفحة قرب حافّتيها، والمعاينة لا (zone 0)
      band: () => (p === "more" ? { top: topbar.getBoundingClientRect().bottom, bottom: innerHeight } : { top: -Infinity, bottom: Infinity }),
      zone: p === "more" ? 96 : 0,
      onStart: () => {
        hintDone();
        settle();
        end("silent"); // حلقة التحديد وتسليح «أدوات أخرى» يزولان قبل الرفع، ولو كانت المسحوبة من القسم الآخر
        document.documentElement.classList.add("tile-dragging");
        navigator.vibrate?.(10);
        host.announce(SG.liftedPointer(name(layout[p][k]!)));
      },
      onLive: () => {},
      onDrop: (from, to) => {
        const x = layout[p][from]!;
        commit(moveWithin(layout, p, from, to));
        if (document.activeElement === t) tiles(p)[to]!.focus(); // التركيز يتبع الأداة
        host.announce(SG.dropped(name(x), to + 1, layout[p].length));
      },
      onEnd: (_moved, cancelled) => {
        document.documentElement.classList.remove("tile-dragging");
        if (cancelled) host.announce(SG.cancelled(name(layout[p][k]!), k + 1, layout[p].length));
      },
    });
  });

  sortHint();

  /**
   * التلميح: بعد 700ms وتحميل الخطوط، والمعاينة ظاهرة ≥ 60%، ولا نشطة ولا سحب. لا يغيّر DOM ولا الترتيب، ولا يُعلن ولا يحرّك التركيز.
   * أي لمسة أو عجلة أو مفتاح أو تمرير أو إخفاء أو مغادرة يقطعه فوراً، ولا تُبتلع (مستمعات passive). ويُحتسب الظهور عند بدء النقل.
   */
  function sortHint() {
    const v = readHint();
    if (hintThisSession || v === "3" || v === "done") return;
    let phase: "wait" | "run" | "off" = "wait";
    let ready = false, visible = false;
    let anims: Animation[] = [];
    const timers: number[] = [];
    const [A, B] = [slots[0]!, slots[1]!];
    const y0 = window.scrollY;
    const io = new IntersectionObserver(([e]) => { visible = !!e && e.intersectionRatio >= 0.6; tryStart(); }, { threshold: [0, 0.6, 1] });
    io.observe(preview);
    const onEv = (e: Event) => {
      if (e.type === "scroll" && Math.abs(window.scrollY - y0) < 1) return; // scrollTo(0,0) عند الفتح ليس تمريراً
      if (e.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      stop(true);
    };
    const CAP = { capture: true, passive: true } as const;
    const DOC = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    for (const t of DOC) document.addEventListener(t, onEv, CAP);
    window.addEventListener("scroll", onEv, { passive: true });
    document.addEventListener("visibilitychange", onEv);
    const at = (ms: number, f: () => void) => {
      timers.push(window.setTimeout(() => { if (!main.isConnected) stop(false); else if (phase !== "off") f(); }, ms));
    };
    at(700, () => void document.fonts.ready.then(() => { ready = true; tryStart(); }));

    function tryStart() {
      if (phase !== "wait" || !ready || !visible) return;
      if (!main.isConnected || act !== null || dragging) { stop(false); return; }
      phase = "run";
      hintThisSession = true;
      const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
      const dx = rb.left + rb.width / 2 - (ra.left + ra.width / 2), dy = rb.top + rb.height / 2 - (ra.top + ra.height / 2);
      const same = Math.abs(dy) < 1; // في صفّ واحد: انتقال، وإلا تلاشٍ متقاطع 160 كـshift() في drag-reorder.ts
      const T = (x: number, y: number) => `translate(${x}px, ${y}px)`;
      const count = () => { const c = readHint(); writeHint(c === "1" ? "2" : c === "2" ? "3" : "1"); };
      A.classList.add("hint-lift");
      if (reduced()) {
        // بلا حجم ولا انتقال: الظلّ بالشفافية 150، ثم تلاشٍ 150 وظهورٌ في خانة الأخرى 150، وثبات 300، ثم العكس
        const N = 1200;
        const kf = (t: string): Keyframe[] => [
          { offset: 0, opacity: 1, transform: "none" }, { offset: 150 / N, opacity: 1, transform: "none" },
          { offset: 300 / N, opacity: 0, transform: "none" }, { offset: 300 / N, opacity: 0, transform: t },
          { offset: 450 / N, opacity: 1, transform: t }, { offset: 750 / N, opacity: 1, transform: t },
          { offset: 900 / N, opacity: 0, transform: t }, { offset: 900 / N, opacity: 0, transform: "none" },
          { offset: 1050 / N, opacity: 1, transform: "none" }, { offset: 1, opacity: 1, transform: "none" }];
        anims = [A.animate(kf(T(dx, dy)), { duration: N, easing: "linear" }), B.animate(kf(T(-dx, -dy)), { duration: N, easing: "linear" })];
        at(150, count);
        at(1050, () => A.classList.remove("hint-lift"));
        at(N + 150, () => stop(false));
        return;
      }
      // 0–360 الرفع والثبات (CSS). ومن 360 النقل: الإزاحة تُقسم على حجم A (scale المستقلّة تُطبَّق قبلها فتكبّرها)
      at(360, () => {
        count();
        const k = parseFloat(getComputedStyle(A).scale) || 1;
        const N = 1020; // 360 → 1380
        const track = (to: string, go: number, back: number, ms: number, ease: string): Keyframe[] => {
          const o = (t: number) => t / N;
          if (same) return [
            { offset: 0, transform: "none" }, { offset: o(go), transform: "none", easing: ease }, { offset: o(go + ms), transform: to },
            { offset: o(back), transform: to, easing: ease }, { offset: o(back + ms), transform: "none" }, { offset: 1, transform: "none" }];
          const fade = (t: number, a: string, b: string): Keyframe[] => [
            { offset: o(t), opacity: 1, transform: a, easing: "ease-out" }, { offset: o(t + 80), opacity: 0, transform: a },
            { offset: o(t + 80), opacity: 0, transform: b, easing: "ease-out" }, { offset: o(t + 160), opacity: 1, transform: b }];
          return [{ offset: 0, opacity: 1, transform: "none" }, ...fade(go, "none", to), ...fade(back, to, "none"), { offset: 1, opacity: 1, transform: "none" }];
        };
        anims = [
          A.animate(track(T(dx / k, dy / k), 0, 580, 280, FLY_EASE), { duration: N }), // 360 ذهاب، 940 عودة
          B.animate(track(T(-dx, -dy), 140, 720, 160, QUICK_EASE), { duration: N }), // 500 ذهاب، 1080 عودة
        ];
      });
      at(1220, () => A.classList.remove("hint-lift"));
      at(1380, () => stop(false));
    }

    /** cut: قطعٌ في منتصفه، فكل أداة تعود من حيث هي في 120ms. */
    function stop(cut: boolean) {
      if (phase === "off") return;
      const was = phase;
      phase = "off";
      for (const t of timers) clearTimeout(t);
      io.disconnect();
      for (const t of DOC) document.removeEventListener(t, onEv, CAP);
      window.removeEventListener("scroll", onEv);
      document.removeEventListener("visibilitychange", onEv);
      if (was !== "run") return;
      A.classList.remove("hint-lift");
      for (const a of anims) {
        const el = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
        const m = cut && el ? getComputedStyle(el).transform : "none";
        a.cancel();
        if (el && m !== "none" && !reduced()) el.animate([{ transform: m }, { transform: "none" }], { duration: 120, easing: QUICK_EASE });
      }
      anims = [];
    }
  }

  function render() {
    layout.home.forEach((s, i) => fill(slots[i]!, s));
    layout.more.forEach((s, j) => fill(picks[j]!, s));
    restore.disabled = sameLayout(layout, host.defaults);
    paint();
  }

  /** يثبّت الترتيب ويحفظه ويرسمه. */
  function commit(next: Layout) {
    layout = next;
    if (!saveLayout(layout, host.defaults)) alert.hidden = false; // يبقى حتى الخروج
    render();
  }

  /** حالة الأزرار والشريطين من `act`: aria-pressed للنشطة، واسمها، والطرفان معطّلان. */
  function paint() {
    slots.forEach((b, i) => b.setAttribute("aria-pressed", String(act?.part === "home" && act.i === i)));
    picks.forEach((b, j) => b.setAttribute("aria-pressed", String(act?.part === "more" && act.i === j)));
    for (const p of ["home", "more"] as const) {
      const el = bars[p];
      if (act?.part !== p) { el.hidden = true; continue; }
      const i = act.i, n = layout[p].length, x = name(layout[p][i]!);
      const bef = el.querySelector<HTMLElement>('[data-test="ob-before"]')!, aft = el.querySelector<HTMLElement>('[data-test="ob-after"]')!;
      for (const [b, label, off] of [[bef, SG.moveBefore(x), i === 0], [aft, SG.moveAfter(x), i === n - 1]] as const) {
        b.setAttribute("aria-label", label);
        b.title = label;
        if (off) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
      }
      el.querySelector('[data-test="ob-name"]')!.textContent = x;
      if (el.hidden) {
        el.hidden = false;
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 150 : 160, easing: "ease-out" });
      }
    }
  }

  /** «أدوات أخرى» مسلّحة للتبادل (الحلقة المتقطّعة) ما دامت أداة من الرئيسية محدَّدة. */
  function arm(on: boolean) {
    grid.classList.toggle("armed", on);
  }

  /** تنشيط أداة في قسمها، ويسقط نشاط ما سواها. */
  function activate(p: Part, i: number) {
    act = { part: p, i, origin: i, before: layout[p] };
    arm(p === "home");
    if (p === "home") slots[i]!.style.removeProperty("--sel-out"); // مدّة الاختفاء بعد تبادل سابق
    paint();
  }

  /**
   * إنهاء النشاط. drop: يبقى ما نُقل («أُفلتت» إن نُقل، وإلا «أُلغي تحديد»). cancel: يعود القسم إلى ترتيبه حين نشطت.
   * silent: بلا إعلان ولا إعادة (عند بدء السحب، و«استعادة الأصل»).
   */
  function end(how: "drop" | "cancel" | "silent") {
    const a = act;
    if (!a) return;
    act = null;
    arm(false);
    const moved = layout[a.part].some((s, k) => s !== a.before[k]);
    if (how === "cancel" && moved) {
      const x = layout[a.part][a.i]!;
      const before = rects(a.part);
      commit(a.part === "home" ? { home: a.before, more: layout.more } : { home: layout.home, more: a.before });
      flip(a.part, before);
      tiles(a.part)[a.origin]!.focus();
      host.announce(SG.cancelled(name(x), a.origin + 1, layout[a.part].length));
      return;
    }
    paint();
    if (how === "silent") return;
    const x = name(layout[a.part][a.i]!);
    host.announce(moved && how === "drop" ? SG.dropped(x, a.i + 1, layout[a.part].length) : SG.unpicked(x));
  }

  /** نقل الأداة النشطة إلى `to` في قسمها: يُحفظ فوراً، والحركة FLIP، والإعلان «نُقلت». خارج الحدود: لا شيء ولا إعلان. */
  function moveTo(to: number): boolean {
    const a = act;
    if (!a || to < 0 || to >= layout[a.part].length || to === a.i) return false;
    settle();
    hintDone(); // moveTo لا يناديها إلا barMove وarrowKey
    const from = a.i, x = layout[a.part][from]!;
    const before = rects(a.part);
    a.i = to;
    commit(moveWithin(layout, a.part, from, to));
    flip(a.part, before);
    host.announce(SG.moved(name(x), to + 1, layout[a.part].length));
    return true;
  }

  /** الأسهم على الأداة النشطة: ↑↓ صفّاً، و→ خطوة إلى البداية و← إلى النهاية (المرئي في RTL). لا التفاف. */
  function arrowKey(p: Part, k: number, e: KeyboardEvent) {
    if (act?.part !== p || act.i !== k || dragging) return;
    const list = tiles(p);
    const cols = Math.max(1, list.filter((b) => b.offsetTop === list[0]!.offsetTop).length);
    const step = ({ ArrowUp: -cols, ArrowDown: cols, ArrowRight: -1, ArrowLeft: 1 } as Record<string, number>)[e.key];
    if (step === undefined) return;
    e.preventDefault();
    if (moveTo(k + step)) list[k + step]!.focus(); // التركيز يتبع الأداة، ومعه aria-pressed
  }

  function barMove(p: Part, dir: -1 | 1) {
    if (act?.part !== p) return;
    if (!moveTo(act.i + dir)) return;
    // صار الزرّ المركَّز معطّلاً (طرف): التركيز إلى أخيه
    const f = document.activeElement as HTMLElement | null;
    if (f && bars[p].contains(f) && f.getAttribute("aria-disabled") === "true") {
      bars[p].querySelector<HTMLElement>(`[data-test="${f.dataset.test === "ob-before" ? "ob-after" : "ob-before"}"]`)!.focus();
    }
  }

  function rects(p: Part) {
    return new Map(tiles(p).map((t) => [t.dataset.slug!, t.getBoundingClientRect()] as const));
  }

  /** FLIP بعد النقل بالزرّ أو السهم أو الإلغاء: في الصفّ نفسه translate، وعبور الصفّ تلاشٍ. ومع تقليل الحركة تلاشٍ 150. */
  function flip(p: Part, before: Map<string, DOMRect>) {
    const r = reduced();
    for (const t of tiles(p)) {
      const b = before.get(t.dataset.slug!), a = t.getBoundingClientRect();
      if (!b) continue;
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      flights.push(r || Math.abs(dy) >= 1
        ? t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: r ? 150 : 160, easing: "ease-out" })
        : t.animate([{ transform: `translate(${dx}px, 0)` }, { transform: "none" }], { duration: 160, easing: QUICK_EASE }));
    }
  }

  /** المقاطعة: الظلال والحركات تنتهي، والتحديد المؤجَّل يُزال، ثم تُعالج اللمسة. */
  function settle() {
    for (const a of flights) a.finish();
    flights = [];
    if (hold) { clearTimeout(hold.timer); hold.done(); hold = null; }
  }

  function slotTap(i: number) {
    settle();
    if (act?.part === "home" && act.i === i) { end("drop"); return; }
    activate("home", i); // لا شيء محدَّد، أو نقل التحديد بلمسة، أو من «أدوات أخرى» إلى الرئيسية
    host.announce(SG.picked(name(layout.home[i]!)));
  }

  function pickTap(j: number, e: MouseEvent) {
    settle();
    if (act?.part !== "home") {
      // بلا أداة محدَّدة من الرئيسية: تنشيط للترتيب (قرار المدير، المواصفة §٤). ولمس النشطة نفسها ينهيه
      if (act?.part === "more" && act.i === j) { end("drop"); return; }
      activate("more", j);
      const x = name(layout.more[j]!);
      host.announce(e.detail === 0 ? SG.lifted(x) : SG.liftedPointer(x)); // detail 0: Enter أو Space
      return;
    }
    const i = act.i;
    const slot = slots[i]!, pick = picks[j]!;
    const out = layout.home[i]!, inn = layout.more[j]!;
    const before = [slot.getBoundingClientRect(), pick.getBoundingClientRect()] as const;
    const ghosts = [ghostOf(slot, before[0]), ghostOf(pick, before[1])];
    // t0: الحفظ، وتبديل المحتوى، واختفاء حلقات الانتظار
    act = null;
    arm(false);
    commit(swapTools(layout, i, j));
    slot.classList.add("hold"); // التحديد يبقى مرسوماً حتى يهبط الظلّ
    host.announce(SG.swapped(name(inn), name(out)));
    fly(slot, pick, before, ghosts);
  }

  /** الظلّ: نسخة من البلاطة بمحتواها القديم فوق مستطيلها، بلا خلفية ولا حلقات (style.css، .swap-ghost). */
  function ghostOf(tile: HTMLButtonElement, r: DOMRect) {
    const g = tile.cloneNode(true) as HTMLElement;
    g.removeAttribute("data-test");
    g.className = `${tile.className} swap-ghost`;
    // إحداثيات مقيسة من الشاشة (فيزيائية)، لا اتجاه نصّ فيها
    Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    return g;
  }

  function fly(slot: HTMLElement, pick: HTMLElement, before: readonly [DOMRect, DOMRect], ghosts: HTMLElement[]) {
    const after = [slot.getBoundingClientRect(), pick.getBoundingClientRect()];
    const onScreen = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    const content = [...slot.children, ...pick.children];
    const fadeIn = (ms: number) => content.map((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "linear" }));
    const unhold = (ms: number) => {
      slot.style.setProperty("--sel-out", `${ms}ms`);
      slot.classList.remove("hold");
    };
    const later = (wait: number, ms: number) => {
      const done = () => unhold(ms);
      hold = { timer: window.setTimeout(() => { hold = null; done(); }, wait), done: () => unhold(0) };
    };
    if (reduced() || !before.every(onScreen) || !after.every(onScreen)) {
      // تقليل الحركة: تلاشٍ متقاطع 150ms، والتحديد بالشفافية. ومستطيل خارج الشاشة: تلاشٍ 160ms بلا طيران
      const ms = reduced() ? 150 : 160;
      flights = fadeIn(ms);
      later(0, reduced() ? 150 : SEL_OUT_MS);
      return;
    }
    layer.append(...ghosts);
    // الخانة تطير إلى «أدوات أخرى»، وأداة «أدوات أخرى» إلى الخانة (to: المستطيل الجديد لمحتوى كلٍّ منهما)
    const pairs: [HTMLElement, DOMRect, DOMRect][] = [[ghosts[0]!, before[0], after[1]!], [ghosts[1]!, before[1], after[0]!]];
    flights = pairs.flatMap(([g, from, to]) => {
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const s = to.height / from.height; // موحّد: 64÷88 أو مقلوبه
      const move = g.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: FLY_MS, easing: FLY_EASE, fill: "forwards" });
      const fade = g.animate([{ opacity: 1 }, { opacity: 1, offset: FADE_AT }, { opacity: 0 }], { duration: FLY_MS, easing: "linear", fill: "forwards" });
      return [move, fade];
    });
    flights.push(...content.map((c) => c.animate([{ opacity: 0 }, { opacity: 0, offset: FADE_AT }, { opacity: 1 }], { duration: FLY_MS, easing: "linear" })));
    void Promise.all(flights.map((a) => a.finished)).catch(() => {}).finally(() => { for (const g of ghosts) g.remove(); });
    later(FLY_MS, SEL_OUT_MS);
  }

  function restoreTap() {
    settle();
    end("silent");
    commit(host.defaults);
    slots[0]!.focus(); // الزرّ صار معطّلاً: لا يضيع التركيز
    host.announce(SG.restored);
  }
}
