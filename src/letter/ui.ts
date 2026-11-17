/**
 * واجهة «إعداد خطاب» (مواصفة 👩‍🎨 لمى `docs/logs/letter-lama-spec.md` وملحقها، ونصوص 👩‍🏫 هدى في `SL`).
 * الكتابة في محرّر TipTap (`editor.ts`)، والمعاينة من `engine.layout()` (`preview.ts`)، والحفظ PDF بالمحرّك نفسه.
 * والعناصر الحرّة (توقيع، ختم، شعار، صورة) بنسق «تحرير ملف»: `.item` يُسحب، وشريط التحديد «تكبير/تصغير/إزالة».
 *
 * الترويسة تبقى في ذاكرة الجلسة وحدها ولا تُحفظ على الجهاز: حفظها يحتاج ذكراً في /privacy، وقرار نايف
 * «لا تعدّل شيئاً في سياسة الخصوصية» (docs/logs/letter-deps-amin.md). والشعار من مخزن «ختم أو شعار» القائم.
 */
import { h, icon } from "../dom";
import { S, S4, SE, SL, ar } from "../strings";
import { endHandoff, takeHandoff, type Handoff } from "./handoff";
import { listAssets, addAsset, deleteAsset, type Asset } from "../store";
import { moveRect, scaleRect, limits, clampRect, minWidth, maxWidth } from "../place";
import { ICON_PAGE_FIT } from "../icons";
import { removeBackground } from "../bg-remove";
import { adjust, gregorianOf, hijriOf, inHijriRange, todayDay, type DateMode, type DateUnit } from "../date-fmt";
import { openDrawScreen } from "../draw-screen";
import { askLeave } from "../leave-ask";
import { installBackGuard } from "./back-guard";
import { installScrollTrace } from "./scroll-trace";
import { allowLeave } from "../leave-guard";
import type { Rect } from "../coords";
import { createEditor, editorChars, sysFontClass, TABLES_OK, type LetterEditor } from "./editor";
import { isEmptyDoc, letterDate, SIZES, templateDoc, toLetterDoc, toPMDoc } from "./doc";
import { DEFAULT_FONT, FONT_KEYS, type FontKey } from "./fonts";
import { loadFont } from "../font-load";
import { nameImage, RUQAA_MIN_PT } from "../font-pick";
import { contentBox, frameLines, headerRect, MMPT, PAGE_H, PAGE_W, type Float, type Page } from "./layout";
import { filterFamilies, groupFamilies, inApp, pickFace, restoreFont, systemFonts, type SysFamily, type SysRef } from "./system-fonts";
import { isSysFont, usedFonts, MARGIN_PRESET_KEYS, MARGIN_PRESETS, MARGIN_RANGE, MAX_CHARS, MAX_PAGES, TEXT_BOX_MAX_CHARS, isLimitError, type LetterFont, type Align, type DateCal, type DateForm, type FrameKind, type LetterDoc, type LetterImage, type Margins, type MarginPreset, type PageSetup } from "./model";
import { backgroundEdges, edgeMargins, prepareBackground } from "./background";
import { BACKGROUND_ERROR, containIn } from "./pdf";
import { drawFloat, drawPage, FLOAT_PAD } from "./preview";
import { changedKeys, clone, putAttrs, type LtAttrs, type LtKey } from "./history";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/core";
import { atOpenZoom, clampZoom, DEFAULT_ZOOM, DEFAULT_ZOOM_WIDE, openZoom, pinchOnItem, PX, zoomLevels, zoomOf, zoomPercent, zoomStep, type ZoomKey } from "./zoom";
import type { Engine } from "./engine";
import { DOCKS, loadDock, saveDock, nearestNarrow, nearestWide, magnet, rubber, center, narrowRect, wideRect, type Box, type DockName, type NarrowM, type WideM } from "./rail-dock";
import { RAIL_ICON } from "../icons";

type ItemKind = "signature" | "stamp" | "logo" | "image" | "text" | "date";
/**
 * عنصر حرّ في «معاينة الصفحة»: صورة (`img`)، أو مربّع نصّ (`tb`: محرّره على الصفحة في «الكتابة»)، أو التاريخ (v2 الدفعة و).
 * وللنصّيَّين لوحة (`canvas`) يُرسم عليها نصّهما من المحرّك، و`fh` من التخطيط.
 */
interface Item { id: string; kind: ItemKind; page: number; fx: number; fy: number; fw: number; fh: number; img?: LetterImage; url?: string; el: HTMLElement; tb?: { ed: LetterEditor; host: HTMLElement }; canvas?: HTMLCanvasElement; w?: HTMLElement }
/** أدنى عرض لمربّع النصّ بالمليمتر، وعرضه عند الإضافة */
const TEXT_MIN_W = 20, TEXT_W = 70;

const WIDE = matchMedia("(min-width: 1024px)");
/** عرض صفّ شريط الكمبيوتر الكامل والمتوسط من داخله، بقياس 40 (docs/logs/letter-desk-bar-lama.md).
 *  والتراجع والإعادة (١٤) في الشريط العلوي على الكمبيوتر لا هنا (قرار لمى، اعتمده المدير)، فلا يدخلان الحساب */
const ROW_FULL = 901, ROW_MID = 733;
/** برنامج ويندوز: فيه «خطوط الجهاز» (W14). وفي الموقع والجوال لا قسم ولا طلب لـ`/list` */
const APP = inApp();
const MM_X = 1 / 210, MM_Y = 1 / 297;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** العمود الجانبي (مواصفة لمى (ب)): مدد الحركة بالمللي ثانية، فتحاً وطيّاً، والشفافية مع تقليل الحركة */
const RAIL_IN = 200, RAIL_OUT = 160, RAIL_FADE = 120;
/** قرار نايف: «عند الكتابه تختفي يمين واذا ارادها استدعاها»، فيُطوى العمود مع أول حرف يُكتب أو يُحذف. وتوصية لمى بإبقائه مفتوحاً لم يُجَب عنها: false يلغي الطيّ */
const RAIL_FOLD_ON_TYPE = true;
/** موضع العمود (مواصفة لمى الطافية §٥، docs/logs/letter-rail-float-lama-spec.md): جدولٌ واحد للحافّة والمحور والحركة والسهم وما يشغله في الأسفل وموضع ما يفتحه.
 *  قرار نايف (٢٠٢٦/١١/١٢): «ستّة مواضع»، أربعة رأسية في الأركان واثنان أفقيّان بعرض الشاشة. والحافّة والمحور مشتقّان من الاسم.
 *  ١٦ (docs/logs/letter-rail-dock-lama-spec.md): المواضع الستّة مبنيّة، والسحب والإرساء والتذكّر في mount، والحساب في rail-dock.ts */
type RailDock = DockName;
type DockEdge = "right" | "left" | "top" | "bottom";
const dockEdge = (d: DockName) => d.split("-")[0] as DockEdge;
const dockAxis = (d: DockName): "v" | "h" => (dockEdge(d) === "right" || dockEdge(d) === "left" ? "v" : "h"); // يمين ويسار رأسيّ، وأعلى وأسفل أفقيّ
/** التحويل الذي يخرج به العمود إلى حافّته، للحركة وحدها لا للحال المستقرّة (§٥-٣) */
const HIDE: Record<DockEdge, string> = { right: "translateX(100%)", left: "translateX(-100%)", top: "translateY(-100%)", bottom: "translateY(100%)" };
type DockSpec = {
  icon: "toRight" | "toLeft" | "toUp" | "toDown"; // سهم زرّ الإغلاق إلى حافّة الطيّ (railIcon)
  occupyBottom: number; // ما يشغله العمود فوق حبّة الدرجة (--rail-occupy-bottom)، 52 في «bottom» (١٦ §٤-ب)
  /** موضع ما يفتحه العمود (قائمة المحاذاة، و«نقل إلى…») بعيداً عن حافّته بفجوة 8 ومقيّداً بـ8 من النافذة (§٤-د): inset-inline-start وinset-block-start */
  menu: (box: DOMRect, btn: DOMRect, m: HTMLElement) => { start: number; top: number };
};
const clampTop = (y: number, m: HTMLElement) => Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8));
const clampStart = (x: number, m: HTMLElement) => Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8));
// RTL: inset-inline-start يُقاس من يمين الشاشة
const toLeftOf = (box: DOMRect, btn: DOMRect, m: HTMLElement) => ({ start: clampStart(innerWidth - box.left + 8, m), top: clampTop(btn.top, m) });
const toRightOf = (box: DOMRect, btn: DOMRect, m: HTMLElement) => ({ start: clampStart(innerWidth - box.right - 8 - m.offsetWidth, m), top: clampTop(btn.top, m) });
const RAIL_DOCKS: Record<RailDock, DockSpec> = {
  "right-bottom": { icon: "toRight", occupyBottom: 0, menu: toLeftOf },
  "right-top": { icon: "toRight", occupyBottom: 0, menu: toLeftOf },
  "left-bottom": { icon: "toLeft", occupyBottom: 0, menu: toRightOf },
  "left-top": { icon: "toLeft", occupyBottom: 0, menu: toRightOf },
  top: { icon: "toUp", occupyBottom: 0, menu: (box, btn, m) => ({ start: clampStart(innerWidth - btn.right, m), top: clampTop(box.bottom + 8, m) }) },
  bottom: { icon: "toDown", occupyBottom: 52, menu: (box, btn, m) => ({ start: clampStart(innerWidth - btn.right, m), top: clampTop(box.top - 8 - m.offsetHeight, m) }) },
};

/* ───────── الخطوط: تُحمَّل عند اختيارها (البند ١١)، بـ`loadFont` المشتركة مع أدوات الكتابة (src/font-load.ts) ───────── */
/** خطوط الجهاز (برنامج ويندوز): الوجهان (العادي المحفوظ والعريض الأقرب) من بايتاتهما بـFontFace، لا url() (عقد W14). واسمها في CSS مولَّد */
const sysCss = new Map<string, Promise<string>>();
let sysN = 0;
const sysKey = (r: SysRef) => `${r.family}\u0000${r.face}`;
function loadSysFont(r: SysRef): Promise<string> {
  const key = sysKey(r);
  let p = sysCss.get(key);
  if (p) return p;
  const name = `L sys ${++sysN}`;
  p = Promise.all([systemFonts().face(r, false), systemFonts().face(r, true)]).then(async ([a, b]) => {
    const one = a.font.family === b.font.family && a.font.face === b.font.face; // عائلة بوجه واحد: هو للعريض أيضاً، كما في PDF
    const faces = one ? [new FontFace(name, a.bytes.slice().buffer, { weight: "100 900" })] : [new FontFace(name, a.bytes.slice().buffer, { weight: "400" }), new FontFace(name, b.bytes.slice().buffer, { weight: "700" })];
    for (const f of await Promise.all(faces.map((x) => x.load()))) document.fonts.add(f);
    return name;
  });
  sysCss.set(key, p);
  p.catch(() => sysCss.delete(key));
  return p;
}
const sysName = new Map<string, string>();
/** خط الجهاز على مقطع في المحرّر (`lfs-<رقم>`، src/letter/editor.ts): قاعدته في ورقة أنماط بـCSSOM، لا style ولا <style> (سياسة الأمان) */
let sysSheet: CSSStyleSheet | null = null;
const sysRuled = new Set<string>();
function sysRule(r: SysRef, name: string) {
  const c = sysFontClass(r);
  if (sysRuled.has(c)) return;
  try {
    if (!sysSheet) { sysSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sysSheet]; }
    sysSheet.insertRule(`.${c} { --lf: "${name}", serif; }`);
    sysRuled.add(c);
  } catch { /* متصفح بلا ورقة أنماط مبنيّة: المقطع على الشاشة بخط الخطاب، وفي PDF بخطّه */ }
}
const ensureFont = async (f: LetterFont): Promise<void> => {
  if (!isSysFont(f)) return loadFont(f);
  const name = await loadSysFont(f);
  sysName.set(sysKey(f), name);
  sysRule(f, name);
};
/** كل خط مستعمل في الخطاب (خطّه وخطوط المقاطع): قبل الحفظ وعند التحميل الأول */
const ensureUsed = (d: LetterDoc) => Promise.all(usedFonts(d).map(ensureFont));
const fontName = (f: LetterFont) => (isSysFont(f) ? f.family : SL.fonts[f]);
const sameFont = (a: LetterFont, b: LetterFont) => (isSysFont(a) && isSysFont(b) ? a.family === b.family && a.face === b.face : a === b);
/** خط الخطاب على عنصر: صنف `lf-<المفتاح>` للثمانية، أو `--lf` باسم خط الجهاز المحمَّل. و`null` (المختلط): خط الواجهة */
function applyLf(el: HTMLElement, f: LetterFont | null) {
  for (const c of [...el.classList]) if (c.startsWith("lf-")) el.classList.remove(c);
  el.style.removeProperty("--lf");
  el.classList.toggle("lt-mixed", !f);
  if (!f) return;
  if (!isSysFont(f)) el.classList.add(`lf-${f}`);
  else el.style.setProperty("--lf", `"${sysName.get(sysKey(f)) ?? ""}", serif`);
}

/* ───────── الصور ───────── */
function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}
/** صورة من ملف إلى PNG (أو JPEG للصور الفوتوغرافية)، مصغّرةً إلى ٢٤٠٠ بكسل، ومحترمةً اتجاه الصورة. */
async function fileImage(file: File): Promise<LetterImage | "not-image" | "bad"> {
  if (file.type && !file.type.startsWith("image/")) return "not-image";
  let img: HTMLImageElement;
  try { img = await decode(file); } catch { return file.type ? "bad" : "not-image"; }
  const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = h("canvas") as HTMLCanvasElement;
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const jpg = file.type === "image/jpeg";
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, jpg ? "image/jpeg" : "image/png", 0.9));
  if (!blob) return "bad";
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: jpg ? "jpg" : "png", w: c.width, h: c.height };
}
const assetImage = (a: Asset): LetterImage => ({ bytes: new Uint8Array(a.png), type: "png", w: a.w, h: a.h });
const urlOf = (i: LetterImage) => URL.createObjectURL(new Blob([i.bytes.slice().buffer], { type: i.type === "png" ? "image/png" : "image/jpeg" }));

/**
 * مقابض e2e (ملاحظة 🕵️ أمين ن٥ على L2): `pdfsaLetterUI` و`pdfsaLetterFont` و`__letterPdf` هنا و`pdfsaLetter` في page.ts لا تُعلَّق
 * على window إلا إذا وضع الاختبار `window.__pdfsaTest = true` قبل تحميل الصفحة (addInitScript)، على طريقة `__openStallMs` في main.ts.
 * فلا تبقى في الإنتاج نسخة PDF الخطاب الأخير ولا المحرّر وحالته. ولا يصلح import.meta.env: e2e يعمل على بناء الإنتاج (vite preview).
 */
export const E2E = (window as unknown as { __pdfsaTest?: boolean }).__pdfsaTest === true;

/** التاريخ كما يُرسم (v2 الدفعة ب): بلا هجري (خارج جدول أم القرى) فالميلادي وحده، و«سطر واحد» مع تقويم واحد يُعدّ «يميناً». */
type LetterDate = { day: number; cal: DateCal; form: DateForm; at?: { fx: number; fy: number } };
function dateNow(d: LetterDate) {
  const t = letterDate(d.day);
  const cal: DateCal = t.hijri ? d.cal : "gregorian";
  const form: DateForm = cal !== "both" && d.form === "line" ? "right" : d.form;
  return { ...t, cal, form };
}
/** ما يظهر على الورقة سطراً سطراً، وما يُسمع (ن١٥) */
function dateTexts(d: LetterDate): { lines: string[]; aria: string } {
  const t = dateNow(d);
  if (t.cal !== "both") { const v = t.cal === "hijri" ? t.hijri : t.gregorian; return { lines: [S4.dateLabel(v)], aria: SL.dateAria(v) }; }
  if (t.form === "line") return { lines: [SL.dateHijri(t.hijri), SL.dateGregorian(t.gregorian)], aria: SL.dateAria(`${t.hijri}، ${SL.dateGregorian(t.gregorian)}`) };
  return { lines: [t.hijri, t.gregorian], aria: SL.dateAria(`${t.hijri}، ${t.gregorian}`) };
}

export function bootLetter(root: HTMLElement, getEngine: () => Promise<Engine>) {
  /** مستمعو `document` الجديدان (سحب المقبض وقائمة «نقل إلى…»). `bootLetter` تُستدعى مرّة لكل تحميل صفحة، فيُبطَلان عند المغادرة نهائياً؛ وpersisted (bfcache) تعود حيّة فلا تُبطَل */
  const docAbort = new AbortController(), docSignal = docAbort.signal;
  addEventListener("pagehide", (e) => { if (!e.persisted) docAbort.abort(); });
  let dirtyNow = false;
  let backRefresh = () => {}; // الرجوع بالسجلّ (back-guard.ts) يتبع `st.dirty`: كل تغيير فيه يطلب التوازن
  const st = {
    font: DEFAULT_FONT as LetterFont,
    /** «هوامش الصفحة» (v2 الدفعة ج): الدرجة، والأعلى والأسفل بالمليمتر (مخصّصان إن خالفا الدرجة) */
    margins: { preset: "normal", top: 25, bottom: 25 } as Margins,
    frame: "none" as FrameKind,
    /** صورة الخلفية، و`assetId` المحفوظ منها على الجهاز (الدفعة ز، قرار نايف ٢٠٢٦/١١/١٢). ولا تُطبَّق محفوظةٌ وحدها في خطاب جديد */
    background: null as null | { img: LetterImage; url: string; assetId: string | null },
    header: null as null | { img: LetterImage; url: string; on: "first" | "all" },
    /** لا تاريخ في خطاب جديد، ويُضاف من «+» (قرار نايف ٢٠٢٦/١١/١٢) */
    date: null as null | LetterDate,
    items: [] as Item[],
    selected: null as Item | null,
    view: "write" as "write" | "preview",
    pages: [] as Page[],
    get dirty() { return dirtyNow; },
    set dirty(v: boolean) { dirtyNow = v; backRefresh(); },
    saving: false,
    panel: "none" as "none" | "plus" | "font",
    kb: 0,
    lastKb: 300,
    /** درجة «الكتابة» (v2 الدفعة د): المسمّاة، أو null بعد التقريب بالإصبعين. للجلسة وحدها */
    zoom: { key: (WIDE.matches ? DEFAULT_ZOOM_WIDE : DEFAULT_ZOOM) as ZoomKey | null, z: 1 },
    /** «تحرير الملف» (الدفعة ٣): اسم ملف الـPDF من اسم ملف Word، وبلاه اسم الخطاب */
    pdfName: null as string | null,
  };

  /* ───────── الهيكل ───────── */
  const title = h("h1", { class: "lt-title" }, SL.title);
  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": S.close, "data-test": "letter-close", onclick: () => leave() }, icon("close"));
  const topSpacer = h("span", { class: "icon-spacer" });
  const topEnd = h("div", { class: "lt-top-end" }); // على WIDE: التلميح ثم «حفظ الملف» مكان الفاصل (مواصفة لمى letter-save-top §١)
  const top = h("header", { class: "topbar lt-top" }, closeBtn, title, topSpacer);
  const radio = (name: string, value: string, label: string, checked: boolean, on: () => void) => {
    const inp = h("input", { type: "radio", name, value, class: "sr-only", checked }) as HTMLInputElement;
    inp.addEventListener("change", () => { if (inp.checked) on(); });
    return h("label", { "data-test": `${name}-${value}` }, inp, h("span", {}, label));
  };
  const seg = h("div", { class: "tool-seg lt-seg", role: "radiogroup", "aria-label": SL.view },
    radio("lt-view", "write", SL.write, true, () => setView("write")),
    radio("lt-view", "preview", SL.preview, false, () => setView("preview")));

  // بطاقة «شكل الصفحة»
  const thumb = h("span", { class: "lt-thumb", "aria-hidden": "true" });
  const cardName = h("span", { class: "lt-card-name" });
  const cardSum = h("span", { class: "lt-card-sum" });
  const setupCard = h("button", { class: "lt-setup", type: "button", "data-test": "letter-setup", onclick: () => openSetup() },
    thumb, h("span", { class: "lt-card-text" }, cardName, cardSum), h("span", { class: "lt-change" }, SL.change));
  const tplTop = h("button", { class: "text-btn lt-tpl-top", type: "button", "data-test": "letter-template-top", onclick: () => useTemplate() }, SL.template);

  // المحرّر على ورقة
  // التاريخ على الورقة: زرّ يفتح «تعديل التاريخ» في «الكتابة» (مواصفة لمى v2 §٥)، والمعاينة لوحة لا تُلمس
  const dateEl = h("div", { class: "lt-date", role: "button", tabindex: 0, hidden: true, "data-test": "lt-date", onclick: () => openDateSheet() });
  dateEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDateSheet(); } });
  /** مقبض التاريخ في «الكتابة» (مواصفة لمى، تحريك العناصر §٢): لمسة التاريخ تفتح «تعديل التاريخ»، والسحب من المقبض */
  const wGrip = () => { const g = h("span", { class: "lt-wgrip", "aria-hidden": "true", "data-test": "lt-wgrip" }); g.addEventListener("click", (e) => e.stopPropagation()); return g; };
  const dateGrip = wGrip();
  const mount = h("div", { class: "lt-pm" });
  const tplBtn = h("button", { class: "lt-tpl", type: "button", "data-test": "letter-template", onclick: () => useTemplate() }, SL.template);
  const emptyEl = h("div", { class: "lt-empty" }, h("p", { "aria-hidden": "true" }, SL.empty), tplBtn);
  // مربّعات النصّ فوق المتن بمواضعها من الصفحات (v2 الدفعة و)، ولا تدخل تدفّقه
  const boxLayer = h("div", { class: "lt-boxes", "data-test": "lt-boxes" });
  // نسخ العناصر المصوَّرة في «الكتابة» فوق كل النصّ، بترتيب رسم PDF (pdf.ts: النصّ ثم الصور)
  const wLayer = h("div", { class: "lt-wimgs", "data-test": "lt-wimgs" });
  const paper = h("div", { class: "lt-editor lf-naskh" }, dateEl, h("div", { class: "lt-body" }, mount, emptyEl), boxLayer, wLayer);
  // الكتابة على الصفحة (v2 الدفعة د، مواصفة لمى §٢): الصفحات خلف المحرّر بمقاسها مضروباً في الدرجة، وحدودها من المحرّك
  const pagesBack = h("div", { class: "lt-wpages", "aria-hidden": "true" });
  const sheetBox = h("div", { class: "lt-sheetbox", "data-test": "lt-sheetbox" }, pagesBack, paper);
  const stage = h("div", { class: "lt-stage fit", "data-test": "lt-stage" }, sheetBox);
  // لمسة على الصفحة تحت النصّ تضع المؤشّر في آخره
  sheetBox.addEventListener("click", (e) => { if (e.target === sheetBox || e.target === paper) le.ed.commands.focus("end"); });
  // حبّة الدرجة: «−» والقيمة و«+» (عدسة بـ− و+، فـ«+» وحده محجوز لـ«إدراج»)
  const lens = (plus: boolean) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M7.5 10.5h6${plus ? "M10.5 7.5v6" : ""}"/></svg>`;
  const zbtn = (cls: string, label: string, test: string, onclick: () => void, html = "") => {
    const b = h("button", { class: cls, type: "button", "aria-label": label, "data-test": test, onclick }) as HTMLButtonElement;
    if (html) b.innerHTML = html;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // يبقى المؤشّر في المحرّر
    return b;
  };
  const zOut = zbtn("lt-zbtn", SL.zoomOut, "lt-zoom-out", () => stepZoom(-1), lens(false));
  const zIn = zbtn("lt-zbtn", SL.zoomIn, "lt-zoom-in", () => stepZoom(1), lens(true));
  // ١٥: «الحجم الأصلي» بعد «+» بفجوة 8px خارج الثلاثي، يعيد درجة الفتح (لا ١٠٠٪)
  const zReset = zbtn("lt-zbtn lt-zreset", SL.zoomReset, "lt-zoom-reset", () => resetZoom(), ICON_PAGE_FIT);
  zReset.title = SL.zoomReset;
  const zVal = zbtn("lt-zval", "", "lt-zoom-val", () => toggleZoomMenu());
  zVal.setAttribute("aria-haspopup", "menu");
  zVal.setAttribute("aria-expanded", "false");
  const zoomPill = h("div", { class: "lt-zoom", "data-test": "lt-zoom" }, zOut, zVal, zIn, zReset);
  const zoomMenu = h("div", { class: "lt-menu lt-zmenu", role: "menu", hidden: true, "data-test": "lt-zoom-menu" });
  const counter = h("p", { class: "lt-count", "aria-live": "polite", "data-test": "letter-count" });

  // أزرار التنسيق: عنصر واحد لكل وظيفة، يُنقل بين شريط الكمبيوتر وشريط الجوال
  const tb = (ic: string, label: string, onclick: () => void, test: string) => {
    const b = h("button", { class: "lt-tb", type: "button", "aria-label": label, "data-test": test, onclick }) as HTMLButtonElement;
    b.innerHTML = ic;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // يبقى المؤشّر في المحرّر ولوحة المفاتيح مفتوحة
    return b;
  };
  const I = {
    plus: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    bold: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg>`,
    right: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>`,
    center: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>`,
    justify: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>`,
    left: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>`,
    split: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 10h16M13 15h7M4 15h4"/><path d="M11 13v4" stroke-width="1.5" stroke-dasharray="1 1.5"/></svg>`,
    ol: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M4 12h10M4 18h10"/><path d="M18 5v3M19 11.5h-2l2 2.5h-2M17 17h2v2h-2" stroke-width="1.5"/></svg>`,
    ul: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 12h12M4 18h12"/><circle cx="19.5" cy="6" r="1.2" fill="currentColor"/><circle cx="19.5" cy="12" r="1.2" fill="currentColor"/><circle cx="19.5" cy="18" r="1.2" fill="currentColor"/></svg>`,
    caret: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`,
    sig: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-6 5-9 7-9 3 0-2 9 1 9 2 0 3-4 5-4 1 0 1 2 2 2s2-1 3-2M3 21h18"/></svg>`,
    stamp: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/></svg>`,
    image: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
    logo: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>`,
    tbox: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke-dasharray="3 2.2"/><path d="M8.5 9h7M12 9v6.5"/></svg>`,
    page: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3h12v6H6zM6 15h12v6H6z"/><path d="M3 12h3M9 12h2M13 12h2M18 12h3"/></svg>`,
    chev: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>`,
    // مقبض العمود (§٣): «أدوات» مطويّاً، وسهم إلى اليمين مفتوحاً
    tools: `<svg class="i-tools" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>`,
    toRight: `<svg class="i-hide" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
    hand: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5 5 0 0 1-3.9-1.9L5.4 15.8a1.6 1.6 0 0 1 2.4-2.1L9 15"/></svg>`,
  };
  // المحاذاة: يمين، وسط، يسار، ضبط، ثم بعد فاصل «يمين ويسار» (مواصفة لمى §٣ و§٧ و§٨)
  type Mode = Align | "split";
  const ALIGN_ORDER: Align[] = ["right", "center", "left", "justify"];
  const ALIGN_ICON: Record<Mode, string> = { right: I.right, center: I.center, left: I.left, justify: I.justify, split: I.split };
  const ALIGN_SHORT: Record<Mode, string> = { right: S4.alignRight, center: S4.alignCenter, left: S4.alignLeft, justify: SL.justify, split: SL.split };
  const ALIGN_LONG: Record<Mode, string> = { right: SL.alignRight, center: SL.alignCenterLong, left: SL.alignLeftLong, justify: SL.justifyLong, split: SL.split };
  const mode = (): Mode => (act.isSplit() ? "split" : act.align());
  const setMode = (m: Mode) => { if (m === "split") { if (act.canSplit()) act.setSplit(); } else act.setAlign(m); };

  const plusBtn = tb(I.plus, SL.insert, () => (WIDE.matches ? openPop("insert", plusBtn) : togglePanel("plus")), "lt-plus"); // ١٦: العمود على الكمبيوتر يفتح قوائمه لا لوحة الجوال
  plusBtn.classList.add("lt-plus");
  const boldBtn = tb(I.bold, SL.bold, () => act.toggleBold(), "lt-bold");
  const alignBtn = tb("", "", () => toggleAlignMenu(), "lt-align");
  alignBtn.classList.add("lt-alignbtn");
  const alignBtns = ALIGN_ORDER.map((a) => tb(ALIGN_ICON[a], ALIGN_LONG[a], () => act.setAlign(a), `lt-align-${a}`));
  const splitBtn = tb(ALIGN_ICON.split, SL.split, () => setMode("split"), "lt-align-split");
  splitBtn.setAttribute("aria-description", SL.splitLong);
  const olBtn = tb(I.ol, SL.ordered, () => act.toggleList(true), "lt-ol");
  const ulBtn = tb(I.ul, SL.bullet, () => act.toggleList(false), "lt-ul");
  const fontBtn = tb("", "", () => (WIDE.matches ? openPop("font", fontBtn) : togglePanel("font")), "lt-font");
  fontBtn.classList.add("lt-fontbtn");
  const sep = () => h("span", { class: "lt-sep", "aria-hidden": "true" });
  // الكمبيوتر: قوائم «إدراج» و«خط الخطاب» و«مقاس النص»
  const dd = (label: string, test: string, cls: string) => {
    const b = h("button", { class: `lt-dd ${cls}`, type: "button", "aria-haspopup": "true", "aria-expanded": "false", "data-test": test }) as HTMLButtonElement;
    b.setAttribute("aria-label", label);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    return b;
  };
  const insDD = dd(SL.insert, "lt-dd-insert", "lt-dd-ins");
  insDD.innerHTML = I.plus;
  const fontDD = dd(SL.font, "lt-dd-font", "lt-dd-font");
  const sizeDD = dd(SL.size, "lt-dd-size", "lt-dd-size");
  const deskBar = h("div", { class: "lt-bar", role: "toolbar", "aria-label": SL.format });
  // العمود الجانبي على الجوال (مواصفة لمى (ب)): مطويّ بلسانه على حافّة اليمين، ومفتوحاً يقتطع من المسرح 60 وزرّ إغلاقه آخر خانة فيه
  const rail = h("div", { class: "lt-rail", id: "lt-rail", role: "toolbar", "aria-label": SL.format, "aria-orientation": "vertical", "data-test": "lt-rail" });
  const railTab = h("button", { class: "lt-railtab", type: "button", "aria-controls": "lt-rail", "aria-expanded": "false", "aria-label": SL.railShow, "data-test": "lt-rail-tab", onclick: () => setRail(!railOpen) },
    h("span", { class: "lt-railface" })) as HTMLButtonElement;
  (railTab.firstElementChild as HTMLElement).innerHTML = I.tools;
  railTab.addEventListener("mousedown", (e) => e.preventDefault()); // يبقى المؤشّر في المحرّر
  const railClose = h("button", { class: "lt-tb lt-railclose", type: "button", "aria-controls": "lt-rail", "aria-expanded": "true", "aria-label": SL.railTools, "data-test": "lt-rail-close", onclick: () => setRail(false) }) as HTMLButtonElement;
  const railIcon = (d: RailDock) => ({ toRight: I.toRight, ...RAIL_ICON })[RAIL_DOCKS[d].icon];
  railClose.addEventListener("mousedown", (e) => e.preventDefault());
  // ١٦: الموضع محفوظ على الجهاز بمفتاحين (الضيّق والعريض، rail-dock.ts)، والمقبض في الطرف الحرّ للعمود، والأدوات بين طرفيه تُمرَّر
  const dockStore = (() => { try { return localStorage; } catch { return null; } })();
  let railDock: DockName = loadDock(dockStore, false), wideDock: DockName = loadDock(dockStore, true);
  const dockNow = () => (WIDE.matches ? wideDock : railDock);
  const grip = h("button", { class: "lt-tb lt-grip", type: "button", "aria-label": SL.railMove, "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "lt-dock-menu", "data-test": "lt-rail-grip" }) as HTMLButtonElement;
  if (matchMedia("(pointer: fine)").matches) grip.title = SL.railMoveTitle; // بالفأرة وحدها (نصّ هدى §١٦)
  const railTools = h("div", { class: "lt-railtools" });
  const railBox = h("div", { class: "lt-railbox", hidden: true, "data-test": "lt-railbox", "data-dock": railDock, "data-axis": dockAxis(railDock) }, rail, railTab);
  const dockMenu = h("div", { class: "lt-menu lt-dockmenu", id: "lt-dock-menu", role: "menu", "aria-label": SL.railMoveTo, hidden: true, "data-test": "lt-dock-menu" });
  const dockLive = h("p", { class: "sr-only", "aria-live": "polite", "data-test": "lt-rail-live" });
  const zones = h("div", { class: "lt-dzs", hidden: true, "aria-hidden": "true" }, ...DOCKS.map((d) => h("div", { class: "lt-dz", "data-dz": d })));
  const marker = h("div", { class: "lt-dmark", hidden: true, "aria-hidden": "true" });
  marker.innerHTML = RAIL_ICON.gripH + I.tools;
  let railOpen = false, railAnim: Animation | null = null, railSafety = 0;
  rail.inert = true;
  const alignMenu = h("div", { class: "lt-menu lt-alignmenu", role: "radiogroup", "aria-label": SL.align(""), hidden: true });
  const panel = h("div", { class: "lt-panel", hidden: true, "data-test": "lt-panel" });
  const pop = h("div", { class: "lt-pop", hidden: true, "data-test": "lt-pop" });

  // المعاينة
  const pagesEl = h("div", { class: "lt-pages", "data-test": "lt-pages" });
  // التلميح فوق الصفحة الأولى (v2 الدفعة هـ، مواصفة لمى §٤): ن٧، أو ن٨ بلا عناصر، و«الكتابة» فيه زرّ نصّ
  const phintText = h("p", { class: "lt-phint-text" });
  const phint = h("div", { class: "lt-phint", hidden: true, "data-test": "lt-phint" }, h("span", { class: "lt-phint-ic" }), phintText,
    h("button", { class: "icon-btn lt-phint-x", type: "button", "aria-label": SL.hideHint, "data-test": "lt-phint-close", onclick: () => endHint(0) }, icon("close")));
  (phint.firstElementChild as HTMLElement).innerHTML = I.hand;
  const grow = h("button", { type: "button", "aria-label": S.enlarge, "data-test": "grow" }, icon("plus")) as HTMLButtonElement;
  const shrink = h("button", { type: "button", "aria-label": S.shrink, "data-test": "shrink" }, icon("minus")) as HTMLButtonElement;
  const del = h("button", { type: "button", class: "del", "aria-label": S.remove, "data-test": "remove", onclick: () => removeSelected() }, icon("trash")) as HTMLButtonElement;
  const selBar = h("div", { class: "sel-bar", hidden: true, "data-test": "sel-bar" }, grow, shrink, h("span", { class: "sep", "aria-hidden": "true" }), del);
  // الشريط العائم للمحدَّد في «الكتابة» (مواصفة لمى ٢٠٢٦/١١/١٥، docs/logs/letter-write-bar-lama-spec.md): شكل .fbar في «تحرير ملف».
  // للصور «+» و«−» والحذف، وللمربّع الحذف وحده. وأزراره لا تأخذ التركيز من المحرّر، فتبقى لوحة المفاتيح
  const wbBtn = (test: string, label: string, ic: Parameters<typeof icon>[0]) => {
    const b = h("button", { type: "button", tabindex: -1, "aria-label": label, "data-test": test }, icon(ic)) as HTMLButtonElement;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    return b;
  };
  const wGrow = wbBtn("lt-wb-grow", S.enlarge, "plus"), wShrink = wbBtn("lt-wb-shrink", S.shrink, "minus"), wDel = wbBtn("lt-wb-del", S.remove, "trash");
  wDel.classList.add("del");
  // الحذف عند رفع الإصبع عن الزرّ نفسه: WebKit باللمس لا يُطلق click بعد pointerdown الممنوع. وclick للوحة المفاتيح (detail 0)،
  // والنقرة التي تتبع الرفع تُبتلع فلا تقع على الورقة تحت الشريط وهو يخبو. وتُبتلع على سطح الكتابة والشريط وحدهما: على WebKit
  // لا click يستهلك الماسك، فكان يبتلع «تراجع» بعده بأقل من 400ms (قرار نايف «أ»: الحذف فوريّ ويعيده التراجع)
  let delDown = -1;
  wDel.addEventListener("pointerdown", (e) => { delDown = e.button > 0 ? -1 : e.pointerId; });
  for (const ev of ["pointerleave", "pointercancel"]) wDel.addEventListener(ev, () => { delDown = -1; });
  wDel.addEventListener("pointerup", (e) => {
    if (e.pointerId !== delDown) return;
    delDown = -1;
    const eat = (c: Event) => {
      const t = c.target as Node | null;
      if (t && (write.contains(t) || wbar.contains(t))) { c.preventDefault(); c.stopPropagation(); document.removeEventListener("click", eat, true); }
    };
    document.addEventListener("click", eat, { capture: true }); // نقرةٌ خارج السطح («تراجع») لا تُنهيه
    setTimeout(() => document.removeEventListener("click", eat, true), 400);
    removeSelected();
  });
  wDel.addEventListener("click", (e) => { if (e.detail === 0) removeSelected(); });
  const wSep = h("span", { class: "sep", "aria-hidden": "true" });
  const wBtns = [wGrow, wShrink, wDel];
  const wbar = h("div", { class: "fbar lt-wbar", role: "toolbar", hidden: true, "data-test": "lt-wbar" }, wGrow, wShrink, wSep, wDel);
  const hint = h("p", { class: "lt-hint", id: "lt-save-why", "data-test": "lt-hint" }, SL.writeFirst);
  const saveBtn = h("button", { class: "btn primary block lt-save", type: "button", "data-test": "letter-save", onclick: () => void save() }, S.save) as HTMLButtonElement;
  // ١٤: التراجع والإعادة على سجلّ المتن (history.ts). أيقونتان (قرار نايف)، بجانب «حفظ الملف»: على الجوال في صفّه أسفل، وعلى الكمبيوتر في الشريط العلوي (قرار لمى)
  const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const histBtn = (redo: boolean) => {
    const id = redo ? "lt-tip-redo" : "lt-tip-undo", label = redo ? SL.redo : SL.undo;
    // التلميح مبنيّ لا title، بالفأرة وحدها (letter.css)، واختصار المنصّة وحدها (نصّ هدى)
    const tip = h("span", { class: "lt-tip", role: "tooltip", id }, label, " ", h("kbd", { dir: "ltr" }, (redo ? SL.redoKeys : SL.undoKeys)[MAC ? "mac" : "win"]));
    const ic = icon(redo ? "redo2" : "undo2");
    ic.classList.add("ic-hist");
    const b = h("button", { class: "lt-tb lt-hb", type: "button", "aria-label": label, "aria-keyshortcuts": MAC ? (redo ? "Meta+Shift+Z" : "Meta+Z") : (redo ? "Control+Y Control+Shift+Z" : "Control+Z"), "aria-describedby": id, "data-test": redo ? "lt-redo" : "lt-undo", onclick: () => runHist(redo) }, ic, tip) as HTMLButtonElement;
    b.disabled = true; // معطّلان عند الفتح
    b.addEventListener("mousedown", (e) => e.preventDefault()); // يبقى المؤشّر في المحرّر
    return b;
  };
  const undoBtn = histBtn(false), redoBtn = histBtn(true);
  const histGrp = h("span", { class: "lt-histgrp" }); // على الكمبيوتر: بين التلميح و«حفظ الملف»
  const histLive = h("p", { class: "sr-only", "aria-live": "polite", "data-test": "lt-hist-live" });
  const saveRow = h("div", { class: "lt-saverow" }, saveBtn, undoBtn, redoBtn);
  const savebar = h("div", { class: "savebar lt-savebar" }, hint, saveRow);
  const dock = h("div", { class: "dock lt-dock" }, selBar, savebar);
  const alert = h("p", { class: "alert lt-alert", role: "alert", hidden: true });

  const ltRow = h("div", { class: "lt-row" }, setupCard, tplTop);
  const cardbox = h("div", { class: "lt-cardbox" }, deskBar, stage, counter);
  const write = h("section", { class: "lt-write" }, ltRow, cardbox, alert);
  const previewCol = h("section", { class: "lt-preview", "aria-label": SL.preview }, phint, pagesEl);
  const grid = h("div", { class: "lt-grid" }, write, previewCol);
  const main = h("main", { class: "lt", "data-view": "write" }, top, seg, grid, railBox, zones, marker, dockMenu, dockLive, alignMenu, panel, pop, zoomPill, zoomMenu, dock, histLive, wbar);
  const photoIn = h("input", { type: "file", accept: "image/*", hidden: true, "data-test": "lt-photo-input" }) as HTMLInputElement;
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,.png,.jpg,.jpeg", hidden: true, "data-test": "lt-file-input" }) as HTMLInputElement;
  const dialog = h("dialog", { class: "bottom-sheet lt-sheet-dlg", "aria-labelledby": "lt-sheet-title" }) as HTMLDialogElement;
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeSheet(); });
  root.replaceChildren(main, photoIn, fileIn, dialog);

  let booted = false; // حدود الصفحات بعد أن تُعرَّف دوالّها (أسفل)
  const le: LetterEditor = createEditor(mount, () => onEdit(), () => showAlert(SL.pasteCut), () => { if (booted) { fitGaps(); trackCaret(); } });
  /** المحرّر الذي تعمل عليه أزرار التنسيق: المتن، أو آخر مربّع نصّ رُكِّز (v2 الدفعة و) */
  let act: LetterEditor = le;
  // خط التحديد (الدفعة ٣): التحديد محفوظ للوحة الخط ما دامت مفتوحة، ورسالة فشل التنزيل (`fontBody`)
  let selHeld = false;
  let fontSeq = 0; // الضغطة الأخيرة هي المعتمدة
  const fontErr = h("p", { class: "lt-syserr lt-fonterr", "aria-live": "polite", "data-test": "lt-font-err" });
  le.ed.on("focus", () => { act = le; syncBars(); });

  /* ───────── الشريطان ───────── */
  function placeBars() {
    if (WIDE.matches) {
      // ١٦: أعلى البطاقة أو أسفلها شريطاً كاملاً ملتصقاً (sticky)، أو العمود المختصر بترتيب الجوال في ركن بلا إغلاق ولا لسان
      const v = dockAxis(wideDock) === "v";
      main.dataset.wdock = v ? "v" : wideDock;
      main.dataset.wside = v ? dockEdge(wideDock) : "";
      if (v) {
        deskBar.replaceChildren();
        main.insertBefore(zoomPill, zoomMenu);
        fillRail();
        railBox.hidden = false;
        railState(true);
        placeRail();
      } else {
        if (wideDock === "bottom") cardbox.append(deskBar); else cardbox.prepend(deskBar);
        // شكل الشريط من عرضه الفعلي لا من innerWidth، فشريط تمرير ويندوز (نحو 15px) محسوب (docs/logs/letter-desk-bar-lama.md):
        // كامل (أربع محاذاة و«يمين ويسار») 901، ومتوسط (المحاذاة في قائمة) 733، وإلا سطران بلا إخفاء
        const A = deskBar.clientWidth - 24;
        const tier = A >= ROW_FULL ? "full" : A >= ROW_MID ? "mid" : "two";
        // يُعاد البناء عند تغيّر الشكل وحده: replaceChildren يُسقط التركيز
        if (deskBar.dataset.tier !== tier || zoomPill.parentElement !== deskBar) {
          deskBar.dataset.tier = tier;
          // ١٤: التراجع والإعادة ليسا هنا بل في الشريط العلوي بجانب «حفظ الملف» (قرار لمى)
          if (tier === "two") deskBar.replaceChildren(insDD, fontDD, sizeDD, sep(), boldBtn, sep(), olBtn, ulBtn, h("span", { class: "lt-brk", "aria-hidden": "true" }), ...alignBtns, splitBtn, sep(), zoomPill, grip);
          else deskBar.replaceChildren(insDD, fontDD, sizeDD, sep(), boldBtn, sep(), ...(tier === "mid" ? [alignBtn] : [...alignBtns, splitBtn]), sep(), olBtn, ulBtn, zoomPill, grip);
        }
        grip.innerHTML = RAIL_ICON.gripH;
        railTools.replaceChildren();
        rail.replaceChildren();
        railState(false);
        railBox.hidden = true;
      }
      previewCol.append(dock); // على الكمبيوتر شريط التحديد في عمود المعاينة (§٦)
      histGrp.replaceChildren(undoBtn, redoBtn); // ١٤ (قرار لمى): التراجع يمين الإعادة، والحفظ يبقى في الطرف
      topEnd.append(hint, histGrp, saveBtn); // و«حفظ الملف» وتلميحه في طرف الشريط العلوي (قرار نايف ٢٠٢٦/١١/١٣)
      top.replaceChildren(closeBtn, title, topEnd);
    } else {
      delete main.dataset.wdock;
      delete main.dataset.wside;
      deskBar.replaceChildren();
      cardbox.prepend(deskBar);
      main.insertBefore(zoomPill, zoomMenu);
      main.append(dock);
      saveRow.replaceChildren(saveBtn, undoBtn, redoBtn);
      savebar.append(hint, saveRow);
      top.replaceChildren(closeBtn, title, topSpacer);
      if (main.dataset.wasWide) { delete main.dataset.wasWide; railState(false); } // من العريض: مطويّاً كما يبدأ الجوال
      fillRail();
    }
    if (WIDE.matches) main.dataset.wasWide = "1";
    closePanels();
    syncBars();
  }
  /** ترتيب الخانات بحسب الموضع (§١): المقبض في الطرف الحرّ بعيداً عن الإغلاق، والأدوات بترتيب §٣ لا تتغيّر. ويُعاد ترتيب الـDOM لا بـorder */
  function fillRail() {
    const d = dockNow(), h_ = dockAxis(d) === "h";
    railTools.replaceChildren(plusBtn, sep(), boldBtn, alignBtn, fontBtn, sep(), olBtn, ulBtn);
    const close = WIDE.matches ? [] : [railClose];
    if (h_) rail.replaceChildren(...close, railTools, grip); // الإغلاق عند يمين الشاشة، والمقبض عند اليسار
    else if (d.endsWith("bottom")) rail.replaceChildren(grip, railTools, ...close);
    else rail.replaceChildren(...close, railTools, grip);
    railBox.dataset.dock = d;
    railBox.dataset.axis = dockAxis(d);
    rail.setAttribute("aria-orientation", h_ ? "horizontal" : "vertical");
    railTools.setAttribute("aria-orientation", h_ ? "horizontal" : "vertical");
    railClose.innerHTML = railIcon(d);
    grip.innerHTML = h_ ? RAIL_ICON.gripH : RAIL_ICON.gripV;
    occupy();
  }
  /** ما يشغله العمود فوق حبّة الدرجة: «أسفل الشاشة» مفتوحاً يرفعها 52، ومطويّاً تعود (§٤-ب) */
  const occupy = () => main.style.setProperty("--rail-occupy-bottom", `${!WIDE.matches && railOpen ? RAIL_DOCKS[railDock].occupyBottom : 0}px`);
  /** حال العمود بلا حركة: للتبديل بين الجوال والكمبيوتر */
  function railState(open: boolean) {
    railAnim?.cancel();
    railOpen = open;
    railBox.classList.toggle("open", open);
    railBox.classList.remove("leaving");
    rail.inert = !open;
    railTab.setAttribute("aria-expanded", String(open));
    railTab.setAttribute("aria-label", open ? SL.railHide : SL.railShow);
    occupy();
  }
  WIDE.addEventListener("change", () => {
    if (drag?.on) endDrag(false); // تدوير أو تغيير حجم عبر 1024 أثناء السحب: تُرجَع الحال بالعنصر الذي بدأ منه
    closePanels();
    closeDockMenu(false);
    st.zoom.key = WIDE.matches ? DEFAULT_ZOOM_WIDE : DEFAULT_ZOOM;
    placeBars();
    refreshZoom();
    syncSel(); // الشريط الظاهر يتبع العرض الجديد
  });
  addEventListener("resize", () => { if (WIDE.matches) placeBars(); refreshZoom(); });

  function syncBars() {
    const a = mode();
    alignBtn.innerHTML = ALIGN_ICON[a] + I.caret;
    alignBtn.setAttribute("aria-label", SL.align(ALIGN_SHORT[a])); // «المحاذاة: وسط» (جدول هدى، م٢)
    alignBtn.setAttribute("aria-expanded", String(!alignMenu.hidden));
    alignBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(ALIGN_ORDER[i] === a)));
    splitBtn.setAttribute("aria-pressed", String(a === "split"));
    splitBtn.setAttribute("aria-disabled", String(a !== "split" && !act.canSplit()));
    boldBtn.setAttribute("aria-pressed", String(act.ed.isActive("bold")));
    olBtn.setAttribute("aria-pressed", String(act.ed.isActive("orderedList")));
    ulBtn.setAttribute("aria-pressed", String(act.ed.isActive("bulletList")));
    const n = act.size();
    const shown = shownFont();
    const fa = h("span", { class: "lt-a", "aria-hidden": "true" }, "أ");
    applyLf(fa, shown);
    fontBtn.replaceChildren(fa);
    fontBtn.insertAdjacentHTML("beforeend", I.caret);
    fontBtn.setAttribute("aria-label", SL.fontAndSize(shown ? fontName(shown) : SL.fontMixed, n));
    fontBtn.setAttribute("aria-expanded", String(st.panel === "font"));
    plusBtn.setAttribute("aria-expanded", String(st.panel === "plus"));
    const fn = h("span", { class: "lt-fname" }, shown ? fontName(shown) : SL.fontMixed);
    applyLf(fn, shown);
    fontDD.replaceChildren(fn);
    fontDD.insertAdjacentHTML("beforeend", I.caret);
    sizeDD.replaceChildren(h("span", { class: "lt-num" }, ar(n)));
    sizeDD.insertAdjacentHTML("beforeend", I.caret);
  }

  /* ───────── لوحة المفاتيح على الجوال (visualViewport) ───────── */
  const vv = window.visualViewport;
  function kbLayout() {
    if (WIDE.matches) return;
    const kb = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
    st.kb = kb > 80 ? kb : 0;
    if (st.kb) st.lastKb = st.kb;
    const focused = act.ed.isFocused;
    const open = focused || st.panel !== "none";
    savebar.hidden = open;
    const base = st.panel !== "none" ? panelHeight() : st.kb;
    main.classList.toggle("lt-typing", open);
    main.classList.toggle("lt-kbopen", st.kb > 0); // مع لوحة المفاتيح يُطوى المفتاح «الكتابة/معاينة الصفحة» (§٢)
    // العمود فوق لوحة المفاتيح أو اللوحة أو «حفظ الملف» بـ8 (§٣)، والحبّة فوقها بـ12 (§٢)
    const floor = open ? base : dock.offsetHeight;
    railBox.hidden = st.view !== "write";
    railFloor = floor;
    zoomPill.style.insetBlockEnd = `calc(${floor + 12}px + var(--rail-occupy-bottom, 0px))`; // §٥-٧: لا يتقاطع العمود مع الحبّة
    placeRail();
    if (!zoomMenu.hidden) placeZoomMenu();
  }
  let railFloor = 0; // F: القاع (لوحة المفاتيح أو اللوحة أو «حفظ الملف»)، من kbLayout
  /** A «ما فوق الورقة» (§٤): أسفل الرأس والمفتاح وبطاقة القالب (فيها «تغيير»، ١٦ التصحيح ١) ما دامت ظاهرة */
  function narrowM(): NarrowM {
    const head = Math.max(0, top.getBoundingClientRect().bottom), kbo = main.classList.contains("lt-kbopen");
    const rr = ltRow.getBoundingClientRect();
    const A = Math.max(head, kbo ? 0 : seg.getBoundingClientRect().bottom, kbo || !rr.height ? 0 : rr.bottom);
    return { W: innerWidth, H: innerHeight, A, head, F: railFloor, len: 402 };
  }
  function wideM(): WideM {
    const c = cardbox.getBoundingClientRect();
    return { W: innerWidth, H: innerHeight, head: Math.max(0, top.getBoundingClientRect().bottom), card: { x: c.left, y: c.top, w: c.width, h: c.height }, len: 354 };
  }
  /** الموضع بأرقامه (§٤): الأعلى من «ما فوق الورقة» والأسفل من القاع، والطول الأقصى بينهما. إن قصر عن 402 صارت الفجوة 0، وما زاد يُمرَّر داخله */
  function placeRail() {
    if (railBox.hidden) return;
    const d = dockNow(), s = railBox.style;
    if (WIDE.matches) {
      if (dockAxis(d) !== "v") return;
      const r = wideRect(d, wideM());
      s.insetBlockStart = d.endsWith("top") ? `${r.y}px` : "";
      s.insetBlockEnd = d.endsWith("bottom") ? `${innerHeight - r.y - r.h}px` : "";
      rail.style.maxBlockSize = `${r.h}px`;
      rail.classList.toggle("tight", r.h < 354);
      zoomPill.style.insetBlockEnd = "12px"; // الحبّة طافية أسفل اليسار، و«يسار أسفل» يرتفع فوقها (wideRect)
    } else {
      const r = narrowRect(d, narrowM());
      const fromTop = d === "top" || d.endsWith("-top");
      s.insetBlockStart = fromTop ? `${r.y}px` : "";
      s.insetBlockEnd = fromTop ? "" : `${innerHeight - r.y - r.h}px`;
      rail.style.maxBlockSize = dockAxis(d) === "v" ? `${r.max}px` : "";
      rail.classList.toggle("tight", dockAxis(d) === "v" && r.max < 402);
      railTools.classList.toggle("over", dockAxis(d) === "h" && railTools.scrollWidth > railTools.clientWidth + 1); // علامة التمرير على 320
    }
    if (!alignMenu.hidden) placeAlignRail();
    if (!dockMenu.hidden) placeDockMenu();
  }
  addEventListener("scroll", () => placeRail(), { passive: true });
  /** يفتح العمود أو يطويه (الطافي): يطفو فوق الورقة ولا يمسّها، فلا مقياس يتغيّر ولا تمرير. الموضع بالتخطيط فوراً، ثم رسمٌ مؤقّت للعمود يبدأ من الحال المرسومة إن قوطعت حركة سابقة */
  function setRail(open: boolean) {
    if (open === railOpen || WIDE.matches) return; // العريض بلا طيّ
    if (!open) closeDockMenu(false);
    const from = railAnim ? getComputedStyle(rail)[reduced() ? "opacity" : "transform"] : null;
    railOpen = open;
    railBox.classList.toggle("open", open);
    rail.inert = !open;
    railTab.setAttribute("aria-expanded", String(open));
    railTab.setAttribute("aria-label", open ? SL.railHide : SL.railShow); // ن٢ / ن١
    occupy();
    const hadFocus = document.activeElement;
    if (!open && !alignMenu.hidden) { alignMenu.hidden = true; syncBars(); }
    animateRail(open, from);
    // لوحة المفاتيح: التركيز ينتقل إلى نظير الزرّ الذي اختفى
    if (hadFocus === railTab && open) railClose.focus();
    else if (hadFocus === railClose && !open) railTab.focus();
  }
  /** حركة العمود رسمٌ مؤقّت (fill: none): إن انتهت أو أُلغيت أو تعطّلت عاد العمود إلى موضعه بالتخطيط بلا transform */
  function animateRail(open: boolean, from: string | null) {
    railAnim?.cancel();
    clearTimeout(railSafety);
    const reduce = reduced(), d = reduce ? RAIL_FADE : open ? RAIL_IN : RAIL_OUT;
    const hide = HIDE[dockEdge(dockNow())];
    const kf = reduce
      ? [{ opacity: from ?? (open ? "0" : "1") }, { opacity: open ? "1" : "0" }]
      : [{ transform: from ?? (open ? hide : "none") }, { transform: open ? "none" : hide }];
    railBox.classList.toggle("leaving", !open);
    const a = rail.animate(kf, { duration: d, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    railAnim = a;
    const done = () => {
      if (railAnim !== a) return;
      railAnim = null;
      clearTimeout(railSafety);
      a.cancel();
      railBox.classList.remove("leaving");
    };
    a.onfinish = done;
    a.oncancel = done;
    railSafety = window.setTimeout(done, d + 120); // حركةٌ تعطّلت (مثل إطاراتٍ لا تُرسم) لا تُبقي العمود خارج الشاشة
  }
  /* ───────── ١٦ السحب والإرساء (docs/logs/letter-rail-dock-lama-spec.md §٢–§٣ و§٦، وقسم ١٦ من additions-13-16-lama-spec.md) ───────── */
  const DOCK_EASE = "cubic-bezier(0.16, 1, 0.3, 1)", DOCK_MS = 200;
  type Drag = { id: number; src: HTMLElement; sx: number; sy: number; on: boolean; touch: boolean; near: DockName | null; box: DOMRect; off: { x: number; y: number }; zones: Record<DockName, Box> };
  let drag: Drag | null = null, justDragged = false;
  /** مستطيلات المواضع الستّة بالتمرير الحالي: ما سيكون فيه العمود (أو الشريط) لو أُلقي هناك */
  function zoneRects(): Record<DockName, Box> {
    const out = {} as Record<DockName, Box>;
    if (WIDE.matches) { const m = wideM(); for (const d of DOCKS) out[d] = wideRect(d, m); }
    else { const m = narrowM(); for (const d of DOCKS) out[d] = narrowRect(d, m); }
    return out;
  }
  /** المصدر المسحوب: العمود، أو شريط البطاقة على الكمبيوتر */
  const dragSrc = () => (WIDE.matches && dockAxis(wideDock) === "h" ? deskBar : rail);
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // يبقى المؤشّر في المحرّر ولوحة المفاتيح مفتوحة، كبقية الأزرار
    grip.setPointerCapture?.(e.pointerId);
    railAnim?.cancel(); // المقاطعة: الإمساك أثناء الحركة يلغيها
    justDragged = false;
    const g = grip.getBoundingClientRect();
    drag = { id: e.pointerId, src: dragSrc(), sx: e.clientX, sy: e.clientY, on: false, touch: e.pointerType !== "mouse", near: null, box: dragSrc().getBoundingClientRect(), off: { x: Math.min(52, e.clientX - g.left), y: Math.min(40, e.clientY - g.top) }, zones: zoneRects() };
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // حدّ البدء: 8 باللمس والقلم، و4 بالفأرة. قبله ضغطة، ولا ضغط مطوّل
    if (!drag.on && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < (drag.touch ? 8 : 4)) return;
    if (!drag.on) startDrag();
    moveDrag(e.clientX, e.clientY);
  });
  grip.addEventListener("pointerup", (e) => { if (drag?.id === e.pointerId) { if (drag.on) endDrag(true); else drag = null; } });
  // الإلغاء لا يتبعه click، فلا يُترك justDragged يبتلع أول نقرة حقيقية على المقبض
  grip.addEventListener("pointercancel", () => { if (drag?.on) endDrag(false); else drag = null; justDragged = false; });
  // فقدان الالتقاط أثناء السحب (يأتي بعد pointerup أيضاً، ولا سحب حينها فلا أثر ولا مسّ بـjustDragged)
  grip.addEventListener("lostpointercapture", () => { if (drag?.on) { endDrag(false); justDragged = false; } });
  grip.addEventListener("click", (e) => { if (justDragged && e.detail !== 0) { justDragged = false; return; } toggleDockMenu(); }); // النقرة وEnter وSpace (detail 0)، لا ما يتبع سحباً أو إلغاءه
  grip.addEventListener("contextmenu", (e) => { e.preventDefault(); if (dockMenu.hidden) toggleDockMenu(); }); // الزرّ الأيمن
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag?.on) { e.preventDefault(); endDrag(false); } }, { signal: docSignal });
  function startDrag() {
    const d = drag!;
    d.on = true;
    closePanels(); // يُرجع selHeld (لا إخفاء مباشر)
    closeDockMenu(false);
    document.documentElement.classList.add("lt-grabbing");
    main.classList.add("lt-dragging");
    if (WIDE.matches) { d.src.classList.add("lt-dragsrc"); marker.hidden = false; }
    else { railBox.classList.add("dragging"); rail.style.transformOrigin = `${d.sx - d.box.left}px ${d.sy - d.box.top}px`; }
    for (const z of zones.children as HTMLCollectionOf<HTMLElement>) {
      const r = d.zones[z.dataset.dz as DockName];
      Object.assign(z.style, { insetInlineStart: `${innerWidth - r.x - r.w}px`, insetBlockStart: `${r.y}px`, inlineSize: `${r.w}px`, blockSize: `${r.h}px` }); // RTL: البداية يمين
      z.classList.toggle("cur", z.dataset.dz === dockNow());
    }
    zones.hidden = false;
  }
  /** يتبع الإصبع 1:1 بـtranslate، ومطّاط خارج الشاشة، ومغناطيس على 40 من مركز الأقرب. والأقرب بموضع الإصبع لا مركز العمود */
  function moveDrag(x: number, y: number) {
    const d = drag!, reduce = reduced(), wide = WIDE.matches;
    const m = wide ? null : narrowM();
    d.near = wide
      ? nearestWide({ x, y }, innerWidth, { top: Math.max(0, top.getBoundingClientRect().bottom), bottom: innerHeight }, wideM().card, d.near ?? undefined)
      : nearestNarrow({ x, y }, innerWidth, { top: m!.A, bottom: innerHeight - m!.F }, d.near ?? undefined);
    for (const z of zones.children as HTMLCollectionOf<HTMLElement>) z.classList.toggle("near", z.dataset.dz === d.near);
    const tgt = center(d.zones[d.near]);
    if (wide) {
      let mx = x - d.off.x, my = y - d.off.y; // العلامة 56×44 من موضع الإمساك
      if (!reduce) { const k = magnet({ x: mx + 28, y: my + 22 }, tgt); mx += k.x; my += k.y; }
      marker.style.transform = `translate(${mx}px, ${my}px)`;
      return;
    }
    let tx = x - d.sx, ty = y - d.sy;
    if (!reduce) {
      const b = d.box, W = innerWidth, H = innerHeight;
      const band = (t: number, lo: number, hi: number, dim: number) => (t < lo ? lo - rubber(lo - t, dim) : t > hi ? hi + rubber(t - hi, dim) : t);
      tx = band(tx, -b.left, W - b.right, W);
      ty = band(ty, -b.top, H - b.bottom, H);
      const k = magnet({ x: b.left + b.width / 2 + tx, y: b.top + b.height / 2 + ty }, tgt);
      tx += k.x; ty += k.y;
    }
    rail.style.transform = `translate(${tx}px, ${ty}px)${reduce ? "" : " scale(1.02)"}`;
  }
  /** الرفع: يستقرّ في المنطقة المضاءة بلا زخم، والموضع الحالي أو الإلغاء (Esc وpointercancel) يُرجِعانه */
  function endDrag(commit: boolean) {
    const d = drag!;
    drag = null;
    justDragged = true; // يبتلع click الذي يتبع الرفع (ومعه الرفع بعد Esc)
    zones.hidden = true;
    marker.hidden = true;
    document.documentElement.classList.remove("lt-grabbing");
    main.classList.remove("lt-dragging");
    d.src.classList.remove("lt-dragsrc"); // العنصر الذي بدأ السحب لا ما يصير مصدراً الآن (قد يتبدّل WIDE أثناءه)
    railBox.classList.remove("dragging");
    const to = commit ? d.near : null;
    if (to && to !== dockNow()) { setDock(to); return; }
    const from = rail.style.transform;
    rail.style.transform = "";
    if (!WIDE.matches && from && !reduced()) railAnim = rail.animate([{ transform: from }, { transform: "none" }], { duration: DOCK_MS, easing: DOCK_EASE });
  }
  /** الالتصاق (§٣): في المحور نفسه FLIP من الموضع المرسوم، وبين محورين تلاشٍ 80 ثم دخولٌ من الحافّة الجديدة. والتذكّر والرسالة الحيّة */
  function setDock(d: DockName, focusGrip = false) {
    const wide = WIDE.matches, prev = dockNow(), reduce = reduced();
    const before = rail.getBoundingClientRect();
    if (wide) wideDock = d; else railDock = d;
    saveDock(dockStore, wide, d);
    dockLive.textContent = SL.railMoved(SL.railDocks[d]);
    if (d === prev) { rail.style.transform = ""; if (focusGrip) grip.focus(); return; }
    const apply = () => { rail.style.transform = ""; if (wide) placeBars(); else { fillRail(); placeRail(); } if (focusGrip) grip.focus(); }; // إعادة الترتيب تُسقط التركيز
    if (wide) {
      apply();
      dragSrc().animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? RAIL_FADE : 160, easing: DOCK_EASE });
      return;
    }
    if (dockAxis(prev) === dockAxis(d)) {
      apply();
      if (reduce) return;
      const after = rail.getBoundingClientRect();
      railAnim = rail.animate([{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(1.02)` }, { transform: "none" }], { duration: DOCK_MS, easing: DOCK_EASE });
      return;
    }
    // بين محورين: تلاشٍ 80 (ومع تقليل الحركة RAIL_FADE وحده عبر animateRail)، ثم الموضع الجديد، ثم دخولٌ من حافّته
    if (reduce) { apply(); animateRail(true, null); return; }
    const out = rail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: "forwards" });
    let done = false;
    const go = () => { if (done) return; done = true; out.cancel(); apply(); animateRail(true, null); };
    out.onfinish = go;
    setTimeout(go, 80 + 120); // إطاراتٌ لا تُرسم لا تُبقي العمود شفّافاً
  }

  /* «نقل إلى…» (§٦): خريطة للشاشة بالمواضع الستّة، والأسهم تتحرّك مكانياً */
  const DM_POS: Record<DockName, [number, number]> = { top: [0, 0], "right-top": [1, 0], "left-top": [1, 1], "right-bottom": [2, 0], "left-bottom": [2, 1], bottom: [3, 0] }; // [الصفّ، العمود (0 يمين)]
  /** الرسم المصغّر: هاتف 18×30 (أو شاشة أفقية 30×20 على الكمبيوتر)، والعمود عند الركن أو الحافّة */
  function dockMini(d: DockName, wide: boolean) {
    const [W, H] = wide ? [30, 20] : [18, 30], v = dockAxis(d) === "v";
    const [rw, rh] = v ? (wide ? [3, 10] : [4, 12]) : (wide ? [22, 3] : [14, 3]);
    const x = d.startsWith("right") ? W - 3 - rw : d.startsWith("left") ? 3 : (W - rw) / 2;
    const y = d === "top" || d.endsWith("-top") ? 3 : H - 3 - rh;
    return `<svg class="lt-dmini" width="${W + 2}" height="${H + 2}" viewBox="-1 -1 ${W + 2} ${H + 2}" aria-hidden="true"><rect class="lt-dmphone" x="0" y="0" width="${W}" height="${H}" rx="4"/><rect class="lt-dmrail" x="${x}" y="${y}" width="${rw}" height="${rh}" rx="1"/></svg>`;
  }
  function toggleDockMenu() {
    if (!dockMenu.hidden) { closeDockMenu(true); return; }
    closePanels();
    const cur = dockNow(), wide = WIDE.matches;
    dockMenu.replaceChildren(...DOCKS.map((d) => {
      const b = h("button", { class: "lt-am lt-dm", type: "button", role: "menuitemradio", "aria-checked": String(d === cur), tabindex: d === cur ? "0" : "-1", "data-dz": d, "data-test": `lt-dm-${d}`, onclick: () => { closeDockMenu(false); setDock(d, true); } });
      b.innerHTML = dockMini(d, wide);
      b.append(h("span", {}, SL.railDocks[d]));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      return b;
    }));
    dockMenu.hidden = false;
    grip.setAttribute("aria-expanded", "true");
    placeDockMenu();
    dockMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }
  function closeDockMenu(refocus: boolean) {
    if (dockMenu.hidden) return;
    dockMenu.hidden = true;
    grip.setAttribute("aria-expanded", "false");
    if (refocus) grip.focus();
  }
  /** من المقبض بعيداً عن الحافّة بدالّة §٤-د، وعلى الكمبيوتر الأفقيّ من الشريط نفسه */
  function placeDockMenu() {
    const d = dockNow(), box = (WIDE.matches && dockAxis(d) === "h" ? deskBar : railBox).getBoundingClientRect();
    const p = RAIL_DOCKS[d].menu(box, grip.getBoundingClientRect(), dockMenu);
    dockMenu.style.insetInlineStart = `${p.start}px`;
    dockMenu.style.insetBlockStart = `${p.top}px`;
  }
  dockMenu.addEventListener("keydown", (e) => {
    const btns = [...dockMenu.querySelectorAll<HTMLButtonElement>(".lt-dm")];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const [r, c] = DM_POS[DOCKS[at]!];
    const find = (rr: number, cc: number) => DOCKS.findIndex((d) => DM_POS[d][0] === rr && (rr === 0 || rr === 3 || DM_POS[d][1] === cc));
    let to = -1;
    if (e.key === "ArrowDown") to = find(Math.min(3, r + 1), c);
    else if (e.key === "ArrowUp") to = find(Math.max(0, r - 1), c);
    else if (e.key === "ArrowLeft") to = r === 1 || r === 2 ? find(r, 1) : at; // السهم الأيسر إلى الخانة اليسرى فعلاً
    else if (e.key === "ArrowRight") to = r === 1 || r === 2 ? find(r, 0) : at;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = btns.length - 1;
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDockMenu(true); return; }
    else if (e.key === "Tab") { closeDockMenu(false); return; }
    else return;
    e.preventDefault();
    btns.forEach((b, i) => { b.tabIndex = i === to ? 0 : -1; });
    btns[to]?.focus();
  });
  document.addEventListener("pointerdown", (e) => { const t = e.target as Element; if (!dockMenu.hidden && !dockMenu.contains(t) && !grip.contains(t)) closeDockMenu(false); }, { signal: docSignal });
  // يُطوى مع أول إدراج أو حذف في المحرّر، لا للتنسيق (formatBold…) ولا لنقل المؤشّر (§٣)
  le.ed.view.dom.addEventListener("beforeinput", (e) => { if (RAIL_FOLD_ON_TYPE && railOpen && !WIDE.matches && /^(insert|delete)/.test((e as InputEvent).inputType)) setRail(false); });
  const panelHeight = () => Math.max(300, st.lastKb);
  vv?.addEventListener("resize", kbLayout);
  vv?.addEventListener("scroll", kbLayout);
  le.ed.on("focus", () => { if (st.panel !== "none" && !WIDE.matches) closePanels(); kbLayout(); });
  le.ed.on("blur", () => setTimeout(kbLayout, 0));

  /* ───────── ١٤: التراجع والإعادة (سجلّ واحد هو سجلّ TipTap، docs/logs/additions-14-17-lama-spec.md) ───────── */
  /** صور الخلفية والترويسة خارج المستند: السمة معرّفٌ هنا، بالذاكرة وحدها */
  const imgs = new Map<string, { img: LetterImage; url: string; assetId: string | null }>();
  const imgIds = new WeakMap<LetterImage, string>();
  const imgId = (o: { img: LetterImage; url: string; assetId?: string | null }) => {
    let id = imgIds.get(o.img);
    if (!id) { id = crypto.randomUUID(); imgIds.set(o.img, id); }
    imgs.set(id, { img: o.img, url: o.url, assetId: o.assetId ?? null });
    return id;
  };
  /**
   * العناصر الحرّة بمعرّفاتها (قرار نايف ٢٠٢٦/١١/١٥ «أ» و«نعم»): السمة `ltItems` قائمة معرّفات، والعنصر هنا بصورته ورابطها ومحرّر مربّعه.
   * المحذوف يبقى هنا بلا إبطال رابطه ولا إتلاف محرّره ما دام في السجلّ مدخلٌ قد يعيده، ويُحرَّران عند مغادرة الصفحة
   */
  const known = new Map<string, Item>();
  docSignal.addEventListener("abort", () => {
    for (const it of known.values()) if (!st.items.includes(it)) { if (it.url) URL.revokeObjectURL(it.url); it.tb?.ed.ed.destroy(); }
  });
  /** قيم `st` التي تُرفع إلى سمات المستند. عرض مربّع النصّ وحده (ارتفاعه من التخطيط) */
  function attrsNow(): LtAttrs {
    return {
      ltItems: st.items.map((it) => it.id),
      ltFont: st.font, ltFrame: st.frame, ltMargins: st.margins,
      ltBg: st.background ? imgId(st.background) : null,
      ltHeader: st.header ? { id: imgId(st.header), on: st.header.on } : null,
      ltDate: st.date,
      ltPos: Object.fromEntries(st.items.map((it) => [it.id, it.kind === "text" ? [it.page, it.fx, it.fy, it.fw] : [it.page, it.fx, it.fy, it.fw, it.fh]])),
    };
  }
  let recording = false, recTimer = 0;
  /** يكتب ما تغيّر من `st` في المستند: مدخلاً في السجلّ، أو خارجه (`quiet`: الفتح) */
  function record(quiet = false, only?: readonly LtKey[]) {
    if (quiet && recTimer) record(); // ما ينتظر مدخلٌ قبله
    clearTimeout(recTimer); recTimer = 0;
    const tr = le.ed.state.tr;
    if (!putAttrs(tr, attrsNow(), only).length) return;
    if (quiet) tr.setMeta("addToHistory", false);
    recording = true;
    try { le.ed.view.dispatch(tr); } finally { recording = false; }
  }
  /** المتكرّر (الضغط المستمرّ، والأسهم، والعدّادات): مدخلٌ واحد بعد 600ms من آخره، ويُكتب فوراً قبل أي تراجع */
  function recordSoon() { clearTimeout(recTimer); recTimer = window.setTimeout(() => record(), 600); }
  const flushRecord = () => { if (recTimer) record(); };
  /** إضافة عنصر أو حذفه: مدخلٌ واحد فيه القائمة ومواضعها، بعد ما ينتظر من قبله */
  function recordItems() { flushRecord(); record(false, ["ltItems", "ltPos"]); }
  /** التراجع أو الإعادة غيّرا سمات: تعود القيم إلى `st` وتُرسم */
  function applyAttrs(keys: LtKey[], a: LtAttrs) {
    clearTimeout(recTimer); recTimer = 0;
    const has = (k: LtKey) => keys.includes(k);
    if (has("ltFont")) {
      st.font = clone(a.ltFont as LetterFont);
      applyLf(paper, st.font);
      refreshFont();
      void ensureFont(st.font).then(() => relayout()).catch(() => {});
    }
    if (has("ltFrame")) st.frame = a.ltFrame as FrameKind;
    if (has("ltMargins")) st.margins = clone(a.ltMargins as Margins);
    if (has("ltBg")) { const g = a.ltBg ? imgs.get(a.ltBg as string) : undefined; st.background = g ? { ...g } : null; }
    if (has("ltHeader")) {
      const v = a.ltHeader as { id: string; on: "first" | "all" } | null, g = v ? imgs.get(v.id) : undefined;
      st.header = v && g ? { img: g.img, url: g.url, on: v.on } : null;
    }
    const back = has("ltItems") ? syncItems((a.ltItems ?? []) as string[]) : undefined;
    if (has("ltPos")) {
      const pos = (a.ltPos ?? {}) as Record<string, number[]>;
      for (const it of st.items) {
        const p = pos[it.id];
        if (!p) continue; // عنصرٌ أُضيف بعد المدخل
        [it.page, it.fx, it.fy, it.fw] = p as [number, number, number, number];
        if (p.length > 4) it.fh = p[4]!;
        mountItem(it);
        placeBox(it);
      }
      if (st.selected) syncSel();
    }
    if (has("ltDate")) { st.date = clone(a.ltDate as LetterDate | null); syncDate(); }
    if (has("ltFrame") || has("ltMargins") || has("ltBg") || has("ltHeader")) syncSetup();
    else if (has("ltPos") || has("ltFont") || has("ltItems")) {
      // المُعاد يُحدَّد بعد رسمه وعليه شريطه، كالمضاف (placeItem)
      void relayout().then(() => { if (back && st.items.includes(back) && !st.selected) select(back, st.view === "write" ? "write" : "preview"); });
    }
  }
  /** التراجع أو الإعادة غيّرا قائمة العناصر: يُزال ما ليس فيها ويعود ما فيها، ويُرجع آخر عائد */
  function syncItems(ids: string[]): Item | undefined {
    const want = ids.flatMap((id) => { const it = known.get(id); return it ? [it] : []; });
    const gone = st.items.filter((it) => !want.includes(it)), back = want.filter((it) => !st.items.includes(it));
    if (!gone.length && !back.length) { st.items = want; return undefined; }
    if (st.selected && gone.includes(st.selected)) select(null);
    st.items = want;
    for (const it of gone) detachItem(it);
    for (const it of back) {
      it.el.classList.remove("leave");
      it.w?.classList.remove("leave");
      if (it.tb) { boxLayer.append(it.tb.host); placeBox(it); }
    }
    syncBoxNames();
    syncWItems();
    syncInsertState();
    st.dirty = true; // العائد والمُزال تعديلٌ في الخطاب، ولو بعد الحفظ
    return back.at(-1);
  }
  /** يُخرج العنصر من الصفحتين بلا إبطال رابطه ولا إتلاف محرّره (`known`)، فيعيده التراجع كما كان. وتاريخ الكتابة داخل المربّع لا يعود */
  function detachItem(it: Item) {
    const out = (el: HTMLElement) => { el.classList.add("leave"); setTimeout(() => { if (!st.items.includes(it)) el.remove(); }, reduced() ? 0 : 120); };
    out(it.el);
    if (it.w) out(it.w);
    if (it.tb) {
      dropSegs(undoSegs, it.tb.ed.ed); dropSegs(redoSegs, it.tb.ed.ed);
      if (act === it.tb.ed) act = le;
      it.tb.host.remove();
    }
  }
  function syncHist() {
    undoBtn.disabled = st.saving || !le.ed.can().undo();
    redoBtn.disabled = st.saving || !le.ed.can().redo();
  }
  /** الزرّان والاختصاران خارج المحرّر: السجلّ نفسه بأمرَي TipTap، ويُقرأ الفعل إن كان من أفعال الخطاب */
  function runHist(redo: boolean, keepFocus = false) {
    if (st.saving) return;
    flushRecord();
    const before = le.ed.state.doc;
    // التركيز في المحرّر على الكمبيوتر وحده: على الجوال يُخفي التركيزُ شريط الحفظ بالزرّين (kbLayout) ويفتح لوحة المفاتيح. ولا في «معاينة الصفحة».
    // ومن مربّع نصّ مركَّز (`keepFocus`) يبقى التركيز فيه
    const c = WIDE.matches && st.view === "write" && !keepFocus ? le.ed.chain().focus() : le.ed.chain();
    if (!(redo ? c.redo() : c.undo()).run()) return;
    const after = le.ed.state.doc, k = changedKeys(before, after)[0];
    histLive.textContent = k ? (redo ? SL.redone : SL.undone)(k === "ltItems" ? itemAct(before.attrs.ltItems, after.attrs.ltItems, redo) : SL.histActs[k]) : "";
  }
  /** اسم فعل العنصر: ما زال بالتراجع كان إضافةً، وما عاد به كان حذفاً، والإعادة عكسهما */
  function itemAct(was: unknown, now: unknown, redo: boolean) {
    const a = (was ?? []) as string[], b = (now ?? []) as string[];
    const added = b.find((id) => !a.includes(id)), id = added ?? a.find((x) => !b.includes(x));
    const kind = (id && known.get(id)?.kind) as keyof typeof SL.histItemAdd | undefined;
    if (!kind || !(kind in SL.histItemAdd)) return "";
    return (redo === !!added ? SL.histItemAdd : SL.histItemDel)[kind];
  }
  le.ed.on("transaction", ({ transaction }) => {
    const keys = changedKeys(transaction.before, transaction.doc);
    if (keys.length && !recording) applyAttrs(keys, transaction.doc.attrs as LtAttrs);
    syncHist();
  });
  le.ed.on("focus", flushRecord);
  dialog.addEventListener("close", flushRecord);
  /*
   * Ctrl+Z وCtrl+Y داخل مربّع نصّ (قرار المدير ٢٠٢٦/١١/١٥، الخيار أ): للمربّع سجلّه (UndoRedo في createEditor)، والنقل في سجلّ المتن (ltPos).
   * فيُذهب إلى الأحدث بينهما: كل مدخلٍ جديد في أيّ سجلّ يُلحق بمقطعٍ لصاحبه، والتراجع والإعادة ينقلانه بين القائمتين.
   */
  type HistSeg = { ed: Editor; n: number };
  const undoSegs: HistSeg[] = [], redoSegs: HistSeg[] = [];
  const pushSeg = (list: HistSeg[], ed: Editor, n: number) => { const top = list.at(-1); if (top?.ed === ed) top.n += n; else list.push({ ed, n }); };
  const takeSeg = (list: HistSeg[], ed: Editor) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.ed === ed) { if (--list[i]!.n <= 0) list.splice(i, 1); return; }
  };
  const dropSegs = (list: HistSeg[], ed: Editor) => { for (let i = list.length - 1; i >= 0; i--) if (list[i]!.ed === ed) list.splice(i, 1); };
  function watchHist(ed: Editor) {
    let u0 = undoDepth(ed.state);
    ed.on("transaction", ({ transaction }) => {
      const u = undoDepth(ed.state);
      const m = transaction.getMeta("history$") as { redo: boolean } | undefined; // مفتاح إضافة prosemirror-history
      if (m) { takeSeg(m.redo ? redoSegs : undoSegs, ed); pushSeg(m.redo ? undoSegs : redoSegs, ed, 1); }
      else if (u > u0) { pushSeg(undoSegs, ed, u - u0); dropSegs(redoSegs, ed); }
      u0 = u;
    });
  }
  watchHist(le.ed);
  /** من محرّر المربّع: التراجع أو الإعادة لصاحب آخر مدخل */
  function boxHist(e: KeyboardEvent, own: Editor) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.code !== "KeyZ" && e.code !== "KeyY")) return;
    const redo = e.code === "KeyY" || e.shiftKey;
    const ed = (redo ? redoSegs : undoSegs).at(-1)?.ed ?? own;
    e.preventDefault();
    e.stopPropagation();
    if (ed === le.ed) runHist(redo, true);
    else if (redo) ed.commands.redo(); else ed.commands.undo();
  }
  // Ctrl/⌘+Z وCtrl+Y وCtrl/⌘+Shift+Z بموضع المفتاح (`e.code`) لا حرفه، فتعمل مع اللوحة العربية. وداخل المحرّر وفي الحقول وفوق الحوار تتنحّى
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.code !== "KeyZ" && e.code !== "KeyY")) return;
    const t = e.target as HTMLElement | null;
    if (dialog.open || t?.isContentEditable || t?.closest?.("input, textarea, select")) return;
    e.preventDefault();
    runHist(e.code === "KeyY" || e.shiftKey);
  }, { signal: docSignal });

  /* ───────── الحال ───────── */
  let layoutTimer = 0;
  function onEdit() {
    if (recording) return; // ١٤: معاملة السمات من record() لا تمسّ النصّ، فلا تخطيط بعدها (كان يقطع قرصاً ثانياً بعد 180ms، letter-item-pinch:82)
    const n = editorChars(le.ed);
    const empty = isEmptyDoc(toLetterDoc(le.json(), st.font)) && !le.ed.state.doc.textContent.trim();
    emptyEl.hidden = !empty;
    tplTop.hidden = n > 0; // «قالب» يُخفى ما دام في المتن نص (مواصفة لمى)
    saveBtn.disabled = empty;
    hint.hidden = !empty;
    if (empty) saveBtn.setAttribute("aria-describedby", hint.id); else saveBtn.removeAttribute("aria-describedby");
    const left = MAX_CHARS - n;
    counter.textContent = left <= 200 ? S4.textRemaining(left) : SL.count(n, MAX_CHARS);
    counter.classList.toggle("near", left <= 200);
    st.dirty = st.dirty || !empty;
    syncBars();
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => { layoutTimer = 0; void relayout(); }, 180);
  }
  function syncSetup() {
    cardName.textContent = SL.marginsCard(SL.marginNames[st.margins.preset]); // ن١٩
    const hs = !st.header ? SL.noHeader : st.header.on === "all" ? SL.headerAll : SL.headerFirst;
    cardSum.textContent = [hs, ...(st.frame === "none" ? [] : [st.frame === "thin" ? SL.thin : SL.double]), ...(st.background ? [SL.withBackground] : [])].join("، ");
    setupCard.setAttribute("aria-label", `${SL.setup}: ${cardName.textContent}، ${cardSum.textContent}`);
    thumb.dataset.frame = st.frame;
    thumb.classList.toggle("has-header", !!st.header);
    void relayout();
    if (booted) { paintPages(); refreshZoom(); recordSoon(); } // «عرض السطر» يتبع الهوامش
  }

  /** يرسم التاريخ في «الكتابة» بشكله، أو يخفيه */
  function paintDate(el: HTMLElement, d: LetterDate) {
    const t = dateNow(d);
    el.dataset.cal = t.cal;
    el.dataset.form = t.form;
    el.replaceChildren(...dateTexts(d).lines.map((x) => h("span", {}, x)));
  }
  function syncDate() {
    dateEl.hidden = !st.date;
    if (st.date) { paintDate(dateEl, st.date); dateEl.append(dateGrip); dateEl.setAttribute("aria-label", dateTexts(st.date).aria); }
    else dateEl.replaceChildren();
    void relayout();
    if (booted) recordSoon();
  }

  function setupNow(): PageSetup {
    return {
      margins: { ...st.margins }, frame: st.frame, background: st.background?.img,
      date: st.date ? { ...dateNow(st.date), ...(st.date.at ? { at: { ...st.date.at } } : {}) } : undefined,
      header: st.header ? { img: st.header.img, on: st.header.on } : undefined,
      logo: st.items.some((i) => i.kind === "logo") || undefined, // المتن من ٤٣ مم في الأولى (layout.ts، LOGO_TOP)
      items: st.items.flatMap((it) => (it.img ? [{ page: it.page, fx: it.fx, fy: it.fy, fw: it.fw, fh: it.fh, img: it.img }] : [])),
      texts: st.items.flatMap((it) => (it.tb ? [{ page: it.page, fx: it.fx, fy: it.fy, fw: it.fw, blocks: toLetterDoc(it.tb.ed.json(), st.font).blocks }] : [])),
    };
  }
  function docNow(): LetterDoc {
    return { ...toLetterDoc(le.json(), st.font), page: setupNow() };
  }

  let layoutSeq = 0;
  /** آخر تخطيط وصلت صفحاته إلى `st.pages`: فإن تأخّر عن `layoutSeq` أو انتظر مؤقّت الكتابة فالصفحات قديمة */
  let laidSeq = 0;
  let lastStarts = "";
  let overShown = false;
  let failShown = false;
  async function relayout() {
    const seq = ++layoutSeq;
    const doc = docNow();
    let pages: Page[];
    try { pages = await (await getEngine()).layout(doc); } catch (e) {
      if (seq !== layoutSeq) return;
      // حدّ لا عطل (شرط أمين لرفع الحدّ): يُقال مرّة حتى يعود التخطيط سليماً، والمعاينة تبقى آخر ما صحّ
      if (isLimitError(e)) { if (!overShown) { overShown = true; showAlert(SL.overLimit(MAX_PAGES, MAX_CHARS)); } return; }
      // وغيره عطلٌ لا يُبتلع (فهد ١): رسالة مرّة حتى يعود سليماً، والورقة بتقدير الصفحات فلا يبقى النصّ بلا ورقة
      if (!failShown) { failShown = true; showAlert(SL.layoutFailed); }
      paintPages(Math.max(1, st.pages.length));
      paintPages(Math.max(1, st.pages.length, Math.ceil(paper.scrollHeight / (PAGE_H * kp() + GAP))));
      return;
    }
    if (seq !== layoutSeq) return;
    overShown = false;
    failShown = false;
    st.pages = pages;
    laidSeq = seq;
    paintPages();
    const starts = pages.map((p) => p.start);
    if (JSON.stringify(starts) !== lastStarts) { lastStarts = JSON.stringify(starts); le.setBreaks(starts); } else fitGaps();
    for (const it of st.items) if (it.page >= pages.length) it.page = pages.length - 1; // البند ١٣
    syncFloats();
    await renderPreview();
  }

  const sheetW = () => {
    const w = previewCol.clientWidth - (WIDE.matches ? 0 : 0);
    return Math.max(200, Math.min(WIDE.matches ? (innerWidth < 1380 ? 352 : 476) : 366, w));
  };
  const sheets: HTMLElement[] = [];
  /* ١٨: أصابع اللمس على pagesEl والقرص الجاري، ونهاية سحب المقبض. هنا قبل renderPreview وselect لأنهما يصفّيانها (أمين ١ و٣) */
  const touches = new Map<number, { x: number; y: number }>();
  let itemPinch: null | { it: Item; base: Pick<Item, "fx" | "fy" | "fw" | "fh">; d0: number; mx: number; my: number } = null;
  /** من بدء القرص حتى رفع آخر إصبع */
  let pinchLock = false;
  /** «الكتابة»: الأصابع النازلة، وقفل الإصبع الثاني (منفصل عن pinchLock الذي يُفكّ من pagesEl وحده): لا سحب جديد حتى تُرفع كلها */
  const wDown = new Set<number>();
  let wLock = false;
  document.addEventListener("pointerdown", (e) => { if (e.isPrimary) wDown.clear(); wDown.add(e.pointerId); }, { capture: true, signal: docSignal });
  const wUp = (e: PointerEvent) => { wDown.delete(e.pointerId); if (!wDown.size) wLock = false; };
  document.addEventListener("pointerup", wUp, { capture: true, signal: docSignal });
  document.addEventListener("pointercancel", wUp, { capture: true, signal: docSignal });
  let itemFrame = 0;
  /** ينهي سحب المقبض الجاري (يثبّته ويزيل مستمعيه): من select() ومن فقد الالتقاط */
  let resizeEnd: (() => void) | null = null;
  async function renderPreview() {
    if (!WIDE.matches && st.view !== "preview") return;
    const w = sheetW();
    const n = st.pages.length;
    while (sheets.length < n) {
      const canvas = h("canvas", { class: "lt-canvas", "aria-hidden": "true" });
      const sheet = h("div", { class: "lt-page", "data-test": "lt-page" }, canvas);
      sheet.addEventListener("pointerdown", (e) => { if (e.target === sheet || e.target === canvas) select(null); });
      const cap = h("p", { class: "lt-pnum" });
      sheets.push(h("figure", { class: "lt-fig" }, sheet, cap));
    }
    sheets.splice(n).forEach((f) => f.remove());
    pagesEl.replaceChildren(...sheets);
    resetTouches(true); // أمين ١: إعادة العرض تُسقط ما كان تحت الأصابع، فلا يبقى إصبعٌ شبحيّ. والقفل يبقى حتى الرفع التالي
    await Promise.all(st.pages.map(async (p, i) => {
      const fig = sheets[i]!;
      const sheet = fig.firstElementChild as HTMLElement;
      sheet.style.inlineSize = `${w}px`;
      sheet.style.blockSize = `${(w * PAGE_H) / PAGE_W}px`;
      (fig.lastElementChild as HTMLElement).textContent = S.page(i + 1, n);
      await drawPage(sheet.firstElementChild as HTMLCanvasElement, p, i, docNow().page!, w);
    }));
    for (const it of st.items) mountItem(it);
    if (dateItem) mountItem(dateItem);
    for (const it of [...st.items, ...(dateItem ? [dateItem] : [])]) {
      const f = it.canvas ? floatOf(it.kind === "date" ? "date" : textItems().indexOf(it)) : undefined;
      if (f) drawFloat(it.canvas!, f, sizeOf(it).W);
    }
    if (st.selected) syncSel();
    showHint(); // ن٨ يصير ن٧ب مع أول عنصر
  }

  /* ───────── التاريخ ومربّعات النصّ عناصرَ تُسحب (v2 الدفعة و) ───────── */
  /** التاريخ في «معاينة الصفحة»: عنصرٌ ما دام في الخطاب تاريخ */
  let dateItem: Item | null = null;
  attachWDrag(() => dateItem, dateGrip, dateEl, () => openDateSheet());
  const textItems = () => st.items.filter((i) => i.kind === "text");
  /** صندوق التاريخ أو المربّع وقطعه من آخر تخطيط */
  const floatOf = (key: Float["key"]): Float | undefined => { for (const p of st.pages) { const f = p.floats.find((x) => x.key === key); if (f) return f; } return undefined; };
  function floatEl(kind: "text" | "date"): { el: HTMLElement; canvas: HTMLCanvasElement } {
    const canvas = h("canvas", { class: "lt-fcanvas", "aria-hidden": "true" }) as HTMLCanvasElement;
    const el = h("div", { class: "item lt-float", tabindex: 0, role: "button", "data-test": kind === "date" ? "lt-date-item" : "item", "data-kind": kind },
      canvas, h("span", { class: "item-grip", "aria-hidden": "true", "data-test": "item-grip" }));
    return { el, canvas };
  }
  /** بعد التخطيط: ارتفاع كل مربّع من نصّه وموضعه في «الكتابة»، والتاريخ بصندوقه */
  function syncFloats() {
    textItems().forEach((it, i) => { const f = floatOf(i); if (f) it.fh = f.box.h / PAGE_H; placeBox(it); });
    syncWItems();
    const f = st.date ? floatOf("date") : undefined;
    if (!st.date || !f) {
      if (dateItem) { if (st.selected === dateItem) select(null); dateItem.el.remove(); dateItem = null; }
    } else {
      if (!dateItem) { dateItem = { id: "date", kind: "date", page: 0, fx: 0, fy: 0, fw: 0, fh: 0, ...floatEl("date") }; attachDrag(dateItem); }
      // الموضع من الحال (`at`) لا من التخطيط: تخطيطٌ بدأ قبل السحب ووصل بعده لا يعيده إلى مكانه القديم
      const at = st.date.at;
      if (!dateItem.el.classList.contains("dragging") && !dateEl.classList.contains("dragging")) Object.assign(dateItem, { fx: at ? at.fx : f.box.x / PAGE_W, fy: at ? at.fy : f.box.y / PAGE_H, fw: f.box.w / PAGE_W, fh: f.box.h / PAGE_H });
      dateItem.el.setAttribute("aria-label", dateTexts(st.date).lines.join("، "));
    }
    placeDateEl();
  }
  /** المربّع في «الكتابة»: على صفحته بكسوره، والدرجة من `--k` */
  function placeBox(it: Item) {
    if (!it.tb || it.tb.host.classList.contains("dragging")) return;
    wPlace(it.tb.host, it, false);
  }
  /** صفحة العنصر في «الكتابة»: ما اختفت صفحته إلى آخر صفحة بكسوره، كالمحرّك (layout.ts وpdf.ts) و`sheetOf` */
  const wPage = (it: Item) => Math.max(0, Math.min(it.page, Math.max(1, st.pages.length) - 1));
  /** موضع عنصر في «الكتابة» على صفحته بكسوره، والدرجة من `--k` (معادلة المربّع نفسها)، والارتفاع للصور وحدها */
  function wPlace(el: HTMLElement, it: Item, withH: boolean) {
    const pg = wPage(it);
    Object.assign(el.style, { insetBlockStart: `calc(var(--k) * ${+((pg + it.fy) * PAGE_H).toFixed(3)} + ${pg * GAP}px)`, insetInlineStart: pt((1 - it.fx - it.fw) * PAGE_W), inlineSize: pt(it.fw * PAGE_W) });
    if (withH) el.style.blockSize = pt(it.fh * PAGE_H);
  }
  /** نسخ الصور في «الكتابة» (`.lt-witem`): واحدة لكل صورة بترتيب `st.items`، وهو ترتيب رسمها في PDF */
  function syncWItems() {
    const imgs = st.items.filter((it) => it.img);
    for (const it of imgs) {
      if (!it.w) {
        it.w = h("div", { class: "lt-witem", "aria-hidden": "true", tabindex: -1, "data-test": "lt-witem", "data-kind": it.kind },
          h("img", { src: it.url, alt: "", draggable: "false" }), wGrip());
        attachWDrag(() => it, it.w, it.w);
      }
      if (!it.w.classList.contains("dragging")) wPlace(it.w, it, true);
    }
    const now = [...wLayer.children];
    if (now.length !== imgs.length || imgs.some((it, i) => now[i] !== it.w)) wLayer.replaceChildren(...imgs.map((it) => it.w!));
  }
  /**
   * السحب في «الكتابة» (مواصفة لمى، تحريك العناصر §٢): الصورة بنفسها، والمربّع والتاريخ من مقبضهما. أثناءه `translate` على عنصر
   * «الكتابة» وحده وكسور العنصر تتبع فتتحرّك نسخة المعاينة معه، وعند الرفع الكسور ثم `moved` ثم مدخلٌ واحد في السجلّ.
   * وإصبعٌ ثانٍ يلغيه، و`st.saving` يمنع بدءه، والضغط يمنع التركيز فيبقى المحرّر مركَّزاً ولوحة المفاتيح مفتوحة
   */
  function attachWDrag(get: () => Item | null, handle: HTMLElement, moveEl: HTMLElement, onTap?: () => void) {
    let s: { id: number; px: number; py: number; r: Rect; W: number; H: number; fx: number; fy: number; go: boolean } | null = null;
    const finish = (keep: boolean) => {
      const it = get();
      if (!s) return;
      const { fx: fx0, fy: fy0, W, H, go } = s;
      s = null;
      moveEl.classList.remove("dragging");
      moveEl.style.transform = "";
      wbar.classList.remove("moving");
      wbarSoon();
      if (!it) return;
      if (!keep) { it.fx = fx0; it.fy = fy0; }
      const ok = keep && Math.hypot((it.fx - fx0) * W, (it.fy - fy0) * H) >= 1;
      if (it.kind === "date") { if (ok && st.date) st.date.at = { fx: it.fx, fy: it.fy }; placeDateEl(); }
      else if (it.w) wPlace(it.w, it, true); else placeBox(it);
      if (it.el.isConnected) position(it);
      if (ok) { endHint(600); moved(it); record(); st.dirty = true; }
      else if (keep && !go) onTap?.(); // لمسةٌ بلا تحريك (ملحق لمى ٢٠٢٦/١١/١٥): للتاريخ تفتح «تعديل التاريخ»
    };
    handle.addEventListener("pointerdown", (e) => {
      const it = get();
      if (!it || s || st.saving || e.button > 0 || (wLock && wDown.size > 1)) return;
      wLock = false;
      e.preventDefault();
      e.stopPropagation();
      const pg = pagesBack.firstElementChild as HTMLElement | null;
      const W = pg?.offsetWidth || PAGE_W * kp(), H = pg?.offsetHeight || PAGE_H * kp();
      handle.setPointerCapture(e.pointerId);
      s = { id: e.pointerId, px: e.clientX, py: e.clientY, r: { x: it.fx * W, y: it.fy * H, w: it.fw * W, h: it.fh * H }, W, H, fx: it.fx, fy: it.fy, go: false };
      moveEl.classList.add("dragging"); // المقبض مصمت منذ الضغط
      if (it.img) select(it, "write"); // الصورة تُحدَّد بالضغط عليها أو على مقبضها، فتبقى زواياها وشريطها بعد الرفع
    });
    handle.addEventListener("pointermove", (e) => {
      const it = get();
      if (!s || !it || e.pointerId !== s.id) return;
      if (!s.go && Math.hypot(e.clientX - s.px, e.clientY - s.py) < 8) return; // العتبة 8px: قبلها لا يتحرّك شيء
      if (!s.go && st.selected === it) wbar.classList.add("moving"); // الشريط يُخفى أثناء السحب ويعود في الموضع الجديد
      s.go = true;
      const r = moveRect(s.r, s.r.x + e.clientX - s.px, s.r.y + e.clientY - s.py, s.W, s.H);
      it.fx = r.x / s.W; it.fy = r.y / s.H;
      moveEl.style.transform = `translate(${r.x - s.r.x}px, ${r.y - s.r.y}px)`;
      if (it.el.isConnected) position(it); // العمود الآخر على الكمبيوتر حيّاً
    });
    handle.addEventListener("pointerup", (e) => { if (s && e.pointerId === s.id) finish(true); });
    handle.addEventListener("pointercancel", (e) => { if (s && e.pointerId === s.id) finish(false); });
    // الالتقاط يُفقد بلا رفع (إعادة رسم الطبقة، أو المتصفح): كالإلغاء، وإلا بقيت `.dragging` وزواياها و`s` عالقة
    handle.addEventListener("lostpointercapture", (e) => { if (s && e.pointerId === s.id) finish(false); });
    document.addEventListener("pointerdown", (e) => { if (s && e.pointerId !== s.id) { wLock = true; finish(false); } }, { capture: true, signal: docSignal }); // الإصبع الثاني يلغي ولا يبدأ سحباً
  }
  /** التاريخ المحرَّك في «الكتابة»: خارج التدفّق حيث وُضع، بعرض المتن */
  function placeDateEl() {
    const at = st.date?.at;
    dateEl.classList.toggle("moved", !!at);
    if (!at) { dateEl.style.insetBlockStart = dateEl.style.insetInlineStart = dateEl.style.inlineSize = ""; return; }
    const cw = contentBox(setupNow(), 0).w;
    Object.assign(dateEl.style, { insetBlockStart: pt(at.fy * PAGE_H), insetInlineStart: pt((1 - at.fx) * PAGE_W - cw), inlineSize: pt(cw) });
    followDate();
  }
  /** سحب التاريخ في المعاينة يُزيحه في «الكتابة» حيّاً (§٥) من موضعه المحفوظ، فلا يتحرّك المتن، ويخرج من التدفّق عند الرفع (`moved`) */
  function followDate() {
    if (!dateItem || !st.date || dateEl.classList.contains("dragging")) return;
    const at = st.date.at, f = at ? undefined : floatOf("date");
    const bx = at ? at.fx : f ? f.box.x / PAGE_W : dateItem.fx, by = at ? at.fy : f ? f.box.y / PAGE_H : dateItem.fy;
    const dx = (dateItem.fx - bx) * PAGE_W, dy = (dateItem.fy - by) * PAGE_H;
    dateEl.style.transform = Math.abs(dx) + Math.abs(dy) < 1e-3 ? "" : `translate(${pt(dx)}, ${pt(dy)})`;
  }
  /** بعد سحب التاريخ أو المربّع: التاريخ يخرج من التدفّق، ويُعاد التخطيط فيصعد المتن */
  function moved(it: Item) {
    if (it.kind === "date" && st.date) st.date.at = { fx: it.fx, fy: it.fy };
    if (it.kind !== "date" && it.kind !== "text") return;
    placeBox(it);
    placeDateEl();
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => { layoutTimer = 0; void relayout(); }, 180);
  }
  /** «مربّع نص»، ومع غيره «مربّع نص ١»… بترتيب الإضافة (هدى) */
  function syncBoxNames() {
    const all = textItems();
    all.forEach((it, i) => {
      const name = SL.textBoxName(i + 1, all.length);
      it.el.setAttribute("aria-label", name);
      it.tb!.ed.ed.view.dom.setAttribute("aria-label", name);
    });
  }

  /* ───────── العناصر الحرّة (نسق «تحرير ملف») ───────── */
  const sheetOf = (it: Item) => sheets[Math.min(it.page, sheets.length - 1)]?.firstElementChild as HTMLElement | undefined;
  const sizeOf = (it: Item) => { const s = sheetOf(it); return { W: s?.clientWidth || sheetW(), H: s?.clientHeight || (sheetW() * PAGE_H) / PAGE_W }; };
  const rectOf = (it: Item): Rect => { const { W, H } = sizeOf(it); return { x: it.fx * W, y: it.fy * H, w: it.fw * W, h: it.fh * H }; };
  function setRect(it: Item, r: Rect) {
    const { W, H } = sizeOf(it);
    it.fx = r.x / W; it.fy = r.y / H; it.fw = r.w / W; it.fh = r.h / H;
    position(it);
  }
  function position(it: Item) {
    const r = rectOf(it);
    it.el.style.inlineSize = `${r.w}px`;
    it.el.style.blockSize = `${r.h}px`;
    it.el.style.transform = `translate(${r.x}px, ${r.y}px)`;
    if (it === st.selected) wbarSoon();
    if (it.w && !it.w.classList.contains("dragging")) wPlace(it.w, it, true); // نسخة «الكتابة» تتبع حيّاً
    else if (it.tb) placeBox(it);
    else if (it.kind === "date") followDate();
    if (it.canvas) { // لوحة النصّ بحاشيتها حول الصندوق (preview.ts، FLOAT_PAD)
      const p = (FLOAT_PAD * sizeOf(it).W) / PAGE_W;
      Object.assign(it.canvas.style, { insetBlockStart: `${-p}px`, insetInlineStart: `${-p}px`, inlineSize: `${r.w + 2 * p}px`, blockSize: `${r.h + 2 * p}px` });
    }
  }
  function mountItem(it: Item) {
    const s = sheetOf(it);
    if (!s) return;
    if (it.el.parentElement !== s) s.append(it.el);
    position(it);
  }
  function makeItemEl(it: Omit<Item, "el">): HTMLElement {
    const label = it.kind === "signature" ? S.signature : it.kind === "stamp" ? S.stamp : it.kind === "logo" ? SL.logoItem : SL.image;
    return h("div", { class: "item enter", tabindex: 0, role: "button", "aria-label": label, "data-test": "item", "data-kind": it.kind },
      h("img", { src: it.url, alt: "", draggable: "false" }), h("span", { class: "item-grip", "aria-hidden": "true", "data-test": "item-grip" })); // §٤: لا يُطبع (المحرّك يرسم من الحال)
  }
  function attachDrag(it: Item) {
    const el = it.el;
    let start: { px: number; py: number; x: number; y: number } | null = null;
    el.addEventListener("pointerdown", (e) => {
      if (st.saving || e.button > 0) return;
      e.preventDefault();
      select(it);
      el.setPointerCapture(e.pointerId);
      const r = rectOf(it);
      start = { px: e.clientX, py: e.clientY, x: r.x, y: r.y };
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!start || pinchLock) return; // ١٨: السحب صار قرصاً، والإصبع الباقي لا يعود سحباً حتى يُرفع
      const { W, H } = sizeOf(it);
      setRect(it, moveRect(rectOf(it), start.x + e.clientX - start.px, start.y + e.clientY - start.py, W, H));
    });
    const end = () => {
      if (!start) return;
      const r = rectOf(it);
      if (Math.hypot(r.x - start.x, r.y - start.y) >= 1) { endHint(600); moved(it); record(); } // سحب ناجح: تحرّك العنصر فعلاً
      start = null;
      st.dirty = true;
      el.classList.remove("dragging");
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      // ١٨: «+» و«=» تكبير و«-» تصغير بخطوة الزرّين، والعنصر مركَّز (Ctrl معها للمتصفح)
      if ((e.key === "+" || e.key === "=" || e.key === "-") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); scaleSel(e.key === "-" ? 1 / 1.1 : 1.1); return; }
      const d = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, number[]>)[e.key];
      if (!d) return;
      e.preventDefault();
      const { W, H } = sizeOf(it);
      const r = rectOf(it), k = e.shiftKey ? 20 : 4;
      setRect(it, moveRect(r, r.x + d[0]! * k, r.y + d[1]! * k, W, H));
      moved(it);
      recordSoon(); // المتتالية مدخلٌ واحد
    });
    el.addEventListener("focus", () => select(it));
  }
  /** `from`: من أين حُدِّد (مواصفة الشريط §١): على الكمبيوتر شريطٌ واحد، العائم لما حُدِّد في «الكتابة» و`selBar` لما حُدِّد في المعاينة */
  function select(it: Item | null, from: "write" | "preview" = "preview") {
    if (st.selected !== it) resizeEnd?.(); // أمين ٣: مقبضٌ يُسحب لعنصرٍ لم يعد المحدَّد يُنهى
    if (!it) resetTouches(); // أمين ١
    const prev = st.selected;
    if (prev && prev !== it) { prev.el.classList.remove("sel"); wOf(prev)?.classList.remove("sel"); }
    st.selected = it;
    if (it) { selFrom = from; it.el.classList.add("sel"); wOf(it)?.classList.add("sel"); } // الزوايا على النسختين
    if (it) it.el.append(...handles); else handles.forEach((x) => x.remove()); // ١٨: مقابض الزوايا مع المحدَّد وحده
    syncSel();
  }
  function syncSel() {
    const it = st.selected;
    selBar.hidden = !it || inWrite(); // على الجوال مخفيّ في «الكتابة»
    if (it) {
      const { W, H } = sizeOf(it);
      const l = it.kind === "text" ? textLimits(it) : it.kind === "date" ? { canGrow: false, canShrink: false } : limits(rectOf(it), W, H);
      grow.disabled = wGrow.disabled = !l.canGrow;
      shrink.disabled = wShrink.disabled = !l.canShrink;
    }
    placeWbar();
  }
  /* ───────── الشريط العائم في «الكتابة» (مواصفة الشريط §١ و§٤) ───────── */
  let selFrom: "write" | "preview" = "preview";
  /** نسخة المحدَّد في «الكتابة»: الصورة أو المربّع، ولا نسخة للتاريخ */
  const wOf = (it: Item) => it.w ?? it.tb?.host;
  /** التحديد ظاهرٌ في «الكتابة»: على الجوال ما دامت هي العرض، وعلى الكمبيوتر ما حُدِّد منها */
  const inWrite = () => (WIDE.matches ? selFrom === "write" : st.view === "write");
  /** لمس الورقة أو المتن ونصّ المربّع، وأول حرف، وEscape، وفتح لوحة: يلغي تحديد «الكتابة» */
  const dropWSel = () => { if (st.selected && inWrite()) select(null); };
  const WB_H = 52;
  let wbOn = false, wbBelow = false, wbT = 0, wbFrame = 0, wbHold = false;
  function hideWbar() {
    if (!wbOn) { wbar.hidden = true; return; }
    wbOn = false;
    if (wbar.contains(document.activeElement)) act.ed.commands.focus(); // التركيز لا يسقط إلى body
    wbar.classList.remove("on", "moving");
    wbT = window.setTimeout(() => { if (!wbOn) wbar.hidden = true; }, 120);
  }
  /**
   * فوق العنصر: أسفله = أعلى العنصر − 14، وإن لم يتّسع فتحت المقبض: أعلاه = أسفل العنصر + 48 (منطقة .lt-wgrip تمتدّ 40)، بتردّد 16.
   * وأفقياً وسط العنصر و12 من الحافّتين (وعلى الكمبيوتر داخل .lt-write). والأرضية أدنى ما يلي ناقص 8: أسفل visualViewport،
   * وأعلى الحبّة والعمود والحاوية السفلية مما يقع تحته. ويُخفى إن خرج العنصر من المساحة الظاهرة
   */
  function placeWbar() {
    const it = st.selected, t = it && wOf(it);
    if (!it || !t || !t.isConnected || !inWrite() || st.saving || st.panel !== "none" || !st.items.includes(it)) { hideWbar(); return; }
    if (wbHold && wbOn) return;
    const r = t.getBoundingClientRect();
    if (!r.width) { hideWbar(); return; }
    const text = it.kind === "text";
    wGrow.hidden = wShrink.hidden = wSep.hidden = text;
    wbar.setAttribute("aria-label", it.el.getAttribute("aria-label") ?? "");
    const vt = vv ? vv.offsetTop : 0, vb = vv ? vv.offsetTop + vv.height : innerHeight;
    const min0 = Math.max(vt, top.getBoundingClientRect().bottom) + 8;
    wbar.hidden = false; // للقياس، وهو شفّاف ما لم يكن .on
    const bw = wbar.offsetWidth;
    const span = WIDE.matches ? write.getBoundingClientRect() : { left: 0, right: innerWidth };
    const cx = (r.left + r.right) / 2;
    /* بلاغ نايف ٢٠٢٦/١١/١٥ (docs/logs/wbar-ios.md): العمود المُرسى «أعلى» كان يُعدّ أرضيةً فيُخفي الشريط، أو يُتخطّى فيغطّيه الشريط.
     * فالعمود «أعلى» سقفٌ (أسفله + 8)، و«أسفل» والحبّة وصفّ الحفظ أرضية (أعلاها − 8)، والعمود الرأسيّ في زاويةٍ يُتجنَّب أفقياً */
    const rb = railBox.getBoundingClientRect();
    const railV = !railBox.hidden && !!rb.height && railBox.dataset.axis === "v";
    /** السقف والأرضية والموضع الرأسيّ لموضعٍ أفقيّ `x` (ما يتقاطع معه أفقياً وحده)، أو null إن خرج العنصر أو ضاق ما بينهما عن الشريط */
    const solve = (x: number) => {
      let min = min0, floor = vb;
      for (const o of railV ? [zoomPill, dock] : [zoomPill, railBox, dock]) {
        const b = o.getBoundingClientRect();
        if (o.hidden || !b.height || b.right <= x || b.left >= x + bw) continue;
        if (o === railBox && railBox.dataset.dock === "top") min = Math.max(min, b.bottom + 8);
        else floor = Math.min(floor, b.top);
      }
      floor -= 8;
      if (r.bottom < min - 8 || r.top > floor + 8) return null;
      const above = r.top - 14 - WB_H;
      let below = wbBelow ? above < min + 16 : above < min;
      let y = below ? r.bottom + 48 : above;
      if (below && y + WB_H > floor) {
        if (above >= min) { below = false; y = above; }
        else if (floor - WB_H >= min) y = floor - WB_H; // لا يتّسع فوقه ولا تحته: على طرف العنصر بين السقف والأرضية
        else return null; // أمين ٢: ما بين السقف والأرضية أضيق من الشريط
      }
      return { y, below };
    };
    let x = Math.max(span.left + 12, Math.min(span.right - 12 - bw, cx - bw / 2));
    let p = solve(x);
    // العمود الرأسيّ في زاويته: إن وقع الشريط عليه انتقل إلى جانبه الآخر (العرض 390 − 52 − 24 يتّسع لـ153)،
    // ثم يُعاد السقف والأرضية بالموضع الجديد، فلا يقع على الحبّة أو صفّ الحفظ هناك (أمين ١)
    if (p && railV && x < rb.right && rb.left < x + bw && p.y < rb.bottom && rb.top < p.y + WB_H) {
      x = rb.left + rb.width / 2 > innerWidth / 2 ? Math.max(span.left + 12, rb.left - 8 - bw) : Math.min(span.right - 12 - bw, rb.right + 8);
      p = solve(x);
    }
    if (!p) { hideWbar(); return; }
    const { y, below } = p;
    wbBelow = below;
    wbar.classList.toggle("below", below);
    wbar.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    wbar.style.transformOrigin = `${Math.round(cx - x)}px ${below ? "0" : "100%"}`; // يدخل من جهة العنصر
    const vis = wBtns.filter((b) => !b.hidden && !b.disabled);
    if (!vis.some((b) => b.tabIndex === 0)) { for (const b of wBtns) b.tabIndex = -1; if (vis[0]) vis[0].tabIndex = 0; }
    if (!wbOn) {
      wbOn = true;
      clearTimeout(wbT);
      void wbar.offsetWidth; // يبدأ الدخول من الشفافية وإزاحته
      wbar.classList.add("on");
    }
  }
  const wbarSoon = () => { if (!wbFrame) wbFrame = requestAnimationFrame(() => { wbFrame = 0; placeWbar(); }); };
  addEventListener("scroll", wbarSoon, { capture: true, passive: true, signal: docSignal });
  addEventListener("resize", wbarSoon, { signal: docSignal });
  window.visualViewport?.addEventListener("resize", wbarSoon, { signal: docSignal });
  window.visualViewport?.addEventListener("scroll", wbarSoon, { signal: docSignal });
  { const ro = new ResizeObserver(wbarSoon); ro.observe(paper); docSignal.addEventListener("abort", () => ro.disconnect()); } // التكبير وإعادة التخطيط
  stage.addEventListener("pointerdown", dropWSel); // المقابض والصور توقف انتشار ضغطها، فهذا الورقة والمتن ونصّ المربّع
  paper.addEventListener("beforeinput", dropWSel, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !st.selected || !inWrite() || st.panel !== "none" || !pop.hidden || !alignMenu.hidden || !zoomMenu.hidden || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    select(null);
    act.ed.commands.focus();
  }, { signal: docSignal });
  // التنقّل بالأسهم داخله (في RTL السهم الأيسر إلى التالي) كـ.fbar، وEscape يلغي التحديد ويعيد التركيز إلى المحرّر
  wbar.addEventListener("keydown", (e) => {
    const bs = wBtns.filter((b) => !b.hidden && !b.disabled);
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = bs.length;
    const j = e.key === "ArrowLeft" ? (i + 1) % n : e.key === "ArrowRight" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j >= 0) { e.preventDefault(); bs[i]!.tabIndex = -1; bs[j]!.tabIndex = 0; bs[j]!.focus(); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); select(null); act.ed.commands.focus(); }
  });
  wbar.addEventListener("focusin", (e) => { if (wBtns.includes(e.target as HTMLButtonElement)) for (const b of wBtns) b.tabIndex = b === e.target ? 0 : -1; });
  /** مربّع النصّ يُكبَّر ويُصغَّر عرضاً وحده، وحافّته اليمنى ثابتة (بداية السطر): إلى حافّة الصفحة اليسرى، ولا دون ٢٠ مم */
  const textLimits = (it: Item) => ({ canGrow: it.fw < it.fx + it.fw - 1e-6, canShrink: it.fw > TEXT_MIN_W * MM_X + 1e-6 });
  function scaleText(it: Item, f: number): boolean {
    const right = it.fx + it.fw;
    const fw = Math.min(right, Math.max(TEXT_MIN_W * MM_X, it.fw * f));
    it.fx = right - fw; it.fw = fw;
    position(it);
    moved(it);
    syncSel();
    st.dirty = true;
    recordSoon();
    const l = textLimits(it);
    return f > 1 ? l.canGrow : l.canShrink;
  }
  function scaleSel(f: number): boolean {
    const it = st.selected;
    if (!it || it.kind === "date") return false;
    if (it.kind === "text") return scaleText(it, f);
    const { W, H } = sizeOf(it);
    const res = scaleRect(rectOf(it), f, W, H);
    setRect(it, res.rect);
    syncSel();
    st.dirty = true;
    recordSoon(); // الضغط المستمرّ مدخلٌ واحد
    return f > 1 ? res.canGrow : res.canShrink;
  }
  const hold = (btn: HTMLButtonElement, step: () => boolean) => {
    let t1 = 0, t2 = 0;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener("pointerdown", (e) => {
      if (btn.disabled || e.button > 0) return;
      e.preventDefault();
      if (!step()) return;
      t1 = window.setTimeout(() => { t2 = window.setInterval(() => { if (!step()) stop(); }, 120); }, 400);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
    btn.addEventListener("click", (e) => { if (e.detail === 0) step(); });
  };
  hold(grow, () => scaleSel(1.1));
  hold(shrink, () => scaleSel(1 / 1.1));
  hold(wGrow, () => scaleSel(1.1));
  hold(wShrink, () => scaleSel(1 / 1.1));
  // أثناء الضغط المستمرّ يثبت الشريط مكانه: لو تبع العنصر وهو يكبر لخرج الزرّ من تحت الإصبع فأوقف `pointerleave` التكرار
  for (const b of [wGrow, wShrink]) {
    b.addEventListener("pointerdown", (e) => { if (!b.disabled && e.button <= 0) wbHold = true; });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { if (wbHold) { wbHold = false; wbarSoon(); } });
  }

  /* ───────── ١٨: القرص بإصبعين والعجلة ومقابض الزوايا للعنصر المحدَّد (docs/logs/additions-12-15-18-lama-spec.md §١٨) ─────────
     العناصر في «معاينة الصفحة» (pagesEl) لا في مسرح «الكتابة»، فالقرص هنا، وما لا يستوفي القاعدة يبقى للمتصفح كما كان.
     وما يكبر ما يكبّره الزرّ: الصورة حول مركزها بين حدّي place.ts، والنصّ عرضه، والتاريخ لا يكبر (canGrow: false) */
  type Base = Pick<Item, "fx" | "fy" | "fw" | "fh">;
  /** من الحال المحفوظة `base` بنسبة `f` ثم إزاحة المركز (dx, dy): من الأصل لا تراكماً، وعند الحدّين وقوف بلا ارتداد */
  function scaleFrom(it: Item, base: Base, f: number, dx: number, dy: number) {
    if (it.kind === "date") return;
    Object.assign(it, base);
    const { W, H } = sizeOf(it);
    if (it.kind === "text") {
      const right = base.fx + base.fw, fw = Math.min(right, Math.max(TEXT_MIN_W * MM_X, base.fw * f));
      it.fx = right - fw; it.fw = fw;
    } else setRect(it, scaleRect(rectOf(it), f, W, H).rect);
    const r = rectOf(it);
    setRect(it, moveRect(r, r.x + dx, r.y + dy, W, H));
    syncSel(); // يعطّل الزرّ المقابل عند الحدّ
  }
  /** أمين ١: يُصفّي الأصابع والقرص (عند إلغاء التحديد وإعادة العرض). القرص الجاري لا يُثبَّت: عنصره ذهب أو أُعيد رسمه.
      و`keepLock` لإعادة العرض: تقع بعد رفع إصبعٍ من القرص (moved ← relayout) والآخر باقٍ، فلو فُكّ القفل عاد سحباً بقفزة */
  function resetTouches(keepLock = false) {
    touches.clear(); itemPinch = null;
    if (!keepLock) pinchLock = false;
    if (itemFrame) { cancelAnimationFrame(itemFrame); itemFrame = 0; }
  }
  const pair = () => [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
  pagesEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const it = st.selected;
    if (!it || st.saving) return;
    const box = it.el.getBoundingClientRect();
    // إصبع أول في الهامش حول المحدَّد (لا عليه): لا يُلغي التحديد، فيبقى للقرص إن نزل الثاني
    // أمين ٤: إلا إن نزل على عنصرٍ آخر، فيُختار كالمعتاد
    if (touches.size === 1) { const other = (e.target as Element).closest?.(".item"); if (!it.el.contains(e.target as Node) && (!other || other === it.el) && pinchOnItem(box, [{ x: e.clientX, y: e.clientY }])) e.stopPropagation(); return; }
    // أمين ٢: إصبعٌ ثالث يُنهي القرص ويثبّت ما وصل إليه، ولا يعود قرصاً حتى تُرفع الأصابع كلها (pinchLock باقٍ)
    if (touches.size > 2) { if (itemPinch) { const { it: p } = itemPinch; itemPinch = null; st.dirty = true; moved(p); record(); } if (pinchLock) e.stopPropagation(); return; }
    const [a, b] = pair();
    if (!pinchOnItem(box, [a, b])) return; // للصفحة كما كان
    itemPinch = { it, base: { fx: it.fx, fy: it.fy, fw: it.fw, fh: it.fh }, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    pinchLock = true;
    e.stopPropagation(); // الإصبع الثاني لا يبدأ سحباً ولا يُلغي التحديد
  }, { capture: true });
  pagesEl.addEventListener("pointermove", (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!itemPinch || touches.size !== 2 || itemFrame) return;
    itemFrame = requestAnimationFrame(() => {
      itemFrame = 0;
      const p = itemPinch;
      if (!p || touches.size !== 2) return;
      const [a, b] = pair();
      scaleFrom(p.it, p.base, Math.hypot(a.x - b.x, a.y - b.y) / p.d0, (a.x + b.x) / 2 - p.mx, (a.y + b.y) / 2 - p.my);
    });
  });
  const liftTouch = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) { if (!touches.size) pinchLock = false; return; } // قفلٌ بقي بعد تصفية الأصابع يُفكّ بأول رفع
    if (itemPinch && touches.size < 2) { const { it } = itemPinch; itemPinch = null; st.dirty = true; moved(it); record(); } // مرة عند الرفع
    if (!touches.size) pinchLock = false;
  };
  // أمين ١: الرفع يُسمع على النافذة لا على pagesEl وحدها، فإصبعٌ انتهى خارجها (أو أُزيل هدفه) لا يبقى في `touches`
  addEventListener("pointerup", liftTouch, true);
  addEventListener("pointercancel", liftTouch, true);
  // أثناء قرص العنصر لا يكبّر المتصفح الصفحة ولا يحرّكها (gesture* في WebKit وحده)
  pagesEl.addEventListener("touchmove", (e) => { if (itemPinch && e.cancelable) e.preventDefault(); }, { passive: false });
  for (const ev of ["gesturestart", "gesturechange"]) pagesEl.addEventListener(ev, (e) => { if (itemPinch) e.preventDefault(); });
  // Ctrl + العجلة (وقرص لوحة اللمس) فوق المحدَّد: بخطوة الزرّين. وخارجه سلوك المتصفح
  pagesEl.addEventListener("wheel", (e) => {
    const it = st.selected;
    if (!e.ctrlKey || !it || !e.deltaY || st.saving) return;
    const r = it.el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault();
    scaleSel(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  /** مقابض الزوايا للفأرة (CSS: hover وpointer: fine وحدهما). الزاوية فيزيائية كموضع العنصر (translate من يسار الصفحة) */
  type Corner = "nw" | "ne" | "sw" | "se";
  const handles = (["nw", "ne", "sw", "se"] as Corner[]).map((c) => {
    const el = h("span", { class: `lt-h lt-h-${c}`, "aria-hidden": "true", "data-test": `lt-handle-${c}` });
    el.addEventListener("pointerdown", (e) => resizeFrom(c, e, el));
    return el;
  });
  function resizeFrom(c: Corner, e: PointerEvent, hEl: HTMLElement) {
    const it = st.selected;
    e.stopPropagation(); // لا يبدأ سحب العنصر
    if (!it || it.kind === "date" || st.saving || e.button > 0) return;
    e.preventDefault();
    hEl.setPointerCapture(e.pointerId);
    resizeEnd?.();
    const ac = new AbortController(), signal = ac.signal;
    const r0 = rectOf(it);
    const sx = c[1] === "e" ? 1 : -1, sy = c[0] === "s" ? 1 : -1;
    const ax = sx > 0 ? r0.x : r0.x + r0.w, ay = sy > 0 ? r0.y : r0.y + r0.h; // الزاوية المقابلة ثابتة
    const move = (ev: PointerEvent) => {
      const s = sheetOf(it)?.getBoundingClientRect();
      if (!s) return;
      const { W, H } = sizeOf(it);
      const px = ev.clientX - s.left, py = ev.clientY - s.top;
      if (it.kind === "text") { // العرض وحده كالزرّ، والحافّة المقابلة ثابتة
        const room = sx > 0 ? W - ax : ax;
        const w = Math.min(room, Math.max(TEXT_MIN_W * MM_X * W, (px - ax) * sx));
        setRect(it, { x: sx > 0 ? ax : ax - w, y: r0.y, w, h: r0.h });
      } else {
        const aspect = r0.w / r0.h;
        const room = Math.min(sx > 0 ? W - ax : ax, (sy > 0 ? H - ay : ay) * aspect, maxWidth(aspect, W, H));
        const w = Math.min(room, Math.max(minWidth(aspect, W, H), (px - ax) * sx, (py - ay) * sy * aspect)), hh = w / aspect;
        setRect(it, clampRect({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - hh, w, h: hh }, W, H));
      }
      syncSel();
    };
    const up = () => {
      ac.abort();
      if (resizeEnd === up) resizeEnd = null;
      st.dirty = true;
      if (it.el.isConnected) { moved(it); record(); }
    };
    resizeEnd = up;
    hEl.addEventListener("pointermove", move, { signal });
    hEl.addEventListener("pointerup", up, { signal });
    hEl.addEventListener("pointercancel", up, { signal });
    hEl.addEventListener("lostpointercapture", up, { signal });
  }
  function removeSelected() {
    const it = st.selected;
    if (!it) return;
    const ae = document.activeElement, refocus = wbar.contains(ae) || !!it.tb?.host.contains(ae); // من الشريط أو من المربّع المحذوف: التركيز إلى المتن لا body
    select(null);
    if (it.kind === "date") { it.el.classList.add("leave"); setTimeout(() => it.el.remove(), reduced() ? 0 : 120); st.date = null; st.dirty = true; syncDate(); return; } // كـ«حذف التاريخ»
    st.items = st.items.filter((x) => x !== it);
    detachItem(it); // يبقى في `known` بصورته ونصّه، فيعيده التراجع
    if (it.tb) syncBoxNames();
    st.dirty = true;
    recordItems(); // الحذف مدخلٌ في السجلّ (قرار نايف ٢٠٢٦/١١/١٥ «أ»: فوريّ بلا سؤال، ويعيده التراجع)
    if (it.kind === "logo" || it.kind === "text") void relayout(); // يعود المتن إلى أعلاه بلا شعار، ويزول نصّ المربّع
    syncInsertState();
    if (refocus) le.ed.commands.focus();
  }

  /** الصفحات من آخر ما كُتب (الدفعة ز): عنصرٌ يُدرج قبل مرور 180ms من الكتابة كان يقرأ صفحات ما قبلها فيوضع أعلى الصفحة */
  async function freshPages() {
    while (layoutTimer || laidSeq !== layoutSeq || !st.pages.length) {
      clearTimeout(layoutTimer); layoutTimer = 0;
      const before = layoutSeq;
      await relayout();
      if (laidSeq !== layoutSeq && layoutSeq === before + 1) break; // تعذّر التخطيط: يُوضع على ما عنده
    }
  }
  /** الموضع الافتراضي بالمليمتر (مواصفة لمى ٠-٤)، والصندوق بنسبة الصورة داخل الصندوق المعطى */
  async function placeItem(kind: Exclude<ItemKind, "text" | "date">, img: LetterImage) {
    await freshPages();
    const last = Math.max(0, st.pages.length - 1);
    const T = ((st.pages[last]?.bottom ?? 25 * MMPT) / MMPT) + 3; // أسفل آخر سطر + 3 مم
    let page = last, bw: number, bh: number, cx: number, top: number;
    if (kind === "signature") { bw = 56; bh = 24; cx = 105; top = T; }
    else if (kind === "stamp") { bw = 30; bh = 30; cx = 56 + 15; top = T - 1; }
    else if (kind === "logo") { bw = 30; bh = 18; cx = 105; top = 18; page = 0; }
    else {
      const b = le.cursorBlock();
      const at = st.pages.findIndex((p) => p.ends.some((e) => e.block >= b));
      page = at < 0 ? last : at;
      const end = st.pages[page]?.ends.find((e) => e.block >= b)?.y ?? st.pages[page]?.bottom ?? 25 * MMPT;
      bw = 80; bh = 120; cx = 105; top = end / MMPT + 2;
    }
    const k = Math.min(bw / img.w, bh / img.h);
    const w = img.w * k, hh = img.h * k;
    const y = Math.min(297 - hh, Math.max(0, top));
    const base = { id: crypto.randomUUID(), kind, page, fx: (cx - w / 2) * MM_X, fy: y * MM_Y, fw: w * MM_X, fh: hh * MM_Y, img, url: urlOf(img) };
    const it: Item = { ...base, el: makeItemEl(base) };
    attachDrag(it);
    known.set(it.id, it);
    st.items.push(it);
    st.dirty = true;
    recordItems(); // الإضافة مدخلٌ في السجلّ، فيلغيها التراجع (قرار نايف ٢٠٢٦/١١/١٥ «نعم»)
    closePanels();
    // نُقض «البند ٥» (قرار نايف ٢٠٢٦/١١/١٥: «نعم يبقى»): يبقى في «الكتابة» والعنصر ظاهرٌ فيها. والتحديد في المعاينة حيث تُرى (الكمبيوتر)
    syncWItems();
    await (kind === "logo" ? relayout() : renderPreview()); // الشعار يُنزل المتن إلى ٤٣ مم (docNow)، فيُعاد التخطيط
    select(it, "write"); // يُحدَّد في «الكتابة» وعليه شريطه (قرار نايف ٢٠٢٦/١١/١٥)، ويبقى محدَّداً في المعاينة
    requestAnimationFrame(() => it.el.classList.remove("enter"));
    syncInsertState();
  }

  /**
   * «مربّع نص» من «+» (v2 الدفعة و): تحت آخر سطر بـ٣ مم في آخر صفحة، عند يمين المتن، بعرض ٧٠ مم. ويبقى في «الكتابة»
   * والمؤشّر فيه، فيُكتب فيه على الصفحة. وفي «معاينة الصفحة» يُسحب ويُغيَّر عرضه ولا يُحرَّر.
   */
  async function addTextBox() {
    closePanels();
    setView("write");
    await freshPages();
    const page = Math.max(0, st.pages.length - 1);
    const cb = contentBox(setupNow(), page);
    const T = ((st.pages[page]?.bottom ?? cb.y) / MMPT) + 3;
    const fw = TEXT_W * MM_X;
    const host = h("div", { class: "lt-tbox", "data-test": "lt-tbox" });
    const ed = createEditor(host, () => boxEdit(), () => showAlert(SL.pasteCut), undefined, { label: SL.textBox, test: "lt-tbox-editor", limit: TEXT_BOX_MAX_CHARS });
    ed.ed.on("focus", () => { act = ed; if (st.panel !== "none" && !WIDE.matches) closePanels(); kbLayout(); noAutoZoom(true); syncBars(); });
    ed.ed.on("blur", () => { setTimeout(kbLayout, 0); noAutoZoom(false); });
    ed.ed.view.dom.addEventListener("beforeinput", (e) => { if (RAIL_FOLD_ON_TYPE && railOpen && /^(insert|delete)/.test((e as InputEvent).inputType)) setRail(false); });
    host.addEventListener("keydown", (e) => boxHist(e, ed.ed), true);
    watchHist(ed.ed);
    const grip = wGrip();
    host.append(grip);
    boxLayer.append(host);
    const it: Item = { id: crypto.randomUUID(), kind: "text", page, fx: (cb.x + cb.w) / PAGE_W - fw, fy: Math.min(T, 297 - 20) * MM_Y, fw, fh: (13 * 1.85) / PAGE_H, tb: { ed, host }, ...floatEl("text") };
    attachDrag(it);
    attachWDrag(() => it, grip, host, () => select(it, "write")); // المربّع يُحدَّد بلمس مقبضه بلا تحريك، ولمس نصّه للكتابة
    known.set(it.id, it);
    st.items.push(it);
    st.dirty = true;
    recordItems();
    syncBoxNames();
    placeBox(it);
    ed.ed.commands.focus("end");
    await relayout();
    syncInsertState();
  }
  /** الكتابة في مربّع: التنسيق وإعادة التخطيط، والعدّاد للمتن وحده */
  function boxEdit() {
    syncBars();
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => { layoutTimer = 0; void relayout(); }, 180);
  }

  /* ───────── لوحة «+» وقائمة «إدراج» ───────── */
  const hasLogo = () => st.items.some((i) => i.kind === "logo");
  function syncInsertState() { if (st.panel === "plus" || !pop.hidden) renderPlus(currentPlus); }
  let currentPlus: "root" | "signature" | "stamp" | "logo" = "root";
  const target = () => (WIDE.matches ? pop : panel);
  async function renderPlus(view: typeof currentPlus) {
    currentPlus = view;
    const host = target();
    if (view !== "root") { host.replaceChildren(...(await subPanel(view))); return; }
    const [sigs, stamps] = await Promise.all([listAssets("signature").catch(() => []), listAssets("stamp").catch(() => [])]);
    const mini = (a: Asset | undefined, cls: string) => (a ? h("span", { class: `lt-mini ${cls}` }, h("img", { src: URL.createObjectURL(new Blob([a.png], { type: "image/png" })), alt: "" })) : null);
    const row = (ic: string, label: string, test: string, onclick: () => void, end: (Node | null)[] = [], why?: string) => {
      const dis = !!why;
      const whyEl = why ? h("span", { class: "lt-why", id: `why-${test}` }, why) : null;
      const b = h("button", { class: "lt-prow", type: "button", "data-test": test, "aria-disabled": dis ? "true" : undefined, "aria-describedby": why ? `why-${test}` : undefined, onclick: () => { if (!dis) onclick(); } });
      b.innerHTML = ic;
      b.append(h("span", { class: "lt-plabel" }, label), ...(end.filter(Boolean) as Node[]), ...(whyEl ? [whyEl] : []));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      return b;
    };
    const chev = () => { const s = h("span", { class: "lt-chev", "aria-hidden": "true" }); s.innerHTML = I.chev; return s; };
    host.replaceChildren(
      h("div", { class: "lt-pgroup" },
        row(I.sig, SL.signature, "lt-ins-signature", () => void renderPlus("signature"), [mini(sigs[0], "sig"), chev()]),
        row(I.stamp, SL.stamp, "lt-ins-stamp", () => void renderPlus("stamp"), [mini(stamps[0], "stamp"), chev()]),
        row(I.image, SL.image, "lt-ins-image", () => pickImage()),
        row(I.logo, SL.logo, "lt-ins-logo", () => void renderPlus("logo"), [mini(stamps[0], "logo"), st.header ? null : chev()], st.header ? SL.logoWhy : undefined),
        row(I.cal, SL.dateRow, "lt-ins-date", () => { closePanels(); openDateSheet(); }),
        row(I.tbox, SL.textBox, "lt-ins-text", () => void addTextBox())),
      h("div", { class: "lt-pgroup" },
        row(I.page, SL.newPage, "lt-ins-page", () => { closePanels(); le.insertPageBreak(); }, [], le.atStart() ? SL.newPageWhy : undefined)),
      alertSlot);
  }
  const alertSlot = h("p", { class: "lt-palert", role: "alert", hidden: true });
  async function subPanel(kind: "signature" | "stamp" | "logo"): Promise<Node[]> {
    const store = kind === "signature" ? "signature" : "stamp";
    const assets = await listAssets(store).catch(() => [] as Asset[]);
    const back = h("button", { class: "icon-btn", type: "button", "aria-label": S.back, onclick: () => void renderPlus("root") }, icon("back"));
    back.addEventListener("mousedown", (e) => e.preventDefault());
    const head = h("div", { class: "lt-subhead" }, back, h("h2", {}, kind === "signature" ? SL.signature : kind === "stamp" ? SL.stamp : SL.logo), h("span", { class: "icon-spacer" }));
    const tiles = assets.map((a, i) => h("button", { class: "lt-tile", type: "button", "data-test": "lt-saved-tile", "aria-label": `${store === "signature" ? S.savedSignature : S.savedStamp} ${ar(i + 1)}`, onclick: () => void placeItem(kind, assetImage(a)) },
      h("img", { src: URL.createObjectURL(new Blob([a.png], { type: "image/png" })), alt: "" })));
    const body = tiles.length ? h("div", { class: `lt-tiles ${store}` }, ...tiles)
      : h("div", { class: "lt-pempty" }, h("p", { class: "empty-title" }, store === "signature" ? S.emptySignature : S.emptyStamp), h("p", { class: "empty-hint" }, S.emptyHint));
    const src = (ic: "photo" | "folder", label: string, input: HTMLInputElement, test: string) =>
      h("button", { class: "btn wash", type: "button", "data-test": test, onclick: () => { input.onchange = () => void newAsset(store, kind, input); input.click(); } }, icon(ic), h("span", {}, label));
    const draw = kind === "signature"
      ? h("button", { class: "btn wash lt-draw", type: "button", "data-test": "lt-draw-signature", onclick: () => drawSignature() }, icon("pen"), h("span", {}, S4.drawSignature))
      : null;
    return [head, body, h("div", { class: "lt-srcs" }, src("photo", S.fromPhotos, photoIn, "lt-from-photos"), src("folder", S.fromFiles, fileIn, "lt-from-files"), ...(draw ? [draw] : [])), alertSlot];
  }
  /** «ارسم توقيعك»: شاشة الرئيسية نفسها (src/draw-screen.ts)، تحفظ في المحفوظ، ثم يوضع التوقيع كتوقيع من المحفوظ */
  function drawSignature() {
    const wide = WIDE.matches;
    closePanels();
    openDrawScreen({
      back: () => { if (wide) openPop("insert", insDD, "signature"); else togglePanel("plus", "signature"); }, // تعود لوحة «توقيع» نفسها
      async done(asset, saved) {
        await placeItem("signature", assetImage(asset));
        if (!saved) showAlert(S4.drawSaveFailed);
      },
    });
  }
  /** توقيع أو ختم جديد: تفريغ الخلفية بالقوة التلقائية (src/bg-remove.ts)، ثم يُحفظ في المخزن القائم ويوضع */
  async function newAsset(store: "signature" | "stamp", kind: "signature" | "stamp" | "logo", input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    panelAlert(null);
    const got = await fileImage(f);
    if (got === "not-image") return panelAlert(SL.notImage);
    if (got === "bad") return panelAlert(S.badImage);
    const img = await decode(new Blob([got.bytes.slice().buffer], { type: got.type === "png" ? "image/png" : "image/jpeg" }));
    const c = h("canvas") as HTMLCanvasElement;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const out = removeBackground(ctx.getImageData(0, 0, c.width, c.height));
    if (!out) return panelAlert(S.badImage);
    c.width = out.width; c.height = out.height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return panelAlert(S.badImage);
    const png = await blob.arrayBuffer();
    try { await addAsset({ id: crypto.randomUUID(), kind: store, png, w: out.width, h: out.height, created: Date.now() }); } catch { /* يوضع وإن تعذّر حفظه */ }
    await placeItem(kind, { bytes: new Uint8Array(png), type: "png", w: out.width, h: out.height });
  }
  function pickImage() {
    fileIn.onchange = async () => {
      const f = fileIn.files?.[0];
      fileIn.value = "";
      if (!f) return;
      panelAlert(null);
      const got = await fileImage(f);
      if (got === "not-image") return panelAlert(SL.notImage);
      if (got === "bad") return panelAlert(S.badImage);
      await placeItem("image", got);
    };
    fileIn.accept = "image/*";
    fileIn.click();
  }
  function panelAlert(msg: string | null) {
    alertSlot.hidden = !msg;
    alertSlot.textContent = msg ?? "";
  }

  /* ───────── لوحة «أ» وقوائم الخط والمقاس ───────── */
  /**
   * خط التحديد (الدفعة ٣، مواصفة لمى): تحديدٌ فيه نصّ يغيّر خطّه وحده، والمؤشّر بلا تحديد يغيّر خط الخطاب كله كما كان.
   * `selFont()`: خط التحديد المحفوظ للوحة، و`null` بلا علامة (خط الخطاب)، و`undefined` مختلط. و`false` إن لم يكن تحديد.
   */
  function selFont(): LetterFont | null | undefined | false {
    const r = selHeld ? act.held() : null;
    if (!r) return false;
    const fs = act.fontsIn(r);
    return fs.length === 1 ? fs[0]! : undefined;
  }
  /** ما يُكتب على زرّ الخط: خط التحديد أو خط الخطاب، و`null` للمختلط */
  function shownFont(): LetterFont | null {
    if (!act.hasTextSel()) return st.font;
    const fs = act.fontsIn();
    return fs.length === 1 ? fs[0] ?? st.font : null;
  }
  const busyOn = (b: HTMLElement) => { b.append(h("span", { class: "spinner small", "aria-hidden": "true" })); b.setAttribute("aria-busy", "true"); };
  const busyOff = (b: HTMLElement) => { b.removeAttribute("aria-busy"); b.querySelector(".spinner")?.remove(); };
  function fontBody(): Node[] {
    const n = act.size();
    const sel = selFont();
    const sizes = h("div", { class: "lt-sizes", role: "radiogroup", "aria-label": SL.size },
      ...SIZES.map((s) => { const b = h("button", { class: "lt-size", type: "button", role: "radio", "aria-checked": String(s === n), "data-test": `lt-size-${s}`, onclick: () => { act.setSize(s); refreshFont(); } }, ar(s)); b.addEventListener("mousedown", (e) => e.preventDefault()); return b; }));
    const btn = (cls: string, on: boolean, test: string, pick: (b: HTMLButtonElement) => void, ...kids: (Node | string)[]) => {
      const b = h("button", { class: cls, type: "button", role: "radio", "aria-checked": String(on), "data-test": test, onclick: () => pick(b as HTMLButtonElement) }, ...kids) as HTMLButtonElement;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      return b;
    };
    // في التحديد: صفّ أول يعيد المحدَّد إلى خط الخطاب (يزيل العلامة)، ثم الثمانية. والاسم صورةٌ بخطّه (src/font-names.ts)، فلا يُنزَّل خطٌّ لعرضها
    const letterRow = sel === false ? [] : [btn("lt-fo lt-fo-letter", sel === null, "lt-font-letter", (b) => void setSelFont(null, b), SL.fontLetterRow(fontName(st.font)))];
    // الرقعة لا تُعرض حيث النصّ المعنيّ (التحديد، أو الخطاب كله بلا تحديد) أصغر من 14 نقطة (≈ 18.7px، قرار المدير على قاعدة نايف «تختفي»).
    // والنصّ الذي عليه الرقعة يبقى عليها وإن صُغِّر، وتبقى ظاهرةً معلَّمةً ما دامت هي المختارة
    const on = (k: FontKey) => (sel === false ? sameFont(k, st.font) : !!sel && sameFont(k, sel));
    const small = act.minSize(sel === false ? null : act.held()) < RUQAA_MIN_PT;
    const fonts = h("div", { class: "lt-fonts", role: "radiogroup", "aria-label": sel === false ? SL.fontAll : SL.fontSelection }, ...letterRow,
      ...FONT_KEYS.filter((k) => k !== "ruqaa" || !small || on(k)).map((k) => btn(`lt-fo lf-${k}`, on(k), `lt-font-${k}`,
        (b) => void (sel === false ? setFont(k, b) : setSelFont(k, b)), h("span", { class: "sr-only" }, SL.fonts[k]), nameImage(k))));
    // في برنامج ويندوز: «خطوط PDFsa» عنواناً للثمانية ما دام لخطوط الجهاز عنوان (هدى)، ثم قسمها. وفي التحديد «خط النص المحدَّد»
    const title = h("p", { class: "lt-plab", "data-test": "lt-font-title" }, sel !== false ? SL.fontSelection : APP ? SL.appFonts : SL.fontAll);
    if (!APP) return [h("p", { class: "lt-plab" }, SL.size), sizes, title, fonts, fontErr];
    return [h("p", { class: "lt-plab" }, SL.size), sizes, title, fonts, fontErr, sysUI.el];
  }
  function refreshFont() { if (st.panel === "font") panel.replaceChildren(...fontBody()); else if (!pop.hidden && popKind === "font") pop.replaceChildren(...popFont()); else if (!pop.hidden && popKind === "size") pop.replaceChildren(fontBody()[1]!); syncBars(); }
  /** القائمة المنبثقة: بلا مقاس، وفي البرنامج أو في التحديد بعنوانها */
  const popFont = () => (APP || selFont() !== false ? fontBody().slice(2) : fontBody().slice(3));
  async function setFont(k: FontKey, btn: HTMLButtonElement) {
    if (sameFont(k, st.font)) return;
    const n = ++fontSeq;
    fontErr.textContent = "";
    busyOn(btn);
    try { await loadFont(k); } catch { busyOff(btn); if (n === fontSeq) fontErr.textContent = SL.fontLoadFailed; return; } // يبقى الخط السابق
    busyOff(btn);
    if (n !== fontSeq) return;
    st.font = k;
    applyLf(paper, k);
    refreshFont();
    onEdit();
    record();
  }
  /** خط التحديد المحفوظ: يُطبَّق بعد التنزيل على حدوده بعد ما كُتب أثناءه، ولا شيء إن حُذف. وخط الخطاب (أو `null`) يزيل العلامة */
  async function setSelFont(k: LetterFont | null, btn: HTMLElement) {
    if (!act.held()) return;
    const n = ++fontSeq;
    fontErr.textContent = "";
    const target = k && !sameFont(k, st.font) ? k : null;
    if (target) {
      busyOn(btn);
      try { await ensureFont(target); } catch { busyOff(btn); if (n === fontSeq) fontErr.textContent = SL.fontLoadFailed; return; }
      busyOff(btn);
      if (n !== fontSeq) return;
    }
    const r = act.held();
    if (r) { act.setFont(target, r); onEdit(); }
    refreshFont();
  }
  const sysUI = makeSysUI();
  /**
   * قسم «خطوط الجهاز» (مواصفة لمى): العنوان والبحث ملتصقان، وصفّ لكل عائلة بخطّ الواجهة، والعربية أولاً ثم فاصل ثم الباقي.
   * يُبنى مرّة ويبقى بحثه بين فتحٍ وآخر في الجلسة، و`/list` عند أول فتح، ويُعاد بعد فشل عند الفتح التالي.
   */
  function makeSysUI() {
    const lab = h("p", { class: "lt-plab lt-syslab" }, SL.sysFonts);
    const q = h("input", { class: "lt-sysq", type: "search", placeholder: SL.sysSearch, "aria-label": SL.sysSearch, "data-test": "lt-sys-search", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    const head = h("div", { class: "lt-syshead" }, lab, q);
    const list = h("div", { class: "lt-syslist", role: "radiogroup", "aria-label": SL.sysFonts, "data-test": "lt-sys-list" });
    const msg = h("p", { class: "lt-sysmsg", "data-test": "lt-sys-msg" });
    const err = h("p", { class: "lt-syserr", "aria-live": "polite", "data-test": "lt-sys-err" });
    const el = h("div", { class: "lt-sys", "data-test": "lt-sys" }, head, list, msg);
    let fams: SysFamily[] | null = null;
    let state: "idle" | "loading" | "ready" | "error" = "idle";
    const rows = () => [...list.querySelectorAll<HTMLButtonElement>(".lt-sysf")];
    function draw() {
      el.setAttribute("aria-busy", String(state === "loading"));
      lab.querySelector(".spinner")?.remove();
      if (state === "loading") lab.append(h("span", { class: "spinner small", "aria-hidden": "true" }));
      q.disabled = state !== "ready";
      q.hidden = state === "error";
      msg.hidden = true;
      if (state === "error") { list.replaceChildren(); msg.textContent = SL.sysFontsFailed; msg.hidden = false; return; }
      if (state !== "ready") { list.replaceChildren(); return; }
      const shown = filterFamilies(fams!, q.value);
      const row = (g: SysFamily) => {
        const sel = selFont();
        const cur = sel === false ? st.font : sel;
        const on = !!cur && isSysFont(cur) && cur.family === g.family;
        const b = h("button", { class: "lt-sysf", type: "button", role: "radio", tabindex: "-1", title: g.family, "aria-checked": String(on), "data-test": "lt-sys-font", onclick: () => void choose(g, b as HTMLButtonElement) }, h("span", { class: "lt-sysname" }, g.family));
        b.addEventListener("mousedown", (e) => e.preventDefault());
        return b;
      };
      const arf = shown.filter((g) => g.arabic), enf = shown.filter((g) => !g.arabic);
      list.replaceChildren(...arf.map(row), ...(arf.length && enf.length ? [h("div", { class: "lt-syssep", "aria-hidden": "true" })] : []), ...enf.map(row));
      if (!shown.length) { msg.textContent = SL.sysNone; msg.hidden = false; }
    }
    async function choose(g: SysFamily, b: HTMLButtonElement) {
      const r: SysRef = { family: g.family, face: pickFace(g.faces, false).face };
      if (selFont() !== false) { if (b.getAttribute("aria-busy") !== "true") { err.remove(); await setSelFont(r, b); draw(); } return; } // التحديد وحده
      if (sameFont(r, st.font) || b.getAttribute("aria-busy") === "true") return;
      err.remove();
      b.setAttribute("aria-busy", "true");
      b.append(h("span", { class: "spinner small", "aria-hidden": "true" }));
      const done = () => { b.removeAttribute("aria-busy"); b.querySelector(".spinner")?.remove(); };
      try { await ensureFont(r); } catch {
        done();
        err.textContent = ""; b.after(err); err.textContent = SL.fontLoadFailed; // يبقى الخط السابق
        return;
      }
      done();
      st.font = r;
      applyLf(paper, r);
      for (const x of el.parentElement?.querySelectorAll(".lt-fo") ?? []) x.setAttribute("aria-checked", "false");
      for (const x of rows()) x.setAttribute("aria-checked", String(x === b));
      syncBars();
      onEdit();
      record();
    }
    q.addEventListener("input", () => { err.remove(); draw(); });
    q.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); rows()[0]?.focus(); } });
    list.addEventListener("keydown", (e) => {
      const all = rows(), i = all.indexOf(document.activeElement as HTMLButtonElement);
      const to = e.key === "ArrowDown" ? all[i + 1] : e.key === "ArrowUp" ? (i <= 0 ? q : all[i - 1]) : e.key === "Home" ? all[0] : e.key === "End" ? all[all.length - 1] : undefined;
      if (to) { e.preventDefault(); to.focus(); }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      const back = st.panel === "font" ? fontBtn : fontDD;
      closePanels();
      back.focus();
    });
    return {
      el,
      /** عند فتح القائمة: `/list` إن لم تُقرأ (أو فشلت)، ثم المحدَّد في العرض */
      async open() {
        const sel = () => list.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
        if (state === "ready") { draw(); sel(); return; }
        if (state === "loading") return;
        state = "loading"; draw();
        try {
          const all = await systemFonts().list();
          fams = groupFamilies(all);
          state = "ready";
          // خط جهاز لم يعد في القائمة (حُذف، أو تغيّر بعد 409): إلى الافتراضي
          const back = restoreFont(st.font, all);
          if (!sameFont(back, st.font)) { st.font = back; await ensureFont(back); applyLf(paper, back); syncBars(); onEdit(); record(true, ["ltFont"]); }
          // وخط جهاز حُذف من مقطع: تُزال علامته فيرث خط الخطاب
          const gone = (f: LetterFont) => isSysFont(f) && !sameFont(restoreFont(f, all), f);
          for (const e of [le, ...st.items.flatMap((it) => (it.tb ? [it.tb.ed] : []))]) e.dropFonts(gone);
        } catch { state = "error"; }
        draw();
        sel();
        if (state === "error") state = "idle"; // يُعاد الطلب عند الفتح التالي، والنصّ باقٍ حتى ذلك
      },
    };
  }

  /* ───────── فتح اللوحات ───────── */
  let popKind: "insert" | "font" | "size" | null = null;
  function closePanels() {
    if (selHeld) { selHeld = false; act.release(); } // يعود التحديد (والتركيز في togglePanel)
    fontErr.textContent = "";
    st.panel = "none";
    panel.hidden = true;
    pop.hidden = true;
    popKind = null;
    alignMenu.hidden = true;
    for (const b of [insDD, fontDD, sizeDD]) b.setAttribute("aria-expanded", "false");
    main.classList.remove("lt-panel-open");
    kbLayout();
    syncBars();
  }
  function togglePanel(p: "plus" | "font", view: typeof currentPlus = "root") {
    if (st.panel === p) { closePanels(); le.ed.commands.focus(); return; }
    alignMenu.hidden = true;
    dropWSel(); // فتح لوحة يلغي تحديد «الكتابة»
    st.panel = p;
    if (p === "font") selHeld = act.hold(true); // قبل إزالة التركيز: التحديد يبقى ظاهراً بزخرفة ما دامت اللوحة
    if (p === "plus") void renderPlus(view); else { panel.replaceChildren(...fontBody()); if (APP) void sysUI.open(); }
    panel.style.blockSize = `${panelHeight()}px`;
    panel.hidden = false;
    main.classList.add("lt-panel-open");
    le.ed.commands.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    kbLayout();
    syncBars();
  }
  function toggleAlignMenu() {
    if (!alignMenu.hidden) { alignMenu.hidden = true; syncBars(); return; }
    const a = mode();
    const item = (x: Mode) => {
      const off = x === "split" && a !== "split" && !act.canSplit(); // لا شيء قبل المؤشّر في فقرته
      const b = h("button", { class: "lt-am", type: "button", role: "radio", "aria-checked": String(x === a), "aria-label": ALIGN_LONG[x], "data-test": `lt-am-${x}`, onclick: () => { if (off) return; setMode(x); alignMenu.hidden = true; syncBars(); } });
      if (x === "split") b.setAttribute("aria-description", SL.splitLong);
      if (off) b.setAttribute("aria-disabled", "true");
      b.innerHTML = ALIGN_ICON[x];
      b.append(h("span", {}, ALIGN_SHORT[x]));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      return b;
    };
    alignMenu.replaceChildren(...ALIGN_ORDER.map(item), h("span", { class: "lt-amsep", "aria-hidden": "true" }), item("split"));
    alignMenu.hidden = false;
    if (WIDE.matches) placePop(alignMenu, alignBtn); else placeAlignRail();
    syncBars();
  }
  /** على الجوال: بعيداً عن حافّة العمود بفجوة 8، وأعلاها عند أعلى زرّ المحاذاة ما اتّسعت الشاشة (§٣). الموضع من جدول الجهة (§٥-١٠) */
  function placeAlignRail() {
    const p = RAIL_DOCKS[dockNow()].menu(railBox.getBoundingClientRect(), alignBtn.getBoundingClientRect(), alignMenu);
    alignMenu.style.insetBlockEnd = "auto";
    alignMenu.style.insetInlineStart = `${p.start}px`;
    alignMenu.style.insetBlockStart = `${p.top}px`;
  }
  function placePop(el: HTMLElement, by: HTMLElement) {
    const r = by.getBoundingClientRect();
    if (rail.contains(by)) { const p = RAIL_DOCKS[dockNow()].menu(railBox.getBoundingClientRect(), r, el); el.style.insetBlockStart = `${p.top + scrollY}px`; el.style.insetInlineStart = `${p.start}px`; return; } // ١٦: من العمود جانبيّاً (§٤-د)
    el.style.insetBlockStart = `${r.bottom + 6 + scrollY}px`;
    el.style.insetInlineStart = `${innerWidth - r.right}px`; // RTL: من يمين الزرّ
  }
  function openPop(kind: "insert" | "font" | "size", by: HTMLButtonElement, view: typeof currentPlus = "root") {
    if (popKind === kind) { closePanels(); return; }
    closePanels();
    dropWSel();
    popKind = kind;
    by.setAttribute("aria-expanded", "true");
    pop.className = `lt-pop lt-pop-${kind}`;
    if (kind === "insert") void renderPlus(view);
    else if (kind === "font") { selHeld = act.hold(false); pop.replaceChildren(...popFont()); }
    else pop.replaceChildren(fontBody()[1]!);
    pop.classList.toggle("lt-app", APP);
    pop.hidden = false;
    placePop(pop, by);
    if (APP && kind === "font") {
      // الارتفاع إلى أسفل الشاشة بفجوة 16، و520 على الأكثر (لمى)
      pop.style.maxBlockSize = `${Math.max(160, Math.min(520, innerHeight - by.getBoundingClientRect().bottom - 16))}px`;
      void sysUI.open();
    } else pop.style.removeProperty("max-block-size");
  }
  insDD.addEventListener("click", () => openPop("insert", insDD));
  fontDD.addEventListener("click", () => openPop("font", fontDD));
  sizeDD.addEventListener("click", () => openPop("size", sizeDD));
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Element;
    if (!pop.hidden && !pop.contains(t) && !t.closest(".lt-dd, .lt-plus, .lt-fontbtn")) closePanels();
    if (!alignMenu.hidden && !alignMenu.contains(t) && !t.closest(".lt-alignbtn")) { alignMenu.hidden = true; syncBars(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (!pop.hidden || !alignMenu.hidden || st.panel !== "none")) closePanels(); });

  /* ───────── الكتابة على الصفحة: الصفحات والدرجة والإصبعان (v2 الدفعة د، مواصفة لمى §٢) ───────── */
  /** بكسل لكل نقطة في الدرجة الحالية (`--k`) */
  const kp = () => PX * st.zoom.z;
  const GAP = 16; // بين الصفحات، ثابتة
  const pitch = () => PAGE_H * kp() + GAP;
  const pt = (v: number) => `calc(var(--k) * ${+v.toFixed(3)})`;
  let pagesSig = "";
  /** الصفحات خلف المحرّر: الخلفية والترويسة والإطار ومستطيل المتن (دليل الهوامش)، بالدوالّ نفسها التي يرسم بها المحرّك */
  /** `n`: عدد الصفحات، والافتراضي صفحات آخر تخطيط. وعند فشل التخطيط تقديرٌ من طول النصّ (`relayout`) */
  function paintPages(n = Math.max(1, st.pages.length)) {
    const setup = setupNow();
    const cb0 = contentBox(setup, 0);
    paper.style.paddingBlockStart = pt(cb0.y);
    paper.style.paddingInline = pt(cb0.x);
    sheetBox.style.minBlockSize = `calc(var(--k) * ${+(n * PAGE_H).toFixed(3)} + ${(n - 1) * GAP}px)`;
    const sig = JSON.stringify([n, st.background?.url, st.header?.url, st.header?.on, st.frame, st.margins, !!st.date, setup.logo]);
    if (sig === pagesSig) return;
    pagesSig = sig;
    const els: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const pg = h("div", { class: "lt-wpage", "data-test": "lt-wpage" });
      pg.style.insetBlockStart = `calc(var(--k) * ${+(i * PAGE_H).toFixed(3)} + ${i * GAP}px)`;
      if (st.background) pg.append(h("img", { class: "lt-wbg", src: st.background.url, alt: "" }));
      const hd = headerRect(setup, i);
      if (hd && st.header) {
        const r = containIn(hd, st.header.img);
        const im = h("img", { class: "lt-whd", src: st.header.url, alt: "" });
        Object.assign(im.style, { insetBlockStart: pt(r.y), insetInlineStart: pt(PAGE_W - r.x - r.w), inlineSize: pt(r.w), blockSize: pt(r.h) });
        pg.append(im);
      }
      for (const f of frameLines(setup)) {
        const fr = h("div", { class: "lt-wframe" });
        Object.assign(fr.style, { inset: pt(f.inset - f.width / 2), borderWidth: pt(f.width) });
        pg.append(fr);
      }
      const cb = contentBox(setup, i);
      const g = h("div", { class: "lt-wguide" });
      Object.assign(g.style, { insetBlockStart: pt(cb.y), insetInlineStart: pt(PAGE_W - cb.x - cb.w), inlineSize: pt(cb.w), blockSize: pt(cb.h) });
      pg.append(g);
      els.push(pg);
    }
    pagesBack.replaceChildren(...els);
  }
  /**
   * يضبط ارتفاع كل حدّ صفحة (`.lt-gap` من editor.ts) فيبدأ أول سطر بعده عند أعلى متن صفحته كما في المحرّك.
   * وإن طال ما قبله في المتصفح عن صفحته يبقى الحدّ صفراً، ويُكتب الفرق في `data-over` (بالبكسل).
   */
  function fitGaps() {
    const gaps = [...paper.querySelectorAll<HTMLElement>(".lt-gap")].sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page));
    if (!gaps.length) return;
    const setup = setupNow();
    const top0 = sheetBox.getBoundingClientRect().top;
    for (const g of gaps) {
      const i = Number(g.dataset.page);
      const target = i * pitch() + contentBox(setup, i).y * kp();
      const need = target - (g.getBoundingClientRect().top - top0);
      g.style.blockSize = `${Math.max(0, need)}px`;
      g.dataset.over = need < -0.5 ? String(Math.round(-need)) : "";
    }
  }
  /** دليل الهوامش: مستطيل المتن متقطّعاً ١٫٥ ثانية بعد إغلاق «شكل الصفحة» (§١)، ولا يُطبع */
  let guideTimer = 0;
  function showGuide() {
    pagesBack.classList.add("guide");
    clearTimeout(guideTimer);
    guideTimer = window.setTimeout(() => pagesBack.classList.remove("guide"), 1500);
  }

  // حاشية المسرح: 12 على الجوال، وعلى الكمبيوتر حاشية العمود (24) خارج المسرح، فـ1440 ← 0.97 و1024 ← 0.726 (§٣)
  const gutter = () => (WIDE.matches ? 0 : 12);
  const levelsNow = () => zoomLevels(stage.clientWidth || innerWidth, gutter(), contentBox(setupNow(), 0).w, WIDE.matches);
  /**
   * ما يُثبَّت عند تغيير الدرجة. أزرار التكبير والتصغير وقائمة الدرجة (`top`، بلاغ نايف ٢٠٢٦/١١/١٢: «المفروض يكبر في أعلى الصفحة
   * واذا اراد النزول ينزل»): أعلى ما يُرى من المسرح وبداية السطر (اليمين)، ولا يُنزل إلى أدنى من أعلى الورقة ولا أبعد من يمينها،
   * فإن كان أعلى الورقة ظاهراً بقي في مكانه. وغيرها (تغيّر العرض والهوامش): المؤشّر إن كان ظاهراً، وإلا وسط ما يُرى
   */
  function zoomAnchor(top = false): { x: number; y: number; caret: boolean } {
    if (top) {
      const r = stage.getBoundingClientRect(), b = sheetBox.getBoundingClientRect();
      return { x: Math.min(r.right, innerWidth, b.right), y: Math.max(r.top, 0, b.top), caret: false };
    }
    if (le.ed.isFocused) {
      try {
        const c = le.ed.view.coordsAtPos(le.ed.state.selection.head);
        if (c.top >= 0 && c.bottom <= innerHeight) return { x: c.left, y: c.top, caret: true };
      } catch { /* خارج المستند */ }
    }
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2, caret: false };
  }
  /** يغيّر الدرجة بلا حركة، ويُبقي ما تحت المؤشّر (أو وسط الشاشة) في موضعه؛ ومع `pin` تُنقل نسبةٌ من الصفحات إلى نقطة (الإصبعان) */
  function applyZoom(z: number, key: ZoomKey | null, pin?: { fx: number; fy: number; x: number; y: number }, top = false) {
    const a = pin ? { ...pin, caret: false } : zoomAnchor(top);
    const b0 = sheetBox.getBoundingClientRect();
    const fx = pin ? pin.fx : (a.x - b0.left) / b0.width, fy = pin ? pin.fy : (a.y - b0.top) / b0.height;
    st.zoom = { key, z };
    stage.style.setProperty("--z", String(z));
    // ما دام عمود المتن يتّسع للمسرح (حتى «عرض السطر» غير محصور بـ٢٠٠٪) لا تمرير أفقي، والصفحة في الوسط
    const line = Math.max(1, stage.clientWidth - 2 * gutter()) / (contentBox(setupNow(), 0).w * PX);
    stage.classList.toggle("fit", z <= line + 0.005);
    fitGaps();
    const b1 = sheetBox.getBoundingClientRect();
    let dx = b1.left + fx * b1.width - a.x, dy = b1.top + fy * b1.height - a.y;
    if (a.caret) { const c = le.ed.view.coordsAtPos(le.ed.state.selection.head); dx = c.left - a.x; dy = c.top - a.y; }
    if (Math.abs(dy) > 0.5) scrollBy({ top: dy, behavior: "instant" as ScrollBehavior });
    if (!stage.classList.contains("fit") && Math.abs(dx) > 0.5) stage.scrollBy({ left: dx, behavior: "instant" as ScrollBehavior });
    syncZoom();
  }
  /** بعد تغيّر العرض أو الهوامش: الدرجة المسمّاة تُعاد حسابها، والحرّة تُحصر في حدودها */
  function refreshZoom() {
    const lv = levelsNow();
    const z = st.zoom.key ? zoomOf(lv, st.zoom.key) : clampZoom(lv, st.zoom.z);
    if (Math.abs(z - st.zoom.z) > 1e-4 || !stage.style.getPropertyValue("--z")) applyZoom(z, st.zoom.key);
    else syncZoom();
  }
  function stepZoom(dir: 1 | -1) {
    const next = zoomStep(levelsNow(), st.zoom.z, dir);
    if (next) applyZoom(next.z, next.key, undefined, true);
  }
  /** ١٥: درجة الفتح، وما في وسط الشاشة (أو المؤشّر) يبقى في موضعه */
  function resetZoom() {
    const lv = levelsNow();
    if (atOpenZoom(lv, st.zoom.z, WIDE.matches)) return;
    applyZoom(openZoom(lv, WIDE.matches), WIDE.matches ? DEFAULT_ZOOM_WIDE : DEFAULT_ZOOM);
  }
  // ١٥: Ctrl+0 وCmd+0 والتركيز داخل المسرح
  stage.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) { e.preventDefault(); resetZoom(); }
  });
  function syncZoom() {
    const lv = levelsNow();
    const p = zoomPercent(st.zoom.z);
    zVal.textContent = SL.zoomPct(p);
    zVal.setAttribute("aria-label", SL.zoomLabel(p)); // ن٤
    zOut.setAttribute("aria-disabled", String(!zoomStep(lv, st.zoom.z, -1)));
    zIn.setAttribute("aria-disabled", String(!zoomStep(lv, st.zoom.z, 1)));
    zReset.setAttribute("aria-disabled", String(atOpenZoom(lv, st.zoom.z, WIDE.matches))); // ١٥
    zVal.setAttribute("aria-expanded", String(!zoomMenu.hidden));
  }
  /** قائمة القيمة: «الصفحة كاملة» و«عرض السطر» و«١٠٠٪»، والمختار بـ✓ */
  function toggleZoomMenu() {
    if (!zoomMenu.hidden) { zoomMenu.hidden = true; syncZoom(); return; }
    dropWSel();
    const lv = levelsNow();
    const opts: [ZoomKey, string][] = [["page", SL.zoomPage], ["line", SL.zoomLine], ["z100", SL.zoomPct(100)]];
    zoomMenu.replaceChildren(...opts.map(([k, label]) => {
      const z = zoomOf(lv, k);
      const on = Math.abs(z - st.zoom.z) < 0.005;
      const b = h("button", { class: "lt-am lt-zm", type: "button", role: "menuitemradio", "aria-checked": String(on), "data-test": `lt-zoom-${k}`,
        onclick: () => { zoomMenu.hidden = true; applyZoom(z, k, undefined, true); } }, h("span", {}, label));
      if (on) b.insertAdjacentHTML("beforeend", `<svg class="lt-zcheck" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      return b;
    }));
    zoomMenu.hidden = false;
    placeZoomMenu();
    syncZoom();
    (zoomMenu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  /** إلى الأعلى من الحبّة على الجوال، وتحتها على الكمبيوتر، بعرض 180 لا تخرج عن الشاشة */
  function placeZoomMenu() {
    const r = zVal.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - 188, r.left + r.width / 2 - 90));
    zoomMenu.style.insetInlineStart = `${innerWidth - left - 180}px`;
    if (WIDE.matches) { zoomMenu.style.insetBlockStart = `${r.bottom + 8}px`; zoomMenu.style.insetBlockEnd = "auto"; }
    else { zoomMenu.style.insetBlockEnd = `${innerHeight - r.top + 8}px`; zoomMenu.style.insetBlockStart = "auto"; }
  }
  document.addEventListener("pointerdown", (e) => { if (!zoomMenu.hidden && !zoomMenu.contains(e.target as Node) && !zVal.contains(e.target as Node)) { zoomMenu.hidden = true; syncZoom(); } });
  zoomMenu.addEventListener("keydown", (e) => {
    const items = [...zoomMenu.querySelectorAll<HTMLElement>(".lt-zm")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); zoomMenu.hidden = true; syncZoom(); zVal.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
  });

  /**
   * التقريب بالإصبعين (قرار نايف: يُبنى ولا يُؤجَّل): pointer events على المسرح، و`touch-action: pan-x pan-y` فيه يمنع تكبير
   * المتصفح للصفحة كلها. فتتغيّر `--z` بين «الصفحة كاملة» و٢٠٠٪ (ZOOM_MAX)، ويبقى ما بين الإصبعين تحتهما.
   */
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: null | { d0: number; z0: number; fx: number; fy: number } = null;
  let pinchFrame = 0;
  const mid = () => { const [a, b] = [...fingers.values()]; return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, d: Math.hypot(a!.x - b!.x, a!.y - b!.y) }; };
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      const m = mid();
      const b = sheetBox.getBoundingClientRect();
      pinch = { d0: Math.max(1, m.d), z0: st.zoom.z, fx: (m.x - b.left) / b.width, fy: (m.y - b.top) / b.height };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || fingers.size !== 2 || pinchFrame) return;
    pinchFrame = requestAnimationFrame(() => {
      pinchFrame = 0;
      if (!pinch || fingers.size !== 2) return;
      const m = mid();
      applyZoom(clampZoom(levelsNow(), (pinch.z0 * m.d) / pinch.d0), null, { fx: pinch.fx, fy: pinch.fy, x: m.x, y: m.y });
    });
  });
  const lift = (e: PointerEvent) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  // إصبعان: لا يحرّك المتصفح الصفحة أثناء التقريب، وSafari لا يكبّرها (gesture* في WebKit وحده)
  stage.addEventListener("touchmove", (e) => { if (e.touches.length >= 2 && e.cancelable) e.preventDefault(); }, { passive: false });
  for (const ev of ["gesturestart", "gesturechange"]) stage.addEventListener(ev, (e) => e.preventDefault());

  /**
   * تكبير Safari للصفحة عند التركيز على حقل خطّه أقلّ من 16px (iOS وحده): `maximum-scale=1` على هذه الصفحة أثناء الكتابة وحدها،
   * ويُزال مع الخروج من المحرّر. وiOS منذ ١٠ يُبقي تقريب المستخدم بإصبعيه معه، فلا يمسّ إتاحة التكبير. (قرار بناء يُعرض على نايف)
   */
  const vpMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const VP = vpMeta?.content ?? "";
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function noAutoZoom(on: boolean) { if (IOS && vpMeta) vpMeta.content = on ? `${VP}, maximum-scale=1` : VP; }
  // يُضاف مع تركيز المحرّر وحده، ويُزال في كل طرق الخروج: blur، وإخفاء الصفحة، والعودة من ذاكرة الرجوع، و«إغلاق» (ملاحظة 🕵️ أمين على الدفعة د)
  le.ed.on("focus", () => noAutoZoom(true));
  le.ed.on("blur", () => noAutoZoom(false));
  addEventListener("pagehide", () => noAutoZoom(false));
  addEventListener("pageshow", (e) => { if (e.persisted) noAutoZoom(false); });

  /** فوق «عرض السطر»: إن قارب المؤشّر يسار المسرح بأقلّ من 16 يمرّ العرض يساراً بقدر الحاجة مع ربع العرض، ومع سطر جديد يعود إلى 16 من اليمين */
  function trackCaret() {
    if (stage.classList.contains("fit") || !le.ed.isFocused) return;
    let c: { left: number; right: number };
    try { c = le.ed.view.coordsAtPos(le.ed.state.selection.head); } catch { return; }
    const r = stage.getBoundingClientRect();
    if (c.left < r.left + 16) stage.scrollBy({ left: c.left - (r.left + 16) - r.width / 4, behavior: "instant" as ScrollBehavior });
    else if (c.right > r.right - 16) stage.scrollBy({ left: c.right - (r.right - 16), behavior: "instant" as ScrollBehavior });
  }

  /* ───────── العرض ───────── */
  function setView(v: "write" | "preview") {
    st.view = v;
    main.dataset.view = v;
    (seg.querySelector(`input[value="${v}"]`) as HTMLInputElement).checked = true;
    if (v === "preview") { closePanels(); zoomMenu.hidden = true; setRail(false); void renderPreview(); }
    else { refreshZoom(); kbLayout(); }
    syncSel(); // التحديد يبقى بين العرضين (مواصفة الشريط §٢)، والشريط الظاهر بحسب العرض
  }

  /* ───────── تلميح المعاينة (§٤) ───────── */
  // يُحفظ على الجهاز كتفضيل الوضع (`pdfsa.theme`) وتلميح القلم (`pdfsa.penHint`) القائمَين، بلا شبكة. والتخزين الممنوع: للجلسة وحدها
  const HINT_KEY = "lt-hint-done";
  let hintDone = (() => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; } })();
  /** ن٧ أو ن٨، وكلمة «الكتابة» الأخيرة فيه زرّ ينقل إليها */
  function showHint() {
    if (hintDone) return;
    phint.hidden = false;
    const t = st.items.length || st.date ? SL.dragHint : SL.dragHintEmpty;
    const at = t.lastIndexOf(SL.write);
    const link = h("button", { class: "lt-phint-link", type: "button", "data-test": "lt-phint-write", onclick: () => setView("write") }, SL.write);
    phintText.replaceChildren(t.slice(0, at), link, t.slice(at + SL.write.length));
  }
  /** بعد أول سحب ناجح (600ms من رفع الإصبع) أو «✕» (فوراً): يختفي ولا يعود */
  function endHint(after: number) {
    if (hintDone) return;
    hintDone = true;
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* التخزين ممنوع: لا يعود في هذه الجلسة */ }
    setTimeout(() => {
      phint.classList.add("leaving");
      setTimeout(() => { phint.hidden = true; phint.classList.remove("leaving"); }, reduced() ? 120 : 160);
    }, after);
  }

  /* ───────── ورقة «شكل الصفحة» ───────── */
  function openSheet(titleText: string, body: Node[]) {
    const head = h("div", { class: "sheet-head" }, h("span", { class: "icon-spacer" }), h("h2", { id: "lt-sheet-title" }, titleText),
      h("button", { class: "icon-btn", type: "button", "aria-label": S.close, onclick: () => closeSheet() }, icon("close")));
    dialog.replaceChildren(h("div", { class: "grab", "aria-hidden": "true" }), head, h("div", { class: "sheet-body" }, ...body));
    if (!dialog.open) dialog.showModal();
  }
  function closeSheet() {
    dialog.classList.add("closing");
    setTimeout(() => { dialog.classList.remove("closing"); dialog.close(); }, reduced() ? 0 : 160);
  }
  function opt(group: string, value: string, label: Node | string, checked: boolean, on: () => void, mini?: Node) {
    const b = h("button", { class: "lt-opt", type: "button", role: "radio", "aria-checked": String(checked), "data-test": `lt-${group}-${value}`, onclick: () => { on(); openSetup(); } }, ...(mini ? [mini] : []), h("span", { class: "lt-opt-label" }, label));
    return b;
  }
  /* «هوامش الصفحة» (v2 الدفعة ج، مواصفة لمى §١): أدنى الهامش ٢٥ مم مع الإطار (layout.ts، contentBox) */
  const marginMin = () => (st.frame === "none" ? 0 : 25);
  /** الأعلى والأسفل كما في الدرجة، مرفوعَين إلى حدّ الإطار */
  const presetTB = (p: MarginPreset) => { const P = MARGIN_PRESETS[p], m = marginMin(); return { top: Math.max(P.top, m), bottom: Math.max(P.bottom, m) }; };
  const customTB = () => { const P = presetTB(st.margins.preset); return st.margins.top !== P.top || st.margins.bottom !== P.bottom; };
  /** الدرجة تضبط الجانبين دائماً، والأعلى والأسفل ما لم يُعدَّلا يدوياً */
  function setPreset(p: MarginPreset) {
    st.margins = customTB() ? { ...st.margins, preset: p } : { preset: p, ...presetTB(p) };
  }
  /** مع الإطار: «ضيّقة» معطّلة فتصير «عادية»، والأعلى والأسفل لا يقلّان عن ٢٥ */
  function setFrame(f: FrameKind) {
    st.frame = f;
    if (f === "none") return;
    if (st.margins.preset === "narrow") setPreset("normal");
    st.margins = { ...st.margins, top: Math.max(25, st.margins.top), bottom: Math.max(25, st.margins.bottom) };
  }
  const marginBounds = (edge: "top" | "bottom"): [number, number] => {
    const other = edge === "top" ? st.margins.bottom : st.margins.top;
    return [Math.max(MARGIN_RANGE[edge][0], marginMin()), Math.min(MARGIN_RANGE[edge][1], MARGIN_RANGE.sum - other)];
  };
  let lastEdge: "top" | "bottom" | null = null;

  /* الخلفيات المحفوظة على الجهاز (الدفعة ز): تظهر في صفّ «الخلفية» للاختيار بلمسة، وتُحذف بنسق «المحفوظ» في الرئيسية
     (main.ts، openPicker): «تعديل» ثم «✕» على كلٍّ، والباهت يبقى في التخزين حتى «تم» أو إغلاق الورقة */
  let bgSaved: Asset<"background">[] = [];
  const bgUrls = new Map<string, string>();
  const bgEdit = { on: false, pending: new Set<string>() };
  const bgImage = (a: Asset<"background">): LetterImage => ({ bytes: new Uint8Array(a.png), type: "jpg", w: a.w, h: a.h });
  const bgUrl = (a: Asset<"background">) => { let u = bgUrls.get(a.id); if (!u) bgUrls.set(a.id, (u = URL.createObjectURL(new Blob([a.png], { type: "image/jpeg" })))); return u; };
  void listAssets("background").then((a) => { bgSaved = a; if (setupShown && dialog.open) openSetup(); }).catch(() => {});
  async function commitBgDeletes() {
    const gone = [...bgEdit.pending];
    bgEdit.pending.clear();
    bgSaved = bgSaved.filter((a) => !gone.includes(a.id));
    for (const id of gone) {
      const u = bgUrls.get(id); if (u) URL.revokeObjectURL(u); bgUrls.delete(id);
      if (st.background?.assetId === id) st.background.assetId = null; // يبقى في الخطاب، ويُحذف من الجهاز وحده
      try { await deleteAsset(id); } catch { /* يبقى إن تعذّر */ }
    }
  }
  /** تطبيق الخلفية: ثم الأعلى والأسفل من حدّي رسمها مع فسحة ٥ مم (background.ts، edgeMargins)، فيصيران مخصّصين */
  async function applyBackground(img: LetterImage, assetId: string | null) {
    // ١٤: رابط الخلفية السابقة يبقى ما دام الخطاب مفتوحاً، فالتراجع قد يعيدها
    st.background = { img, url: urlOf(img), assetId };
    const e = await backgroundEdges(img);
    const m = e && edgeMargins(e, st.margins, marginMin());
    if (m && st.background?.img === img) { st.margins = { ...st.margins, ...m }; lastEdge = null; }
    syncSetup();
  }
  /** خلفية جديدة تُحفظ على الجهاز، إلا إن كانت محفوظةً بعينها (البايتات نفسها) */
  async function saveBackground(img: LetterImage): Promise<string | null> {
    const same = bgSaved.find((a) => a.png.byteLength === img.bytes.length && new Uint8Array(a.png).every((v, i) => v === img.bytes[i]));
    if (same) return same.id;
    const a: Asset<"background"> = { id: crypto.randomUUID(), kind: "background", png: img.bytes.slice().buffer, w: img.w, h: img.h, created: Date.now() };
    try { await addAsset(a); } catch { return null; } // يُطبَّق وإن تعذّر حفظه
    bgSaved = [a, ...bgSaved];
    return a.id;
  }

  let setupShown = false;
  dialog.addEventListener("close", () => {
    if (bgEdit.on || bgEdit.pending.size) { bgEdit.on = false; void commitBgDeletes(); }
    if (setupShown) showGuide();
    setupShown = false;
  });
  function openSetup() {
    setupShown = true;
    // ١. الهوامش: الدرجات، ثم المصغّر الحيّ والعدّادان و«استعادة هوامش …»
    const narrowOff = st.frame !== "none";
    const mthumb = (p: MarginPreset) => {
      const P = MARGIN_PRESETS[p];
      const t = h("span", { class: "lt-thumb big lt-mthumb", "aria-hidden": "true" });
      t.style.setProperty("--t", `${(P.top * 64) / 297}px`);
      t.style.setProperty("--b", `${(P.bottom * 64) / 297}px`);
      t.style.setProperty("--s", `${(P.side * 45) / 210}px`);
      return t;
    };
    const presetRow = h("div", { class: "lt-opts three", role: "radiogroup", "aria-label": SL.margins },
      ...MARGIN_PRESET_KEYS.map((p) => {
        const off = p === "narrow" && narrowOff;
        const b = opt("margin", p, SL.marginNames[p], st.margins.preset === p, () => { if (off) return; setPreset(p); lastEdge = null; syncSetup(); }, mthumb(p));
        if (off) { b.setAttribute("aria-disabled", "true"); b.setAttribute("aria-describedby", "why-narrow"); }
        return b;
      }));
    const why = narrowOff ? h("p", { class: "lt-why lt-mwhy", id: "why-narrow", "data-test": "lt-narrow-why" }, SL.narrowWhy) : null;
    const mini = h("div", { class: "lt-mmini", "aria-hidden": "true", "data-test": "lt-margin-mini" });
    const counter = (edge: "top" | "bottom") => {
      const label = edge === "top" ? SL.marginTop : SL.marginBottom;
      const val = h("output", { class: "date-val lt-mval", "data-test": `lt-margin-${edge}` });
      const mk = (d: -1 | 1) => {
        const b = h("button", { class: "step", type: "button", "aria-label": d < 0 ? SL.marginLess(label) : SL.marginMore(label), "data-test": `lt-margin-${edge}-${d < 0 ? "minus" : "plus"}` }, icon(d < 0 ? "minus" : "plus"));
        hold(b, () => stepMargin(edge, d)); // الضغط المستمرّ كـ«تكبير/تصغير»: كل 120ms بعد 400ms (§١)
        return b;
      };
      const minus = mk(-1), plus = mk(1);
      return { el: h("div", { class: "date-row lt-mrow", role: "group", "aria-label": label }, h("span", { class: "date-unit" }, label), minus, val, plus), val, minus, plus, edge };
    };
    const counters = [counter("top"), counter("bottom")];
    const restore = h("button", { class: "text-btn lt-mrestore", type: "button", "data-test": "lt-margin-restore", onclick: () => {
      st.margins = { ...st.margins, ...presetTB(st.margins.preset) };
      lastEdge = null;
      syncMargins();
      syncSetup();
      (presetRow.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
    } });
    function stepMargin(edge: "top" | "bottom", d: -1 | 1): boolean {
      const v = st.margins[edge];
      const [lo, hi] = marginBounds(edge);
      // من ١٢٫٧ تنتقل الخطوة إلى ١٣ أو ١٢، ثم مليمتراً مليمتراً
      const next = Math.min(hi, Math.max(lo, d > 0 ? Math.floor(v + 1e-9) + 1 : Math.ceil(v - 1e-9) - 1));
      if (next === v) return false;
      st.margins = { ...st.margins, [edge]: next };
      lastEdge = edge;
      syncMargins();
      syncSetup();
      return true;
    }
    function syncMargins() {
      for (const c of counters) {
        const v = st.margins[c.edge];
        const [lo, hi] = marginBounds(c.edge);
        c.val.textContent = SL.mm(v);
        c.minus.setAttribute("aria-disabled", String(v <= lo));
        c.plus.setAttribute("aria-disabled", String(v >= hi));
      }
      restore.hidden = !customTB();
      restore.textContent = SL.marginsRestore(SL.marginNames[st.margins.preset]);
      paintMini();
    }
    /** المصغّر الحيّ 132×187 (0.629px لكل مم): الخلفية والترويسة والإطار، ومستطيل المتن من contentBox نفسه */
    function paintMini() {
      const s = setupNow();
      const k = 132 / PAGE_W;
      const place = <T extends HTMLElement>(el: T, r: { x: number; y: number; w: number; h: number }) => {
        Object.assign(el.style, { left: `${r.x * k}px`, top: `${r.y * k}px`, width: `${r.w * k}px`, height: `${r.h * k}px` });
        return el;
      };
      const kids: HTMLElement[] = [];
      if (st.background) kids.push(h("img", { class: "lt-mmini-bg", src: st.background.url, alt: "" }));
      const hd = headerRect(s, 0);
      if (hd && st.header) kids.push(place(h("img", { class: "lt-mmini-hd", src: st.header.url, alt: "" }), containIn(hd, st.header.img)));
      for (const f of frameLines(s)) kids.push(place(h("span", { class: "lt-mmini-frame" }), { x: f.inset, y: f.inset, w: PAGE_W - 2 * f.inset, h: PAGE_H - 2 * f.inset }));
      const box = place(h("span", { class: "lt-mmini-box", "data-test": "lt-margin-box" }), contentBox(s, 0));
      if (lastEdge) box.dataset.edge = lastEdge;
      kids.push(box);
      mini.replaceChildren(...kids);
    }
    syncMargins();

    // ٢. الترويسة و«تظهر على»
    const headerRow = h("div", { class: "lt-opts hdr", role: "radiogroup", "aria-label": SL.header },
      opt("header", "none", SL.none, !st.header, () => { st.header = null; syncSetup(); })); // الرابط يبقى للتراجع (١٤)
    const hdrBtn = h("button", { class: "lt-opt lt-hdr-pick", type: "button", role: "radio", "aria-checked": String(!!st.header), "data-test": "lt-header-pick",
      "aria-label": st.header ? SL.savedHeader : SL.pickHeader, "aria-disabled": hasLogo() ? "true" : undefined, "aria-describedby": hasLogo() ? "why-header" : undefined,
      onclick: () => { if (hasLogo()) return; pickHeader(); } },
    st.header ? h("img", { class: "lt-hdr-img", src: st.header.url, alt: "" }) : h("span", { class: "lt-opt-label" }, SL.pickHeader),
    st.header ? h("span", { class: "lt-change" }, SL.changeImage) : null,
    // البند ١٥: سطر السبب داخل البلاطة المعطّلة كـ«غير متاح مع الترويسة» في «شعار»، ومربوط بـaria-describedby
    hasLogo() ? h("span", { class: "lt-why", id: "why-header", "data-test": "lt-header-why" }, SL.headerWhy) : null);
    headerRow.append(hdrBtn);
    const onRow = st.header ? h("div", { class: "tool-seg lt-on", role: "radiogroup", "aria-label": SL.showOn },
      radio("lt-on", "first", SL.firstPage, st.header.on === "first", () => { st.header!.on = "first"; syncSetup(); }),
      radio("lt-on", "all", SL.allPages, st.header.on === "all", () => { st.header!.on = "all"; syncSetup(); })) : null;
    // ٣. الإطار
    const frameRow = h("div", { class: "lt-opts three", role: "radiogroup", "aria-label": SL.frame },
      ...(["none", "thin", "double"] as FrameKind[]).map((f) => opt("frame", f, f === "none" ? SL.noFrame : f === "thin" ? SL.thin : SL.double, st.frame === f, () => { setFrame(f); syncSetup(); }, h("span", { class: `lt-fthumb f-${f}`, "aria-hidden": "true" }))));
    const status = h("p", { class: "processing", role: "status", hidden: true }, h("span", { class: "spinner", "aria-hidden": "true" }), SL.imagePreparing);
    const err = h("p", { class: "alert", role: "alert", hidden: true });
    // ٤. الخلفية (§٦): «بلا» و«اختر صورة الخلفية»، وبعد الاختيار مصغّرها و«تغيير الصورة» و«إزالة الخلفية»
    const clearBg = () => { st.background = null; syncSetup(); }; // الرابط يبقى للتراجع (١٤)
    // المحفوظة تحت «بلا» و«اختر»: كلٌّ زرّ اختيار بلمسة، عدا المطبَّقة (مكانها مصغّر «اختر»). ومع «تعديل» كلّها، وعلى كلٍّ «✕»
    const shown = bgEdit.on ? bgSaved : bgSaved.filter((a) => a.id !== st.background?.assetId);
    const savedRow = shown.length ? h("div", { class: "lt-bg-saved" }, ...shown.map((a, i) => {
      const tile = h("button", { class: "lt-opt lt-bg-tile", type: "button", role: "radio", "aria-checked": String(a.id === st.background?.assetId), "data-test": "lt-bg-saved",
        "aria-label": `${SL.background} ${ar(i + 1)}`, onclick: () => { if (!bgEdit.on) void applyBackground(bgImage(a), a.id).then(() => { if (setupShown && dialog.open) openSetup(); }); } },
      h("img", { class: "lt-bg-thumb", src: bgUrl(a), alt: "" }));
      const wrap = h("div", { class: "tile-wrap" }, tile);
      if (bgEdit.on) {
        const x = icon("close"), undo = icon("undo");
        x.classList.add("ic", "ic-x"); undo.classList.add("ic", "ic-undo");
        const del = h("button", { class: "tile-del", type: "button", "data-test": "lt-bg-del" }, x, undo);
        const sync = () => {
          const p = bgEdit.pending.has(a.id);
          wrap.classList.toggle("pending", p);
          x.classList.toggle("on", !p); undo.classList.toggle("on", p);
          del.setAttribute("aria-label", p ? S.undo : S.remove); // كـ«المحفوظ» في الرئيسية
        };
        del.addEventListener("click", () => { if (!bgEdit.pending.delete(a.id)) bgEdit.pending.add(a.id); sync(); });
        sync();
        wrap.append(del);
      }
      return wrap;
    })) : null;
    const bgRow = h("div", { class: "lt-opts hdr", role: "radiogroup", "aria-label": SL.background, "data-test": "lt-bg-row" },
      opt("bg", "none", SL.none, !st.background, clearBg),
      h("button", { class: "lt-opt lt-hdr-pick", type: "button", role: "radio", "aria-checked": String(!!st.background), "data-test": "lt-bg-pick", onclick: () => pickBackground() },
        st.background ? h("img", { class: "lt-bg-thumb", src: st.background.url, alt: "" }) : h("span", { class: "lt-opt-label" }, SL.pickBackground),
        st.background ? h("span", { class: "lt-change" }, SL.changeImage) : null),
      ...(savedRow ? [savedRow] : []));
    const bgEditBtn = bgSaved.length ? h("button", { class: "text-btn", type: "button", "data-test": "lt-bg-edit", onclick: () => {
      bgEdit.on = !bgEdit.on;
      if (bgEdit.on) openSetup(); else void commitBgDeletes().then(() => openSetup());
    } }, bgEdit.on ? S.done : S.edit) : null;
    const bgRemove = st.background ? h("button", { class: "text-btn lt-bg-remove", type: "button", "data-test": "lt-bg-remove", onclick: () => { clearBg(); openSetup(); } }, SL.removeBackground) : null;
    const bgStatus = h("p", { class: "processing", role: "status", hidden: true, "data-test": "lt-bg-status" }, h("span", { class: "spinner", "aria-hidden": "true" }), SL.imagePreparing);
    const bgErr = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "lt-bg-error" });
    openSheet(SL.setup, [
      h("p", { class: "lt-slab" }, SL.margins), presetRow, ...(why ? [why] : []),
      h("div", { class: "lt-mbox" }, mini, h("div", { class: "lt-mctl" }, ...counters.map((c) => c.el), restore)),
      h("p", { class: "lt-slab" }, SL.header), headerRow, ...(onRow ? [h("p", { class: "lt-slab" }, SL.showOn), onRow] : []), status, err,
      h("p", { class: "lt-slab" }, SL.frame), frameRow,
      bgEditBtn ? h("div", { class: "lt-slab-row" }, h("p", { class: "lt-slab" }, SL.background), bgEditBtn) : h("p", { class: "lt-slab" }, SL.background), bgRow, ...(bgRemove ? [bgRemove] : []), bgStatus, bgErr,
    ]);
    function pickBackground() {
      fileIn.accept = "image/*";
      fileIn.onchange = async () => {
        const f = fileIn.files?.[0];
        fileIn.value = "";
        if (!f) return;
        bgStatus.hidden = false; bgErr.hidden = true;
        bgRow.setAttribute("aria-busy", "true");
        const got = await prepareBackground(f);
        bgStatus.hidden = true;
        bgRow.removeAttribute("aria-busy");
        if (got === "not-image" || got === "bad") { bgErr.textContent = got === "bad" ? SL.backgroundBad : SL.notImage; bgErr.hidden = false; return; }
        await applyBackground(got, await saveBackground(got));
        if (setupShown && dialog.open) openSetup(); // أُغلقت الورقة أثناء الإعداد: تُطبَّق ولا تعود الورقة
      };
      fileIn.click();
    }
    function pickHeader() {
      fileIn.accept = "image/*";
      fileIn.onchange = async () => {
        const f = fileIn.files?.[0];
        fileIn.value = "";
        if (!f) return;
        status.hidden = false; err.hidden = true;
        const got = await fileImage(f);
        status.hidden = true;
        if (got === "not-image" || got === "bad") { err.textContent = got === "bad" ? S.badImage : SL.notImage; err.hidden = false; return; }
        st.header = { img: got, url: urlOf(got), on: st.header?.on ?? "first" };
        syncSetup();
        openSetup();
      };
      fileIn.click();
    }
  }

  /* ───────── ورقة «إضافة تاريخ» و«تعديل التاريخ» (مواصفة لمى v2 §٥، ونصوص هدى ن١١–ن١٤) ───────── */
  function openDateSheet() {
    setupShown = false;
    const editing = !!st.date;
    const today = todayDay();
    let cur: LetterDate = st.date ? { ...st.date } : { day: today, cal: inHijriRange(today) ? "both" : "gregorian", form: "line" };
    let unit: DateMode = cur.cal === "gregorian" ? "gregorian" : "hijri"; // تقويم العدّادات: مع «كلاهما» يُختار بمفتاح «م/هـ»
    const set = (next: LetterDate) => {
      cur = next;
      if (editing) { st.date = { ...cur }; st.dirty = true; syncDate(); } // في التعديل يُطبَّق فوراً، وفي الإضافة بـ«أضف التاريخ»
      render(document.activeElement?.getAttribute("data-test") ?? undefined);
    };
    const press = (b: HTMLElement) => { b.addEventListener("mousedown", (e) => e.preventDefault()); return b; };
    const choice = (group: string, value: string, label: string, checked: boolean, on: () => void, mini?: Node, off = false) =>
      press(h("button", { class: "lt-opt", type: "button", role: "radio", "aria-checked": String(checked), "aria-disabled": off ? "true" : undefined, "data-test": `lt-${group}-${value}`,
        onclick: () => { if (!off && !checked) on(); } }, ...(mini ? [mini] : []), h("span", { class: "lt-opt-label" }, label)));
    function render(focus?: string) {
      const hijriOk = inHijriRange(cur.day);
      if (!hijriOk && cur.cal !== "gregorian") cur = { ...cur, cal: "gregorian" };
      if (cur.cal !== "both") unit = cur.cal === "hijri" ? "hijri" : "gregorian";
      if (!hijriOk) unit = "gregorian";
      const shown = dateNow(cur);
      // ١. شريحة المعاينة على الورقة بخطّ الخطاب
      const strip = h("div", { class: "lt-dprev", "aria-hidden": "true", "data-test": "lt-date-preview" });
      applyLf(strip, st.font);
      paintDate(strip, cur);
      // ٢. التقويم: «م» يمين «هـ» (قرار نايف ٢٠٢٦/١١/٠٨)
      const calSeg = h("div", { class: "tool-seg lt-dcal", role: "radiogroup", "aria-label": SL.calendar },
        ...([["gregorian", SL.calGregorian], ["hijri", SL.calHijri], ["both", SL.calBoth]] as [DateCal, string][]).map(([c, label]) => {
          const inp = h("input", { type: "radio", name: "lt-dcal", value: c, class: "sr-only", "data-test": `lt-dcal-in-${c}`, checked: shown.cal === c, disabled: c !== "gregorian" && !hijriOk }) as HTMLInputElement;
          inp.addEventListener("change", () => { if (inp.checked) set({ ...cur, cal: c, form: c === "both" ? cur.form : cur.form === "left" ? "left" : "right" }); });
          return h("label", { "data-test": `lt-dcal-${c}` }, inp, h("span", {}, label));
        }));
      // ٣. الشكل
      const forms: [DateForm, string][] = shown.cal === "both" ? [["line", SL.formLine], ["right", SL.formRight2], ["left", SL.formLeft2]] : [["right", SL.formRight], ["left", SL.formLeft]];
      const formRow = h("div", { class: `lt-opts ${forms.length === 3 ? "three" : "two"}`, role: "radiogroup", "aria-label": SL.dateForm },
        ...forms.map(([f, label]) => choice("dform", f, label, shown.form === f, () => set({ ...cur, form: f }),
          h("span", { class: "lt-dthumb", "data-form": f, "data-cal": shown.cal === "both" ? "both" : "one", "aria-hidden": "true" }, h("i"), h("i")))));
      // ٤. العدّادات: الشهر بالاسم، ولا كتابة حرّة، والهجري لا يخرج من الجدول (adjust)
      const p = unit === "gregorian" ? gregorianOf(cur.day) : hijriOf(cur.day);
      const months = unit === "gregorian" ? SL.gregorianMonths : SL.hijriMonths;
      const rows = ([["day", S4.unitDay, ar(p.d)], ["month", S4.unitMonth, months[p.m - 1]!], ["year", S4.unitYear, ar(p.y)]] as [DateUnit, string, string][]).map(([u, label, v]) => {
        const step = (delta: number) => {
          const next = adjust(cur.day, unit, u, delta);
          return press(h("button", { class: "step", type: "button", "aria-label": S4.stepLabel(u, delta), "data-test": `lt-date-${u}-${delta < 0 ? "minus" : "plus"}`, disabled: next === cur.day,
            onclick: () => set({ ...cur, day: next }) }, icon(delta < 0 ? "minus" : "plus")));
        };
        return h("div", { class: "date-row", role: "group", "aria-label": label }, h("span", { class: "date-unit" }, label), step(-1), h("output", { class: "date-val", "data-test": `lt-date-${u}` }, v), step(1));
      });
      const modeRow = shown.cal === "both" ? h("div", { class: "date-mode-row" }, modeSwitch()) : null;
      // ٥. الأزرار
      const todayBtn = press(h("button", { class: "text-btn", type: "button", "data-test": "lt-date-today", onclick: () => set({ ...cur, day: today }) }, S4.todayDate));
      const mainBtn = press(h("button", { class: "btn primary", type: "button", "data-test": "lt-date-done",
        onclick: () => { if (!editing) { st.date = { ...cur }; st.dirty = true; syncDate(); } closeSheet(); } }, editing ? S.done : S4.addDate));
      const delBtn = editing ? press(h("button", { class: "text-btn lt-ddel", type: "button", "data-test": "lt-date-delete", onclick: () => { st.date = null; st.dirty = true; syncDate(); closeSheet(); } }, SL.deleteDate)) : null;
      openSheet(editing ? SL.editDateTitle : SL.addDateTitle, [
        strip,
        h("p", { class: "lt-slab" }, SL.calendar), calSeg,
        h("p", { class: "lt-slab" }, SL.dateForm), formRow,
        h("p", { class: "lt-slab" }, SL.pickDay), ...(modeRow ? [modeRow] : []), ...rows,
        h("div", { class: "date-actions" }, todayBtn, mainBtn),
        ...(delBtn ? [delBtn] : []),
      ]);
      if (focus) (dialog.querySelector(`[data-test="${focus}"]:not([disabled])`) as HTMLElement | null)?.focus();
    }
    /** مفتاح «م/هـ» بنسق ورقة «تغيير التاريخ» في الرئيسية (main.ts، modeSwitch): يختار تقويم العدّادات وحده */
    function modeSwitch(): HTMLElement {
      const btns = (["gregorian", "hijri"] as DateMode[]).map((m) => press(h("button", {
        class: "mode-part", type: "button", role: "radio", "aria-checked": String(unit === m), tabindex: unit === m ? 0 : -1,
        "aria-label": m === "gregorian" ? S4.modeGregorian : S4.modeHijri, "data-test": `lt-date-mode-${m}`,
        onclick: () => { if (unit !== m) { unit = m; render(`lt-date-mode-${m}`); } },
        onkeydown: (e: Event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes((e as KeyboardEvent).key)) return;
          e.preventDefault();
          const o: DateMode = m === "hijri" ? "gregorian" : "hijri";
          unit = o; render(`lt-date-mode-${o}`);
        },
      }, m === "gregorian" ? S4.modeGregorianShort : S4.modeHijriShort)));
      return h("div", { class: "mode-switch", role: "radiogroup", "aria-label": S4.dateModeLabel, "data-mode": unit, "data-test": "lt-date-mode" },
        h("span", { class: "mode-thumb", "aria-hidden": "true" }), ...btns);
    }
    render();
    dialog.classList.add("lt-date-dlg");
    dialog.addEventListener("close", () => dialog.classList.remove("lt-date-dlg"), { once: true });
  }

  /* ───────── القالب ───────── */
  function useTemplate() {
    // معاملة بـTABLES_OK لا setContent: حارس الشكل يرفض الاستبدال بصمت على خطاب فيه جدول. (والتراجع عن حذف الجدول يرفضه الحارس نفسه)
    const apply = () => {
      const tpl = le.ed.schema.nodeFromJSON(templateDoc());
      le.ed.view.dispatch(le.ed.state.tr.replaceWith(0, le.ed.state.doc.content.size, tpl.content).setMeta(TABLES_OK, true));
      le.ed.commands.focus("end"); onEdit();
    };
    if (!editorChars(le.ed)) { apply(); return; }
    openSheet(SL.replaceAsk, [
      h("button", { class: "btn primary block", type: "button", "data-test": "lt-replace", onclick: () => { closeSheet(); apply(); } }, SL.replace),
      h("button", { class: "btn block", type: "button", "data-test": "lt-keep", onclick: () => closeSheet() }, SL.keepMine),
    ]);
  }

  /* ───────── الحفظ ───────── */
  /** `at: "save"`: خطأ الحفظ، فيظهر على WIDE تحت الزرّ في الشريط العلوي (letter.css: .lt-alert-save). وغيره تحت المحرّر */
  function showAlert(msg: string, at?: "save") {
    alert.classList.toggle("lt-alert-save", at === "save");
    alert.textContent = msg; alert.hidden = false; setTimeout(() => { alert.hidden = true; }, 6000);
  }
  async function save() {
    if (st.saving || saveBtn.disabled) return;
    st.saving = true;
    syncHist();
    saveBtn.setAttribute("aria-busy", "true");
    saveBtn.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.scanPreparingFile);
    try {
      const d = docNow();
      await ensureUsed(d); // البند ١١: لا يُحفظ PDF بخط بديل، ولا مقطعٌ بغير خطّه
      const pdf = await (await getEngine()).render(d);
      const signed = st.items.some((i) => i.kind === "signature" || i.kind === "stamp");
      const file = new File([pdf.slice().buffer], st.pdfName ?? (signed ? SL.fileNameSigned : SL.fileName), { type: "application/pdf" });
      if (E2E) (window as unknown as { __letterPdf?: Uint8Array }).__letterPdf = pdf;
      st.dirty = false;
      showReady(file);
    } catch (e) {
      // خلفية محفوظة لا تُفكّ (ملاحظة 🕵️ أمين م٦): تُزال من الخطاب ويُحذف سجلّها من الجهاز، فلا يتكرّر الفشل
      if (e instanceof Error && e.message === BACKGROUND_ERROR && st.background) {
        const id = st.background.assetId;
        // رابطٌ يُبطَل يخرج من خريطة الصور، فلا يعيده التراجع من مدخلٍ قديم (ملاحظة أمين على ١٤)
        const key = imgIds.get(st.background.img);
        if (key) imgs.delete(key);
        URL.revokeObjectURL(st.background.url);
        st.background = null;
        syncSetup();
        record(true); // خلفيةٌ لا تُفكّ لا يعيدها التراجع
        if (id) { bgSaved = bgSaved.filter((a) => a.id !== id); try { await deleteAsset(id); } catch { /* يبقى إن تعذّر */ } }
        showAlert(SL.backgroundBad, "save");
      } else showAlert(S.saveFailed, "save");
    } finally {
      st.saving = false;
      syncHist();
      saveBtn.removeAttribute("aria-busy");
      saveBtn.replaceChildren(S.save);
    }
  }
  function showReady(file: File) {
    const share = /iPhone|iPad|iPod/.test(navigator.userAgent) && !!navigator.canShare?.({ files: [file] });
    const go = () => {
      if (share) { void navigator.share({ files: [file] }).catch(() => {}); return; }
      const url = URL.createObjectURL(file);
      const a = h("a", { href: url, download: file.name, hidden: true });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    openSheet(S.ready, [
      h("div", { class: "saved" }, h("div", { class: "check marks" }, icon("check")), h("p", { class: "saved-name", "data-test": "saved-name" }, h("bdi", {}, file.name))),
      h("button", { class: "btn primary block", type: "button", "data-test": "share", onclick: go }, S.share),
      h("div", { class: "text-row" },
        h("button", { class: "text-btn", type: "button", onclick: () => closeSheet() }, S.continueEdit),
        h("button", { class: "text-btn", type: "button", onclick: () => { endHandoff(); location.href = "/"; } }, S.backHome)),
    ]);
  }
  function leave() {
    noAutoZoom(false);
    const go = () => { endHandoff(); location.href = "/"; };
    if (!st.dirty) go(); // نافذة «لم يُحفظ» في الصفحة بدل confirm الذي يكبته Safari iOS (src/leave-ask.ts)
    else void askLeave(S.leaveDialog.titleLetter, undefined, document.activeElement !== document.body ? null : closeBtn).then((a) => { if (a === "exit") { allowLeave(); go(); } }); // لا نافذة متصفح بعد «الخروج» (src/leave-guard.ts)
  }

  /* ───────── «تحرير الملف» (الدفعة ٣، مواصفة لمى §٢) ───────── */
  /** الشريط فوق «شكل الصفحة»: اسم ملف Word نصّاً (`textContent` عبر `h`، شرط أمين)، وما يختلف في `details` مفتوح بسهم يطويه (فهد ٢) */
  function fromBar(hd: Handoff): HTMLElement {
    const list = hd.notMoved.length
      ? [h("details", { class: "lt-from-nm", "data-test": "lt-from-nm", open: true },
        h("summary", {}, h("span", {}, SE.notMovedHead), icon("chevDown")),
        h("ul", { class: "iv-list info" }, ...hd.notMoved.map((t) => h("li", { class: "iv-item" }, icon("info"), h("span", {}, t)))),
        h("p", { class: "lt-from-keep" }, SE.stayInWord))]
      : [];
    const bar: HTMLElement = h("section", { class: "lt-from", "aria-label": SE.title, "data-test": "lt-from" },
      h("div", { class: "lt-from-head" },
        h("p", { class: "lt-from-name" }, SE.fromWord, h("bdi", { "data-test": "lt-from-name" }, hd.name)),
        h("button", { class: "icon-btn", type: "button", "aria-label": SE.hideFrom, "data-test": "lt-from-close", onclick: () => bar.remove() }, icon("close"))),
      ...list);
    return bar;
  }
  async function openHandoff() {
    const got = await takeHandoff();
    if (got.kind === "none") return;
    if (got.kind === "expired") {
      endHandoff(); // تحديثٌ ثانٍ فتحٌ عاديّ
      alert.classList.remove("lt-alert-save");
      alert.textContent = SE.expired; alert.hidden = false; // يبقى حتى يُغلق الخطاب، لا يختفي بعد ٦ ثوانٍ
      return;
    }
    const hd = got.h;
    title.textContent = SE.title;
    document.title = SE.title;
    st.pdfName = hd.pdfName;
    st.font = hd.doc.font;
    await ensureUsed(hd.doc); // البند ١١: لا يُعرض بخط بديل
    applyLf(paper, st.font);
    refreshFont();
    le.load(toPMDoc(hd.doc));
    write.prepend(fromBar(hd));
    onEdit();
    record(true); // الملف المفتوح بداية السجلّ لا مدخلٌ فيه
    st.dirty = false;
  }

  placeBars();
  syncSetup();
  booted = true;
  record(true); // قيم البداية في المستند خارج السجلّ: الزرّان معطّلان عند الفتح
  refreshZoom();
  onEdit();
  st.dirty = false;
  void ensureUsed(docNow()).then(() => void relayout());
  // السحب للرجوع وزرّ الرجوع يسألان «الخطاب لم يُحفظ» كزرّ ✕ (قرار نايف «أ» ٢٠٢٦/١١/١٥، docs/logs/letter-back.md)
  installScrollTrace(); // ?debug=1 وحده: التمرير ومصدره (docs/logs/letter-gap-scroll.md)
  backRefresh = installBackGuard({
    dirty: () => st.dirty,
    ask: () => askLeave(S.leaveDialog.titleLetter),
    leaving: () => { noAutoZoom(false); endHandoff(); },
    fallback: () => { location.href = "/"; },
  });
  void openHandoff().catch(() => {});
  if (E2E) {
    (window as unknown as { pdfsaLetterFont: unknown }).pdfsaLetterFont = loadFont;
    (window as unknown as { pdfsaLetterUI: unknown }).pdfsaLetterUI = { editor: le, state: st, docNow, placeItem, addTextBox, setView, relayout };
  }
}
