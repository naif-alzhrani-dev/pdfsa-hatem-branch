/**
 * عنصر النصّ: يكتب المستخدم نصاً (اسمه، أو مقالاً بأسطر) فيُرسم PNG شفافاً بخطّ المنصة وحبره، ويوضع على الصفحة كالتاريخ.
 * هنا: اللفّ والرسم، وآخر نصّ على الجهاز، وجسم ورقة «أضف نصاً». ووضعه على الصفحة وحفظه في main.ts بنمط التاريخ.
 * طلبا نايف ٢٠٢٦/١١/٠٨ و٢٠٢٦/١١/١٠ (docs/logs/phase1/text-long.md).
 */
import { h } from "./dom";
import { inkColor, inkPicker, loadInkAny, type Ink } from "./ink";
import { S, S4 } from "./strings";
import type { WebFontKey } from "./font-load";
import { ensurePickFont, familyOf, fontPicker, loadPickFont } from "./font-pick";

/** حدّ النصّ القصير (سطر واحد): تستعمله العلامة المائية (src/tools/watermark.ts)، وكان حدّ عنصر النصّ قبل الأسطر. */
export const TEXT_MAX = 80;
/**
 * أقصى عدد لحروف عنصر النصّ: ما يملأ صفحة A4 بالحجم الافتراضي (16.7pt) وعرض اللفّ الافتراضي (80٪ من الصفحة).
 * القياس في docs/logs/phase1/text-long-log.md.
 */
export const LONG_TEXT_MAX = 2600;
/** المحاذاة فيزيائية: «يمين» يمين الصفحة دائماً، ولو كان النصّ إنجليزياً. */
export type TextAlign = "right" | "center" | "left";
/** `font` غير معطى ← خط المنصة (عناصر ما قبل اختيار الخط، وأرقام الصفحات). */
/** `boxEm`: عرض مربّع النصّ بالـem (بلا الهامش)، ثابت منذ إنشائه، والمحاذاة تحرّك الأسطر داخله ولا تحرّك المربّع
 *  (قرار نايف ٢٠٢٦/١١/١٥، كمربّع «+» في «إعداد خطاب»). وغيابه (النصّ القديم و«توقيع ملف»): اللوحة بعرض أطول سطر كما كانت. */
export type TextVal = { text: string; ink: Ink; align?: TextAlign; font?: WebFontKey; boxEm?: number };

const KEY = "pdfsa.text";
/** آخر نصّ أُضيف على هذا الجهاز، و«» إن لم يُضف أو تعذّرت القراءة. */
export function loadLastText(): string {
  try { return (localStorage.getItem(KEY) ?? "").slice(0, LONG_TEXT_MAX); } catch { return ""; }
}
export function saveLastText(text: string): void {
  try { localStorage.setItem(KEY, text); } catch { /* تخزين معطّل: يُكتب من جديد في المرة القادمة */ }
}

/**
 * الاتجاه الأساسي كما يحسبه `dir="auto"`: أول حرف قويّ. عربي ← rtl، ولاتيني ← ltr، وبلا حرف قويّ ← rtl.
 * فيُرسم النصّ على الصفحة كما ظهر في الحقل («Naif الزهراني» يبدأ من اليسار، و«نايف Z» من اليمين).
 */
export function baseDir(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    if (/[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch)) return "rtl";
    if (/\p{L}/u.test(ch)) return "ltr";
  }
  return "rtl";
}
/** المحاذاة المختارة، وإلا ما يتبع اتجاه النصّ: يمين للعربي، ويسار للإنجليزي. */
export const alignOf = (v: TextVal): TextAlign => v.align ?? (baseDir(v.text) === "rtl" ? "right" : "left");

/** وسم العنصر على الصفحة: الأسطر مسافات، ويُقصّ إلى 40 حرفاً. */
export function labelText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40).trimEnd()}…` : t;
}

/**
 * لفّ الكلمات داخل `maxW`: كل Enter سطر جديد، والسطر الفارغ يبقى. والسطر الذي يتّسع يبقى كما كُتب،
 * والكلمة الأطول من العرض (رابط مثلاً) تُقطع حرفاً حرفاً حتى لا تفيض.
 */
export function wrapLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  const pieces = (w: string): string[] => {
    if (measure(w) <= maxW) return [w];
    const parts: string[] = [];
    let cur = "";
    for (const ch of Array.from(w)) {
      if (cur && measure(cur + ch) > maxW) { parts.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  };
  for (const para of text.split("\n")) {
    if (measure(para) <= maxW) { out.push(para.trimEnd()); continue; }
    let line = "";
    for (const w of para.trim().split(/\s+/)) {
      for (const p of pieces(w)) {
        const cand = line ? `${line} ${p}` : p;
        if (line && measure(cand) > maxW) { out.push(line); line = p; } else line = cand;
      }
    }
    out.push(line);
  }
  return out;
}

const REF = 96; // بكسل خطّ القياس: الأسطر تُلفّ مرة واحدة به، وتبقى كما هي بأي حجم يُرسم به النصّ
const LH = 1.35, PAD = 0.12; // ارتفاع السطر والهامش كسراً من حجم الخطّ (كما كان للسطر الواحد)

/** أسطر النصّ ملفوفة بعرض `wrapEm` من حجم الخطّ، وعرض أطولها وارتفاع اللوحة بالـem. */
export type TextLayout = { lines: string[]; dir: "rtl" | "ltr"; wEm: number; hEm: number; boxEm?: number };
export async function textLayout(text: string, wrapEm: number, font?: WebFontKey, boxEm?: number): Promise<TextLayout> {
  await ensurePickFont(font);
  const f = `500 ${REF}px ${familyOf(font)}`;
  await document.fonts.load(f, text);
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = f;
  ctx.direction = baseDir(text);
  const m = (s: string) => ctx.measureText(s).width;
  const lines = wrapLines(text, (boxEm ?? wrapEm) * REF, m);
  const pad = Math.ceil(REF * PAD) / REF;
  const wEm = boxEm ?? Math.max(...lines.map(m)) / REF;
  return { lines, dir: baseDir(text), wEm: wEm + 2 * pad, hEm: lines.length * LH + 2 * pad, boxEm };
}

/**
 * يُرسم النصّ بخطّ التاريخ نفسه (المنصة، 500) وبحبره، بلا خلفية، سطراً سطراً بمحاذاته داخل عرض أطول سطر.
 * والسطر الواحد يُرسم كما كان قبل الأسطر بالبكسل: في وسط لوحة بعرضه.
 */
export async function drawText(val: TextVal, lay: TextLayout, font: number): Promise<HTMLCanvasElement> {
  await ensurePickFont(val.font);
  const f = `500 ${font}px ${familyOf(val.font)}`;
  await document.fonts.load(f, val.text);
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d")!;
  ctx.font = f;
  const pad = Math.ceil(font * PAD), lh = font * LH;
  const widths = lay.lines.map((l) => ctx.measureText(l).width);
  const maxW = lay.boxEm ? Math.max(lay.boxEm * font, ...widths) : Math.max(...widths); // المربّع: بعرضه الثابت
  c.width = Math.ceil(maxW + 2 * pad);
  c.height = Math.ceil(lh * lay.lines.length + 2 * pad);
  ctx = c.getContext("2d")!; // تغيير المقاس يعيد ضبط اللوحة
  ctx.font = f;
  ctx.direction = lay.dir; // لوحة خارج الصفحة اتجاهها ltr
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inkColor(val.ink);
  const k = { left: -0.5, center: 0, right: 0.5 }[alignOf(val)];
  const n = lay.lines.length;
  lay.lines.forEach((l, i) => {
    if (l) ctx.fillText(l, c.width / 2 + (maxW - widths[i]!) * k, c.height / 2 + (i - (n - 1) / 2) * lh);
  });
  return c;
}

/** أكبر حجم خطّ تبقى به اللوحة دون `area` بكسلاً (والنصّ الطويل لا يُرسم بـ96 فتتجاوز لوحته حدّ Safari). */
const fontForArea = (lay: TextLayout, area: number) => Math.floor(Math.sqrt(area / (lay.wEm * lay.hEm)));
const SCREEN_AREA = 4e6, SCREEN_W = 1600;

/** سطر واحد بلا لفّ بحجم `font` (رقم الصفحة في src/tools/page-numbers.ts)، كما كان قبل الأسطر. */
export async function textCanvas(val: TextVal, font: number): Promise<HTMLCanvasElement> {
  return drawText(val, await textLayout(val.text, Infinity, val.font), font);
}
/** لوحة العرض على الشاشة: بـ`font` للنصّ القصير كما كان، وأصغر للطويل. ويُرجع حجم الخطّ لمقياس الصندوق. */
export async function textCanvasScreen(val: TextVal, font: number, wrapEm: number): Promise<{ canvas: HTMLCanvasElement; font: number }> {
  const lay = await textLayout(val.text, wrapEm, val.font, val.boxEm);
  const f = Math.max(8, Math.min(font, fontForArea(lay, SCREEN_AREA), Math.floor(SCREEN_W / lay.wEm)));
  return { canvas: await drawText(val, lay, f), font: f };
}
/** لوحة النصّ للملف بعرض لا يقلّ عن `minW` بكسلاً (للحفظ بدقّة ≥ 4x). */
export async function textCanvasFor(val: TextVal, minW: number, font: number, wrapEm: number): Promise<HTMLCanvasElement> {
  const lay = await textLayout(val.text, wrapEm, val.font, val.boxEm);
  font = Math.min(font, fontForArea(lay, SCREEN_AREA));
  let c = await drawText(val, lay, font);
  for (let i = 0; i < 3 && c.width < minW; i++) {
    font = Math.ceil((font * minW * 1.01) / c.width);
    c = await drawText(val, lay, font);
  }
  return c;
}

/** محاذاة النصّ: يمين ثم وسط ثم يسار، أزرار راديو بمظهر `.tool-seg` (مفتاح أداة الترقيم نفسه). */
function alignSeg(value: TextAlign, onChange: (a: TextAlign) => void) {
  const opts: [TextAlign, string][] = [["right", S4.alignRight], ["center", S4.alignCenter], ["left", S4.alignLeft]];
  const inputs = new Map<TextAlign, HTMLInputElement>();
  const el = h("div", { class: "tool-seg", role: "radiogroup", "aria-label": S4.textAlignLabel, "data-test": "text-align" },
    ...opts.map(([v, text]) => {
      const input = h("input", { class: "sr-only", type: "radio", name: "text-align", value: v, checked: v === value, "data-test": `text-align-${v}` }) as HTMLInputElement;
      input.addEventListener("change", () => input.checked && onChange(v));
      inputs.set(v, input);
      return h("label", {}, input, h("span", {}, text));
    }));
  return { el, set: (a: TextAlign) => { inputs.get(a)!.checked = true; } };
}

/**
 * جسم ورقة النصّ: «اكتب النص» وحقله (Enter سطر جديد)، والعدّاد قرب الحدّ، ثم سطر واحد للمحاذاة والحبر
 * (لمى، docs/logs/fonts-layout-lama-spec.md)، ثم الخط، ومعاينة حيّة بالحبر، وزرّ التأكيد (معطّل والحقل فارغ أو مسافات).
 * `initial` غير معطى ← نصّ جديد: آخر نصّ على الجهاز، والحبر والخط الافتراضيان، والزرّ «أضفه إلى الصفحة». ومعطى ← تعديل: «تم».
 * والخط بعد سطر المحاذاة والحبر وقبل المعاينة (لمى): يفتح على خطّ العنصر، والمعاينة تتبدّل بعد تنزيله.
 */
export function textSheetBody(initial: TextVal | null, onDone: (v: TextVal) => void): Node[] {
  let ink: Ink = initial?.ink ?? loadInkAny();
  let picked: TextAlign | undefined = initial?.align; // غير مختارة ← تتبع اتجاه النصّ وهو يُكتب
  let font: WebFontKey = initial ? initial.font ?? "plex" : loadPickFont();
  const input = h("textarea", {
    id: "text-input", class: "text-field", dir: "auto", maxlength: LONG_TEXT_MAX, autocomplete: "off", rows: 2,
    enterkeyhint: "enter", placeholder: S4.textPlaceholder, "data-test": "text-input",
  }) as HTMLTextAreaElement;
  input.value = initial?.text ?? loadLastText();
  const count = h("p", { class: "text-count", role: "status", "data-test": "text-count" });
  const preview = h("p", { class: "text-preview", dir: "auto", "aria-hidden": "true", "data-test": "text-preview" });
  const done = h("button", { class: "btn primary block", type: "button", "data-test": "text-done" }, initial ? S.done : S.placeOnPage) as HTMLButtonElement;
  const value = () => input.value.trim();
  const align = () => alignOf({ text: value(), ink, align: picked });
  const seg = alignSeg(align(), (a) => { picked = a; refresh(); });
  function refresh() {
    preview.textContent = value();
    preview.style.color = inkColor(ink); // CSSOM لا سمة style، فلا تمنعه سياسة الأمان
    preview.style.textAlign = align();
    preview.style.fontFamily = familyOf(font);
    seg.set(align());
    const left = LONG_TEXT_MAX - input.value.length;
    count.hidden = left > 200;
    count.textContent = left > 200 ? "" : S4.textRemaining(left);
    done.disabled = !value();
  }
  const picker = inkPicker({ value: ink, testId: "text-ink", custom: true, compact: true, onChange: (n) => { ink = n; refresh(); } });
  const fonts = fontPicker({ value: font, testId: "text-font", onChange: (k) => { font = k; refresh(); } });
  const submit = () => {
    const text = value();
    if (!text) return;
    saveLastText(text);
    onDone({ text, ink, align: align(), font: fonts.value() });
  };
  input.addEventListener("input", refresh);
  done.addEventListener("click", submit);
  refresh();
  return [
    h("div", { class: "text-entry" }, h("label", { for: "text-input", class: "text-label" }, S4.textLabelField), input, count),
    h("div", { class: "text-style-row" }, seg.el, picker.el),
    picker.note,
    fonts.el,
    preview,
    h("div", { class: "text-done-bar" }, done),
  ];
}
