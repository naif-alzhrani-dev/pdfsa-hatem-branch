/**
 * الرجوع بسجلّ المتصفح (الملاحظة ١ من تحديث 1.0.2: «السحب من يمين الشاشة أو اليسار للرجوع للصفحة السابقة في الجوال»).
 * التنقّل في المنصة تبديلُ شاشات في الصفحة نفسها، فكانت حركة الحافة وزرّ الرجوع في أندرويد يُخرجان من الموقع.
 * هنا يوازن السجلّ ما يُعرض: لكل طبقة فوق الأساس حالةٌ في السجلّ (`{pdfsa: n}`، بلا رابط جديد فلا تتغيّر الصفحات المنشورة ولا canonical).
 * - الطبقات: الشاشة (0 في الأساس، 1 في غيره) والنوافذ المفتوحة فوقها (ورقة الأدوات، والحفظ، وشاشة الرسم). يحسبها المضيف (`depth`).
 * - الرجوع (حركة الحافة، وزرّ أندرويد، وزرّ الماوس الخلفي، و`history.back()`): يُنفَّذ رجوع الطبقة العليا كما يفعل زرّها (`back`)،
 *   ومعه سؤال العمل غير المحفوظ. فإن رُفض بقيت الشاشة، وأعاد التوازن حالتها إلى السجلّ.
 * - الانتقال بغير الرجوع (زرّ الرجوع في الواجهة، و«ملف جديد»، والخطأ إلى الرئيسية): تُزال الحالات الزائدة بـ`history.go`، فلا تتكرّر.
 * - في الأساس لا حالة: الرجوع منه يُخرج من الموقع كما كان، فلا يُحبس المستخدم.
 * ولا مستمع سحب في الصفحة: الحركة للنظام، فلا تعارض مع الرسم والقص والمسح.
 * - العمل غير المحفوظ حالةٌ إضافية فوق الشاشة (بلاغ نايف ٢٠٢٦/١١/١٥، docs/logs/swipe-back-leave.md): Safari يعرض أثناء سحب الحافة
 *   لقطةَ الحالة السابقة، ويلتقطها حين تُضاف حالة فوقها. فحالة الشاشة تُضاف قبل أن تُرسم الشاشة فلقطتها الرئيسية، وحالة العمل تُضاف
 *   بعد تعديلٍ في شاشة مرسومة فلقطتها الشاشة نفسها: السحب يُري الملف، ثم يُسأل السؤال نفسه. يطلبها المضيف بـ`refresh` حين يتغيّر العمل.
 * - `history.go` الذي لا يصل `popstate` بعده (سحبٌ أُلغي، أو استعادة الصفحة من الذاكرة): يُعاد التوازن بعد UNWIND_MS وعند `pageshow`،
 *   فلا يبقى `unwinding` مرفوعاً فيبتلع الرجوع التالي (بلاغ نايف الرابع، وبند الصقل ١١).
 * - التمرير (بلاغ نايف ٢٠٢٦/١١/١٥ بعد «إضافة نص»، docs/logs/swipe-back-text.md): Safari يرفض صورة لقطة المدخل إن كان `manual`
 *   وتغيّر التمرير منذ التقاطها (ViewGestureControllerIOS.mm، `canUseSnapshot`)، فيُري صفحةً فارغة بلون الخلفية. فالمدخل الذي تُضاف
 *   فوقه حالةٌ وشاشته مرسومة يصير `auto` قبل الدفع (لقطته تُستعمل، والرجوع إليه يعيد تمريره لحظتها)، والجديد `manual` كما كان.
 *   وتراجعاتنا بـ`history.go` تُبقي التمرير كما كان قبلها، فلا تقفز الصفحة بعد «حفظ» أو إغلاق نافذة.
 * - تجديد لقطة الشاشة (بلاغ نايف ٢٠٢٦/١١/١٥، docs/logs/swipe-snap.md): WebKit يلتقط لقطة المدخل الحاليّ حين يُضاف مدخلٌ فوقه
 *   (WebBackForwardList::addItem) وحين يُترك بالتنقّل (goToItem)، ولا يلتقطها بعد ذلك. وحالة العمل تُدفع مع أول تعديل قبل أن يُرسم،
 *   ولا تُدفع ثانيةً ما دام العمل، فكان السحب يُري الملف قبل تعديلاته. فبعد كل تعديلٍ يستقرّ (SNAP_MS بلا تعديل، ثم إطاران)
 *   وحالة العمل هي العليا (`workOnTop`): تُنزَل ثم تُدفع من جديد، فتُلتقط لقطة الشاشة تحتها بالتعديل. والعدد لا يتغيّر.
 *   ولا تجديد أثناء لمس (ولا بعد لمسٍ أخذه النظام حتى لمسةٍ تنتهي)، ولا ونافذةٌ أو سؤالٌ مفتوح، ولا وحقلُ كتابةٍ مركَّز (يُجدَّد عند خروجه):
 *   فلا `history.go` ولوحة المفاتيح مفتوحة.
 *   ولا بعد رجوعٍ من المتصفح حتى تفاعلٍ جديد (مراجعة أمين، docs/logs/swipe-snap.md): Chrome يطفئ احتساب التفاعل بعد الرجوع، فإن دُفع
 *   مدخلٌ بلا تفاعل علّم مدخلات المستند كلها «تُتخطّى» (SetShouldSkipOnBackForwardUIIfNeeded)، فيُخرج الرجوعُ التالي من الموقع بلا سؤال.
 *   وpopstate نزولِ التجديد إن تأخّر عن UNWIND_MS يُعدّ تتمّةً له خلال LATE_MS إن كان بالمستوى المنتظر، لا رجوعاً يسأل.
 *   ولا ومؤشّرٌ مضغوط، ولا خلال SNAP_MS من تمريرٍ أو تكبير (الفحص الكامل على 3dafce0: كان التجديد يقطع التمرير التلقائي أثناء
 *   السحب، وإبقاءُ التمرير بعده يُلغي تمرير الصفحة نفسها). والإبقاء لا يردّ إلا ما يعيده المتصفح للمدخل (`saved`).
 * - نقرة رابطٍ والنزول جارٍ (docs/logs/swipe-snap.md، الدفعة السادسة): WebKit يُلغي `history.go` المجدول إن بدأ تنقّلٌ قبل تنفيذه
 *   (تنزيل «حفظ» بـ`a[download]`، قيس في probe الدفعة السادسة)، فلا يصل popstate، فيُعدّ رجوعُ المستخدم بعده تتمّةً للنزول (LATE_MS) أو نزولاً منّا فيضيع.
 *   فتُؤجَّل نقرة التنزيل (`parked`) حتى يصل popstate النزول أو مهلته، ثم تُنقر كما هي. وChromium لا يُلغيه، فالتأجيل فيه أجزاءٌ من الثانية.
 */
import { leaving } from "./leave-guard";

const KEY = "pdfsa";
/** مهلة `popstate` بعد `history.go`: رجوع الصفحة نفسها يصل في أجزاء من الثانية، وما تجاوزها فلم يقع. */
export const UNWIND_MS = 600;
/** مدّة إبقاء التمرير بعد رجوعٍ منّا: إرجاع المتصفح تمريرَ المدخل يصل بعد popstate بأجزاء من الثانية (قيس في WebKit حتى ~30ms). */
const HOLD_MS = 500;
/** مفاتيح التعديل وحدها وEsc لا يعدّها Chromium تفاعلاً (keyboard_event_manager.cc: `!is_modifier && dom_key != ESCAPE`). */
const NOT_ACTIVATION = new Set(["Escape", "Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn", "FnLock", "NumLock", "ScrollLock", "Hyper", "Super", "Symbol", "SymbolLock"]);
/** تأخير تجديد لقطة الشاشة بعد آخر تغيّر في العمل: يجمع التعديلات المتتالية، ويأتي بعد رسمها. */
export const SNAP_MS = 400;
/** بعد مهلة نزول التجديد: popstate بالمستوى المنتظر تتمّةٌ له لا رجوع (WebKit/Chrome تحت الحِمل). */
const LATE_MS = 2000;

export interface NavHost {
  /** عدد الطبقات المعروضة فوق الأساس الآن، ومنها حالة العمل غير المحفوظ فوق الشاشة. */
  depth(): number;
  /**
   * رجوع الطبقة العليا كما يفعل زرّها. ورفضه (سؤال العمل غير المحفوظ) يُبقي ما يُعرض كما هو.
   * والسؤال قد يكون نافذةً في الصفحة لا `confirm` (src/leave-ask.ts): تُفتح هنا ويُجاب عنها بعد popstate. وهي طبقةٌ في `depth`،
   * فالتوازن بعد `back` يعيد المستوى ويزيد حالتها، و«البقاء» يُنزلها و«الخروج» يعود إلى الأساس، والسحب الثاني يصل إليها `cancel`.
   */
  back(): void;
  /** حالة العمل غير المحفوظ هي العليا ولا نافذة فوقها: حينها تُجدَّد لقطة الشاشة تحتها. وبلا هذه الدالّة لا تجديد. */
  workOnTop?(): boolean;
}

/** مستوى حالة السجلّ: 0 للأساس ولكل حالة ليست منّا. */
export const navLevel = (s: unknown): number => {
  const n = (s as Record<string, unknown> | null)?.[KEY];
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
};

/** `watch`: ما يتبدّل بتبدّل الشاشات (`#app`). والنوافذ تُراقَب بسمة `open` في الصفحة كلها. */
/** يعيد `refresh`: يطلبه المضيف حين يتغيّر ما يحسبه `depth` بغير تبدّل الشاشات والنوافذ، وبعد كل تعديل في العمل (لقطة الشاشة). */
export function installNav(host: NavHost, watch: HTMLElement): () => void {
  try { history.scrollRestoration = "manual"; } catch { /* التمرير تديره الشاشات كما كان قبل السجلّ */ }
  let at = navLevel(history.state); // بعد إعادة التحميل تبقى الحالة، والرئيسية تُعرض: فيُرجع التوازنُ السجلَّ إلى الأساس
  let unwinding = false; // history.go جارٍ: لا رجوع ولا توازن حتى يصل popstate
  let watchdog = 0;
  let kept: [number, number] | null = null; // التمرير قبل history.go: يُعاد بعد popstate (المدخل `auto` يُرجع تمريره القديم)
  // والإرجاع يقع بعد popstate بلا موعد (WebKit، وiOS من عملية الواجهة): يُعاد التمرير عند كل تمرير خلال HOLD_MS، ما لم يلمس المستخدم
  // ولا يُعاد إلا التمرير الذي يقع على تمرير المدخل المحفوظ (`to`، ما كان عند الدفع فوقه): تمرير الصفحة نفسها خلالها (التكبير،
  // وscrollIntoView، والتمرير التلقائي أثناء السحب) يبقى (docs/logs/swipe-snap.md، الدفعة الخامسة)
  let hold: { x: number; y: number; until: number; to?: [number, number] } | null = null;
  const saved = new Map<number, [number, number]>(); // تمرير كل مستوى لحظة دُفع فوقه: ما يعيده المتصفح عند الرجوع إليه
  /** التمرير الآن هو ما يعيده المتصفح للمدخل (`to` محصوراً في مدى الصفحة، ±1px). وبلا `to` (بعد إعادة التحميل) يُعاد كل تمرير كما كان. */
  const restored = (to?: [number, number]) => {
    if (!to) return true;
    const el = document.scrollingElement ?? document.documentElement;
    const mx = Math.max(0, el.scrollWidth - innerWidth), my = Math.max(0, el.scrollHeight - innerHeight);
    const cx = Math.sign(to[0]) * Math.min(Math.abs(to[0]), mx), cy = Math.min(Math.max(to[1], 0), my); // scrollX سالبٌ في rtl
    return Math.abs(scrollX - cx) <= 1 && Math.abs(scrollY - cy) <= 1;
  };
  addEventListener("scroll", () => {
    if (!hold || performance.now() >= hold.until || (scrollX === hold.x && scrollY === hold.y)) return;
    if (restored(hold.to)) scrollTo(hold.x, hold.y);
    else { hold.x = scrollX; hold.y = scrollY; } // تمرير الصفحة نفسها: هو ما يُبقى إن جاء إرجاع المتصفح بعده
  }, { passive: true });
  for (const t of ["wheel", "touchstart", "pointerdown", "keydown"]) addEventListener(t, () => { hold = null; }, { capture: true, passive: true });
  const settle = () => { clearTimeout(watchdog); unwinding = false; kept = null; };
  // نقرة رابط تنزيلٍ والنزول جارٍ: تُؤجَّل حتى ينتهي (WebKit يُلغي به history.go المجدول)، ثم تُنقر كما هي.
  // ورابط `#` لا يُلغيه (قيس)، والرابط إلى صفحةٍ أخرى يغادر بها، فلا يُؤجَّلان
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
    for (const a of all) { const off = !a.isConnected; if (off) document.body.append(a); a.click(); if (off) a.remove(); } // `download()` يزيله بعد النقر
  };
  /** رجوعٌ منّا: يُحفظ التمرير ليُعاد بعد popstate، وإن لم يصل popstate يُقرأ موضع السجلّ الفعليّ ويُعاد التوازن منه. */
  const unwind = (n: number) => {
    unwinding = true;
    kept = [scrollX, scrollY];
    history.go(n);
    watchdog = window.setTimeout(() => {
      // نزول التجديد لم يصل popstate بعد: إن وصل متأخّراً بالمستوى المنتظر فهو تتمّته (سطر popstate)
      if (resnap) late = { n: at + n, until: performance.now() + LATE_MS };
      settle(); resnap = false; at = navLevel(history.state); sync(); release();
    }, UNWIND_MS);
  };
  const restore = (m: ScrollRestoration) => { try { history.scrollRestoration = m; } catch { /* بلا اختيار: يبقى ما كان */ } };
  const sync = () => {
    if (unwinding || leaving()) return; // بعد مغادرةٍ مقصودة (src/leave-guard.ts): لا دفع يقطعها
    const want = host.depth();
    while (at < want) {
      saved.set(at, [scrollX, scrollY]);
      if (at > 0) restore("auto");
      history.pushState(resnap ? { [KEY]: ++at, snap: 1 } : { [KEY]: ++at }, ""); // `snap`: دفعُ تجديد اللقطة، يميّزه الحارس عن تصحيح التوازن
      resnap = false;
      restore("manual");
    }
    if (want < at) unwind(want - at); // إن لم يقع الرجوع أُعيد، وإن وقع بلا حدث فلا شيء
  };
  // تجديد لقطة الشاشة تحت حالة العمل: `stale` تغيّر العمل منذ آخر دفعٍ لها بعد الرسم
  let stale = false;
  let resnap = false; // النزول الجاري لتجديد اللقطة: الدفع بعده يحمل `snap`
  let snapTimer = 0;
  let touchHeld = false; // لمسٌ جارٍ، أو أُلغي (أخذه النظام، كسحب الحافة): لا تجديد حتى لمسةٍ تنتهي أو مفتاح
  let act = true; // تفاعلٌ منذ آخر رجوعٍ من المتصفح (كما يعدّه المتصفح): بلاه لا دفع
  let late: { n: number; until: number } | null = null;
  let pressed = false; // مؤشّرٌ مضغوط (فأرة أو قلم أو إصبع)
  let moved = -Infinity; // آخر تمرير أو تكبير
  /** حقل كتابة مركَّز: لا تجديد ولوحة المفاتيح مفتوحة. */
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.isContentEditable || a.matches("textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=tel], input[type=url], input[type=password]"));
  };
  const snapLater = () => {
    clearTimeout(snapTimer);
    if (stale && !touchHeld) snapTimer = window.setTimeout(snap, SNAP_MS);
  };
  const snap = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (pressed || performance.now() - moved < SNAP_MS) { snapLater(); return; } // يتفاعل الآن: مؤشّرٌ مضغوط (pointerup يطلبه)، أو تمريرٌ أو تكبيرٌ قريب
    if (!stale || !act || leaving() || touchHeld || typing() || unwinding || at < 2 || at !== host.depth() || !host.workOnTop?.()) return; // تبدّلُ الحال يطلبه ثانيةً
    stale = false;
    resnap = true;
    unwind(-1); // popstate منّا يعيد الدفع (sync)، ودفعُ المدخل فوق الشاشة يلتقط لقطتها الآن
  }));
  addEventListener("touchstart", () => { touchHeld = true; clearTimeout(snapTimer); }, { capture: true, passive: true });
  // رفع الإصبع وحده ليس تفاعلاً (بعد التمرير لا يعدّه Chromium)، والنقرة يعدّها pointerup، والتمرير يرسل pointercancel بدلاً منه
  addEventListener("touchend", (e) => { touchHeld = e.touches.length > 0; snapLater(); }, { capture: true, passive: true });
  addEventListener("keydown", (e) => {
    touchHeld = false; // الكتابة بلوحة الجوال لا تُطلق لمساً في الصفحة
    if (!NOT_ACTIVATION.has(e.key)) { act = true; snapLater(); }
  }, { capture: true, passive: true });
  for (const t of ["mousedown", "pointerup"]) addEventListener(t, () => { act = true; snapLater(); }, { capture: true, passive: true });
  addEventListener("focusout", () => snapLater(), { capture: true, passive: true }); // خرج من حقل الكتابة
  // لا تجديد ما دام يتفاعل (docs/logs/swipe-snap.md، الدفعة الخامسة): history.go أثناء سحبٍ بالمؤشّر أو بعد تمريرٍ أو تكبير مباشرةً
  // يقطع ما يجري (التمرير التلقائي، وتثبيت التكبير). والتمرير بالتقاط النافذة يشمل حاويات التمرير الداخلية
  addEventListener("pointerdown", () => { pressed = true; }, { capture: true, passive: true });
  addEventListener("pointercancel", () => { pressed = false; }, { capture: true, passive: true });
  addEventListener("pointerup", () => { pressed = false; }, { capture: true, passive: true });
  // سحب الحافة يأخذه النظام: قد لا يُطلق WebKit pointercancel (مراجعة أمين على 9c354a2)، ولا مؤشّر بعد مغادرة الصفحة
  for (const t of ["touchcancel", "pagehide"]) addEventListener(t, () => { pressed = false; }, { capture: true, passive: true });
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
    at = navLevel(e.state);
    const tail = !unwinding && !!late && performance.now() < late.until && at === late.n;
    late = null;
    if (tail) { // popstate نزول التجديد بعد مهلته: يُعاد الدفع بلا سؤال، ويبقى التمرير
      resnap = true;
      hold = { x: scrollX, y: scrollY, until: performance.now() + HOLD_MS, to: saved.get(at) };
    } else if (unwinding) {
      const k = kept;
      settle();
      if (k) { hold = { x: k[0], y: k[1], until: performance.now() + HOLD_MS, to: saved.get(at) }; scrollTo(k[0], k[1]); }
    }
    else {
      act = false; // رجوعٌ من المتصفح: لا دفع للتجديد حتى تفاعلٍ جديد
      if (at < host.depth()) { stale = true; host.back(); } // بعد السحب قد لا تُلتقط لقطة الشاشة (Safari يعرض لقطته)، فتُجدَّد بعد السؤال
    }
    sync();
    snapLater();
    release();
  });
  // رجوع الصفحة من ذاكرة المتصفح (bfcache): ما كان جارياً قبل مغادرتها لا يصل حدثه
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    settle();
    at = navLevel(history.state);
    sync();
    release();
  });
  new MutationObserver(later).observe(watch, { childList: true });
  new MutationObserver(later).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  sync();
  return () => { stale = true; later(); };
}
