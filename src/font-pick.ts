/**
 * اختيار الخط في أدوات الكتابة (مواصفة 👩‍🎨 لمى وقرارات نايف في آخرها، docs/logs/fonts-picker-lama-spec.md).
 * - العنصر الجديد يبدأ بآخر خط اختاره المستخدم (مفتاح واحد للأدوات كلها)، وبلكس إن لم يختر.
 * - كل عنصر يحمل خطّه، وتغييره يمسّه وحده ويصير خطَّ العناصر التالية (كالحبر، src/ink.ts).
 * - الرقعة تختفي من الشبكة حيث `minPx` أقل من 18، والمحفوظ رقعةً يُرسم هناك ببلكس ولا يُكتب فوقه.
 * والأسماء من `SL.fonts` (مصدر «إعداد خطاب» نفسه، هدى)، تُرسم صوراً من src/font-names.ts (scripts/gen-font-names.mjs) فلا يُنزَّل خطٌّ لعرض الشبكة.
 * والخط يُنزَّل عند اختياره وحده، بوجهه العادي (`loadRegular`، src/font-load.ts).
 */
import "./font-pick.css";
import { h } from "./dom";
import { loadRegular, type WebFontKey } from "./font-load";
import { FONT_NAMES } from "./font-names";
import { SL } from "./strings";

/** الترتيب من اليمين (لمى). */
export const PICK_FONTS: readonly WebFontKey[] = ["plex", "amiri", "naskh", "markazi", "kufi", "almarai", "messiri", "ruqaa"];
export const DEFAULT_PICK: WebFontKey = "plex";
/** أصغر حجم تُعرض به الرقعة (بكسل): تحته تلتبس حروفها («هدى» و«مدى»). */
export const RUQAA_MIN_PX = 18;
/** في «إعداد خطاب» بالنقاط: 14 نقطة ≈ 18.7px، أول مقاس في قائمة الخطاب لا يقلّ عن RUQAA_MIN_PX */
export const RUQAA_MIN_PT = 14;

const KEY = "pdfsa.font";
export const isPickFont = (v: unknown): v is WebFontKey => typeof v === "string" && (PICK_FONTS as readonly string[]).includes(v);

/** آخر خط اختير على هذا الجهاز، وبلكس إن لم يُختر أو كانت القيمة مجهولة أو تعذّرت القراءة. */
export function loadPickFont(): WebFontKey {
  try {
    const v = localStorage.getItem(KEY);
    return isPickFont(v) ? v : DEFAULT_PICK;
  } catch {
    return DEFAULT_PICK;
  }
}
export function savePickFont(k: WebFontKey): void {
  try { localStorage.setItem(KEY, k); } catch { /* تخزين معطّل: يبقى للجلسة وحدها */ }
}

/** خطوط الشبكة بحسب أصغر حجم في الأداة. */
export const pickFontsFor = (minPx = Infinity): WebFontKey[] => PICK_FONTS.filter((k) => k !== "ruqaa" || minPx >= RUQAA_MIN_PX);
/** الخط الذي يُرسم به فعلاً: المجهول بلكس، والرقعة تحت 18px بلكس (والمحفوظ لا يتغيّر). */
export const usableIn = (k: unknown, minPx = Infinity): WebFontKey => (isPickFont(k) && pickFontsFor(minPx).includes(k) ? k : DEFAULT_PICK);

const platform = () => getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || '"IBM Plex Sans Arabic"';
/** عائلة CSS للرسم: بلكس خطّ المنصة (`--font`، كما كان قبل الاختيار)، وغيره `L <المفتاح>` وبعده خطّ المنصة للحروف التي ليست فيه. */
export const familyOf = (k?: WebFontKey): string => (!k || k === "plex" ? platform() : `"L ${k}", ${platform()}`);
/** يجهّز الخط للرسم. بلكس محمَّل مع الصفحة. ويُرفض إن تعذّر التنزيل. */
export const ensurePickFont = (k?: WebFontKey): Promise<void> => (!k || k === "plex" ? Promise.resolve() : loadRegular(k));
/** لعنصر جديد: الخط المطلوب إن تنزّل، وإلا بلكس (فلا يحمل العنصر خطاً لم يُرسم به). */
export async function readyFont(k: WebFontKey): Promise<WebFontKey> {
  try { await ensurePickFont(k); return k; } catch { return DEFAULT_PICK; }
}

/** حال الشبكة: المحدَّد، وما يُنزَّل الآن، وهل فشل آخر تنزيل. */
export type PickState = { checked: WebFontKey; busy: WebFontKey | null; failed: boolean };

/**
 * منطق الاختيار بلا DOM (يُختبر في tests/font-pick.test.ts): العلامة تبقى على السابق حتى يتنزّل الخط، ثم `onChange` مرة واحدة.
 * **الضغطة الأخيرة هي المعتمدة:** لكل ضغطة رقم، وما ينتهي بعد ضغطة أحدث منه لا يُطبَّق، نجح أو فشل.
 */
export function pickController(opts: { value: WebFontKey; load: (k: WebFontKey) => Promise<void>; onState: (s: PickState) => void; onChange: (k: WebFontKey) => void }) {
  let st: PickState = { checked: opts.value, busy: null, failed: false };
  let seq = 0;
  const emit = (next: PickState) => { st = next; opts.onState(st); };
  async function choose(k: WebFontKey): Promise<void> {
    const n = ++seq;
    if (k === st.checked) { emit({ ...st, busy: null, failed: false }); return; } // رجوع إلى المحدَّد يلغي ما قبله
    emit({ checked: st.checked, busy: k, failed: false });
    let ok = true;
    try { await opts.load(k); } catch { ok = false; }
    if (n !== seq) return;
    if (!ok) { emit({ checked: st.checked, busy: null, failed: true }); return; }
    emit({ checked: k, busy: null, failed: false });
    opts.onChange(k);
  }
  return {
    choose,
    state: () => st,
    /** يغيّر المحدَّد دون `onChange` ويلغي أي تنزيل جارٍ. */
    set(k: WebFontKey) { seq++; emit({ checked: k, busy: null, failed: false }); },
  };
}

export interface FontPicker {
  el: HTMLElement;
  value(): WebFontKey;
  /** يغيّر الاختيار الظاهر دون `onChange` ودون حفظ (والرقعة حيث لا تُقبل تُعرض بلكس). */
  set(k: WebFontKey): void;
  /** أصغر حجم في العنصر المحدَّد الآن (تعبئة النماذج: لكل حقل حجمه): الرقعة تختفي تحته. */
  limit(minPx: number): void;
}

/**
 * أداة تفتح بخطٍّ محفوظ: يُنزَّل في الخلفية، فإن تعذّر عادت الشبكة إلى بلكس بلا حفظ.
 * ثم `apply` بالخط الجاهز، ما لم يختر المستخدم غيره في أثناء ذلك.
 */
export function readyInitial(picker: FontPicker, apply: (k: WebFontKey) => void): void {
  const k0 = picker.value();
  void readyFont(k0).then((k) => {
    if (picker.value() !== k0) return;
    if (k !== k0) picker.set(k);
    apply(k);
  });
}

/**
 * شبكة الخط: `fieldset.font-pick` > `legend` «الخط» > `.lt-fonts` > `label.lt-fo.lf-<المفتاح>` فيه radio أصليّ (فالأسهم تعمل بلا كود)،
 * وكل اسم بخطّه. الاختيار يحفظ الخط على الجهاز ثم يستدعي `onChange` بعد التنزيل. والخطأ سطر `role="status"` تحت الشبكة.
 * `testId` يُلحق بـ`data-test`: `${testId}` للشبكة، و`${testId}-<المفتاح>` لكل radio، و`${testId}-error` للخطأ.
 */
export function fontPicker(opts: { value?: WebFontKey; minPx?: number; testId?: string; onChange?: (k: WebFontKey) => void } = {}): FontPicker {
  let minPx = opts.minPx ?? Infinity;
  const name = `font-pick-${opts.testId ?? "x"}-${++pickers}`;
  const inputs = new Map<WebFontKey, HTMLInputElement>();
  const labels = new Map<WebFontKey, HTMLElement>();
  const err = h("p", { class: "font-pick-err", role: "status", "data-test": opts.testId && `${opts.testId}-error` });
  const ctl = pickController({
    value: usableIn(opts.value ?? loadPickFont(), minPx),
    load: ensurePickFont,
    onState: render,
    onChange: (k) => { savePickFont(k); opts.onChange?.(k); },
  });
  const grid = h("div", { class: "lt-fonts" }, ...PICK_FONTS.map((k) => {
    const input = h("input", { class: "sr-only", type: "radio", name, value: k, "data-test": opts.testId && `${opts.testId}-${k}` }) as HTMLInputElement;
    input.addEventListener("change", () => { if (input.checked) void ctl.choose(k); });
    inputs.set(k, input);
    const label = h("label", { class: `lt-fo lf-${k}` }, input, h("span", { class: "sr-only" }, SL.fonts[k]), nameImage(k));
    labels.set(k, label);
    return label;
  }));
  const el = h("fieldset", { class: "font-pick", "data-test": opts.testId }, h("legend", { class: "tool-label" }, SL.fontPick), grid, err);
  function render(s: PickState) {
    inputs.get(s.checked)!.checked = true; // العلامة على المحدَّد ولو ضُغط غيره، حتى يتنزّل
    for (const [k, label] of labels) {
      const sp = label.querySelector(".spinner");
      if (k === s.busy && !sp) label.append(h("span", { class: "spinner small", "aria-hidden": "true" }));
      if (k !== s.busy) sp?.remove();
    }
    el.toggleAttribute("aria-busy", s.busy !== null);
    err.textContent = s.failed ? SL.fontLoadFailed : "";
  }
  function limit(px: number) {
    minPx = px;
    const ok = pickFontsFor(px).includes("ruqaa");
    labels.get("ruqaa")!.hidden = !ok; // تختفي، بلا سطر شرح (قرار نايف)
    inputs.get("ruqaa")!.disabled = !ok;
    if (!ok && ctl.state().checked === "ruqaa") ctl.set(DEFAULT_PICK);
  }
  limit(minPx);
  render(ctl.state());
  return { el, value: () => ctl.state().checked, set: (k) => ctl.set(usableIn(k, minPx)), limit };
}
let pickers = 0;

const SVG = "http://www.w3.org/2000/svg";
/** اسم الخط بخطّه صورةً (مسارات، `fill: currentColor`)، بمقياس 18px للـem كالنصّ، ومخفيّة عن قارئ الشاشة (الاسم نصّاً قبلها). */
export function nameImage(k: WebFontKey): SVGSVGElement {
  const n = FONT_NAMES[k]!;
  const [x, y, w, hh] = n.box;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${hh}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "fo-name");
  svg.style.inlineSize = `${w / n.upem}em`; // CSSOM لا سمة style، فلا تمنعه سياسة الأمان
  svg.style.blockSize = `${hh / n.upem}em`;
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", n.d);
  svg.append(path);
  return svg;
}
