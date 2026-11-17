/**
 * الرجوع بالسجلّ في «إعداد خطاب» (قرار نايف «أ» ٢٠٢٦/١١/١٥، docs/logs/letter-back.md): «أريد أن يقبل سحب من اليمين للرجوع
 * للصفحة الرئيسية وكذلك الزر الذي في الأعلى وتظهر رسالة تنبيه أن الملف لم يحفظ».
 * الخطاب صفحةٌ مستقلّة (letter.html)، فحركة الحافة في Safari وزرّ الرجوع يغادرانها بلا سؤال. هنا، ما دام فيه عملٌ غير محفوظ،
 * حالةٌ واحدة فوق مدخل الصفحة (`{pdfsaLetter: 1}`، بلا رابط جديد):
 * - الرجوع منها يصل الصفحة نفسها (popstate): تُعاد الحالة فوراً، فالرجوع التالي يصلها أيضاً، ثم تُفتح نافذة «لم يُحفظ».
 *   «البقاء» لا يفعل شيئاً آخر، و«الخروج» يتجاوز المدخلين إلى ما قبل الخطاب (`go(-2)`)، أي حيث قصد المستخدم.
 *   ولا صفحة قبله (فُتح في لسان جديد): `fallback`.
 * - بلا عمل (أو بعد الحفظ) لا حالة: الرجوع يغادر بخطوة واحدة كما كان. والحفظ يُنزلها بـ`go(-1)`، ويُتجاهل popstate الذي بعده.
 * دروس src/nav.ts نفسها:
 * - Safari يرفض لقطة المدخل في السحب إن كان `manual` وتغيّر التمرير، فيُري صفحةً فارغة. ومدخل الخطاب مرسومٌ حين تُضاف الحالة
 *   فوقه، فهو `auto`: لقطته الخطاب نفسه.
 * - و`auto` يعيد تمريرَ وقت الدفع عند الرجوع إليه: يُبقى التمرير كما كان لحظة الرجوع (HOLD_MS)، فـ«البقاء» يُبقي الخطاب كما هو.
 * - `history.go` الذي لا يصل popstate بعده يُعاد توازنه بعد UNWIND_MS وعند `pageshow`.
 * - Safari يكبت `confirm` بعد `pushState` والرجوع: السؤال نافذة PDFsa (src/leave-ask.ts)، لا `confirm`.
 * - لقطة مدخل الخطاب تُلتقط حين تُدفع الحالة فوقه، أي مع أول تعديل قبل أن يُرسم، ولا تتجدّد (docs/logs/swipe-snap.md):
 *   فبعد كل تعديل يستقرّ (SNAP_MS ثم إطاران)، ولا لمس ولا نافذة ولا سؤال، تُنزَل الحالة وتُدفع من جديد فتُلتقط بالخطاب كما هو.
 *   ولا والمتن أو حقلٌ مركَّز (حركة المؤشّر تعديلٌ هنا، فيُجدَّد عند خروجه)، ولا بعد رجوعٍ من المتصفح حتى تفاعلٍ جديد (Chrome يعلّم
 *   المدخلات «تُتخطّى» إن دُفع مدخلٌ بلا تفاعل)، وpopstate النزول المتأخّر بعد مهلته تتمّةٌ له خلال LATE_MS، كـsrc/nav.ts.
 *   ولا ومؤشّرٌ مضغوط أو بعد تمريرٍ أو تكبيرٍ بأقلّ من SNAP_MS، والإبقاء لا يردّ إلا ما يعيده المتصفح للمدخل، كـsrc/nav.ts.
 *   ونقرة رابط تنزيلٍ («حفظ») والنزول جارٍ تُؤجَّل حتى ينتهي، كـsrc/nav.ts: WebKit يُلغي بها `history.go` المجدول.
 */
import { allowLeave, guardLeave, leaving } from "../leave-guard";
import { mark, note } from "./scroll-trace";

const KEY = "pdfsaLetter";
/** كـsrc/nav.ts: رجوع الصفحة نفسها يصل في أجزاء من الثانية، وما تجاوزها فلم يقع. */
const UNWIND_MS = 600;
/** كـsrc/nav.ts: إرجاع المتصفح تمريرَ المدخل يصل بعد popstate بأجزاء من الثانية. */
const HOLD_MS = 500;
/** كـsrc/nav.ts: مفاتيح التعديل وحدها وEsc لا يعدّها Chromium تفاعلاً (keyboard_event_manager.cc: `!is_modifier && dom_key != ESCAPE`). */
const NOT_ACTIVATION = new Set(["Escape", "Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn", "FnLock", "NumLock", "ScrollLock", "Hyper", "Super", "Symbol", "SymbolLock"]);
/** كـsrc/nav.ts: تجديد لقطة مدخل الخطاب بعد آخر تعديل. */
const SNAP_MS = 400;
/** كـsrc/nav.ts: popstate نزول التجديد بعد مهلته تتمّةٌ له. */
const LATE_MS = 2000;

export interface BackHost {
  /** في الخطاب عملٌ غير محفوظ. */
  dirty(): boolean;
  /** نافذة «لم يُحفظ». */
  ask(): Promise<"stay" | "exit">;
  /** ما يُفعل قبل مغادرة الصفحة بـ«الخروج» (كما يفعل ✕). */
  leaving(): void;
  /** «الخروج» ولا صفحة قبل الخطاب في السجلّ. */
  fallback(): void;
}

/** مستوى حالة الخطاب: 1 أو 0 (الأساس ولكل حالة ليست منّا). */
export const guardLevel = (s: unknown): 0 | 1 => ((s as Record<string, unknown> | null)?.[KEY] === 1 ? 1 : 0);

/**
 * آخر تمريرٍ من كود الصفحة (scrollTo وscrollBy وscroll وscrollIntoView، لا focus: المحرّر يركّز بعد كل إضافة ولا يمرّر): يميّز تمرير الصفحة نفسها عن إرجاع المتصفح بعد
 * نزولنا، فـWebKit يعيد للمدخل موضعاً لا يُعرف سلفاً (docs/logs/letter-gap-scroll.md). يسجّل الوقت وحده ويستدعي الأصل كما هو.
 */
let ownAt = -Infinity;
function watchOwnScroll() {
  const tap = <T extends object, K extends keyof T>(o: T, k: K) => {
    const f = o[k] as unknown as ((...a: unknown[]) => unknown) | undefined;
    if (typeof f !== "function") return;
    (o as Record<K, unknown>)[k] = function (this: unknown, ...a: unknown[]) { ownAt = performance.now(); return f.apply(this, a); };
  };
  tap(window, "scrollTo"); tap(window, "scrollBy"); tap(window, "scroll");
  tap(Element.prototype, "scrollIntoView");
}

/** يعيد `refresh`: يطلبه المضيف كلما تغيّر `dirty` أو عُدّل الخطاب (لقطة المدخل). */
export function installBackGuard(host: BackHost): () => void {
  watchOwnScroll();
  try { history.scrollRestoration = "auto"; } catch { /* بلا اختيار: يبقى الافتراضي، وهو auto */ }
  let at = guardLevel(history.state); // بعد إعادة التحميل تبقى الحالة والخطاب فارغ: فيُنزلها التوازن
  let unwinding = false;
  let watchdog = 0;
  let asking = false;
  let kept: [number, number] | null = null; // التمرير قبل go(-1)
  let pos: [number, number] = [scrollX, scrollY]; // آخر تمرير من المستخدم: إرجاع المتصفح التمريرَ يصل بعد popstate
  // ولا يُعاد إلا التمرير الذي يقع على تمرير المدخل عند دفع الحالة فوقه (`saved`)، كـsrc/nav.ts: تمرير الصفحة نفسها خلالها
  // (تثبيت التكبير، وscrollIntoView) يبقى (docs/logs/swipe-snap.md، الدفعة الخامسة)
  // و`any` بعد نزولنا (التجديد أو الحفظ): أول تمرير بعده هو الإرجاع أيّاً كان موضعه، فـWebKit يعيد للمدخل تمريراً قديماً لا تمريرَ
  // وقت الدفع (مثلاً أعلى الملف لحظة فتحه، فيقفز العرض إليه بعد إضافة توقيع، بلاغ نايف ٢٠٢٦/١١/١٧، docs/logs/letter-gap-scroll.md)
  let hold: { x: number; y: number; until: number; to: [number, number] | null; any: boolean; since: number } | null = null;
  let saved: [number, number] | null = null; // تمرير مدخل الخطاب لحظة دُفعت الحالة فوقه: ما يعيده المتصفح عند الرجوع إليه
  const restored = (to: [number, number] | null) => {
    if (!to) return true; // بلا دفعٍ منّا (بعد إعادة التحميل): يُعاد كل تمرير كما كان
    const el = document.scrollingElement ?? document.documentElement;
    const mx = Math.max(0, el.scrollWidth - innerWidth), my = Math.max(0, el.scrollHeight - innerHeight);
    const cx = Math.sign(to[0]) * Math.min(Math.abs(to[0]), mx), cy = Math.min(Math.max(to[1], 0), my); // scrollX سالبٌ في rtl
    return Math.abs(scrollX - cx) <= 1 && Math.abs(scrollY - cy) <= 1;
  };
  addEventListener("scroll", () => {
    if (hold && performance.now() < hold.until) {
      if (scrollX === hold.x && scrollY === hold.y) return;
      const first = hold.any && ownAt < hold.since; // ولا تمرير من الصفحة منذ الإبقاء (وتمرير الإبقاء نفسه مُسقَط: الساعة بدقّة 1ms في WebKit): هو الإرجاع
      hold.any = false;
      if (first || restored(hold.to)) { note(first ? "back-guard:hold-first" : "back-guard:hold"); scrollTo(hold.x, hold.y); }
      else { mark("back-guard:own", JSON.stringify(hold.to)); hold.x = scrollX; hold.y = scrollY; pos = [scrollX, scrollY]; } // تمرير الصفحة نفسها: هو ما يُبقى إن جاء الإرجاع بعده
      return;
    }
    pos = [scrollX, scrollY];
  }, { passive: true });
  for (const t of ["wheel", "touchstart", "pointerdown", "keydown"]) addEventListener(t, () => { hold = null; }, { capture: true, passive: true });
  const keep = ([x, y]: [number, number], any = false) => { note("back-guard:keep"); scrollTo(x, y); ownAt = -Infinity; const t = performance.now(); hold = { x, y, until: t + HOLD_MS, to: saved, any, since: t }; }; // قبل الدفع: `saved` ما يعيده المتصفح الآن
  /** لم يصل الإرجاع بعد: التمرير ما زال على ما كان لحظة النزول، فأول تمرير بعده هو الإرجاع (`any`) */
  const at0 = ([x, y]: [number, number]) => scrollX === x && scrollY === y;
  let tailKept: [number, number] | null = null; // التمرير لحظة نزولٍ فاتته مهلته: يُعاد إن وصل popstate متأخّراً
  const settle = () => { clearTimeout(watchdog); unwinding = false; kept = null; };
  // نقرة رابط تنزيلٍ والنزول جارٍ: تُؤجَّل حتى ينتهي ثم تُنقر كما هي، كـsrc/nav.ts
  let parked: HTMLAnchorElement[] = [];
  addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href][download]");
    if (!unwinding || !(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self")) return;
    e.preventDefault();
    parked.push(a);
  }, { capture: true });
  const release = () => {
    const all = parked;
    parked = [];
    for (const a of all) { const off = !a.isConnected; if (off) document.body.append(a); a.click(); if (off) a.remove(); } // التنزيل يزيله بعد النقر
  };
  const arm = () => { saved = [scrollX, scrollY]; mark("back-guard:arm", JSON.stringify(saved)); history.pushState({ [KEY]: 1 }, ""); at = 1; };
  const unwind = () => {
    unwinding = true;
    kept = [scrollX, scrollY];
    mark("back-guard:unwind", resnap ? "snap" : "");
    history.go(-1);
    // لم يصل popstate: يُقرأ موضع السجلّ الفعليّ ويُعاد التوازن منه
    watchdog = window.setTimeout(() => {
      if (resnap) { late = performance.now() + LATE_MS; tailKept = kept; } // نزول التجديد: إن وصل popstate متأخّراً إلى 0 فهو تتمّته
      settle(); resnap = false; at = guardLevel(history.state); sync(); release();
    }, UNWIND_MS);
  };
  const sync = () => {
    if (unwinding || leaving()) return; // بعد «الخروج»: نزولٌ منّا قد يصل بعده، فلا دفع يقطع المغادرة
    const want = host.dirty() ? 1 : 0;
    if (want > at) arm();
    else if (want < at) unwind();
  };
  // تجديد لقطة مدخل الخطاب: `stale` عُدّل منذ آخر دفعٍ للحالة بعد الرسم
  let stale = false;
  let snapTimer = 0;
  let touchHeld = false; // لمسٌ جارٍ، أو أُلغي (أخذه النظام، كسحب الحافة): لا تجديد حتى لمسةٍ تنتهي أو مفتاح
  let act = true; // تفاعلٌ منذ آخر رجوعٍ من المتصفح: بلاه لا دفع
  let resnap = false; // النزول الجاري لتجديد اللقطة
  let late = 0; // حتى متى يُعدّ popstate إلى 0 تتمّةً لنزول تجديدٍ فاتته مهلته
  let pressed = false; // مؤشّرٌ مضغوط
  let moved = -Infinity; // آخر تمرير أو تكبير
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.isContentEditable || a.matches("textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=tel], input[type=url], input[type=password]"));
  };
  const snapLater = () => {
    clearTimeout(snapTimer);
    if (stale && !touchHeld) snapTimer = window.setTimeout(snap, SNAP_MS);
  };
  const snap = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (pressed || performance.now() - moved < SNAP_MS) { snapLater(); return; } // يتفاعل الآن، كـsrc/nav.ts
    if (!stale || !act || leaving() || touchHeld || typing() || unwinding || asking || at !== 1 || !host.dirty() || document.querySelector("dialog[open]")) return;
    stale = false;
    resnap = true;
    unwind(); // popstate منّا يعيد الحالة (sync)، ودفعُها فوق المدخل يلتقط لقطته الآن
  }));
  addEventListener("touchstart", () => { touchHeld = true; clearTimeout(snapTimer); }, { capture: true, passive: true });
  // رفع الإصبع وحده ليس تفاعلاً (بعد التمرير لا يعدّه Chromium)، والنقرة يعدّها pointerup، والتمرير يرسل pointercancel بدلاً منه
  addEventListener("touchend", (e) => { touchHeld = e.touches.length > 0; snapLater(); }, { capture: true, passive: true });
  addEventListener("keydown", (e) => {
    touchHeld = false; // الكتابة بلوحة الجوال لا تُطلق لمساً في الصفحة
    if (!NOT_ACTIVATION.has(e.key)) { act = true; snapLater(); }
  }, { capture: true, passive: true });
  for (const t of ["mousedown", "pointerup"]) addEventListener(t, () => { act = true; snapLater(); }, { capture: true, passive: true });
  addEventListener("focusout", () => snapLater(), { capture: true, passive: true }); // خرج من المتن أو الحقل
  // لا تجديد ما دام يتفاعل (كـsrc/nav.ts): مؤشّرٌ مضغوط، أو تمريرٌ (والحاويات الداخلية بالالتقاط) أو تكبيرٌ قريب
  addEventListener("pointerdown", () => { pressed = true; }, { capture: true, passive: true });
  addEventListener("pointercancel", () => { pressed = false; }, { capture: true, passive: true });
  addEventListener("pointerup", () => { pressed = false; }, { capture: true, passive: true });
  for (const t of ["touchcancel", "pagehide"]) addEventListener(t, () => { pressed = false; }, { capture: true, passive: true }); // كـsrc/nav.ts
  const move = () => { moved = performance.now(); };
  // والتكبير: بإصبعين لمسٌ (touchHeld)، وبالمتصفح resize، وبلوح اللمس wheel. ولا مستمع على visualViewport: يبقى عمر الصفحة
  // فيُحسب على الشاشات التي تحرس إزالة مستمعيه (e2e/fill-form.spec.ts «مغادرة الأداة»)
  for (const t of ["scroll", "resize", "wheel"]) addEventListener(t, move, { capture: true, passive: true });
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); snapLater(); });
  };
  addEventListener("popstate", (e) => {
    at = guardLevel(e.state);
    const tail = !unwinding && at === 0 && performance.now() < late;
    late = 0;
    const tk = tailKept;
    tailKept = null;
    if (tail) { if (tk) keep(tk, at0(tk)); else keep([scrollX, scrollY]); sync(); return; } // popstate نزول التجديد بعد مهلته: تُعاد الحالة بلا سؤال
    if (unwinding) {
      resnap = false;
      const k = kept;
      settle();
      if (k) keep(k, at0(k));
      sync();
      snapLater();
      return;
    }
    act = false; // رجوعٌ من المتصفح: لا دفع للتجديد حتى تفاعلٍ جديد
    if (at === 0 && host.dirty()) {
      keep(pos);
      arm(); // قبل السؤال: الرجوع والنافذة مفتوحة يصل هنا ثانيةً ولا يغادر، والنافذة باقية
      if (asking) return;
      asking = true;
      stale = true; // بعد السحب قد لا تُلتقط لقطة المدخل (Safari يعرض لقطته)، فتُجدَّد بعد «البقاء»
      void host.ask().then((a) => {
        asking = false;
        if (a !== "exit") { snapLater(); return; }
        host.leaving();
        allowLeave(); // «الخروج» من نافذتنا: لا نافذة متصفح بعده
        // بعد pushState لا مدخل أمامنا: الطول = موضع الحالة + 1، فما قبل الخطاب موجودٌ إن كان الطول 3 فأكثر
        if (history.length > 2) history.go(-2);
        else host.fallback();
      });
      return;
    }
    sync();
  });
  addEventListener("popstate", release); // بعد ما سبق في الحدث نفسه: النقرة المؤجَّلة بعد أن انتهى النزول ودُفعت الحالة
  // رجوع الصفحة من ذاكرة المتصفح (bfcache): ما كان جارياً قبل مغادرتها لا يصل حدثه
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    settle();
    at = guardLevel(history.state);
    sync();
    release();
  });
  guardLeave(host.dirty); // مغادرة الصفحة بخطابٍ لم يُحفظ: نافذة المتصفح شبكةَ أمان (src/leave-guard.ts)
  sync();
  return () => { stale = true; later(); };
}
