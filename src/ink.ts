/**
 * لون الحبر لكل ما يكتبه المستخدم على الصفحة: الأسود أو الأزرق، أو لون مخصّص من دائرة الألوان (الإضافة ١٠،
 * docs/logs/additions-10-11-lama-spec.md)، والتوقيع المرسوم مثلها (قرار نايف ٢٠٢٦/١١/١٤: «تضاف لها دائرة الألوان»).
 * التخزين: يُقرأ `pdfsa.inkAny` (black|blue|#RRGGBB)، وإن غاب فـ`pdfsa.ink` القديم (black|blue)، فلا تنكسر قيم المستخدمين.
 * ويُكتب `pdfsa.inkAny` دائماً، ومعه `pdfsa.ink` للأسود والأزرق (للنسخ الأقدم)، و`pdfsa.inkCustom` آخر لون مخصّص.
 */
import { h } from "./dom";
import { S4 } from "./strings";

export const INK = { black: "#141414", blue: "#1E40AF" } as const;
export type InkName = keyof typeof INK;
export type Ink = InkName | `#${string}`;
const NAMES = Object.keys(INK) as InkName[];
const KEY = "pdfsa.ink", KEY_ANY = "pdfsa.inkAny", KEY_CUSTOM = "pdfsa.inkCustom";
/** شرط أمان: لا يصل `fillStyle` ولا CSSOM ولا التخزين إلا ستّ خانات ست عشرية بعد «#». */
const HEX = /^#[0-9A-F]{6}$/i;

export const isInkName = (v: unknown): v is InkName => typeof v === "string" && (NAMES as string[]).includes(v);
export const isHexInk = (v: unknown): v is `#${string}` => typeof v === "string" && HEX.test(v);
export const isInk = (v: unknown): v is Ink => isInkName(v) || isHexInk(v);
/** اللون الذي يُرسم به. وما ليس حبراً صحيحاً (قيمة قديمة أو معطوبة) يُرسم بالأسود. */
export const inkColor = (v: unknown): string => (isInkName(v) ? INK[v] : isHexInk(v) ? v.toUpperCase() : INK.black);

/** نسبة التباين على الورق الأبيض (WCAG 2): FF0000 = 4.0، وFFA500 = 2.0، وFFFF00 = 1.07. */
export function contrastOnWhite(hex: string): number {
  if (!isHexInk(hex)) return 21;
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return 1.05 / (L + 0.05);
}
/** تحت 3:1 تنبيه لا منع. */
export const isLightInk = (v: Ink) => isHexInk(v) && contrastOnWhite(v) < 3;

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* تخزين معطّل: يبقى للجلسة وحدها */ } };

/** المفتاح القديم `pdfsa.ink`: آخر أسود أو أزرق، والأسود إن لم يُختر أو تعذّرت القراءة (لمنتقٍ بلا دائرة). */
export function loadInk(): InkName {
  const v = read(KEY);
  return isInkName(v) ? v : "black";
}
/** الحبر لكل منتقٍ بدائرة (التوقيع والتاريخ والنص والرسم): آخر ما اختير، ومنه المخصّص، وإلا المفتاح القديم. */
export function loadInkAny(): Ink {
  const v = read(KEY_ANY);
  return isInk(v) ? (isHexInk(v) ? (v.toUpperCase() as Ink) : v) : loadInk();
}
/** آخر لون مخصّص، أو null. */
export function loadInkCustom(): `#${string}` | null {
  const v = read(KEY_CUSTOM);
  return isHexInk(v) ? (v.toUpperCase() as `#${string}`) : null;
}
export function saveInk(v: Ink): void {
  if (isInkName(v)) { write(KEY, v); write(KEY_ANY, v); return; }
  if (!isHexInk(v)) return;
  write(KEY_ANY, v.toUpperCase());
  write(KEY_CUSTOM, v.toUpperCase());
}

/** هل يدعم المتصفّح `<input type=color>`؟ (الذي لا يدعمه يعيده نصاً) */
function colorInputOk(): boolean {
  const t = document.createElement("input");
  try { t.type = "color"; } catch { return false; }
  return t.type === "color";
}

export interface InkPicker<T extends Ink = InkName> {
  el: HTMLElement;
  /** تنبيه اللون الفاتح (`role=status`)، يضعه المضيف تحت صفّ الحبر. فارغ ومخفيّ بلا دائرة. */
  note: HTMLElement;
  value(): T;
  /** يغيّر الاختيار الظاهر دون استدعاء `onChange` ودون حفظ. */
  set(v: T): void;
}
interface InkOpts<T extends Ink> { value?: T; onChange?: (v: T) => void; testId?: string; custom?: boolean; compact?: boolean }

/**
 * أزرار الحبر: دائرة بلون الحبر ومعها «أسود» أو «أزرق» (و`compact` نقطتان بلا نص تحت 480px)، بـ`aria-pressed`،
 * ومساحة لمس ≥ 44px (`.ink-btn` في style.css). ومع `custom`: حبّة ثالثة لآخر لون مخصّص (لا تظهر قبل أول اختيار)،
 * ثم دائرة الألوان (`<input type=color>`، والالتزام عند `change` وحده، ولا تُضاف إن لم يدعمها المتصفح).
 * الضغط يحفظ الاختيار على الجهاز ثم يستدعي `onChange`.
 * `testId` يُلحق بـ`data-test`: `${testId}-black` و`-blue` و`-custom` و`-more` و`-note`.
 */
export function inkPicker(opts: InkOpts<InkName> & { custom?: false }): InkPicker<InkName>;
export function inkPicker(opts: InkOpts<Ink> & { custom: true }): InkPicker<Ink>;
// التوقيعان أعلاه هما العقد، وهذا التنفيذ يخدمهما
export function inkPicker(opts: InkOpts<any> = {}): InkPicker<Ink> {
  const custom = !!opts.custom;
  let cur: Ink = opts.value !== undefined && (custom ? isInk(opts.value) : isInkName(opts.value)) ? opts.value : custom ? loadInkAny() : loadInk();
  let last = custom ? loadInkCustom() : null;
  const text = { black: S4.inkBlack, blue: S4.inkBlue }, label = { black: S4.inkBlackLabel, blue: S4.inkBlueLabel };
  const tid = (s: string) => (opts.testId ? `${opts.testId}-${s}` : undefined);
  const pick = (v: Ink) => {
    if (cur === v) return;
    set(v);
    saveInk(v);
    opts.onChange?.(v);
  };
  const btns = NAMES.map((name) => {
    const dot = h("span", { class: "ink-dot", "aria-hidden": "true" });
    dot.style.backgroundColor = INK[name]; // CSSOM لا سمة style، فلا تمنعه سياسة الأمان
    const b = h("button", {
      class: "ink-btn", type: "button", "data-ink": name, "aria-label": label[name], "data-test": tid(name),
      onclick: () => pick(name),
    }, dot, h("span", { class: "ink-text" }, text[name]));
    return [name as Ink, b] as const;
  });
  const extra: HTMLElement[] = [];
  let customBtn: HTMLButtonElement | null = null, customDot: HTMLElement | null = null, more: HTMLInputElement | null = null;
  if (custom && colorInputOk()) {
    customDot = h("span", { class: "ink-dot", "aria-hidden": "true" });
    customBtn = h("button", {
      class: "ink-btn ink-custom", type: "button", "data-ink": "custom", "aria-label": S4.inkCustom, "data-test": tid("custom"), hidden: true,
      onclick: () => { if (last) pick(last); },
    }, customDot) as HTMLButtonElement;
    more = h("input", { class: "ink-more", type: "color", "aria-label": S4.inkMore, title: S4.inkMore, "data-test": tid("more") }) as HTMLInputElement;
    more.addEventListener("change", () => {
      const v = more!.value;
      if (!isHexInk(v)) return; // ما يعطيه المتصفح «#rrggbb» دائماً، والحارس قبل أي رسم أو حفظ
      pick(v.toUpperCase() as Ink);
    });
    extra.push(customBtn, more);
  }
  const note = h("p", { class: "ink-note", role: "status", "data-test": tid("note") });
  const set = (v: Ink) => {
    if (!isInk(v) || (!customBtn && !isInkName(v))) return;
    cur = isHexInk(v) ? (v.toUpperCase() as Ink) : v;
    if (isHexInk(cur)) last = cur;
    if (customBtn && customDot && last) {
      customDot.style.backgroundColor = last; // بعد الحارس: ستّ خانات ست عشرية وحدها
      customBtn.hidden = false;
      customBtn.classList.toggle("light", isLightInk(last)); // حلقة رمادية: يُرى الفاتح على الأبيض
      if (more) more.value = last.toLowerCase();
    }
    for (const [n, b] of btns) b.setAttribute("aria-pressed", String(n === cur));
    customBtn?.setAttribute("aria-pressed", String(isHexInk(cur)));
    note.textContent = customBtn && isLightInk(cur) ? S4.inkLightNote : "";
  };
  set(cur);
  const el = h("div", { class: opts.compact ? "ink-picker compact" : "ink-picker" }, ...btns.map(([, b]) => b), ...extra);
  return { el, note, value: () => cur, set };
}
