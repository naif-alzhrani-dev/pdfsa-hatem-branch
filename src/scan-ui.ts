/**
 * «تصوير ملف» (المواصفة (هـ) في docs/design-spec-v2.md): البداية ← ضبط الزوايا ← التقويم والتبييض ← شريط الصفحات ← «تم».
 *
 * - الكشف ومحرّر الزوايا من scanic 1.7.1؛ والتحميل (الاتجاه وEXIF) والتقويم (`flatten.ts`: نسبة الصفحة الحقيقية، وبلا خلفية على الحواف) والتبييض وPDF من محرّكنا (`src/scan/*`).
 * - **الكاشف `classical` ثابت ولا يُعرض خياراً**: كاشف ML يجلب من jsDelivr، والملف لا يغادر الجهاز (شرط أمين).
 * - **لوحة رسم كبيرة واحدة في كل وقت**: `loadImage` و`encodeJpeg` تفرّغان لوحتيهما، والتقويم بلا لوحة (مصفوفة بكسلات)،
 *   والمحرّر يُهدم قبل التقويم. المحفوظ لكل صفحة: ملف الصورة نفسه (لإعادة الضبط) وJPEG الناتج وصورة مصغّرة.
 * - تحت سياسة الأمان (بلا `wasm-unsafe-eval`) تعود scanic إلى JavaScript، فيُكشف على نسخة أطول ضلعها نحو 1000px،
 *   ثم تُعاد الزوايا إلى مقاس الأصل.
 */
import { scanDocument, createCornerEditor, type CornerEditor } from "scanic";
import { S, S4, ar, scanRotatePage } from "./strings";
import { h, icon } from "./dom";
import { toolsButton } from "./tools-sheet";
import { askDelete, askLeave } from "./leave-ask";
import { guardLeave } from "./leave-guard";
import { toolArt } from "./tools/tool-art";
import { loadImage } from "./scan/load";
import { enhance } from "./scan/enhance";
import { flatten } from "./scan/flatten";
import { buildPdf, encodeCapped, encodeJpeg } from "./scan/to-pdf";
import { CORNER_KEYS, acceptDetection, downscale, insetCorners, rotateCW, rotateCornersCW, scaleCorners, type Corners } from "./scan/geom";
import type { Img } from "./scan/types";
import { liveSupported, openLive, stopLive } from "./scan/live-screen";
import { THUMB_MAX, currentFilter, dropFilterCache, filterKey, filterPanel, flatBlob, pdfPages, settleFilter, type Hooks } from "./scan/filter-panel";

const SOURCE_PIXELS = 4_000_000; // الأصل يُحمَّل بنحو 4M بكسل (2309×1732 لصورة 4:3)؛ والصفحة المقوّمة سقفها 2000px (`MAX_SIDE`)
const PREVIEW_MAX = 1200; // المعاينة في المحرّر
const DETECT_MAX = 1000; // الكشف (المسار البطيء تحت السياسة)
const MIN_CONFIDENCE = 0.3; // ما دونه «ثقة ضعيفة»: تُعرض ملاحظة الحواف ومستطيل الهامش
const DETECTOR = "classical" as const;

export interface ScanHost {
  app: HTMLElement;
  exit: () => void; // الرجوع إلى الرئيسية
  done: (pdf: File) => Promise<void>; // يفتح الملف في العارض
  announce: (msg: string) => void;
  /** «الأدوات» بجانب «تم» (tools-sheet.ts): `build` يبني الملف كما يبنيه «تم»، أو `null` إن فشل (وتُعرض النتيجة بالخطأ). */
  tools?: (pages: number, build: () => Promise<File | null>) => void;
}

/**
 * صفحة ممسوحة. الزوايا كسورٌ من المعاينة بعد التدوير، فتصلح لأي مقاس يُعاد به تحميل الملف.
 * `base` ناتج التقويم كما خرج؛ و`turn` ما دُوّرت به في النتيجة (أرباع مع عقارب الساعة)، و`jpeg`/`width`/`height`/`thumb`
 * هي `base` بعد `turn` — فالملف والمعاينة والمصغّرة شيءٌ واحد. والتدوير يُضاف إلى `rot` و`corners` أيضاً،
 * فإعادة ضبط الزوايا تبدأ من الصفحة كما تُرى.
 */
interface ScanPage { id: string; file: Blob; rot: number; corners: Corners; jpeg: Uint8Array; width: number; height: number; thumb: string; base: Jpeg; turn: number; flat: Blob; fkey: string }
interface Jpeg { jpeg: Uint8Array; width: number; height: number; thumb: string }
/** جلسة الضبط الحالية. */
interface Session { file: Blob; src: Img; preview: Img; rot: number; found: boolean; replace: ScanPage | null }

const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, "data-test": "scan-camera-input" }) as HTMLInputElement;
const picInput = h("input", { type: "file", accept: "image/*", hidden: true, "data-test": "scan-photos-input" }) as HTMLInputElement;
document.body.append(camInput, picInput);

let host: ScanHost;
let pages: ScanPage[] = [];
let guarded = false; // صفحاتٌ مصوَّرة لم تُبنَ ملفاً («تم» يفرّغها): نافذة المتصفح عند مغادرة الصفحة (src/leave-guard.ts)، تُسجَّل في أول فتح
let editor: CornerEditor | null = null;
let cur: Session | null = null;
let picked: string | null = null; // الصفحة الملموسة في الشريط
let viewUrl: string | null = null;
let noCam = false; // الجهاز بلا كاميرا (NotFoundError): «صوّر الورقة» مخفيّ و«من الصور» هو المملوء

export function showScan(hst: ScanHost) {
  host = hst;
  if (!guarded) { guarded = true; guardLeave(() => pages.length > 0); }
  reset();
  renderStart();
}

function reset() {
  stopLive();
  disposeEditor();
  dropFilterCache();
  for (const p of pages) revokeThumbs(p);
  pages = [];
  cur = null;
  picked = null;
  setView(null);
}
function revokeThumbs(p: ScanPage) {
  URL.revokeObjectURL(p.base.thumb);
  if (p.thumb !== p.base.thumb) URL.revokeObjectURL(p.thumb);
}
function disposeEditor() {
  editor?.destroy();
  editor = null;
}
function setView(url: string | null) {
  if (viewUrl) URL.revokeObjectURL(viewUrl);
  viewUrl = url;
}
const toImageData = (img: Img) => (img instanceof ImageData ? img : new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))); // يظهر المؤشّر قبل الحساب

function topbar(label: string, onBack: () => void, title: string) {
  return h("header", { class: "topbar" },
    h("button", { class: "icon-btn", type: "button", "aria-label": label, "data-test": "back", onclick: onBack }, icon("back")),
    h("h1", { class: "route-title" }, title),
    h("span", { class: "icon-spacer" }));
}
function leave() {
  const go = () => { reset(); host.exit(); };
  if (!pages.length) go(); // نافذة «لم يُحفظ» في الصفحة بدل confirm الذي يكبته Safari iOS (src/leave-ask.ts)
  else void askLeave(S.leaveDialog.titleScan, undefined, host.app.querySelector<HTMLElement>('[data-test="back"]')).then((a) => { if (a === "exit") go(); });
}

/* ───────── البداية ───────── */
/** رسم الورقة في البداية (وتحت أزرار شاشة رفض الكاميرا). */
function sheetArt() {
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => h("span", { class: "line", "data-w": w })),
    toolArt("scan"));
  sheet.querySelectorAll<HTMLElement>(".line").forEach((l) => (l.style.inlineSize = `${l.dataset.w}%`));
  return sheet;
}
/** «صوّر صفحة أخرى» و«أعد التصوير»: المسح الحيّ حين تكون الكاميرا متاحة، وإلا حقل الملف كما كان. */
function camera(replace: ScanPage | null = null) {
  if (liveSupported() && !noCam) startLive(replace); else capture(camInput, replace);
}
function renderStart(error?: string) {
  disposeEditor();
  const live = liveSupported() && !noCam;
  const sheet = sheetArt();
  host.app.replaceChildren(
    topbar(S.backHome, leave, S.scanFile),
    h("main", { class: "start scan-start" }, sheet, h("p", { class: "tool-lead" }, S.scanLead),
      live ? h("button", { class: "btn primary block", type: "button", "data-test": "scan-camera", onclick: () => startLive() }, icon("camera"), S.scanCamera) : null,
      live
        ? h("button", { class: "text-btn", type: "button", "data-test": "scan-photos", onclick: () => capture(picInput) }, S.fromPhotos)
        : h("button", { class: "btn primary block", type: "button", "data-test": "scan-photos", onclick: () => capture(picInput) }, icon("photo"), S.fromPhotos),
      h("p", { class: "alert", role: "alert", hidden: !error }, error ?? "")));
}

let replaceTarget: ScanPage | null = null; // «أعد التصوير» أثناء إعادة ضبط صفحة: تُستبدل ولا تُضاف
let directPick = false; // احتياط المسح الحيّ: إن اكتُشفت الحواف تذهب الصورة إلى النتيجة مباشرة (livescan §٢)
for (const input of [camInput, picInput]) {
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    input.value = "";
    if (f && host) void adjust(f, { replace: replaceTarget, direct: directPick });
  });
}
function capture(input: HTMLInputElement, replace: ScanPage | null = null, direct = false) {
  replaceTarget = replace;
  directPick = direct;
  input.click();
}

/* ───────── المسح الحيّ (src/scan/live-screen.ts): كل صفحة ملتقطة تمرّ بـ`makePage`، المسار نفسه ───────── */
/**
 * `replace`: «أعد التصوير» لصفحة موجودة، فأوّل صفحة ملتقطة تحلّ محلّها وتعود الشاشة إلى النتيجة.
 * وإلا تُضاف الصفحات بعد الموجودة. و«تجاهل» يحذف ما التُقط في هذه الجلسة وحده.
 */
function startLive(replace: ScanPage | null = null) {
  disposeEditor();
  cur = null;
  const before = pages.slice();
  const back = () => (pages.length ? renderResult() : renderStart());
  openLive({
    app: host.app,
    announce: (m) => host.announce(m),
    count: () => pages.length,
    lastThumb: () => pages[pages.length - 1]?.thumb ?? null,
    once: !!replace,
    art: sheetArt,
    add: async (file, src, corners) => { // يرمي إن فشل: شاشة المسح تكتب الخطأ في التشخيص (?debug=1)
      const page = await makePage(file, src, 0, corners, replace?.id);
      const i = replace ? pages.indexOf(replace) : -1;
      if (i >= 0) { revokeThumbs(pages[i]!); pages[i] = page; } else pages.push(page);
      return true;
    },
    adjust: (file) => void adjust(file, { replace }),
    done: () => { picked = null; renderResult(); },
    discard: () => {
      for (const p of pages) if (!before.includes(p) && p.id !== replace?.id) revokeThumbs(p);
      pages = pages.filter((p) => before.includes(p) || p.id === replace?.id);
      picked = null;
      back();
    },
    close: back,
    fallbackCamera: () => capture(camInput, replace, true),
    fallbackPhotos: () => capture(picInput, replace, true),
    noCamera: () => { noCam = true; renderStart(); },
  });
}

/* ───────── ضبط الزوايا ───────── */
function renderBusy(onBack: () => void) {
  disposeEditor();
  host.app.replaceChildren(
    topbar(S.back, onBack, S.adjustTitle),
    h("main", { class: "scan-adjust" },
      h("div", { class: "scan-stage busy" },
        h("p", { class: "scan-busy", role: "status", "data-test": "scan-busy" }, h("span", { class: "spinner", "aria-hidden": "true" }), S.preparing))));
}
const backFromAdjust = () => { cur = null; if (pages.length) renderResult(); else renderStart(); };

async function adjust(file: Blob, o: { replace: ScanPage | null; rot?: number; corners?: Corners; direct?: boolean }) {
  renderBusy(backFromAdjust);
  await frame();
  let src: Img;
  try { src = await loadImage(file, SOURCE_PIXELS); } catch {
    if (pages.length) renderResult(S.badImage); else renderStart(S.badImage);
    return;
  }
  const rot = o.rot ?? 0;
  for (let i = 0; i < rot; i++) src = rotateCW(src);
  const preview = downscale(src, PREVIEW_MAX);
  let corners: Corners | null;
  if (o.corners) corners = scaleCorners(o.corners, preview.width, preview.height);
  else {
    corners = null;
    try {
      const r = await scanDocument(toImageData(preview), { mode: "detect", detector: DETECTOR, maxProcessingDimension: DETECT_MAX });
      corners = acceptDetection(r, MIN_CONFIDENCE, preview.width, preview.height);
    } catch { /* الكشف فشل: مستطيل الهامش */ }
  }
  cur = { file, src, preview, rot, found: !!corners || !!o.corners, replace: o.replace };
  if (o.direct && corners) return finalize(cur, corners);
  renderAdjust(corners ?? insetCorners(preview.width, preview.height));
}

function renderAdjust(corners: Corners) {
  const s = cur!;
  disposeEditor();
  const stage = h("div", { class: "scan-stage", "data-test": "scan-stage" });
  const nextBtn = h("button", { class: "btn primary", type: "button", "data-test": "scan-next", onclick: () => void next() }, S.next) as HTMLButtonElement;
  host.app.replaceChildren(
    topbar(S.back, backFromAdjust, S.adjustTitle),
    h("main", { class: "scan-adjust" },
      s.found
        ? h("p", { class: "scan-hint" }, S.adjustHint)
        : h("p", { class: "scan-hint note", role: "status", "data-test": "scan-no-edges" }, S.noEdges),
      stage,
      h("div", { class: "scan-actions" },
        h("button", { class: "text-btn", type: "button", "data-test": "scan-retake", onclick: () => camera(s.replace) }, S.retake),
        h("button", { class: "text-btn", type: "button", "data-test": "scan-rotate", onclick: () => rotate() }, icon("rotate"), S.rotate),
        nextBtn)));
  editor = createCornerEditor({
    container: stage,
    image: toImageData(s.preview),
    corners,
    injectStyles: false, // أنماطه في style.css برموزنا (شرط أمين: style-src 'self')
    toolbar: { enabled: false }, // أزرارنا: «أعد التصوير» و«تدوير» و«التالي»
    magnifier: { enabled: true, size: 112, zoom: 2 },
    handleHitArea: 44,
    keyboard: true,
    onConfirm: () => void next(), // Enter على دائرة
  });
  // أسماء الدوائر بالعربية: المكتبة تكتبها بالإنجليزية ولا خيار لها
  for (const k of CORNER_KEYS) stage.querySelector(`.scanic-handle[data-corner="${k}"]`)?.setAttribute("aria-label", S.corner[k]);
  dragOneToOne(stage, s.preview);
}

/**
 * السحب 1:1 (المواصفة (هـ)): محرّر scanic يبطّئ الحركة البطيئة إلى 35% «للدقّة»، فتنفصل الدائرة عن الإصبع.
 * فتُلتقط `pointermove` على المسرح قبل وصولها إلى الدائرة، وتوضع الزاوية تحت الإصبع بإزاحته نفسها.
 * ويبقى للمكتبة الضغط والإفلات والعدسة ولوحة المفاتيح. المقياس من معادلة رسمها: الصورة في المسرح بهامش 12px.
 */
function dragOneToOne(stage: HTMLElement, img: Img) {
  let drag: { id: number; key: (typeof CORNER_KEYS)[number]; x: number; y: number; c: Corners } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>(".scanic-handle")?.dataset.corner as (typeof CORNER_KEYS)[number] | undefined;
    if (key && editor) drag = { id: e.pointerId, key, x: e.clientX, y: e.clientY, c: editor.getCorners() };
  }, true);
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || !editor) return;
    e.stopPropagation(); // لا تصل إلى معالج المكتبة
    const k = Math.min((stage.clientWidth - 24) / img.width, (stage.clientHeight - 24) / img.height);
    const p = drag.c[drag.key];
    const c = { ...editor.getCorners() };
    c[drag.key] = {
      x: Math.max(0, Math.min(img.width, p.x + (e.clientX - drag.x) / k)),
      y: Math.max(0, Math.min(img.height, p.y + (e.clientY - drag.y) / k)),
    };
    editor.setCorners(c); // يرفض الشكل غير المحدّب، فتقف الدائرة
  }, true);
  const end = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
  stage.addEventListener("pointerup", end, true);
  stage.addEventListener("pointercancel", end, true);
}

function rotate() {
  const s = cur!;
  if (!editor) return;
  const c = rotateCornersCW(editor.getCorners(), s.preview.width, s.preview.height);
  s.src = rotateCW(s.src);
  s.preview = rotateCW(s.preview);
  s.rot = (s.rot + 1) % 4;
  renderAdjust(c);
}

/** التقويم ثم التبييض ثم الصفحة (الزوايا بمقاس `src`). مشترك بين «التالي» والمسح الحيّ. */
async function makePage(file: Blob, src: Img, rot: number, full: Corners, id?: string): Promise<ScanPage> {
  const flat = flatten(src, full); // بنسبة الصفحة الحقيقية، وبلا خلفية على الحواف (flatten.ts)
  const filter = currentFilter(); // خيارات المسح (filter-panel.ts): الصفحة الجديدة تأخذ آخر إعداد
  const out = enhance(flat, filter);
  const jpeg = await encodeCapped(out, encodeJpeg);
  const small = await encodeJpeg(downscale(out, THUMB_MAX), 0.8);
  const base: Jpeg = { jpeg, width: out.width, height: out.height, thumb: URL.createObjectURL(new Blob([small as BlobPart], { type: "image/jpeg" })) };
  return { id: id ?? crypto.randomUUID(), file, rot, corners: scaleCorners(full, 1 / src.width, 1 / src.height), ...base, base, turn: 0, flat: await flatBlob(flat), fkey: filterKey(filter) };
}

async function next() {
  const s = cur;
  if (!s || !editor) return;
  await finalize(s, editor.getCorners());
}
async function finalize(s: Session, c: Corners) {
  const full = scaleCorners(c, s.src.width / s.preview.width, s.src.height / s.preview.height);
  renderBusy(backFromAdjust); // المحرّر يُهدم هنا، قبل التقويم
  await frame();
  try {
    const page = await makePage(s.file, s.src, s.rot, full, s.replace?.id);
    if (cur !== s) { revokeThumbs(page); return; }
    const i = s.replace ? pages.indexOf(s.replace) : -1;
    if (i >= 0) { revokeThumbs(pages[i]!); pages[i] = page; } else pages.push(page);
    cur = null;
    picked = null;
    renderResult(undefined, page.id);
  } catch {
    if (cur !== s) return;
    cur = null;
    if (pages.length) renderResult(S.badImage); else renderStart(S.badImage);
  }
}

/* ───────── النتيجة: الصفحة، والشريط، و«صوّر صفحة أخرى»، و«تم» ───────── */
function renderResult(error?: string, showId?: string) {
  disposeEditor();
  if (!pages.length) return renderStart(error);
  const n = pages.length;
  const shown = pages.find((p) => p.id === (picked ?? showId)) ?? pages[n - 1]!;
  const at = pages.indexOf(shown) + 1;
  shownNow = shown;
  setView(URL.createObjectURL(new Blob([shown.jpeg as BlobPart], { type: "image/jpeg" })));

  const strip = h("div", { class: "scan-strip", "data-test": "scan-strip" }, ...pages.map((p, i) =>
    h("button", {
      class: "scan-thumb", type: "button", "aria-label": S.page(i + 1, n), "aria-pressed": String(p.id === picked), "data-test": "scan-thumb",
      onclick: () => { picked = picked === p.id ? null : p.id; renderResult(); },
    }, h("img", { src: p.thumb, alt: "" }), h("span", { class: "page-badge", "aria-hidden": "true" }, ar(i + 1)))));
  const sel = pages.find((p) => p.id === picked) ?? null;
  const actions = h("div", { class: "scan-page-actions", hidden: !sel, "data-test": "scan-page-actions" },
    h("button", { class: "text-btn danger", type: "button", "data-test": "scan-delete", onclick: () => sel && del(sel) }, icon("trash"), S.deletePage));
  const doneBtn = h("button", { class: "btn primary block", type: "button", "data-test": "scan-done", onclick: () => void finish(doneBtn) }, S.done) as HTMLButtonElement;
  const toolsBtn: HTMLButtonElement | null = host.tools ? toolsButton(() => host.tools!(pages.length, () => buildFile(toolsBtn!))) : null;
  host.app.replaceChildren(
    topbar(S.backHome, leave, S.scanFile),
    h("main", { class: "scan-result" },
      h("figure", { class: "scan-view" }, h("span", { class: "scan-page" },
        h("img", { src: viewUrl!, alt: S.page(at, n), "data-test": "scan-view" }),
        h("button", { class: "scan-rot", type: "button", "aria-label": scanRotatePage(at), "data-test": "scan-page-rotate", disabled: turning, onclick: () => void turnPage(shown) }, rotateIcon()))),
      // ظاهر دائماً تحت الصفحة المعروضة (طلب نايف بعد تجربة آيفون: «حتى يعرف انه يمكن تعديل الزوايا»)
      h("button", { class: "text-btn scan-readjust", type: "button", "data-test": "scan-readjust", onclick: () => void adjust(shown.file, { replace: shown, rot: shown.rot, corners: shown.corners }) }, cornersIcon(), S.readjust),
      h("p", { class: "alert", role: "alert", hidden: !error }, error ?? ""),
      strip, actions),
    h("footer", { class: "savebar scan-foot" },
      filterPanel(filterHooks),
      h("div", { class: "scan-more" },
        h("button", { class: "btn source", type: "button", "data-test": "scan-more", onclick: () => camera() }, icon("camera"), S.scanMore),
        h("button", { class: "text-btn", type: "button", "data-test": "scan-more-photos", onclick: () => capture(picInput) }, S.fromPhotos)),
      toolsBtn ? h("div", { class: "scan-finish" }, toolsBtn, doneBtn) : doneBtn));
  strip.querySelector<HTMLElement>(`[aria-pressed="true"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** أيقونة «أعد ضبط الزوايا»: أربع زوايا كزوايا الإطار، بخطوط الأيقونات الحالية. */
function cornersIcon(): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
  return t.content.firstElementChild as SVGElement;
}

/** ربط خيارات المسح (filter-panel.ts): تُرسم الصفحة الكبيرة ومصغّرات الشريط في مكانها، بلا إعادة بناء الشاشة. */
let shownNow: ScanPage | null = null; // الصفحة الكبيرة في آخر رسمٍ للنتيجة
const view = () => host.app.querySelector<HTMLImageElement>('[data-test="scan-view"]');
const filterHooks: Hooks = {
  pages: () => pages,
  shown: () => (shownNow && view() && pages.includes(shownNow) ? shownNow : null),
  paint: (p) => {
    const t = host.app.querySelectorAll<HTMLImageElement>('[data-test="scan-thumb"] img')[pages.indexOf(p as ScanPage)];
    if (t) t.src = p.thumb;
    const v = view();
    if (v && p === filterHooks.shown()) { setView(URL.createObjectURL(new Blob([p.jpeg as BlobPart], { type: "image/jpeg" }))); v.src = viewUrl!; }
  },
  preview: (url) => { const v = view(); if (v) { setView(url); v.src = url; } else URL.revokeObjectURL(url); },
};

/** أيقونة التدوير بالمواصفة (batch4 ١): قوس نصف دائرة مركزه (12,13) ونصف قطره 7 عبر الأعلى، والسهم عند (19,13) إلى الأسفل. لا تُعكس. */
function rotateIcon(): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13a7 7 0 0 1 14 0"/><path d="M16 10.5l3 3 3-3"/></svg>';
  return t.content.firstElementChild as SVGElement;
}

/**
 * «دوّر الصفحة»: ربع دورة مع عقارب الساعة على الصفحة المعروضة. يُدار `base` نفسه (`turn` مرّة) فيُرمَّز JPEG مرّة واحدة
 * أياً كان عدد اللمسات، وأربع لمسات تعيد `base` كما هو. ويُضاف إلى `rot` و`corners` حتى تبدأ إعادة الضبط من الصفحة كما تُرى.
 */
let turning = false;
async function turnPage(p: ScanPage) {
  if (turning) return;
  turning = true;
  host.app.querySelector<HTMLButtonElement>('[data-test="scan-page-rotate"]')?.setAttribute("disabled", "");
  try {
    const turn = (p.turn + 1) % 4, from = p.base;
    let next: Jpeg = from;
    if (turn) {
      let img = await loadImage(new Blob([from.jpeg as BlobPart], { type: "image/jpeg" }), SOURCE_PIXELS);
      for (let i = 0; i < turn; i++) img = rotateCW(img);
      const jpeg = await encodeCapped(img, encodeJpeg);
      const small = await encodeJpeg(downscale(img, THUMB_MAX), 0.8);
      next = { jpeg, width: img.width, height: img.height, thumb: URL.createObjectURL(new Blob([small as BlobPart], { type: "image/jpeg" })) };
    }
    if (!pages.includes(p)) return;
    if (p.base !== from) { if (next !== from) URL.revokeObjectURL(next.thumb); turning = false; return turnPage(p); } // خيارات المسح أعادت الصفحة أثناء التدوير
    if (p.thumb !== p.base.thumb) URL.revokeObjectURL(p.thumb);
    Object.assign(p, next, { turn, rot: (p.rot + 1) % 4, corners: rotateCornersCW(p.corners, 1, 1) });
  } catch {
    turning = false;
    return renderResult(S.badImage);
  }
  turning = false;
  renderResult(undefined, p.id);
  host.app.querySelector<HTMLButtonElement>('[data-test="scan-page-rotate"]')?.focus();
}

function del(p: ScanPage) {
  void askDelete(S.dialogs.deletePageTitle(pages.indexOf(p) + 1), host.app.querySelector<HTMLElement>('[data-test="scan-delete"]')).then((yes) => {
    const n = pages.indexOf(p) + 1;
    if (!yes || !n) return; // الشاشة تغيّرت تحت السؤال
    pages = pages.filter((x) => x !== p);
    revokeThumbs(p);
    picked = null;
    renderResult();
    host.announce(S.pageDeleted(n, pages.length));
    // الشاشة أُعيد رسمها بلا زرّ الحذف: التركيز على المصغّر الذي حلّ محلّها لا body
    const thumbs = host.app.querySelectorAll<HTMLButtonElement>('[data-test="scan-thumb"]');
    thumbs[Math.min(n - 1, thumbs.length - 1)]?.focus({ preventScroll: true });
  });
}

async function finish(btn: HTMLButtonElement) {
  const file = await buildFile(btn);
  if (file) await host.done(file);
}

/** يبني ملف الصفحات (ما يصنعه «تم»)، ويفرّغ الجلسة. وإن فشل: النتيجة بالخطأ، و`null`. */
async function buildFile(btn: HTMLButtonElement): Promise<File | null> {
  for (const b of host.app.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
  btn.setAttribute("aria-busy", "true");
  // «تم» يقول «جارٍ تجهيز الملف»، و«الأدوات» (أضيق) يبقى نصّه بجانب الدوّار، والورقة فوقه تدور بلاطتها
  const main = btn.classList.contains("primary");
  btn.replaceChildren(h("span", { class: main ? "spinner light" : "spinner", "aria-hidden": "true" }), main ? S.scanPreparingFile : S4.tools);
  let bytes: Uint8Array;
  try {
    await settleFilter(filterHooks); // كل الصفحات بالإعداد الأخير
    bytes = await buildPdf(await pdfPages(pages));
  } catch {
    renderResult(S.saveFailed);
    return null;
  }
  reset(); // الصفحات صارت في الملف
  return new File([bytes as BlobPart], `${S.scanName}.pdf`, { type: "application/pdf" });
}

