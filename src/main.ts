import "./promise-try"; // قبل pdf.js: Safari < 18.2 بلا Promise.try
import "./uint8-codec"; // قبل pdf.js: toBase64 لخطّ @font-face وfromBase64 للتواقيع، وغيابها في Chrome < 140 وSafari < 18.2
import "./baseline-polyfills"; // قبل pdf.js: Iterator ومساعداته وURL.parse وPromise.withResolvers وغيرها (Safari 16.4، Chrome 110)
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "@fontsource/ibm-plex-sans-arabic/latin-400.css";
import "@fontsource/ibm-plex-sans-arabic/latin-500.css";
import "@fontsource/ibm-plex-sans-arabic/latin-600.css";
import "@fontsource/ibm-plex-sans-arabic/latin-700.css";
import "./style.css";

import * as pdfjs from "pdfjs-dist";
import workerUrl from "./pdf-worker?worker&url"; // عامل pdf.js مسبوقاً ببوليفل Promise.try
import { PDFDocument, degrees, type PDFPage } from "pdf-lib";

import { S, S4, SR, SF, SG, SL, SP, SU, SW, SX, WA_URL, ar, pagesCount, rangeError } from "./strings";
import { createHistory, type Entry, type History } from "./history"; // ١٤
import { prepare, extract, type Prepared } from "./bg-remove";
import { EraseHistory, buildMask, eraseStage } from "./erase-stage";
import { normRotation, viewportSize, type PageGeom, type Rect, type Rotation } from "./coords";
import { placementTurned, rotateFrac, rotateGeom, rotatePage, rotateTurn } from "./rotate";
import { initialRect, moveRect, scaleRect, limits, clampRect, type Kind } from "./place";
import { pinchHitsItem, pinchRect, cornerRect, type Corner } from "./place"; // ١٨
import { createScrollHandle, type ScrollHandle } from "./scroll-handle"; // ١٢
import { addAsset, deleteAsset, getAsset, listAssets, type Asset } from "./store";
import { h, icon } from "./dom";
import { askDelete, askLeave, notice } from "./leave-ask";
import { showScan } from "./scan-ui";
import { showSplit, splitIcon, type SplitHost } from "./split-screen";
import { drawThumbs, fileThumb, keepThumbs, pauseThumbs, thumbScale, turnThumb } from "./merge-thumb";
import { busyTile, moreFor, moreToolsBody, moreToolsTile, toolsBody, toolsButton, toolsFor, type Op, type Tool } from "./tools-sheet";
import { MORE_TOOLS, moreTool, type MoreTool } from "./tools/registry";
import { toolArt } from "./tools/tool-art";
import type { SavedImages, ToolHost } from "./tools/host";
import { showEmpty } from "./tools/tool-ui";
import { showCompress } from "./tools/compress";
import { showPdfToJpg } from "./tools/pdf-to-jpg";
import { showProtect } from "./tools/protect";
import { showUnlock } from "./tools/unlock";
import { showJpgToPdf } from "./tools/jpg-to-pdf";
import { showWordToPdf } from "./tools/word-to-pdf";
import { installDropWheel, wheelOptions, type WheelChoice, type WheelTool } from "./drop-wheel";
import { mhalahLogoSvg } from "./mhalah-logo";
import { move, remove, can, gridTarget, type GridDir } from "./page-ops";
import { parsePosition } from "./numerals";
import { outputName, writtenOnly } from "./out-name";
import { prepareCopy } from "./copy-clean";
import { BurnRefused, burnPage, fileExtras, pageHasAnnots, toPdf, toView, type PdfRect } from "./redact-save";
import { burnScale, snapInk, snapText, textLines, type Box, type Lum, type TLine, type Pt, type TextRun } from "./redact";
import { cutRects, drawMarks as drawPenMarks, hlBoxes, inkPath, isInkWidth, isPenTool, HL_BLANK_PT, INK_MIN_PX, INK_WIDTHS, PEN_TOOLS, type Highlight, type Ink, type InkWidth, type PenTool } from "./pen-marks";
import { burnClosure, burnedFonts, leakedPages } from "./font-share";
import { hiddenOf, sharesText } from "./redact-text";
import { attachReorder, liveIndex, dragging } from "./drag-reorder";
import { openDrawScreen as drawScreen } from "./draw-screen";
import { themeToggle } from "./theme";
import { downloadMenu } from "./download-menu";
import { dropHelpButton } from "./drop-help";
import { inWindowsApp } from "./install-env";
import { inkColor, inkPicker, loadInkAny, type Ink as InkColor, type InkPicker } from "./ink";
import { alignOf, labelText, loadLastText, LONG_TEXT_MAX, saveLastText, textCanvasScreen, textCanvasFor, textSheetBody, type TextAlign, type TextVal } from "./text-item";
import type { WebFontKey } from "./font-load";
import { ensurePickFont, familyOf, fontPicker, loadPickFont, readyFont } from "./font-pick";
import { adjust, asMode, dayBounds, dayOf, defaultMode, fieldDigits, formatLines, inHijriRange, monthLength, parseUnit, partsOf, setUnit, shownMode, todayDay, unitRange, weekdayOf, yearRange, type DateMode, type DateUnit } from "./date-fmt";
import { installCard } from "./install-card";
import { installNav } from "./nav";
import { allowLeave, guardLeave } from "./leave-guard";
import { byMoreOrder, defaultLayout, loadLayout } from "./home-layout"; // ٢١
import { showSettings } from "./settings-screen"; // ٢١
import { toolName } from "./tool-name"; // ٢١
import "./analytics-boot"; // عدّاد الزوار في الإنتاج وحده (src/analytics.ts)

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const BASE = import.meta.env.BASE_URL;
const PROCESS_MAX = 1600; // أقصى ضلع تُعالج به الصورة
const OUTPUT_MAX = 1200; // أقصى ضلع للصورة المحفوظة (حتى لا يتضخّم الملف)
const STEP = 1.1;
const FLIP_MS = 220;

/* ───────── أدوات DOM صغيرة (h وicon في dom.ts) ───────── */
const $ = <T extends Element>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
/** نصّ فيه اسم ملف: الاسم داخل <bdi> لئلا تنقلب علامات «». */
function withName(text: string, name?: string): (Node | string)[] {
  if (!name) return [text];
  const i = text.indexOf(name);
  if (i < 0) return [text];
  return [text.slice(0, i), h("bdi", {}, name), text.slice(i + name.length)];
}
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ───────── الملفات المفتوحة ───────── */
interface Source { name: string; bytes: Uint8Array; doc: pdfjs.PDFDocumentProxy }
/** صفحة من ملف مصدر. ترتيب الصفحات قائمةٌ من هذه، والتوقيع يتبع `uid` صفحته أينما نُقلت. */
/** `geom` هندسة الصفحة كما تُعرض الآن، و`turns` ما دوّرها المستخدم (أرباعاً مع العقارب) فوق `/Rotate` الأصلي، ويُكتب عند الحفظ. */
interface PageRef { uid: string; src: Source; index: number; proxy: pdfjs.PDFPageProxy; geom: PageGeom; turns?: number }
/** توقيع أو ختم موضوع، بلا DOM: كسورٌ من عرض الصفحة المعروضة وارتفاعها. */
/** `kind: "date"`: التاريخ، وصورته تُرسم من `date` (لا من المحفوظ). و`kind: "text"`: النصّ، وصورته من `text` (src/text-item.ts). */
/** `turn`: كم تظهر الصورة مُدارةً مع العقارب على الشاشة (تدور مع صفحتها، src/rotate.ts). والصندوق صندوقها على الشاشة. */
interface ItemData { id: string; assetId: string; kind: Kind | "date" | "text"; pageUid: string; fx: number; fy: number; fw: number; fh: number; date?: DateVal; text?: TextVal; turn?: Rotation }

const openSources = new Set<Source>();

/** مهلة «بلا تقدّم» لكل مرحلة من فتح الملف: إن قتل النظام عامل pdf.js (ضغط الذاكرة في iOS) بقي وعده معلّقاً إلى الأبد.
 * الاختبار يختصرها بـ`window.__openStallMs`. */
const STALL_MS = 60_000;
const stallMs = () => (window as unknown as { __openStallMs?: number }).__openStallMs ?? STALL_MS;
function watchdog<T>(p: Promise<T>): Promise<T> {
  let t = 0;
  return Promise.race([p, new Promise<never>((_, no) => { t = window.setTimeout(() => no(new Error("stalled")), stallMs()); })]).finally(() => clearTimeout(t));
}

async function openSource(file: File): Promise<Source | "bad" | "encrypted"> {
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await watchdog(file.arrayBuffer())); } catch { return "bad"; }
  // pdf.js وحده عند الفتح، وpdf-lib عند الحفظ فقط: تحميله هنا كان يبني بنية الملف كلها على الخيط الرئيسي لمجرّد كشف الحماية
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js يأخذ ملكية المصفوفة، فتُعطى نسخة
    cMapUrl: `${BASE}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
    wasmUrl: `${BASE}pdfjs/wasm/`,
    iccUrl: `${BASE}pdfjs/iccs/`,
    useWasm: false, // بلا WebAssembly، فتبقى سياسة الأمان بلا 'wasm-unsafe-eval'
    enableXfa: false,
  });
  try {
    const doc = await watchdog(task.promise);
    // المحمي بكلمة مرور المالك وحدها يفتحه pdf.js ويرفض pdf-lib حفظه: فيه /Encrypt، فلا تكون صلاحياته null
    if ((await watchdog(doc.getPermissions())) !== null) { void task.destroy(); return "encrypted"; }
    const src: Source = { name: file.name, bytes, doc };
    openSources.add(src);
    return src;
  } catch (e) {
    void task.destroy();
    return (e as Error)?.name === "PasswordException" ? "encrypted" : "bad";
  }
}
async function pageRefs(src: Source): Promise<PageRef[]> {
  // دفعاتٌ متوازية محدودة بدل انتظار كل صفحة وحدها: في WebKit كلّ ذهابٍ وإيابٍ مع العامل نحو ١ms.
  // ولكل دفعة مهلتها: صفحة لا تردّ تُسقط الملف بخطأ بدل دوّارٍ لا ينتهي
  const out: PageRef[] = [], n = src.doc.numPages, BATCH = 16;
  for (let i = 0; i < n; i += BATCH) {
    const proxies = await watchdog(Promise.all(Array.from({ length: Math.min(BATCH, n - i) }, (_, k) => src.doc.getPage(i + k + 1))));
    proxies.forEach((proxy, k) => out.push({ uid: crypto.randomUUID(), src, index: i + k, proxy, geom: { view: proxy.view as PageGeom["view"], rotate: normRotation(proxy.rotate) } }));
  }
  return out;
}
function closeSource(src: Source) {
  openSources.delete(src);
  void src.doc.loadingTask?.destroy();
}
function closeAllSources() {
  for (const s of [...openSources]) closeSource(s);
}

/* ───────── الحال ───────── */
type Mode = "sign" | "edit" | "merge-edit" | "merged" | "scan";
interface ViewerOpts {
  mode: Mode;
  title: string;
  titleName?: string; // اسم الملف داخل العنوان
  fileLabel?: string; // سطر اسم الملف فوق الصفحات
  pages: PageRef[]; // تُعدَّل في مكانها (ترتيب وحذف)
  items: ItemData[]; // تُعدَّل في مكانها
  /** اسم الملف الناتج، يُحسب عند الحفظ بحسب ما وُضع (توقيع/ختم) أو لم يُوضع. */
  outName: (hasMarks: boolean, dateOnly?: boolean, hidden?: string[] | null) => string;
  back?: { label: string; run: () => void };
  done?: () => void; // طبقة التحرير في الدمج: «تم» مكان «حفظ الملف»
  /** علامات القلم المحفوظة مع ملفات الدمج (merge.marks): تُشارَك بالمرجع، فما يُضاف أو يُزال في العارض يبقى بعد إغلاقه. */
  marks?: MarkSet;
}
/** أغطية الطمس والتحديد والرسم، كلٌّ بـuid صفحته. */
interface MarkSet { covers: Cover[]; hls: Highlight[]; inks: Ink[] }
interface PageView {
  ref: PageRef;
  wrap: HTMLElement;
  frame: HTMLElement; // حامل علامات الزوايا للصفحة المحدَّدة
  sheet: HTMLElement; // الورقة نفسها (canvas + العناصر)
  canvas: HTMLCanvasElement;
  badge: HTMLElement; // شارة رقم الموضع: على الشاشة وحدها، لا تدخل الملف المحفوظ
  rot: HTMLButtonElement; // زرّ تدوير الصفحة في زاويتها المقابلة للشارة
  rendered: boolean;
  scale: number; // المقياس الذي رُسمت به اللوحة (المصغّر يكتفي بلوحة أكبر منه)
  task: pdfjs.RenderTask | null;
}
interface Placed { d: ItemData; el: HTMLElement }

const state = {
  opts: null as ViewerOpts | null,
  pages: [] as PageView[],
  byUid: new Map<string, PageView>(),
  items: [] as Placed[],
  selected: null as Placed | null,
  picked: null as PageView | null, // الصفحة المحدَّدة (التحرير)
  saving: false,
  changed: false, // حدث تعديل (يفتح «حفظ الملف» في التحرير)
  unsaved: false, // تعديل لم يُحفظ بعد (سؤال الخروج)
  savedTurns: "", // تدوير الصفحات عند الفتح أو آخر حفظ (سؤال الخروج)
  urls: new Map<string, string>(), // assetId → blob URL
};
const editable = () => state.opts?.mode === "edit" || state.opts?.mode === "merge-edit";
/** «تحرير ملف» كاملاً: «تحرير ملف» نفسه، ومحرّر الملف داخل الدمج (القلم والتراجع والكتابة في الصفحة والمقابض، قرار نايف ٢٠٢٦/١١/١٧). */
const fullEdit = (m = state.opts?.mode) => m === "edit" || m === "merge-edit";

const app = $<HTMLElement>("#app");
const pdfInput = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true, "data-test": "pdf-input" }) as HTMLInputElement;
const multiInput = h("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, hidden: true, "data-test": "merge-input" }) as HTMLInputElement;
const photoInput = h("input", { type: "file", accept: "image/*", hidden: true, "data-test": "photo-input" }) as HTMLInputElement;
const fileInput = h("input", {
  type: "file",
  accept: "image/png,image/jpeg,image/webp,image/heic,image/heif,.png,.jpg,.jpeg,.webp,.heic,.heif",
  hidden: true,
  "data-test": "file-input",
}) as HTMLInputElement;
const live = h("p", { class: "sr-only", "aria-live": "polite", "data-test": "live" });
document.body.append(pdfInput, multiInput, photoInput, fileInput, live);

function announce(msg: string) {
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = msg));
}

/* ───────── الرئيسية ───────── */
/** أتُرسم حركة الشعار الآن؟ لا مع تقليل الحركة، ولا والصفحة في الخلفية، ولا بعد مهلة التحميل، ومرة في الجلسة.
 *  والعلامة تُكتب هنا قبل البدء: إن تعذّرت القراءة أو الكتابة فلا حركة. و?t= (frozen) يتجاوز الجلسة والمهلة */
function logoMotionDue(frozen: boolean): boolean {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (frozen) return true;
  if (document.visibilityState !== "visible" || performance.now() > 600) return false;
  try {
    if (sessionStorage.getItem("pdfsa.logoMotion") !== null) return false;
    sessionStorage.setItem("pdfsa.logoMotion", "1");
    return true;
  } catch { return false; }
}

function showHome(error?: string) {
  closeViewer();
  closeAllSources();
  merge = null;
  keepThumbs(new Set());
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => h("span", { class: "line", "data-w": w })),
    h("span", { class: "slot marks" }),
  );
  sheet.querySelectorAll<HTMLElement>(".line").forEach((l) => (l.style.inlineSize = `${l.dataset.w}%`));
  const signBtn = h("button", { class: "btn primary block home-sign", type: "button", "data-test": "home-sign", onclick: () => choose("sign") }, S.signFile) as HTMLButtonElement;
  // البلاطات الأربع من الترتيب المحفوظ (الإضافة ٢١، src/home-layout.ts)، بلا حركة. والأصل: دمج، تقسيم، تحرير، مسح
  const layout = loadLayout(LAYOUT_DEFAULT);
  const tiles = layout.home.map((slug) => {
    const e = homeEntry(slug);
    return h("button", { class: "home-tile", type: "button", "data-test": `home-${slug}`, onclick: () => e.open() }, e.icon(), h("span", {}, toolName(e.label))) as HTMLButtonElement;
  });
  // «أدوات أخرى» (layout-lama.md): سطر بعرض كامل تحت البلاطات، يفتح ورقة الأدوات المبنية (src/tools/registry.ts)
  const moreBtn = h("button", { class: "home-tile home-more", type: "button", "data-test": "home-more", onclick: () => openMoreTools() }, h("span", {}, SF.moreTools)) as HTMLButtonElement;
  // زرّ «الإعدادات» (الإضافة ٢١، لمى ٢٠٢٦/١١/١٤): مربّع في نهاية سطر «أدوات أخرى» وبعده في التركيز، ويتعطّل مع الأزرار أثناء فتح ملف
  const settingsBtn = h("button", { class: "home-tile settings-btn", type: "button", "aria-label": SG.title, title: SG.title, "data-test": "home-settings", onclick: () => openSettings() }, icon("settings")) as HTMLButtonElement;
  const all = [signBtn, ...tiles, moreBtn, settingsBtn];
  const alert = h("p", { class: "alert", role: "alert", hidden: !error }, error ?? "");
  const card = installCard(() => signBtn);
  app.replaceChildren(h("main", { class: "start home" },
    // في برنامج ويندوز زرّ «؟» (الإضافة ١٩) مكان «تنزيل PDFsa»، ولا شيء في غيره من التطبيقات
    inWindowsApp(location.protocol, location.hostname, navigator.userAgent, navigator.maxTouchPoints) ? dropHelpButton() : downloadMenu(card), // «تنزيل PDFsa» في زاوية البداية: أول ما في الرئيسية، ثم زرّ الوضع في زاوية النهاية (download-buttons-lama-spec.md)
    themeToggle(), // قبل الشعار فيوافق ترتيبُ التركيز موضعه (مواصفة لمى)
    h("div", { class: "home-brand" },
      // صورتان، والوضع يُظهر واحدة بـCSS (مواصفة لمى ٢٠٢٦/١١/١١): الليلية بلا لوح
      h("img", { class: "home-logo logo-light", src: `${BASE}logo-pdfsa.png`, alt: "PDFsa", width: 600, height: 147 }),
      h("img", { class: "home-logo logo-dark", src: `${BASE}logo-pdfsa-dark.png`, alt: "PDFsa", width: 600, height: 147 }),
      h("h1", { class: "sr-only" }, S.appName)), // طلب نايف ٢٠٢٦/١١/٠٨: «ازل كلمة توقيع وختم». يبقى عنواناً لقارئ الشاشة وحده
    h("div", { class: "home-sheet" }, sheet), signBtn,
    // «أضف إلى الشاشة الرئيسية» على الجوال وحده: أول ما في صفّ الأدوات، فتعلوه تحت «توقيع ملف» وتأتي في Tab قبله (src/install-card.ts)
    h("div", { class: "home-row" }, card, ...tiles),
    h("div", { class: "home-more-row" }, moreBtn, settingsBtn),
    alert,
    ...siteFooter("home")));
  // رسم الشعار حركةً (docs/logs/logo-motion-s2.md): مرة في الجلسة، ولا تُطلب شيفرتها إن لم تُرسم. الصورتان تُخفيان من أول رسم
  // (lm-pending) فلا يظهر الشعار ثم يختفي، ويعود الثابت إن لم تبدأ الحركة (src/logo-motion.ts)
  const brand = app.querySelector<HTMLElement>(".home-brand")!;
  // ?t=<ms> يوقف الحركة عند زمن، للاختبار (e2e/logo-motion.spec.ts) ولوحة الإطارات (scripts/logo-motion-board.mjs) وحدهما.
  // لا يكتب في الجلسة ولا يتقيّد بمهلة التحميل، ولا يمسّ شيئاً غير الشعار، ومع تقليل الحركة لا أثر له. ويُقبل رقماً منتهياً وحده، وإلا فكأنه غائب.
  // ولا يُخفي الصورتين قبل أن تجهز الطبقات (lm-pending للحركة الحيّة وحدها)، فلا يختفي الشعار إن تعلّق شيء
  const lmQ = new URLSearchParams(location.search).get("t");
  const lmT = lmQ !== null && lmQ.trim() !== "" && Number.isFinite(Number(lmQ)) ? Number(lmQ) : null;
  const still = () => { brand.classList.remove("lm-pending"); brand.dataset.lm = "static"; };
  if (logoMotionDue(lmT !== null)) {
    if (lmT === null) {
      brand.classList.add("lm-pending");
      // مهلة قصوى: إن تعلّق import() أو decode() بلا رفض، يعود الشعار الثابت ولا تبدأ الحركة بعدها (run() يرى lm-pending قد أُزيلت)
      setTimeout(() => { if (brand.classList.contains("lm-pending")) still(); }, 1500);
    }
    void import("./logo-motion").then((m) => m.run(brand, lmT)).catch(still);
  } else brand.dataset.lm = "static";

  // صفحة الشرح أولاً، ومنها «اختر ملفاً» (الملاحظة ٩ من تحديث 1.0.2)
  function choose(mode: "sign" | "edit" | "split") { showIntro(mode); }
  // الافتراضي «توقيع ملف» (كما في النسخة الأولى)
  pdfInput.onchange = () => void picked("sign");

  async function picked(mode: "sign" | "edit" | "split") {
    const f = pdfInput.files?.[0];
    pdfInput.value = "";
    if (!f) return;
    const btn = mode === "sign" ? signBtn : tiles[layout.home.indexOf(mode)] ?? signBtn;
    const kids = [...btn.childNodes];
    for (const b of all) b.disabled = b !== btn;
    btn.setAttribute("aria-busy", "true");
    if (mode === "sign") btn.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.opening);
    else btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), kids[1]!);
    alert.hidden = true;
    let src = await openSource(f);
    let pages: PageRef[] = [];
    if (typeof src !== "string") {
      try { pages = await pageRefs(src); } catch { closeSource(src); src = "bad"; }
    }
    if (typeof src === "string") {
      btn.removeAttribute("aria-busy");
      btn.replaceChildren(...kids);
      for (const b of all) b.disabled = false;
      alert.textContent = src === "encrypted" ? S.encrypted : S.badPdf;
      alert.hidden = false;
      return;
    }
    if (mode === "split") { showSplit(splitHost, src, pages); return; }
    await viewFile(mode, src, pages);
  }
}

/**
 * صفحة الشرح لـ«توقيع ملف» و«تحرير ملف» و«تقسيم ملف» قبل اختيار الملف (update-1.0.2-lama-spec.md §٩، والنصوص SX):
 * قالب الحالة الفارغة نفسه (`showEmpty`)، ثم الفتح بمسار الرئيسية (`openSource` و`pageRefs`) إلى شاشته. وهي شاشة فوق الأساس،
 * فالرجوع بالسحب منها يعود إلى الرئيسية (src/nav.ts). ورسم كلٍّ من `toolArt(mode)` (docs/logs/intro-art-lama-spec.md).
 */
function showIntro(mode: "sign" | "edit" | "split") {
  const t = mode === "sign" ? { name: S.signFile, lead: SX.signLead, points: SX.signPoints }
    : mode === "edit" ? { name: S.editFile, lead: SX.editLead, points: SX.editPoints, note: SX.editNote }
      : { name: S4.splitFile, lead: SX.splitLead, points: SX.splitPoints };
  showEmpty(toolHost, {
    ...t, slug: mode, p: `intro-${mode}`, test: `intro-${mode}`,
    open: async (file) => {
      let src = await openSource(file);
      let pages: PageRef[] = [];
      if (typeof src !== "string") {
        try { pages = await pageRefs(src); } catch { closeSource(src); src = "bad"; }
      }
      if (typeof src === "string") return src === "encrypted" ? S.encrypted : S.badPdf;
      if (mode === "split") showSplit(splitHost, src, pages);
      else await viewFile(mode, src, pages);
      return null;
    },
  }, async () => {});
}

/** عبارة الخصوصية وتذييل مَحالة: في الرئيسية وفي صفحات الأدوات (قرار المدير: الإعلان لمَحالة غرض الموقع). */
function siteFooter(from: string): Node[] {
  // تذييل مَحالة (§٧): رابط واحد يضمّ الشعار و«mhalah.com»
  const mhalah = h("a", { href: "https://mhalah.com", target: "_blank", rel: "noopener noreferrer", "aria-label": S4.mhalahLabel, "data-test": "mhalah-link" },
    h("bdi", { dir: "ltr" }, S4.mhalahDomain));
  mhalah.insertAdjacentHTML("afterbegin", mhalahLogoSvg());
  return [
    // عبارة الخصوصية (طلب نايف ٢٠٢٦/١١/٠٨: «لا تكون بحجم كبير»): صادقة لأن المنصة بلا خادم و`connect-src 'self'`
    h("p", { class: "home-privacy", "data-test": "home-privacy" },
      icon("lock"), h("strong", {}, S4.privacyTitle), " ", S4.privacyBody, " ",
      h("a", { href: "/privacy", "data-test": "privacy-link" }, S4.privacyLink)),
    h("footer", { class: "mhalah-foot", "data-test": "mhalah-foot" }, h("span", {}, S4.madeBy), mhalah,
      // واتساب مَحالة (موافقة نايف ٢٠٢٦/١١/٠٩): رابط ثانويّ لا زرّ بارز، والضغطة تُعدّ في الإنتاج وحده (data-wa-from، src/analytics.ts)
      h("a", { class: "wa-link", href: WA_URL, target: "_blank", rel: "noopener", "aria-label": SW.label, "data-wa-from": from, "data-test": "wa-link" },
        icon("whatsapp"), h("span", {}, SW.label))),
  ];
}

/* ───────── «أدوات أخرى» (src/tools/) ───────── */
/** الرجوع إلى الرئيسية: في صفحة بحث لأداة (`data-tool`) إلى «/» نفسها، وفي غيرها بلا تحميل. */
function goHome() {
  if (document.body.dataset.tool) { allowLeave(); location.assign("/"); } // مغادرةٌ مقصودة (بعد «الخروج» من نافذتنا أحياناً): لا نافذة متصفح
  else showHome();
}
const toolHost: ToolHost = {
  app, announce,
  pickPdf: (onFile) => {
    pdfInput.onchange = () => {
      const f = pdfInput.files?.[0];
      pdfInput.value = "";
      if (f) onFile(f);
    };
    pdfInput.click();
  },
  open: (file) => openSource(file),
  exit: () => goHome(),
  saved: (file, pages, from, images) => showSaved(file, from ? "tool" : null, pages, from, images),
  footer: siteFooter,
};
/* ───────── ترتيب أدوات الرئيسية و«الإعدادات» (الإضافة ٢١) ───────── */
const LAYOUT_DEFAULT = defaultLayout(MORE_TOOLS.map((t) => t.slug));
interface HomeEntry { slug: string; label: string; icon: () => Element; open: () => void }
/** أداة بالرئيسية أو بـ«أدوات أخرى» أينما وُضعت: اسمها وأيقونتها وفتحها. أدوات الرئيسية الأصلية بمساراتها من الرئيسية، وغيرها من السجلّ. */
function homeEntry(slug: string): HomeEntry {
  switch (slug) {
    case "merge": return { slug, label: S.mergeFile, icon: () => icon("merge"), open: () => showMerge() };
    case "split": return { slug, label: S4.splitFile, icon: () => splitIcon(), open: () => showIntro("split") };
    case "edit": return { slug, label: S.editFile, icon: () => icon("pages"), open: () => showIntro("edit") };
    case "scan": return {
      slug, label: S.scanFile, icon: () => icon("camera"),
      open: () => showScan({ app, exit: () => showHome(), done: openScanned, announce, tools: (n, build) => openTools("scan", n, build) }),
    };
  }
  const t = moreTool(slug)!; // الترتيب المقروء من قائمة مسموحة (parseLayout)
  return { slug, label: t.label, icon: () => icon(t.icon), open: () => t.open(toolHost) };
}
function openSettings() {
  showSettings({
    app, announce, exit: () => showHome(), footer: siteFooter, defaults: LAYOUT_DEFAULT,
    tool: (slug) => { const e = homeEntry(slug); return { label: e.label, art: e.icon }; },
    // ring: قسم دائرة الإفلات، يملؤه برنامج ويندوز لاحقاً (لا في هذه الدفعة)
  });
}

function openMoreTools() {
  if (!dialog.open) dialog.classList.add("tools"); // دخول الورقة كورقة «الأدوات» (style.css)
  // «أدوات أخرى» بترتيب الإعدادات: ما خرج من الرئيسية يأخذ خانة الداخلة (الإضافة ٢١)
  const grid = moreToolsBody(loadLayout(LAYOUT_DEFAULT).more.map(homeEntry), (t) => { closeSheet(); t.open(); });
  // «إعداد خطاب» آخر الورقة (الحادية عشرة): رابط إلى /letter لا أداة في MORE_TOOLS، فلا يدخل openPdf ولا دائرة السحب.
  // قرار نايف ٢٠٢٦/١١/١١ «نعم، آخرها»: ينقض «تعبئة نموذج آخر الورقة» (registry.ts) في هذا الموضع وحده، فتصير قبله.
  // وبعرض الشاشة على الجوال، وعمودان على ثلاثة أعمدة (style.css، .more-letter)
  grid.append(h("a", { href: "/letter", class: "home-tile more-letter", "data-test": "more-letter" }, icon("fileText"), h("span", {}, SL.title)));
  openSheet(SF.moreTools, [grid]);
}

/* ───────── دائرة السحب (src/drop-wheel.ts) ───────── */
/** أدوات الرئيسية في الدائرة. وأيقوناتها وأسماؤها من بلاطات «الأدوات» (tools-sheet.ts)، وهي بلاطات الرئيسية. */
const HOME_TOOLS: readonly WheelTool[] = ["sign", "edit", "split", "merge"];
const wheelAvailable = (t: WheelTool) => HOME_TOOLS.includes(t) || !!moreTool(t);
function wheelTile(t: WheelTool) {
  if (HOME_TOOLS.includes(t)) {
    const b = toolsBody([t as Tool], () => {}).firstElementChild!;
    return { icon: b.firstElementChild!, label: b.lastElementChild!.textContent ?? "" };
  }
  const m = moreTool(t)!; // أدوات «أدوات أخرى» من السجلّ
  return { icon: icon(m.icon), label: m.label };
}
/** الـPDF الواحد المُسقط بعد فتحه، إلى أن تأخذه أداة أو تُغلق الدائرة. */
let dropped: { file: File; src: Source; pages: PageRef[] } | null = null;
function closeDropped() {
  if (dropped) closeSource(dropped.src);
  dropped = null;
}
/** الفتح بالملفات المُسقطة بمسار الاختيار نفسه. وإن لم يصلح الخيار بعد قراءة الملف (محمي، أو «تقسيم» لصفحة واحدة) تُعاد الخيارات الصحيحة. */
async function wheelPick(t: WheelTool, files: File[]): Promise<WheelChoice | void> {
  if (t === "jpg-to-pdf") return showJpgToPdf(toolHost, files);
  if (t === "word-to-pdf") return showWordToPdf(toolHost, files[0]); // الإضافة ٢٠: ملف Word واحد
  if (t === "merge") {
    const m: NonNullable<typeof merge> = { files: [], items: [], marks: noMarks() };
    for (const f of files) m.files.push(await openMergeFile(f));
    merge = m;
    showMerge();
    return;
  }
  const file = files[0]!;
  if (t === "unlock") { closeDropped(); return showUnlock(toolHost, undefined, file); }
  if (dropped?.file !== file) {
    closeDropped();
    const src = await openSource(file);
    if (src === "encrypted") return wheelOptions({ kinds: ["pdf"], encrypted: true, available: wheelAvailable }) ?? undefined;
    let pages: PageRef[] = [];
    if (typeof src !== "string") {
      try { pages = await pageRefs(src); } catch { closeSource(src); }
    }
    if (typeof src === "string" || !pages.length) { showHome(S.badPdf); return; }
    dropped = { file, src, pages };
    app.querySelector<HTMLElement>("main.home .alert")?.setAttribute("hidden", ""); // نجح فتحٌ جديد: لا تبقى رسالة «غير صالح» من إسقاطٍ سابق
  }
  const { src, pages } = dropped;
  const fit = wheelOptions({ kinds: ["pdf"], pages: pages.length, available: wheelAvailable });
  if (fit && "tools" in fit && !fit.tools.includes(t)) return fit;
  dropped = null; // أخذته الأداة
  if (t === "split") showSplit(splitHost, src, pages);
  else if (t === "sign" || t === "edit") await viewFile(t, src, pages);
  else if (t === "compress") await showCompress(toolHost, undefined, src);
  else if (t === "pdf-to-jpg") await showPdfToJpg(toolHost, src);
  else if (t === "protect") await showProtect(toolHost, undefined, src);
}
installDropWheel({
  // الرئيسية وحدها، بلا ورقة مفتوحة ولا ملف يُفتح من زرّ
  active: () => !!app.querySelector("main.home") && !app.querySelector("main.home [aria-busy]") && !dialog.open,
  available: wheelAvailable,
  tile: wheelTile,
  pick: wheelPick,
  closed: closeDropped,
});

/** «توقيع ملف» و«تحرير ملف» على ملف مفتوح (من المنتقي، أو من «الأدوات»). */
function viewFile(mode: "sign" | "edit", src: Source, pages: PageRef[]) {
  const name = src.name;
  return buildViewer({
    mode, title: mode === "sign" ? S.signFile : S.editFile, fileLabel: name,
    pages, items: [], outName: (marks, dateOnly, hidden) => outputName(mode, name, marks, dateOnly, hidden),
    back: { label: S.backHome, run: () => leaveThen(showHome) },
  });
}

const splitHost: SplitHost = {
  app, exit: () => showHome(), announce,
  tools: (file, n, leave) => toolsButton(() => openTools("split", n, async () => file, undefined, leave)),
};

/* ───────── الأدوات (tools-sheet.ts) ───────── */
/**
 * ورقة «الأدوات» للملف الحالي: `file` يعطيه (بناؤه من المسح، أو البايتات المحفوظة)، أو `null` إن فشل.
 * `back` يعيد الورقة السابقة (ورقة الحفظ)، و`leave` يغلق موارد الشاشة الحالية قبل فتح الأداة.
 * `more` (بعد الحفظ): تحت البلاطات «أدوات أخرى» تفتح ورقتها بالملف نفسه، بلا الأداة `more.from`. و«رجوع» منها إلى هذه الورقة.
 */
function openTools(op: Op, pages: number, file: () => Promise<File | null>, back?: () => void, leave?: () => void, more?: { from?: string }) {
  if (!dialog.open) dialog.classList.add("tools"); // دخول الورقة 160ms (style.css)
  const take = <T,>(start: (t: T, f: File) => Promise<void>) => (t: T, tile: HTMLButtonElement, all: HTMLButtonElement[]) => void (async () => {
    if (tile.getAttribute("aria-busy")) return;
    busyTile(tile, all);
    const f = await file();
    if (!f) { closeSheet(); return; }
    await start(t, f);
  })();
  const self = () => openTools(op, pages, file, back, leave, more);
  openSheet(S4.tools, [
    toolsBody(toolsFor(op, pages), take<Tool>((t, f) => startTool(t, f, leave))),
    ...(more ? [moreToolsTile(() => openSheet(SF.moreTools, [moreToolsBody(moreFor(byMoreOrder(MORE_TOOLS, loadLayout(LAYOUT_DEFAULT).more), more.from), // بترتيب الإعدادات (الإضافة ٢١)
       take<MoreTool>((t, f) => startMoreTool(t, f, leave)))], self))] : []),
  ], back);
}

/** يفتح الملف من الذاكرة في الأداة، بمسار الفتح نفسه (`openSource` بمهلته وكشف الحماية)، بلا منتقي ملفات. والرجوع منها إلى الرئيسية كالعادة. */
async function startTool(tool: Tool, file: File, leave?: () => void) {
  const src = await openSource(file);
  let pages: PageRef[] = [];
  if (typeof src !== "string") {
    try { pages = await pageRefs(src); } catch { closeSource(src); }
  }
  closeSheet();
  leave?.();
  if (typeof src === "string" || !pages.length) { showHome(src === "encrypted" ? S.encrypted : S.badPdf); return; }
  closeViewer();
  for (const s of [...openSources]) if (s !== src) closeSource(s); // ملفات الشاشة السابقة
  merge = null;
  keepThumbs(new Set());
  if (tool === "split") showSplit(splitHost, src, pages);
  else if (tool === "merge") {
    merge = { files: [{ id: crypto.randomUUID(), name: src.name, src, pages, error: null }], items: [], marks: noMarks() };
    showMerge();
  } else await viewFile(tool, src, pages);
}

/** «أدوات أخرى» بعد الحفظ: الملف من الذاكرة في الأداة بمسار `startTool` نفسه، ثم شاشتها على الملف المفتوح (`openPdf`). */
async function startMoreTool(t: MoreTool, file: File, leave?: () => void) {
  const src = await openSource(file);
  closeSheet();
  leave?.();
  if (typeof src === "string" || src.doc.numPages < 1) {
    if (typeof src !== "string") closeSource(src);
    showHome(src === "encrypted" ? S.encrypted : S.badPdf);
    return;
  }
  closeViewer();
  for (const s of [...openSources]) if (s !== src) closeSource(s); // ملفات الشاشة السابقة
  merge = null;
  keepThumbs(new Set());
  t.openPdf!(toolHost, src);
}

/**
 * الخروج بسؤال «لم يُحفظ» داخل الصفحة (src/leave-ask.ts) بدل `confirm` الذي يكبته Safari iOS بعد الرجوع في السجلّ (docs/logs/back-home-fix.md).
 * يُسأل في «توقيع ملف» إن وُضع شيء (كما في النسخة الأولى)، وفي غيره إن بقي تعديل لم يُحفظ. بلا عمل يُخرج في الضغطة نفسها
 * (ولا يتأخّر عن popstate، src/nav.ts). وجلسة الكتابة تبقى مفتوحة تحت السؤال: فتح النافذة يأخذ التركيز من الحقل، و«البقاء» يعيده إليه.
 */
function leaveThen(go: () => void) {
  const mode = state.opts?.mode;
  if (mode === "edit" && edit?.isNew && !edit.ta.value.trim()) void endEdit(); // المربّع الفارغ يُغلق بلا سؤال، فتعود علامتا العمل قبله (endEdit)
  if (!unsavedWork()) { go(); return; }
  if (edit) holdEdit = performance.now(); // focusout الحقل حين يُركَّز «البقاء» لا يُغلق التحرير
  const L = S.leaveDialog;
  const title = mode === "merged" ? L.titleMerged : mode === "scan" ? L.titleScan : L.titleFile;
  void askLeave(title, mode === "merged" ? L.toFiles : L.exit, edit?.ta ?? app.querySelector<HTMLElement>('[data-test="back"]')).then((a) => { if (a === "exit") go(); });
}

function unsavedWork() {
  const mode = state.opts?.mode;
  return (mode === "sign" ? state.items.length > 0 : state.unsaved) || turnKey() !== state.savedTurns;
}

/** «تم» في التصوير: الملف المبني يُفتح في العارض نفسه، بشريط التوقيع والختم و«حفظ الملف». والرجوع إلى الرئيسية. */
async function openScanned(file: File) {
  const src = await openSource(file);
  let pages: PageRef[] = [];
  if (typeof src !== "string") {
    try { pages = await pageRefs(src); } catch { closeSource(src); }
  }
  if (typeof src === "string" || !pages.length) { showHome(S.saveFailed); return; }
  await buildViewer({
    mode: "scan", title: S.scanFile, pages, items: [], outName: (marks, dateOnly, hidden) => outputName("scan", file.name, marks, dateOnly, hidden),
    back: { label: S.backHome, run: () => leaveThen(showHome) },
  });
}

/* ───────── دمج ملف ───────── */
interface MergeFile { id: string; name: string; src: Source | null; pages: PageRef[]; error: string | null; locked?: boolean }
let merge: { files: MergeFile[]; items: ItemData[]; marks: MarkSet } | null = null;
const noMarks = (): MarkSet => ({ covers: [], hls: [], inks: [] });
/** موضع قائمة الدمج والملف الذي فُتح محرّره: يُعادان عند الرجوع (showMerge). */
let mergeBack: { y: number; id: string } | null = null;
let mergeBusy = false;

/** ملف من ملفات الدمج: مفتوحاً بصفحاته، أو بخطئه. */
async function openMergeFile(f: File): Promise<MergeFile> {
  const src = await openSource(f);
  const id = crypto.randomUUID();
  if (typeof src === "string") return { id, name: f.name, src: null, pages: [], error: src === "encrypted" ? S.fileEncrypted(f.name) : S.fileBad(f.name), locked: src === "encrypted" };
  try {
    return { id, name: f.name, src, pages: await pageRefs(src), error: null };
  } catch {
    closeSource(src);
    return { id, name: f.name, src: null, pages: [], error: S.fileBad(f.name) };
  }
}

function showMerge() {
  closeViewer();
  mergeBusy = false;
  if (!merge) merge = { files: [], items: [], marks: noMarks() };
  const m = merge;
  const back = mergeBack; // الرجوع من محرّر ملف: موضع القائمة قبل فتحه، والتركيز على «تحرير» صفّه
  mergeBack = null;
  const scrollY = back?.y ?? window.scrollY;
  const backBtn = h("button", {
    class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back",
    onclick: () => { if (!m.files.length) showHome(); else void askLeave(S.leaveDialog.titleMergeList, undefined, backBtn).then((a) => { if (a === "exit") showHome(); }); },
  }, icon("back"));
  const header = h("header", { class: "topbar" }, backBtn, h("h1", { class: "route-title" }, S.mergeFile), h("span", { class: "icon-spacer" }));

  const pick = (btn: HTMLButtonElement) => {
    multiInput.onchange = async () => {
      const files = [...(multiInput.files ?? [])];
      multiInput.value = "";
      if (!files.length) return;
      pauseThumbs(); // فتح الملفات أولاً
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      const label = document.createTextNode(S.opening);
      btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), label);
      for (const [k, f] of files.entries()) {
        if (files.length > 1) label.data = S.openingOf(k + 1, files.length);
        m.files.push(await openMergeFile(f));
      }
      showMerge();
    };
    multiInput.click();
  };

  if (!m.files.length) {
    keepThumbs(new Set());
    const choose = h("button", { class: "btn primary block", type: "button", "data-test": "choose-files" }, S.chooseFiles) as HTMLButtonElement;
    choose.addEventListener("click", () => pick(choose));
    const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
      ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }),
      toolArt("merge"));
    app.replaceChildren(header, h("main", { class: "merge merge-empty" }, sheet, h("p", { class: "tool-lead" }, S.chooseTwo), choose));
    return;
  }

  const n = m.files.length;
  /** نقل ملف بالرقم أو بالسهم: إعادة رسم القائمة، ثم FLIP، والتركيز يتبع الملف، وإعلان مرة واحدة. */
  const moveFile = (f: MergeFile, i: number, to: number, focus: () => HTMLElement | null) => {
    const first = rowTops();
    m.files = move(m.files, i, to);
    showMerge();
    flipRows(first);
    focus()?.focus();
    announce(S.fileMoved(f.name, to + 1, n));
  };
  const rowArrow = (id: string, test: string) => $<HTMLElement>(`[data-id="${id}"] [data-test="${test}"]`);
  const foot = h("footer", { class: "savebar" });
  const rows = m.files.map((f, i) => {
    // عمود الترتيب (د-٢): نقرة سهم = خطوة، وحركة > 8px منه = سحب
    const movable = n >= 2 && !f.error;
    const arrow = (dir: -1 | 1) => {
      const test = dir < 0 ? "file-up" : "file-down", other = dir < 0 ? "file-down" : "file-up";
      const off = !movable || (dir < 0 ? i === 0 : i === n - 1);
      return h("button", {
        type: "button", "aria-label": dir < 0 ? S.moveFileUp(f.name) : S.moveFileDown(f.name), "aria-disabled": off ? "true" : undefined, "data-test": test,
        onclick: () => {
          if (off || mergeBusy) return;
          // إن تعطّل السهم الملموس في الموضع الجديد ينتقل التركيز إلى أخيه
          moveFile(f, i, i + dir, () => rowArrow(f.id, rowArrow(f.id, test)?.getAttribute("aria-disabled") === "true" ? other : test));
        },
      }, icon(dir < 0 ? "up" : "down"));
    };
    const col = h("div", { class: "reorder-col", "data-test": "reorder-col" }, arrow(-1), arrow(1));
    attachReorder({
      handle: col, axis: "y", zone: 48, lift: 1.02,
      elements: () => [...document.querySelectorAll<HTMLElement>(".merge-row")],
      index: () => i,
      canDrag: () => movable && !mergeBusy,
      band: () => ({ top: header.getBoundingClientRect().bottom, bottom: barTopOr(foot) }),
      onStart: () => { mergeBtn.disabled = true; for (const b of document.querySelectorAll(".merge-row .reorder-col button, .merge-row .thumb-btn")) if (!col.contains(b)) b.setAttribute("aria-disabled", "true"); },
      onLive: (from, to) => document.querySelectorAll<HTMLInputElement>(".merge-row .order").forEach((o, k) => (o.value = ar(liveIndex(k, from, to) + 1))),
      onDrop: (from, to) => { if (mergeBusy) return; m.files = move(m.files, from, to); announce(S.fileMoved(f.name, to + 1, n)); },
      onEnd: () => { showMerge(); $<HTMLElement>(`[data-id="${f.id}"] .reorder-col button:not([aria-disabled="true"])`)?.focus(); },
    });
    const err = h("p", { class: "alert row-alert", role: "alert", hidden: true, id: `err-${f.id}` });
    const order = h("input", {
      class: "order", type: "text", inputmode: "numeric", enterkeyhint: "done", autocomplete: "off",
      value: ar(i + 1), "aria-label": S.orderLabel(f.name), "aria-describedby": `err-${f.id}`, "data-test": "order", disabled: n < 2,
    }) as HTMLInputElement;
    let applied = false; // Chrome يطلق change على الحقل المركَّز وهو يُزال عند إعادة الرسم، فلا يُنقل مرّتين
    const apply = () => {
      if (applied || dragging || !order.isConnected) return; // أثناء السحب تُغلق لوحة المفاتيح، ولا يُطبَّق ما كُتب
      const p = parsePosition(order.value, n);
      if (p === null) {
        err.textContent = rangeError(n); err.hidden = false; order.setAttribute("aria-invalid", "true");
        return;
      }
      err.hidden = true; order.removeAttribute("aria-invalid");
      if (p - 1 === i) { order.value = ar(i + 1); return; }
      applied = true;
      moveFile(f, i, p - 1, () => $<HTMLInputElement>(`[data-id="${f.id}"] .order`));
    };
    order.addEventListener("focus", () => order.select());
    order.addEventListener("change", apply);
    order.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });

    // سطر الإشارة (مواصفة لمى، نصّ هدى): «فيه نصّ مطموس» يحلّ محلّ «عليه إضافات»
    const mark = f.error ? null : markOf(f, m);
    const meta = h("div", { class: "meta" },
      h("p", { class: "name", dir: "rtl" }, h("bdi", {}, f.name)),
      f.error ? h("p", { class: "row-error", role: "alert", "data-test": "row-error" }, ...withName(f.error, f.name)) : h("p", { class: "count" }, pagesCount(f.pages.length)),
      mark ? h("p", { class: "marked", "data-test": "file-marked" }, mark === "redacted" ? S.fileRedacted : S.fileMarked) : null);
    const openEdit = () => {
      if (mergeBusy || dragging) return;
      mergeBack = { y: window.scrollY, id: f.id };
      pauseThumbs();
      void buildViewer({
        mode: "merge-edit", title: S.editTitle(f.name), titleName: f.name,
        pages: f.pages, items: m.items, marks: m.marks, outName: () => "", done: () => showMerge(),
      });
    };
    const edit = f.error ? h("span", {}) : h("button", {
      class: "text-btn", type: "button", "aria-label": S.editLabel(f.name), "data-test": "edit-file", onclick: openEdit,
    }, S.editBtn);
    const del = h("button", {
      class: "icon-btn remove", type: "button", "aria-label": S.removeFileLabel(f.name), "data-test": "remove-file",
      onclick: () => {
        m.files = m.files.filter((x) => x !== f);
        pruneItems(m.items, new Set(f.pages.map((p) => p.uid)));
        pruneMarks(m.marks, new Set(f.pages.map((p) => p.uid)));
        if (f.src) closeSource(f.src);
        showMerge();
      },
    }, icon("close"));
    // تدوير الملف كله «من الخارج» (§١): عمود 44×88 في جهة النهاية، ✕ في الأعلى والتدوير تحته
    const rot = f.error ? null : h("button", {
      class: `icon-btn rot-file${turned(f.pages) ? " on" : ""}`, type: "button", "aria-label": S4.rotateFileLabel(f.name), "data-test": "rotate-file",
      onclick: () => {
        if (mergeBusy) return;
        const kPrev = thumbScale(f.pages[0]!.uid);
        for (const p of f.pages) turnRef(p, m.items);
        showMerge();
        turnThumb(f.pages[0]!.uid, kPrev, reducedMotion());
        $<HTMLElement>(`[data-id="${f.id}"] [data-test="rotate-file"]`)?.focus();
        announce(S4.allRotated);
      },
    }, icon("turn"));
    // صورة الصفحة الأولى بعد الرقم وقبل الاسم، كصفوف «صور إلى PDF» (رسم لمى)
    const first = f.pages[0];
    const frame = first ? fileThumb(first.uid, first, "page") : fileThumb(f.id, null, f.locked ? "locked" : "bad");
    // المصغّر اختصار لمس لـ«تحرير» (مواصفة لمى §٢ وتحديثها): خارج التنقّل ومخفيّ عن قارئ الشاشة، و«تحرير» بعده هو الزرّ المسموع
    const thumb = f.error ? frame : h("button", {
      class: "thumb-btn", type: "button", tabindex: "-1", "aria-hidden": "true", "data-test": "thumb-open",
      "aria-disabled": mergeBusy ? "true" : undefined, onclick: openEdit,
    }, frame, h("span", { class: "thumb-badge", "aria-hidden": "true" }, icon("maximize2")));
    return h("li", { class: "merge-row", "data-id": f.id, "data-test": "merge-row" }, col, order, thumb, meta, edit, h("div", { class: "end-col" }, del, rot), err);
  });

  const addBtn = h("button", { class: "btn source add-file", type: "button", "data-test": "add-file" }, icon("plus"), S.addFile) as HTMLButtonElement;
  addBtn.addEventListener("click", () => pick(addBtn));
  const valid = m.files.filter((f) => !f.error);
  const ok = valid.length >= 2 && valid.length === n;
  const hint = h("p", { class: "save-hint", hidden: valid.length >= 2 }, S.addSecond);
  const mergeBtn = h("button", { class: "btn primary block", type: "button", "data-test": "merge", disabled: !ok }, S.mergeBtn) as HTMLButtonElement;
  mergeBtn.addEventListener("click", async () => {
    mergeBusy = true; // أثناء الدمج كل شيء معطّل
    pauseThumbs();
    for (const b of document.querySelectorAll(".merge-row .reorder-col button, .merge-row .thumb-btn")) b.setAttribute("aria-disabled", "true");
    mergeBtn.disabled = true;
    mergeBtn.setAttribute("aria-busy", "true");
    mergeBtn.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.merging);
    const firstName = m.files[0]!.name;
    await buildViewer({
      mode: "merged", title: S.mergeFile, pages: m.files.flatMap((f) => f.pages), items: m.items, marks: m.marks, outName: (marks, dateOnly, hidden) => outputName("merged", firstName, marks, dateOnly, hidden),
      back: { label: S.backFiles, run: () => leaveThen(showMerge) },
    });
  });

  foot.append(hint, mergeBtn);
  app.replaceChildren(header,
    h("main", { class: "merge" }, h("ol", { class: "merge-list" }, ...rows), addBtn),
    foot);
  window.scrollTo(0, scrollY);
  if (back) {
    app.querySelector(":scope > main.merge")?.classList.add("fade-in");
    $<HTMLElement>(`[data-id="${back.id}"] [data-test="edit-file"]`)?.focus({ preventScroll: true });
  }
  const keys = m.files.map((f) => f.pages[0]?.uid ?? f.id);
  keepThumbs(new Set(keys));
  drawThumbs(keys);
}

function rowTops() {
  return new Map([...document.querySelectorAll<HTMLElement>(".merge-row")].map((r) => [r.dataset.id!, r.getBoundingClientRect().top]));
}
function flipRows(first: Map<string, number>) {
  if (reducedMotion()) return;
  for (const r of document.querySelectorAll<HTMLElement>(".merge-row")) {
    const dy = (first.get(r.dataset.id!) ?? 0) - r.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: "cubic-bezier(.23, 1, .32, 1)" });
  }
}
/** أعلى ما على صفحات الملف: طمس، أو إضافات (توقيع وختم وتاريخ ونصّ وتحديد ورسم)، أو لا شيء. */
function markOf(f: MergeFile, m: NonNullable<typeof merge>): "redacted" | "marked" | null {
  const uids = new Set(f.pages.map((p) => p.uid)), on = (x: { pageUid: string }) => uids.has(x.pageUid);
  if (m.marks.covers.some(on)) return "redacted";
  return m.items.some(on) || m.marks.hls.some(on) || m.marks.inks.some(on) ? "marked" : null;
}
/** يحذف من علامات القلم (في مكانها) ما على هذه الصفحات: ملفٌّ أُزيل من الدمج لا يبقى منه شيء. */
function pruneMarks(ms: MarkSet, uids: Set<string>) {
  for (const l of [ms.covers, ms.hls, ms.inks] as { pageUid: string }[][]) for (let i = l.length - 1; i >= 0; i--) if (uids.has(l[i]!.pageUid)) l.splice(i, 1);
}
/** يحذف من القائمة (في مكانها) ما وُضع على هذه الصفحات. */
function pruneItems(items: ItemData[], uids: Set<string>) {
  for (let i = items.length - 1; i >= 0; i--) if (uids.has(items[i]!.pageUid)) items.splice(i, 1);
}

/* ───────── التدوير (docs/design-spec-batch4.md §١) ───────── */
/** يدوّر الصفحة ربعاً مع العقارب، ومعها ما وُضع عليها: يبقى في مكانه من الورقة ويظهر مُداراً معها. */
function turnRef(ref: PageRef, items: ItemData[]) {
  ref.geom = rotateGeom(ref.geom);
  ref.turns = ((ref.turns ?? 0) + 1) % 4;
  for (const d of items) {
    if (d.pageUid !== ref.uid) continue;
    Object.assign(d, rotateFrac(d));
    d.turn = rotateTurn(d.turn ?? 0);
  }
}
/** أُدير شيء منها؟ أربع لمسات تعيد الصفحة إلى الصفر، فلا تُحسب تعديلاً. */
const turned = (refs: PageRef[]) => refs.some((r) => (r.turns ?? 0) % 4 !== 0);
const turnKey = () => state.pages.map((p) => p.ref.turns ?? 0).join("");

/** نقطة تخطيط الكمبيوتر الوحيدة (docs/logs/phase1/layout-lama.md): الأدوات في عمود جانبي ثابت. */
const WIDE = matchMedia("(min-width: 1024px)");
/** أسفل المساحة الظاهرة: حدّ الشريط السفلي على الجوال، وأسفل النافذة على الكمبيوتر لأن الشريط في العمود لا فوق المحتوى. */
const barTopOr = (bar: HTMLElement) => (WIDE.matches ? innerHeight : bar.getBoundingClientRect().top);

/* ───────── طيّ الشريط (يبقى طوال الجلسة) ───────── */
let folded = (() => { try { return sessionStorage.getItem("pill-folded") === "1"; } catch { return false; } })();
function setFolded(v: boolean) {
  folded = v;
  try { sessionStorage.setItem("pill-folded", v ? "1" : "0"); } catch { /* التخزين ممنوع */ }
  applyFold();
  (v ? tab : foldBtn).focus();
}
function applyFold() {
  const f = folded && !WIDE.matches; // لا طيّ في العمود الجانبي: القيمة المحفوظة تبقى للجوال، ولا تترك الأدوات inert
  pill.classList.toggle("folded", f);
  pill.inert = f;
  tab.classList.toggle("shown", f);
  tab.inert = !f;
}

/* ───────── العارض (كل المسارات) ───────── */
let observer: IntersectionObserver | null = null;
let header: HTMLElement, pill: HTMLElement, tab: HTMLButtonElement, foldBtn: HTMLButtonElement, list: HTMLElement;
let saveBar: HTMLElement, saveBtn: HTMLButtonElement, saveHint: HTMLElement, selBar: HTMLElement, pageBar: HTMLElement;
let rotAllBtn: HTMLButtonElement, rotBarBtn: HTMLButtonElement;
let growBtn: HTMLButtonElement, shrinkBtn: HTMLButtonElement, addSigBtn: HTMLButtonElement, addStampBtn: HTMLButtonElement, addDateBtn: HTMLButtonElement, addTextBtn: HTMLButtonElement;
let dateEditBtn: HTMLButtonElement, dateSep: HTMLElement, textEditBtn: HTMLButtonElement;
let beforeBtn: HTMLButtonElement, afterBtn: HTMLButtonElement, posInput: HTMLInputElement, moveBtn: HTMLButtonElement, delPageBtn: HTMLButtonElement, posError: HTMLElement;
/* العرض المصغّر (ج-٢): زرّ التبديل في الرأس، وصليب الأسهم الأربعة (ج-٣) على الصفحة المختارة (عنصر واحد يُنقل إليها) */
let thumbs = false;
let thumbsBtn: HTMLButtonElement | null = null;
let gridCross: HTMLElement;
const GRID_DIRS: readonly GridDir[] = ["up", "prev", "next", "down"]; // ترتيب Tab بترتيب القراءة: الأعلى، ثم → و← من اليمين، ثم الأسفل
const crossBtn = {} as Record<GridDir, HTMLButtonElement>;

function closeViewer() {
  dropEdit(); // ١٧
  vvAbort?.abort(); // ومستمعا visualViewport معه
  vvAbort = null;
  clearHist(); // ١٤: السجلّ لا يبقى بعد الخروج، ولا يُخزَّن
  resetPen(); // ولا أغطية الطمس وخطوطه (ملاحظة أمين ٤): لا يقرؤها شيء بعد الإغلاق، وbuildViewer يعيد ضبطها على كل حال
  thumbs = false;
  thumbsBtn = null;
  app.classList.remove("thumbs");
  for (const p of state.pages) p.task?.cancel();
  observer?.disconnect();
  observer = null;
  state.opts = null;
  state.pages = [];
  state.byUid.clear();
  state.items = [];
  state.selected = null;
  state.picked = null;
  state.changed = state.unsaved = false;
  clearTimeout(turnTimer);
  stale.clear();
  scrollHandle?.destroy(); // ١٢
  scrollHandle = null;
  pinch = null; // ١٨
  fingers.clear();
}

async function buildViewer(o: ViewerOpts) {
  closeViewer();
  state.opts = o;
  // المدموج والممسوح لم يُحفظا بعد: قبل الرسم، فمزامنة السجلّ بعده تحسب مستوى العمل غير المحفوظ فلا تنزل ثم تصعد (مراجعة أمين)
  if (o.mode === "merged" || o.mode === "scan") state.unsaved = true;
  listenViewport();
  if (fullEdit(o.mode)) openHist();
  // في الدمج ✕ في جهة البداية (لمى): يفعل ما يفعله «تم» بلا سؤال، والنصّ المسموع «رجوع إلى الملفات» (هدى) لا يوحي بالحذف
  const finish = async () => { await endEdit(); setPen(false); o.done?.(); };
  const backBtn = o.mode === "merge-edit"
    ? h("button", { class: "icon-btn", type: "button", "aria-label": S.backFiles, "data-test": "close-edit", onclick: () => void finish() }, icon("close"))
    : o.back
    ? h("button", { class: "icon-btn", type: "button", "aria-label": o.back.label, "data-test": "back", onclick: () => o.back!.run(),
      // لمسة الرجوع لا تُغلق الكتابة بـfocusout قبل السؤال: «البقاء» يعيد الحقل نفسه (leaveThen)، و«الخروج» يُسقطه مع العارض
      onpointerdown: () => { if (edit) holdEdit = performance.now(); } }, icon("back"))
    : h("span", { class: "icon-spacer" });
  // في مساري التحرير وحدهما: زرّ العرض المصغّر في جهة النهاية
  thumbsBtn = editable()
    ? h("button", { class: "icon-btn thumbs-toggle", type: "button", "aria-label": S.thumbsToggle, "aria-pressed": "false", "data-test": "thumbs", onclick: () => setThumbs(!thumbs) }, icon("grid")) as HTMLButtonElement
    : null;
  // تدوير الملف كله في الطرف الأقصى من جهة النهاية، وزرّ المصغّر يليه إلى الداخل (§١)
  rotAllBtn = h("button", { class: "icon-btn rot-all", type: "button", "aria-label": S4.rotateAllLabel, "data-test": "rotate-all", onclick: () => turnPages(state.pages, true) }, icon("turn")) as HTMLButtonElement;
  header = h("header", { class: "topbar viewer" }, backBtn, h("h1", { class: "route-title" }, ...withName(o.title, o.titleName)), h("div", { class: "topbar-end" }, thumbsBtn, rotAllBtn));

  // الحبّة (أ): أربعة أزرار نصّية بلا «+» (docs/design-spec-batch4.md §٢). الأربعة بنصوصها الكاملة لا تتّسع في 360–390،
  // فالظاهر كلمة واحدة، والكامل في aria-label (القياس في docs/logs/text-item.md)
  const pillBtn = (test: string, full: string, short: string, run: () => void) =>
    h("button", { class: "btn wash", type: "button", "aria-label": full, "data-test": test, onclick: run }, h("span", {}, short)) as HTMLButtonElement;
  addSigBtn = pillBtn("add-signature", S.addSignature, S4.pillSignature, () => openPicker("signature"));
  addStampBtn = pillBtn("add-stamp", S.addStamp, S4.pillStamp, () => openPicker("stamp"));
  addDateBtn = pillBtn("add-date", S4.addDate, S4.pillDate, () => void placeDate());
  addTextBtn = pillBtn("add-text", S4.addText, S4.pillText, () => (fullEdit(o.mode) ? startNewText() : openTextSheet())); // ١٧: في «تحرير ملف» يُكتب في الصفحة
  foldBtn = h("button", { class: "icon-btn fold", type: "button", "aria-label": S.fold, "data-test": "fold", onclick: () => setFolded(true) }, icon("left")) as HTMLButtonElement;
  pill = h("div", { class: "pill", "data-test": "pill" }, addSigBtn, addStampBtn, addDateBtn, addTextBtn, foldBtn);
  resetPen();
  if (o.marks) { pen.covers = o.marks.covers; pen.hls = o.marks.hls; pen.inks = o.marks.inks; } // الدمج: علامات كل ملف تبقى معه، ويحرقها الملف المدموج
  tab = h("button", { class: "pill-tab", type: "button", "aria-label": S.unfold, "data-test": "unfold", onclick: () => setFolded(false) }, icon("right")) as HTMLButtonElement;

  list = h("div", { class: "pages" }, o.fileLabel ? h("p", { class: "file-name", dir: "rtl" }, h("bdi", {}, o.fileLabel)) : null);
  state.pages = o.pages.map((ref) => makePage(ref));
  for (const p of state.pages) { state.byUid.set(p.ref.uid, p); list.append(p.wrap); }
  renumber();

  growBtn = h("button", { class: "", type: "button", "aria-label": S.enlarge, "data-test": "grow" }, icon("plus")) as HTMLButtonElement;
  shrinkBtn = h("button", { type: "button", "aria-label": S.shrink, "data-test": "shrink" }, icon("minus")) as HTMLButtonElement;
  const delBtn = h("button", { class: "del", type: "button", "aria-label": S.remove, "data-test": "delete", onclick: () => removeSelected() }, icon("trash"));
  const press = { start: () => { if (state.selected) beginItem(state.selected); }, end: () => { if (state.selected) commitItem(state.selected); } }; // ضغطة مستمرة مدخل واحد
  holdRepeat(growBtn, () => scaleSelected(STEP), press);
  holdRepeat(shrinkBtn, () => scaleSelected(1 / STEP), press);
  // للتاريخ وحده (من اليمين): [تغيير التاريخ] | [+] [−] | [🗑]، والصيغة في الورقة وحدها
  dateEditBtn = h("button", { type: "button", "aria-label": S4.changeDate, "data-test": "date-edit", onclick: () => openDateSheet() }, icon("calendar")) as HTMLButtonElement;
  dateSep = h("span", { class: "sep", "aria-hidden": "true" });
  // وللنصّ: [تعديل النص] | [+] [−] | [🗑]، والفاصل نفسه
  textEditBtn = h("button", { type: "button", "aria-label": S4.editText, "data-test": "text-edit", onclick: () => { const it = state.selected; if (it?.d.text) openTextSheet(it); } }, icon("pen")) as HTMLButtonElement;
  selBar = h("div", { class: "sel-bar", hidden: true, "data-test": "sel-bar" }, dateEditBtn, textEditBtn, dateSep, growBtn, shrinkBtn, h("span", { class: "sep", "aria-hidden": "true" }), delBtn);

  // شريط الصفحة: في موضع شريط التحديد، ولا يظهران معاً
  beforeBtn = h("button", { type: "button", "data-test": "page-before", onclick: () => movePicked(-1) }, icon("up"), h("span", {}, S.before)) as HTMLButtonElement;
  afterBtn = h("button", { type: "button", "data-test": "page-after", onclick: () => movePicked(1) }, icon("down"), h("span", {}, S.after)) as HTMLButtonElement;
  // صليب (ج-٣) على الصفحة المختارة في المصغّر: ↑ و↓ صفّ، و→ السابقة و← التالية، والسحب من أيّ سهم
  const isOff = (b: HTMLButtonElement) => b.getAttribute("aria-disabled") === "true";
  /** التركيز على السهم نفسه إن بقي فعّالاً، وإلا على أول سهم فعّال (السهم المقابل أولاً). */
  const focusArrow = (d: GridDir) => {
    const opposite: Record<GridDir, GridDir> = { up: "down", down: "up", prev: "next", next: "prev" };
    ([d, opposite[d], ...GRID_DIRS].map((k) => crossBtn[k]).find((b) => !isOff(b)) ?? crossBtn[d]).focus();
  };
  let lastArrow: GridDir = "next";
  const arrowRot: Record<GridDir, string> = { up: "", down: "rotate(180deg)", prev: "rotate(90deg)", next: "rotate(-90deg)" };
  for (const d of GRID_DIRS) {
    const b = h("button", {
      type: "button", class: d, "data-test": `col-${d}`,
      onclick: () => {
        if (isOff(b) || !state.picked) return;
        const n = state.pages.length, t = gridTarget(state.pages.indexOf(state.picked), n, d, thumbCols);
        if (t !== null) moveTo(state.picked, t);
        focusArrow(d);
      },
    }, icon("up")) as HTMLButtonElement;
    const svgEl = b.querySelector("svg");
    if (svgEl && arrowRot[d]) svgEl.style.transform = arrowRot[d]; // الأيقونة نفسها مُدارة بحسب السهم، ولا تُعكس مع RTL
    b.addEventListener("pointerdown", () => (lastArrow = d));
    crossBtn[d] = b;
    attachReorder({
      handle: b, axis: "xy", zone: 96, lift: 1.04,
      elements: () => state.pages.map((p) => p.wrap),
      index: () => state.pages.indexOf(state.picked!),
      canDrag: () => thumbs && !!state.picked && state.pages.length > 1 && !state.saving,
      band: () => ({ top: header.getBoundingClientRect().bottom, bottom: barTopOr(pageBar) }),
      onStart: () => { updatePageBar(); updateSaveState(); },
      onLive: (from, to) => state.pages.forEach((p, i) => (p.badge.textContent = ar(liveIndex(i, from, to) + 1))),
      onDrop: (_from, to) => { if (state.saving || !state.picked) return; moveTo(state.picked, to, false); },
      onEnd: () => { updatePageBar(); updateSaveState(); focusArrow(lastArrow); },
    });
  }
  gridCross = h("div", { class: "page-cross", role: "group", "data-test": "page-col" }, ...GRID_DIRS.map((d) => crossBtn[d]));
  posInput = h("input", { id: "page-pos", class: "pos", type: "text", inputmode: "numeric", enterkeyhint: "go", autocomplete: "off", "aria-describedby": "page-pos-err", "data-test": "page-pos" }) as HTMLInputElement;
  moveBtn = h("button", { type: "button", "aria-label": S.moveLabel, "data-test": "page-move", onclick: () => moveToTyped() }, S.moveBtn) as HTMLButtonElement;
  delPageBtn = h("button", { class: "del", type: "button", "data-test": "page-delete", onclick: () => deletePicked() }, icon("trash"), h("span", {}, S.deletePage)) as HTMLButtonElement;
  posError = h("p", { class: "pos-error", id: "page-pos-err", role: "alert", hidden: true });
  posInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); moveToTyped(); } });
  posInput.addEventListener("focus", () => posInput.select());
  // في المصغّر يختفي زرّ زاوية المختارة (يتداخل مع ↑ في الصليب)، فيظهر هنا بعد «انقل» وفاصل (§١)
  rotBarBtn = h("button", { class: "rot-only", type: "button", "data-test": "page-bar-rotate", onclick: () => { if (state.picked) turnPages([state.picked]); } }, icon("turn")) as HTMLButtonElement;
  pageBar = h("div", { class: "page-bar", hidden: true, "data-test": "page-bar" },
    h("div", { class: "row" }, beforeBtn, afterBtn, h("span", { class: "sep", "aria-hidden": "true" }), delPageBtn),
    h("div", { class: "row" }, h("label", { for: "page-pos" }, S.position), posInput, moveBtn, h("span", { class: "sep rot-only", "aria-hidden": "true" }), rotBarBtn),
    posError);

  if (fullEdit(o.mode)) buildPen(pillBtn);
  if (o.mode === "merge-edit") {
    saveHint = h("p", { class: "save-hint", hidden: true });
    saveBtn = h("button", { class: "btn primary block", type: "button", "data-test": "done-edit", onclick: () => void finish() }, S.done) as HTMLButtonElement;
  } else {
    saveHint = h("p", { class: "save-hint" }, o.mode === "edit" ? S.editFirst : S.placeFirst);
    saveBtn = h("button", { class: "btn primary block", type: "button", "data-test": "save", onclick: () => void savePdf() }, S.save) as HTMLButtonElement;
  }
  if (fullEdit(o.mode)) { // ١٤: [حفظ] [↶] [↷]، وفي الدمج [تم] [↶] [↷]
    undoBtn = histBtn("undo", "undo");
    redoBtn = histBtn("redo", "redo");
  }
  saveBar = h("footer", { class: "savebar" }, saveHint, undoBtn ? h("div", { class: "save-row" }, saveBtn, undoBtn, redoBtn) : saveBtn);

  const main = h("main", { class: `editor${editable() ? " editable" : ""}${o.mode === "merge-edit" ? " fade-in" : ""}` }, list);
  main.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === main || t === list || t.classList.contains("page-wrap")) { select(null); selectPage(null); }
  });
  const dock = h("div", { class: "dock" }, selBar, pageBar, ...(fullEdit(o.mode) ? [penHint, penTray] : []), saveBar);
  if (fullEdit(o.mode)) attachPen(list);
  app.replaceChildren(header, pill, tab, main, dock);
  // ١٢: مقبض التمرير في «تحرير ملف» وحده، في جذر التطبيق خارج list فلا تراه مستمعات القلم.
  // والمسار من أسفل الشريط العلوي والحبّة (visibleBand) إلى أعلى .dock
  if (fullEdit(o.mode)) {
    scrollHandle = createScrollHandle({
      band: () => ({ top: visibleBand().top, bottom: barTopOr(dock) }),
      always: () => pen.on, // ملحق docs/logs/int2-fixes-lama-spec.md: في القلم ظاهر دائماً
      pages: () => state.pages.map((p) => p.sheet),
      busy: () => !!stroke,
      reduced: reducedMotion,
      watch: [header, pill, dock, list],
    });
    app.append(scrollHandle.el);
    attachPinch(main); // ١٨
  }
  // ارتفاع شريط الحفظ الفعلي (يطول بالتلميح) يضبط مساحة التمرير أسفل الصفحات
  new ResizeObserver(() => main.style.setProperty("--savebar-h", `${saveBar.offsetHeight}px`)).observe(saveBar);
  applyFold();
  layoutPages();
  for (const d of o.items) if (state.byUid.has(d.pageUid)) await addItem(d);
  if (o.marks) for (const p of state.pages) { drawCovers(p); paintMarks(p); } // ما طُمس أو حُدّد أو رُسم في محرّر الملف من قبل
  updateSaveState();

  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = state.pages.find((pg) => pg.sheet === e.target);
      if (!p) continue;
      p.sheet.classList.toggle("near", e.isIntersecting);
      if (e.isIntersecting) void renderPage(p);
      else freePage(p);
    }
  }, { rootMargin: "150% 0px" });
  state.pages.forEach((p) => observer!.observe(p.sheet));
  state.savedTurns = turnKey();
  window.scrollTo(0, 0);
}

const turnIcon = icon("turn"); // يُستنسخ لكل صفحة: تحليل SVG لكلٍّ من ١٢٠٠ صفحة يبطئ الفتح
function makePage(ref: PageRef): PageView {
  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  // الشارة فوق صورة الصفحة وتحت التوقيعات (تُضاف العناصر بعدها)
  const badge = h("span", { class: "page-badge", "aria-hidden": "true", "data-test": "badge" });
  const sheet = h("div", { class: "page" }, canvas, h("span", { class: "spinner small", "aria-hidden": "true" }), badge);
  // خارج الورقة (لا تقصّه حوافّها) وفوق التوقيعات. ولمسه لا يحدّد الصفحة
  const rot = h("button", { class: "page-rot", type: "button", "data-test": "page-rotate", onclick: () => turnPages([pv]) }, turnIcon.cloneNode(true)) as HTMLButtonElement;
  const frame = h("div", { class: "page-frame" }, sheet, rot);
  const wrap = h("section", { class: "page-wrap", role: "group" }, frame);
  const pv: PageView = { ref, wrap, frame, sheet, canvas, badge, rot, rendered: false, task: null, scale: 0 };
  sheet.addEventListener("click", (e) => {
    if (pen.on || (e.target !== sheet && e.target !== canvas)) return; // القلم مفعّل: لا تحديد للصفحة (§٠-٤)
    if (editable()) selectPage(state.picked === pv ? null : pv);
    else select(null);
  });
  return pv;
}

function renumber() {
  const n = state.pages.length;
  state.pages.forEach((p, i) => {
    p.badge.textContent = ar(i + 1);
    p.wrap.setAttribute("aria-label", S.page(i + 1, n)); // سطر «صفحة ١ من ٣» حُذف من الشاشة وبقي اسماً للصفحة
    p.rot.setAttribute("aria-label", S4.rotatePageLabel(i + 1));
    p.sheet.dataset.page = String(i);
  });
}

// عرض الشاشة يُقرأ مرةً في layoutPages (عند البناء وتغيّر المقاس والمصغّر): قراءته لكل صفحة بعد كتابة مقاس
// سابقتها تفرض تخطيطاً كاملاً في كل مرة، فيتجمّد WebKit بما يفوق الخطّي (١٦ ث لفتح ١٢٠٠ صفحة)
let viewWidth = 0;
/** أعمدة الشبكة المصغّرة الفعلية: ثلاثة على الجوال، وبحسب العرض على الكمبيوتر (تُكتب في --thumb-cols). */
let thumbCols = 3;
/** عرض الصفحة على الشاشة: عرض الشاشة ناقصاً 12px من كل جانب. وفي المصغّر ثلث ذلك بعد فجوتين 12px (114px على 390). */
function pageCssWidth() {
  if (WIDE.matches) return thumbs ? 168 : Math.min(viewWidth - 320 - 48, 720);
  const w = Math.min(viewWidth - 24, 900);
  return thumbs ? Math.floor((w - 24) / 3) : w;
}
function pageScale(p: PageView) {
  return pageCssWidth() / viewportSize(p.ref.geom, 1).width;
}
function pageSize(p: PageView) {
  return viewportSize(p.ref.geom, pageScale(p));
}

function layoutPages() {
  viewWidth = document.documentElement.clientWidth;
  // innerWidth لا clientWidth: شريط التمرير التقليدي (15px) يُنقص الثاني فيهبط 1440 إلى 5 أعمدة، والمساحة تتسع لستة
  thumbCols = WIDE.matches ? Math.min(8, Math.floor((innerWidth - 320 - 48 + 12) / 180)) : 3;
  list.style.setProperty("--thumb-cols", String(thumbCols));
  for (const p of state.pages) {
    const { width, height } = pageSize(p);
    p.sheet.style.inlineSize = `${width}px`;
    p.sheet.style.blockSize = `${height}px`;
  }
  for (const it of state.items) positionItem(it);
}

async function renderPage(p: PageView) {
  if (p.rendered || p.task) return;
  const s = pageScale(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const vp = p.ref.proxy.getViewport({ scale: s * dpr, rotation: p.ref.geom.rotate });
  p.canvas.width = Math.floor(vp.width);
  p.canvas.height = Math.floor(vp.height);
  const task = p.ref.proxy.render({ canvas: p.canvas, viewport: vp });
  p.task = task;
  try {
    await task.promise;
    // حُرِّرت الصفحة بعد اكتمال الرسم وقبل هذا السطر: لوحتها صُفّرت، فلا تُعلَّم مرسومة
    if (p.task !== task) return;
    p.rendered = true;
    p.scale = s;
    p.sheet.classList.add("ready");
  } catch { /* أُلغي الرسم */ } finally {
    // مهمة ملغاة تنتهي متأخرة لا تمحو مهمة أحدث بدأت بعدها
    if (p.task === task) p.task = null;
  }
}
function freePage(p: PageView) {
  p.task?.cancel();
  p.task = null;
  // تحرير ذاكرة الصفحات البعيدة (iOS يحدّ ذاكرة اللوحات)، ولو أُلغي رسمها قبل أن يكتمل:
  // اللوحة تأخذ مقاسها الكامل قبل الرسم، فترك الملغاة يبقي ١–١٫٨ GB بعد تمرير سريع
  if (p.canvas.width || p.canvas.height) {
    p.canvas.width = 0;
    p.canvas.height = 0;
  }
  if (!p.rendered) return;
  p.rendered = false;
  p.sheet.classList.remove("ready");
}

/* ───────── تدوير صفحات العارض ───────── */
let turnTimer = 0;
const stale = new Set<PageView>(); // صفحات دُوِّرت ولوحتها مُدارةٌ من رسمٍ سابق، تُعاد بعد السكون
/** يدير صورة اللوحة ربعاً مع العقارب في مكانها، فتُرى الصفحة مُدارةً فوراً إلى أن يُعاد رسمها. */
function turnBitmap(c: HTMLCanvasElement) {
  if (!c.width || !c.height) return;
  const tmp = document.createElement("canvas");
  tmp.width = c.width; tmp.height = c.height;
  tmp.getContext("2d")!.drawImage(c, 0, 0);
  c.width = tmp.height; c.height = tmp.width; // يصفّر اللوحة وحالة سياقها
  const ctx = c.getContext("2d")!;
  ctx.setTransform(0, 1, -1, 0, c.width, 0); // (x, y) إلى (H - y, x)
  ctx.drawImage(tmp, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  tmp.width = tmp.height = 0;
}
/** موضع الإطار في التخطيط (بلا أثر الحركات الجارية) نسبةً إلى الشاشة. */
function layoutBox(p: PageView) {
  const f = p.frame;
  return { cx: f.offsetLeft + f.offsetWidth / 2 - window.scrollX, cy: f.offsetTop + f.offsetHeight / 2 - window.scrollY, w: f.offsetWidth };
}
/**
 * يدوّر صفحات العارض ربعاً مع العقارب (§١): هندستها وما عليها، ثم مقاسها، ثم FLIP دوراني بالمعكوس إلى الصفر،
 * والصفحات التي تزحزحت تنتقل بـFLIP. اللمسات المتلاحقة تُضاف إلى الحركة الجارية (composite: add) فتكمل من موضعها.
 * والقراءات كلها قبل أول كتابة. وإعادة الرسم بعد سكون 300ms.
 */
/** `quarters`: 3 تراجعٌ عن ربع (١٤)، فتدور الحركة عكس العقارب. */
function turnPages(pvs: PageView[], all = false, quarters: 1 | 3 = 1) {
  const o = state.opts;
  if (!o || state.saving || dragging || !pvs.length) return;
  const set = new Set(pvs), vh = window.innerHeight;
  const anchor = all ? currentPage().page : null;
  const shown = state.pages.filter((p) => { const r = p.frame.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
  const before = new Map(shown.map((p) => [p, layoutBox(p)]));
  const a0 = anchor && (before.get(anchor) ?? layoutBox(anchor));
  for (const p of pvs) {
    for (let q = 0; q < quarters; q++) turnRef(p.ref, o.items);
    if (p.task) { p.task.cancel(); p.task = null; stale.add(p); } // رسمٌ جارٍ بالاتجاه القديم
    if (p.rendered) { for (let q = 0; q < quarters; q++) turnBitmap(p.canvas); stale.add(p); }
    drawCovers(p); // الأغطية في فضاء الصفحة الأصلي: تُرسم بهندستها الجديدة
    paintMarks(p); // والتحديد والرسم كذلك
    const { width, height } = pageSize(p);
    p.sheet.style.inlineSize = `${width}px`;
    p.sheet.style.blockSize = `${height}px`;
  }
  for (const it of state.items) if (set.has(state.byUid.get(it.d.pageUid)!)) positionItem(it);
  if (anchor && a0) { const a1 = layoutBox(anchor); window.scrollBy(0, a1.cy - a0.cy); } // الصفحة المرجع تبقى في موضعها من الشاشة
  if (reducedMotion()) {
    for (const p of shown) if (set.has(p)) p.frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  } else {
    const timing: KeyframeAnimationOptions = { duration: 240, easing: "cubic-bezier(.23, 1, .32, 1)", composite: "add" };
    for (const [p, b0] of before) {
      const b1 = layoutBox(p), dx = b0.cx - b1.cx, dy = b0.cy - b1.cy;
      if (set.has(p)) {
        // الجديدة مُدارةً -90° وبمقياس k تطابق القديمة: عرض القديمة على ارتفاع الجديدة (نحو 1.41 في العادي، و161/114 في المصغّر)
        const k = b0.w / p.frame.offsetHeight;
        p.frame.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(${quarters === 3 ? 90 : -90}deg) scale(${k})` }, { transform: "none" }], timing);
      } else if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        p.frame.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing);
      }
    }
  }
  clearTimeout(turnTimer);
  turnTimer = window.setTimeout(() => { for (const p of [...stale]) { stale.delete(p); void refreshPage(p); } }, 300);
  const uids = pvs.map((p) => p.ref.uid), back = () => uids.map((u) => state.byUid.get(u)).filter((p): p is PageView => !!p);
  rec({ label: all ? SU.turnFile : SU.turnPage, undo: () => turnPages(back(), all, 3), redo: () => turnPages(back(), all) });
  placeCol();
  if (state.selected && set.has(state.byUid.get(state.selected.d.pageUid)!)) updateLimits();
  updatePageBar();
  updateSaveState();
  announce(all ? S4.allRotated : S4.pageRotated(state.pages.indexOf(pvs[0]!) + 1));
}
/** إعادة رسم صفحة دُوِّرت: في لوحة جانبية ثم نسخها، فلا تومض الصفحة فارغةً أثناء الرسم. */
async function refreshPage(p: PageView) {
  if (!p.rendered) {
    if (!p.task && p.sheet.classList.contains("near")) void renderPage(p);
    return;
  }
  p.task?.cancel();
  const s = pageScale(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const vp = p.ref.proxy.getViewport({ scale: s * dpr, rotation: p.ref.geom.rotate });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const task = p.ref.proxy.render({ canvas: c, viewport: vp });
  p.task = task;
  try {
    await task.promise;
    if (p.task !== task || !p.rendered) return;
    p.canvas.width = c.width;
    p.canvas.height = c.height;
    p.canvas.getContext("2d")!.drawImage(c, 0, 0);
    p.scale = s;
  } catch { /* أُلغي الرسم */ } finally {
    if (p.task === task) p.task = null;
    c.width = c.height = 0;
  }
}

let resizeTimer = 0, resizeDpr = window.devicePixelRatio || 1;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (!state.opts) return;
    applyFold(); // عبور 1024 في الجلسة نفسها
    layoutPages();
    updatePageBar(); // أهداف ↑ و↓ تتبع عدد الأعمدة
    // تُعاد اللوحة التي تغيّر مقياسها وحدها: تغيّر الارتفاع وحده (انطواء شريط Safari مع النزول، والتكبير، ولوحة المفاتيح)
    // لا يغيّر عرض الصفحة، وكان يحرّر كل المرسوم فتعود الظاهرة بيضاء بدائرة (بلاغ نايف ٢٠٢٦/١١/١٥، docs/logs/page-reload-scroll.md).
    // وذاكرة البعيدة يحرّرها المراقب كما كانت
    const dpr = window.devicePixelRatio || 1, dprMoved = dpr !== resizeDpr;
    resizeDpr = dpr;
    for (const p of state.pages) if (p.rendered && (dprMoved || Math.abs(p.scale - pageScale(p)) > 1e-6)) freePage(p);
    // يعيد المراقب رسم الظاهر
    observer?.disconnect();
    state.pages.forEach((p) => observer!.observe(p.sheet));
  }, 150);
});

/* ───────── الصفحة الظاهرة ───────── */
function visibleBand() {
  const typing = app.classList.contains("tx-typing"); // ١٧: أثناء الكتابة على الجوال الحبّة والشريط السفلي مخفيّان
  const top = (WIDE.matches || folded || thumbs || typing ? header : pill).getBoundingClientRect().bottom; // الحبّة مخفيّة في المصغّر، وعند WIDE في العمود لا فوق الصفحات
  const bottom = typing ? innerHeight : saveBar.getBoundingClientRect().top;
  return { top, bottom };
}
function currentPage(): { page: PageView; cy: number } {
  const band = visibleBand();
  // الصفحة الأكثر ظهوراً من نفسها (صفحة أفقية صغيرة ظاهرة كلّها تغلب جزءاً كبيراً من جارتها)،
  // وعند التساوي الأقرب إلى وسط الشاشة.
  const mid = (band.top + band.bottom) / 2;
  let best = state.pages[0]!, bestF = -1, bestD = Infinity, cy = 0;
  for (const p of state.pages) {
    const r = p.sheet.getBoundingClientRect();
    const t = Math.max(r.top, band.top), b = Math.min(r.bottom, band.bottom);
    const f = Math.max(0, b - t) / r.height;
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (f > bestF + 0.01 || (Math.abs(f - bestF) <= 0.01 && d < bestD)) {
      bestF = f; bestD = d; best = p; cy = (t + b) / 2 - r.top;
    }
  }
  return { page: best, cy };
}

/* ───────── تحديد الصفحة ونقلها وحذفها (التحرير) ───────── */
function selectPage(pv: PageView | null) {
  if (pv) select(null); // شيء واحد محدَّد في كل مرة
  state.picked?.frame.classList.remove("picked");
  state.picked = pv;
  if (!pv) { pageBar.hidden = true; gridCross.remove(); return; }
  pv.frame.classList.add("picked");
  posError.hidden = true;
  posInput.removeAttribute("aria-invalid");
  pageBar.hidden = false;
  placeCol();
  updatePageBar();
  if (thumbs) centerRow(pv); else ensureVisibleEl(pv.sheet);
}
/** الصليب على المختارة وحدها في المصغّر، ولا صليب في العادي ولا مع صفحة واحدة. */
function placeCol() {
  const pv = state.picked;
  if (thumbs && pv && state.pages.length > 1) {
    if (gridCross.parentElement !== pv.frame) pv.frame.append(gridCross);
    // الصفحة الأفقية (نحو 81px): منطقتا ↑↓ تصغران عمودياً فلا تتداخلان مع → و← (44 + 2×44 = 132)
    gridCross.classList.toggle("short", pageSize(pv).height < 132);
  } else gridCross.remove();
}
function updatePageBar() {
  const pv = state.picked;
  if (!pv) return;
  const n = state.pages.length, i = state.pages.indexOf(pv);
  const c = can(i, n);
  const off = state.saving || dragging; // أثناء الحفظ والسحب
  beforeBtn.disabled = !c.before || off;
  afterBtn.disabled = !c.after || off;
  delPageBtn.disabled = !c.remove || off;
  posInput.disabled = moveBtn.disabled = !c.position || off;
  posInput.value = ar(i + 1);
  rotBarBtn.disabled = off;
  rotBarBtn.setAttribute("aria-label", S4.rotatePageLabel(i + 1));
  // «انقل الصفحة ٣ قبل الصفحة ٢»: لا يُولَّد على الأولى والأخيرة، فيبقى اسم الزرّ المعطّل «قبل»/«بعد»
  beforeBtn.setAttribute("aria-label", c.before ? S.pageBeforeLabel(i + 1) : S.before);
  afterBtn.setAttribute("aria-label", c.after ? S.pageAfterLabel(i + 1) : S.after);
  // الصليب (ج-٣): الهدف صفّ كامل لـ↑↓ وخانة لـ→←. والمعطّل بـaria-disabled: يبقى السحب منه ممكناً نحو الاتجاه الآخر
  gridCross.setAttribute("aria-label", S.pageOrderGroup(i + 1));
  for (const d of GRID_DIRS) {
    const b = crossBtn[d], t = gridTarget(i, n, d, thumbCols), back = d === "up" || d === "prev";
    b.setAttribute("aria-label", t === null ? (back ? S.before : S.after) : back ? S.pageBeforeLabel(i + 1, t + 1) : S.pageAfterLabel(i + 1, t + 1));
    if (t === null || state.saving) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
  }
}
/** يمرّر حتى يصير صفّ الصفحة في وسط المساحة الظاهرة (بين الرأس وشريط الصفحة)، فتُرى ومعها ٤ قبلها و٤ بعدها. */
function centerRow(pv: PageView) {
  requestAnimationFrame(() => centerRowNow(pv));
}
function centerRowNow(pv: PageView) {
  const r = pv.frame.getBoundingClientRect();
  const top = header.getBoundingClientRect().bottom;
  const bottom = barTopOr(pageBar.hidden ? saveBar : pageBar);
  window.scrollBy({ top: (r.top + r.bottom) / 2 - (top + bottom) / 2 });
}

/** التبديل بين العرض العادي والمصغّر: الصفحة المرجع (المختارة، وإلا التي في الوسط) تبقى في مكانها من الشاشة. */
function setThumbs(on: boolean) {
  if (on === thumbs || state.saving || !thumbsBtn) return;
  select(null); // تحديد التوقيع يُلغى عند التبديل
  const ref = state.picked ?? currentPage().page;
  const r0 = ref.frame.getBoundingClientRect();
  thumbs = on;
  app.classList.toggle("thumbs", on);
  thumbsBtn.setAttribute("aria-pressed", String(on));
  layoutPages();
  // لوحة رُسمت أصغر من المقاس الجديد تُعاد؛ والأكبر تكفي مصغّرةً بلا وميض
  for (const p of state.pages) if (p.rendered && p.scale < pageScale(p) - 1e-6) freePage(p);
  placeCol();
  const r1 = ref.frame.getBoundingClientRect();
  window.scrollBy(0, (r1.top + r1.bottom) / 2 - (r0.top + r0.bottom) / 2);
  const r2 = ref.frame.getBoundingClientRect();
  if (reducedMotion()) list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  else {
    const k = r0.width / r2.width;
    ref.frame.animate([
      { transformOrigin: "center", transform: `translate(${(r0.left + r0.right - r2.left - r2.right) / 2}px, ${(r0.top + r0.bottom - r2.top - r2.bottom) / 2}px) scale(${k})` },
      { transformOrigin: "center", transform: "none" },
    ], { duration: FLIP_MS, easing: "cubic-bezier(.23, 1, .32, 1)" });
    // الظهور التدريجي للظاهرة وحدها: القراءات كلها قبل أول حركة (كما في moveTo)
    const vh = window.innerHeight;
    const shown = state.pages.filter((p) => { if (p === ref) return false; const r = p.frame.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
    for (const p of shown) p.frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLIP_MS, easing: "ease-out" });
  }
  // يعيد المراقب رسم ما صار ظاهراً
  observer?.disconnect();
  state.pages.forEach((p) => observer!.observe(p.sheet));
}
/** يحفظ الترتيب في قائمة المسار نفسها (ملف الدمج يرى التغيير). */
function syncRefs() {
  const o = state.opts!;
  o.pages.splice(0, o.pages.length, ...state.pages.map((p) => p.ref));
}
function movePicked(step: number) {
  const pv = state.picked;
  if (pv) moveTo(pv, state.pages.indexOf(pv) + step);
}
function moveToTyped() {
  const pv = state.picked;
  if (!pv) return;
  const n = state.pages.length;
  const p = parsePosition(posInput.value, n);
  if (p === null) {
    posError.textContent = rangeError(n);
    posError.hidden = false;
    posInput.setAttribute("aria-invalid", "true");
    posInput.focus();
    return;
  }
  posError.hidden = true;
  posInput.removeAttribute("aria-invalid");
  moveTo(pv, p - 1);
}
/** `animate = false` بعد إفلات السحب: الصفحات استقرّت في خاناتها، فيُثبَّت الترتيب بلا تمرير ولا حركة. */
function moveTo(pv: PageView, to: number, animate = true) {
  const from = state.pages.indexOf(pv), n = state.pages.length;
  if (to < 0 || to >= n || to === from) { updatePageBar(); return; }
  const first = new Map(state.pages.map((p) => [p, p.wrap.getBoundingClientRect()]));
  state.pages = move(state.pages, from, to);
  syncRefs();
  for (const p of state.pages) list.append(p.wrap);
  renumber();
  if (animate) {
    // يتبعها التمرير، ثم FLIP: كل صفحة تبدأ من موضعها السابق على الشاشة (على المحورين في الشبكة)
    if (thumbs) centerRowNow(pv); else pv.wrap.scrollIntoView({ block: "center" });
    if (!reducedMotion()) {
      // القراءات كلها أولاً ثم الحركات: حركةٌ تبدأ بين قراءتين تفرض إعادة حساب الأنماط للصفحات كلها
      // في القراءة التالية (٦ ث لنقل صفحة في ١٢٠٠). والحركة للظاهرة وحدها، قبل النقل أو بعده
      const vh = window.innerHeight, seen = (r: DOMRect) => r.bottom > 0 && r.top < vh;
      const moves: [PageView, number, number][] = [];
      for (const p of state.pages) {
        const a = first.get(p)!, b = p.wrap.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if ((Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) && (seen(a) || seen(b))) moves.push([p, dx, dy]);
      }
      for (const [p, dx, dy] of moves) p.wrap.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: "cubic-bezier(.23, 1, .32, 1)" });
    }
  }
  markChanged();
  updatePageBar();
  announce(S.pageMoved(to + 1, n));
  const uid = pv.ref.uid, at = (i: number) => () => { const p = state.byUid.get(uid); if (p) moveTo(p, i); };
  rec({ label: SU.movePage, undo: at(from), redo: at(to) });
}
function deletePicked() {
  const pv = state.picked;
  if (!pv) return;
  if (state.pages.length <= 1) return;
  void askDelete(S.dialogs.deletePageTitle(state.pages.indexOf(pv) + 1), delPageBtn).then((yes) => {
    const i = state.pages.indexOf(pv);
    if (!yes || i < 0 || state.pages.length <= 1) return; // الشاشة تغيّرت تحت السؤال
    selectPage(null);
    const gone = dropPage(pv);
    markChanged();
    announce(S.pageDeleted(i + 1, state.pages.length));
    rec({ label: SU.deletePage, undo: () => restorePage(pv, i, gone), redo: () => { if (state.picked === pv) selectPage(null); dropPage(pv); } });
    state.pages[Math.min(i, state.pages.length - 1)]?.rot.focus({ preventScroll: true }); // شريط الصفحة اختفى بزرّه: التركيز على الصفحة التي حلّت محلّها لا body
  });
}
/** يحذف الصفحة وما وُضع عليها، ويعيد ما حذفه منها بمواضعه في القائمة (للتراجع، ١٤). */
function dropPage(pv: PageView): { it: Placed; at: number }[] {
  const i = state.pages.indexOf(pv), all = state.opts!.items;
  const gone = state.items.filter((it) => it.d.pageUid === pv.ref.uid).map((it) => ({ it, at: all.indexOf(it.d) }));
  if (state.selected && gone.some((g) => g.it === state.selected)) select(null);
  // ما على الصفحة يُحذف معها
  pruneItems(all, new Set([pv.ref.uid]));
  state.items = state.items.filter((it) => it.d.pageUid !== pv.ref.uid);
  pv.task?.cancel();
  observer?.unobserve(pv.sheet);
  pv.wrap.remove();
  state.pages = remove(state.pages, i);
  state.byUid.delete(pv.ref.uid);
  syncRefs();
  renumber();
  return gone;
}
/** ١٤: الصفحة في موضعها ومعها ما كان عليها (العناصر داخل ورقتها لم تُنزع منها). */
function restorePage(pv: PageView, i: number, gone: { it: Placed; at: number }[]) {
  const next = state.pages[i];
  state.pages = [...state.pages.slice(0, i), pv, ...state.pages.slice(i)];
  state.byUid.set(pv.ref.uid, pv);
  if (next) next.wrap.before(pv.wrap); else list.append(pv.wrap);
  observer?.observe(pv.sheet);
  syncRefs();
  renumber();
  const all = state.opts!.items;
  for (const g of [...gone].sort((a, b) => a.at - b.at)) all.splice(Math.min(g.at, all.length), 0, g.it.d);
  state.items.push(...gone.map((g) => g.it));
  sortItems();
  layoutPages(); // تغيّر المقاس أو المصغّر بعد الحذف
  pv.wrap.scrollIntoView({ block: "center" });
}

/* ───────── العناصر الموضوعة ───────── */
function rectOf(it: Placed): Rect {
  const p = state.byUid.get(it.d.pageUid)!;
  const { width: W, height: H } = pageSize(p);
  return { x: it.d.fx * W, y: it.d.fy * H, w: it.d.fw * W, h: it.d.fh * H };
}
function setRect(it: Placed, r: Rect) {
  const p = state.byUid.get(it.d.pageUid)!;
  const { width: W, height: H } = pageSize(p);
  it.d.fx = r.x / W; it.d.fy = r.y / H; it.d.fw = r.w / W; it.d.fh = r.h / H;
  positionItem(it);
}
function positionItem(it: Placed) {
  const r = rectOf(it);
  it.el.style.inlineSize = `${r.w}px`;
  it.el.style.blockSize = `${r.h}px`;
  it.el.style.transform = `translate(${r.x}px, ${r.y}px)`;
  // الصورة مُدارةً مع صفحتها: في الربع والثلاثة أرباع عرضها ارتفاع الصندوق
  const t = it.d.turn ?? 0, img = it.el.querySelector("img") as HTMLElement;
  img.style.inlineSize = t % 180 ? `${r.h}px` : "";
  img.style.blockSize = t % 180 ? `${r.w}px` : "";
  img.style.rotate = t ? `${t}deg` : "";
  if (state.selected === it) { if (edit?.it === it) layoutEdit(); placeFbar(); } // ١٧: يتبع السحب والقرص والتراجع 1:1
}
function pageSizeOf(it: Placed) {
  return pageSize(state.byUid.get(it.d.pageUid)!);
}

const itemLabel = (d: ItemData) => d.kind === "signature" ? S.signature : d.kind === "stamp" ? S.stamp : d.kind === "text" ? S4.textLabel(labelText(d.text?.text ?? "")) : S4.dateLabel(dateText(d));
/** يبني عنصر الشاشة لتوقيع أو ختم موضوع (من المحفوظ في الجلسة أو جديد). */
async function addItem(d: ItemData, isNew = false): Promise<Placed | null> {
  const asset = await assetOf(d.assetId);
  if (!asset || !state.byUid.has(d.pageUid)) return null; // أُغلق العارض أو حُذفت الصفحة أثناء الانتظار
  const img = h("img", { src: assetUrl(asset), alt: "", draggable: "false" });
  const el = h("div", {
    class: `item${isNew ? " enter" : ""}`, tabindex: 0, role: "button",
    "aria-label": itemLabel(d),
    "data-test": "item", "data-kind": d.kind,
  }, img);
  const it: Placed = { d, el };
  state.byUid.get(d.pageUid)!.sheet.append(el);
  positionItem(it);
  state.items.push(it);
  attachDrag(it);
  return it;
}

async function placeAsset(asset: Asset) {
  const { page, cy } = currentPage();
  const { width: W, height: H } = pageSize(page);
  const rect = initialRect(asset.kind, asset.w / asset.h, W, H, W / 2, cy);
  await placeItem({ id: crypto.randomUUID(), assetId: asset.id, kind: asset.kind, pageUid: page.ref.uid, fx: rect.x / W, fy: rect.y / H, fw: rect.w / W, fh: rect.h / H });
}
/** `record = false`: النصّ الجديد في «تحرير ملف» (١٧) يُقيَّد عند إغلاق جلسته (`recAdd`)، ويُحذف بلا مدخل إن بقي فارغاً. */
async function placeItem(d: ItemData, record = true): Promise<Placed | null> {
  state.opts!.items.push(d);
  const it = await addItem(d, true);
  if (!it) return null;
  select(it);
  markChanged();
  requestAnimationFrame(() => it.el.classList.remove("enter"));
  if (record) recAdd(it);
  return it;
}
function recAdd(it: Placed) {
  const d = it.d, snap = snapOf(d), at = state.opts!.items.indexOf(d);
  rec({ label: SU.add[d.kind], undo: () => dropItem(d.id), redo: () => restoreItem(snap, at) });
}

/**
 * صور لا تُحفظ في المخزن أو لم تُحفظ: صورة التاريخ، وتوقيع مرسوم تعذّر حفظه في المحفوظ.
 * تبقى في الذاكرة طوال الجلسة، فتُعرض وتُحفظ في الملف كالمحفوظ.
 */
type Img = Pick<Asset, "id" | "png" | "w" | "h"> & { font?: number }; // `font`: حجم خطّ صورة النصّ (يختلف بطوله)
const memAssets = new Map<string, Img>();
async function assetOf(id: string): Promise<Img | undefined> {
  return memAssets.get(id) ?? (await getAsset(id));
}

function assetUrl(a: Img) {
  let u = state.urls.get(a.id);
  if (!u) { u = URL.createObjectURL(new Blob([a.png], { type: "image/png" })); state.urls.set(a.id, u); }
  return u;
}

function attachDrag(it: Placed) {
  const el = it.el;
  let start: { px: number; py: number; x: number; y: number } | null = null;
  let tap: { t: number; x: number; y: number; again: boolean; touch: boolean } | null = null; // ١٧: ضغطة ثانية على نصّ محدَّد تفتح تحريره
  let tapEdit = false;
  el.addEventListener("pointerdown", (e) => {
    if (state.saving || e.button > 0 || pinch) return; // ١٨: الإصبع الثاني في القرص لا يبدأ سحباً
    e.preventDefault();
    tap = { t: e.timeStamp, x: e.clientX, y: e.clientY, again: state.selected === it && !edit, touch: e.pointerType !== "mouse" };
    select(it);
    el.setPointerCapture(e.pointerId);
    const r = rectOf(it);
    start = { px: e.clientX, py: e.clientY, x: r.x, y: r.y };
    beginItem(it); // من الضغط إلى الرفع مدخل واحد
    scrollHandle?.mute(true); // ١٢: يختفي المقبض أثناء سحب العنصر
  });
  el.addEventListener("pointermove", (e) => {
    if (pinch) start = null; // ١٨: نزل الثاني فصار السحب قرصاً من موضعه الحالي، ولا يعود سحباً بعده
    if (!start) return;
    const { width: W, height: H } = pageSizeOf(it);
    setRect(it, moveRect(rectOf(it), start.x + e.clientX - start.px, start.y + e.clientY - start.py, W, H));
    if (fbar && Math.hypot(e.clientX - start.px, e.clientY - start.py) >= TAP_PX) fbar.el.classList.add("moving"); // ١٧: يُخفى أثناء السحب ويظهر عند الرفع
  });
  const end = () => { scrollHandle?.mute(false); fbar?.el.classList.remove("moving"); if (start) { start = null; markChanged(); ensureVisible(it); commitItem(it); } };
  el.addEventListener("pointerup", (e) => {
    const t = tap;
    tap = null;
    end();
    // باللمس: رفعٌ قبل 300ms بلا حركة على نصّ كان محدَّداً. والفأرة بالنقر المزدوج
    // ويُفتح في click لا هنا: بعد الرفع يأتي تركيز المتصفح للعنصر فيُغلق حقلاً فُتح قبله (وclick ضغطة مستخدم يقبلها iOS للتركيز)
    tapEdit = !!(t?.again && t.touch && editsInPlace(it) && e.timeStamp - t.t < 300 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < TAP_PX);
    if (tapEdit) setTimeout(() => { if (tapEdit) { tapEdit = false; beginEdit(it); } }, 0); // لمسٌ بلا click بعده (WebKit بلا محاكاة الجوال)
  });
  el.addEventListener("click", () => { if (tapEdit) { tapEdit = false; beginEdit(it); } });
  el.addEventListener("pointercancel", () => { tap = null; end(); });
  if (editsInPlace(it)) {
    el.addEventListener("dblclick", () => beginEdit(it));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); beginEdit(it); }
      else if (e.key === "Escape" && state.selected === it) { e.preventDefault(); select(null); }
      else if (e.key === "Tab" && !e.shiftKey && fbar?.on) { e.preventDefault(); fbarFocus(); } // من العنصر إلى «تنسيق النص»
    });
  }
  if (fullEdit()) attachResize(it); // ١٨: مقابض الزوايا وCtrl مع العجلة و+ و-
  // بديل السحب بلوحة المفاتيح: الأسهم تنقل العنصر
  el.addEventListener("keydown", (e) => {
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    select(it);
    const { width: W, height: H } = pageSizeOf(it);
    const r = rectOf(it), k = e.shiftKey ? 20 : 4, b = snapOf(it.d);
    setRect(it, moveRect(r, r.x + d[0]! * k, r.y + d[1]! * k, W, H));
    markChanged();
    recItem(b, it, `move:${it.d.id}`); // المتتالية تُدمج ما لم يفصلها أكثر من 600ms
  });
  el.addEventListener("focus", () => select(it));
}

function select(it: Placed | null) {
  if (edit && edit.it !== it) void endEdit(); // ١٧
  if (it) selectPage(null); // شيء واحد محدَّد في كل مرة
  if (state.selected && state.selected !== it) state.selected.el.classList.remove("sel");
  state.selected = it;
  if (pinch && pinch.it !== it) pinch = null; // حُذف العنصر أو تغيّر التحديد أثناء القرص
  if (it) {
    it.el.classList.add("sel");
    const isDate = it.d.kind === "date", isText = it.d.kind === "text";
    dateEditBtn.hidden = !isDate;
    const inFbar = isText && fullEdit(); // ١٧: «تعديل النص» في الشريط العائم لا هنا
    textEditBtn.hidden = !isText || inFbar;
    dateSep.hidden = !isDate && (!isText || inFbar);
    selBar.hidden = false;
    updateLimits();
    ensureVisible(it);
  } else {
    selBar.hidden = true;
  }
  placeFbar();
}

function updateLimits() {
  const it = state.selected;
  if (!it) return;
  const { width: W, height: H } = pageSizeOf(it);
  const l = limits(rectOf(it), W, H);
  growBtn.disabled = !l.canGrow;
  shrinkBtn.disabled = !l.canShrink;
}

function scaleSelected(f: number): boolean {
  const it = state.selected;
  if (!it) return false;
  const { width: W, height: H } = pageSizeOf(it);
  const res = scaleRect(rectOf(it), f, W, H);
  setRect(it, res.rect);
  updateLimits();
  ensureVisible(it);
  markChanged();
  return f > 1 ? res.canGrow : res.canShrink;
}

/** الضغط المستمرّ يكرّر كل 120ms بعد 400ms، ويقف عند الحدّ. */
function holdRepeat(btn: HTMLButtonElement, step: () => boolean, edge?: { start(): void; end(): void }) {
  let t1 = 0, t2 = 0, on = false;
  const stop = () => { clearTimeout(t1); clearInterval(t2); if (on) { on = false; edge?.end(); } };
  btn.addEventListener("pointerdown", (e) => {
    if (btn.disabled || e.button > 0) return;
    e.preventDefault();
    on = true;
    edge?.start();
    if (!step()) { stop(); return; }
    t1 = window.setTimeout(() => {
      t2 = window.setInterval(() => { if (!step()) stop(); }, 120);
    }, 400);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
  btn.addEventListener("click", (e) => { if (e.detail === 0) { edge?.start(); step(); edge?.end(); } }); // لوحة المفاتيح
}

/* ───────── ١٢ و١٨: مقبض التمرير، والقرص لكل عنصر (docs/logs/additions-12-15-18-lama-spec.md) ───────── */
let scrollHandle: ScrollHandle | null = null;
/** القرص الجاري: إطار العنصر وبُعد الإصبعين ومنتصفهما عند نزول الثاني. */
let pinch: { it: Placed; r0: Rect; d0: number; m0: Pt } | null = null;
const fingers = new Map<number, Pt>();
const two = () => { const [a, b] = [...fingers.values()] as [Pt, Pt]; return { d: Math.hypot(b.x - a.x, b.y - a.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, b }; };
/** إصبعان على العنصر المحدَّد أو في هامش 24px حوله يكبّرانه ويصغّرانه 1:1، وإلا يبقيان للصفحة. وضع القلم بلا تحديد، فلا تعارض. */
function attachPinch(host: HTMLElement) {
  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || pen.on || state.saving) return;
    if (e.isPrimary) fingers.clear(); // أول لمسة جديدة: لا أصابع غيرها على الشاشة، فما بقي شبحٌ فاته الرفع
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const it = state.selected;
    if (fingers.size !== 2 || pinch || !it) return;
    const r = it.el.getBoundingClientRect(), g = two();
    if (!pinchHitsItem({ x: r.left, y: r.top, w: r.width, h: r.height }, g.a, g.b)) return;
    e.preventDefault();
    e.stopPropagation(); // لا يبدأ الإصبع الثاني سحباً ولا تحديد صفحة
    pinch = { it, r0: rectOf(it), d0: g.d, m0: g.m };
    beginItem(it, true); // سحبٌ صار قرصاً: من أول الضغط إلى رفع الإصبعين مدخل واحد
  }, true);
  host.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || fingers.size < 2) return;
    e.preventDefault();
    const g = two(), { width: W, height: H } = pageSizeOf(pinch.it);
    setRect(pinch.it, pinchRect(pinch.r0, pinch.d0, g.d, pinch.m0, g.m, W, H).rect); // عند الحدّين يقف بلا ارتداد
    updateLimits();
  }, true);
  const up = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId) || !pinch) return;
    if (fingers.size >= 2) { rebase(); return; }
    const it = pinch.it;
    pinch = null;
    markChanged(); // مرة عند رفع الإصبعين
    ensureVisible(it);
    commitItem(it);
  };
  const rebase = () => { // رُفع إصبع من ثلاثة فصار الزوج غير الأصليّ: يبدأ القرص من الحال الراهنة فلا قفزة
    if (!pinch) return;
    const g = two();
    pinch = { it: pinch.it, r0: rectOf(pinch.it), d0: g.d, m0: g.m };
  };
  const forget = () => { fingers.clear(); if (pinch) { const it = pinch.it; pinch = null; markChanged(); commitItem(it); } }; // غابت النافذة: الرفع لن يصل
  document.addEventListener("visibilitychange", () => { if (document.hidden) forget(); });
  window.addEventListener("blur", forget);
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", up, true);
}

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];
/** مقابض الزوايا للفأرة (تظهر تحت hover: hover وpointer: fine في style.css)، وCtrl مع العجلة، و+ و= و- والعنصر مركَّز. */
function attachResize(it: Placed) {
  const el = it.el;
  for (const c of CORNERS) {
    const k = h("span", { class: `corner ${c}`, "aria-hidden": "true", "data-test": `corner-${c}` });
    el.append(k);
    let g: { r0: Rect; px: number; py: number; cx: number; cy: number } | null = null;
    k.addEventListener("pointerdown", (e) => {
      if (state.saving || e.button > 0 || e.pointerType === "touch") return;
      e.preventDefault();
      e.stopPropagation();
      select(it);
      try { k.setPointerCapture(e.pointerId); } catch { /* */ }
      beginItem(it);
      const r0 = rectOf(it);
      g = { r0, px: e.clientX, py: e.clientY, cx: c[1] === "w" ? r0.x : r0.x + r0.w, cy: c[0] === "n" ? r0.y : r0.y + r0.h };
    });
    k.addEventListener("pointermove", (e) => {
      if (!g) return;
      e.stopPropagation();
      const { width: W, height: H } = pageSizeOf(it);
      setRect(it, cornerRect(g.r0, c, { x: g.cx + e.clientX - g.px, y: g.cy + e.clientY - g.py }, W, H)); // الزاوية المقابلة ثابتة
      updateLimits();
    });
    const end = (e: PointerEvent) => { if (!g) return; e.stopPropagation(); g = null; markChanged(); ensureVisible(it); commitItem(it); };
    k.addEventListener("pointerup", end);
    k.addEventListener("pointercancel", end);
  }
  // Ctrl مع العجلة فوق العنصر المحدَّد (وهو أيضاً قرص لوحة اللمس): خطوة العجلة STEP، ودفعات لوحة اللمس الصغيرة بقدرها
  el.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || state.selected !== it || state.saving) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    if (!dy) return;
    const b = snapOf(it.d);
    scaleSelected(Math.min(STEP, Math.max(1 / STEP, Math.exp(-dy / 100))));
    recItem(b, it, `scale:${it.d.id}`); // دفعات العجلة المتتالية مدخل واحد
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl و+ تكبير المتصفح
    const f = e.key === "+" || e.key === "=" ? STEP : e.key === "-" ? 1 / STEP : 0;
    if (!f) return;
    e.preventDefault();
    select(it);
    const b = snapOf(it.d);
    scaleSelected(f);
    recItem(b, it);
  });
}

function removeSelected() {
  if (editBusy) { void editEnd.then(() => removeSelected()); return; } // ١٧: إغلاق الجلسة يُقيَّد قبل الحذف
  const it = state.selected;
  if (!it) return;
  select(null);
  it.el.classList.add("leave");
  setTimeout(() => it.el.remove(), 120);
  state.items = state.items.filter((x) => x !== it);
  const all = state.opts!.items, i = all.indexOf(it.d);
  if (i >= 0) all.splice(i, 1);
  markChanged();
  const snap = snapOf(it.d);
  rec({ label: SU.del(it.d.kind), undo: () => restoreItem(snap, i), redo: () => dropItem(snap.id) });
}

/** ألّا يغطّي شريطُ التحديد العنصرَ، ولا يختفي تحت الشريط العلوي. */
function ensureVisible(it: Placed) {
  ensureVisibleEl(it.el);
}
function ensureVisibleEl(el: HTMLElement) {
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const bar = !pageBar.hidden ? pageBar : !selBar.hidden ? selBar : saveBar;
    const barTop = WIDE.matches ? innerHeight : bar.getBoundingClientRect().top; // على الكمبيوتر الشريط في العمود لا فوق الصفحة
    const top = visibleBand().top;
    if (r.height > barTop - top) return; // أطول من المساحة (صفحة كاملة): لا يُمرَّر
    if (r.bottom > barTop - 8) window.scrollBy({ top: r.bottom - (barTop - 8) });
    else if (r.top < top + 8) window.scrollBy({ top: r.top - (top + 8) });
  });
}

function markChanged() {
  state.changed = true;
  state.unsaved = true;
  updateSaveState();
}
let navRefresh = () => {}; // src/nav.ts: حالة العمل غير المحفوظ في السجلّ تتبع هذا التغيّر
function updateSaveState() {
  navRefresh();
  syncHist();
  const mode = state.opts?.mode;
  if (mode === "merge-edit") return;
  const t = turned(state.pages.map((p) => p.ref));
  const can = mode === "sign" ? state.items.length > 0 || t : mode === "edit" ? state.changed || t : true;
  saveBtn.disabled = !can || state.saving || dragging; // أثناء السحب يُحفظ الترتيب القديم
  saveHint.hidden = can;
}

/* ───────── ١٤: التراجع والإعادة في «تحرير ملف» وحدها (docs/logs/additions-14-17-lama-spec.md §١٤) ───────── */
let hist: History | null = null;
let replaying = false; // التطبيق من السجلّ لا يُقيَّد
let cleanChanged = false; // state.changed عند نقطة الحفظ: عند الفتح لا تعديل، فيتعطّل «حفظ الملف» إن رجع إليها
let penFloor = 0; // عمق السجلّ لحظة دخول القلم
const retained = new Set<string>(); // صور نصّ وتاريخ يشير إليها السجلّ: لا تُحذف حتى يُمسح
let undoBtn: HTMLButtonElement | null = null, redoBtn: HTMLButtonElement | null = null;
/** مقفلان من بدء إشعار الطمس حتى تُغلق ورقته: الأغطية تُلتقط في أوله، فلا يُحفظ غير ما يُرى (ملاحظة أمين ١). */
let histLock = false;
function lockHist(v: boolean) { histLock = v; syncHist(); }
/** يزيد مع كل مسح للسجلّ: ما صُفّ قبله لا يُنفَّذ بعده (ملاحظة أمين ٣). */
let histGen = 0;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function openHist() {
  hist = createHistory({
    limit: 100,
    onChange: (ev) => {
      if (ev === "undo" || ev === "redo") {
        const c = hist!.isClean();
        state.unsaved = !c;
        state.changed = c ? cleanChanged : true;
      }
      updateSaveState();
    },
  });
  cleanChanged = false;
  penFloor = 0;
}
function clearHist() {
  if (!hist) return;
  histGen++;
  histLock = false;
  hist.clear();
  hist = null;
  const used = new Set(state.opts?.items.map((d) => d.assetId));
  for (const id of retained) if (!used.has(id)) releaseImg(id);
  retained.clear();
  gesture.clear();
  undoBtn = redoBtn = penRedoBtn = null;
}
/** يقيّد مدخلاً، إلا خارج «تحرير ملف» وأثناء التطبيق من السجلّ. */
function rec(e: Entry) {
  if (!hist || replaying) return;
  // replaying في الجزء المتزامن وحده: فعلٌ يأتي من المستخدم وتراجعٌ ينتظر (getAsset) يُقيَّد ولا يسقط (ملاحظة أمين ٢)
  const gen = histGen;
  const wrap = (f: () => void | Promise<void>) => async () => {
    if (gen !== histGen) return; // مُسح السجلّ (خروج) قبل أن يأتي دوره
    let p: void | Promise<void>;
    replaying = true;
    try { p = f(); } finally { replaying = false; }
    try { await p; } finally { updateSaveState(); }
  };
  hist.push({ ...e, undo: wrap(e.undo), redo: wrap(e.redo) });
}
const canUndoNow = () => !!hist && !state.saving && !histLock && (pen.on ? hist.depth() > penFloor && hist.canUndo("pen") : hist.canUndo() || !!edit); // ١٧: جلسة تحرير مفتوحة تُغلق ثم يُتراجع عنها
const canRedoNow = () => !!hist && !state.saving && !histLock && hist.canRedo(pen.on ? "pen" : undefined);
function syncHist() {
  const u = !canUndoNow(), r = !canRedoNow();
  for (const b of [undoBtn, hist ? penUndoBtn : null]) if (b) b.disabled = u;
  for (const b of [redoBtn, penRedoBtn]) if (b) b.disabled = r;
}
async function doUndo() {
  if (!canUndoNow()) return;
  await endEdit(); // ١٧: الجلسة مدخل واحد يُقيَّد أولاً
  if (!canUndoNow()) return;
  const e = await hist!.undo(pen.on ? "pen" : undefined);
  if (e) announce(SU.undone(e.label));
}
async function doRedo() {
  if (!canRedoNow()) return;
  await endEdit();
  if (!canRedoNow()) return;
  const e = await hist!.redo(pen.on ? "pen" : undefined);
  if (e) announce(SU.redone(e.label));
}

/** زرّ أيقونة 44×44، يُعكس في RTL، ومعطّل حتى يُقيَّد شيء. وتلميحه على الكمبيوتر وحده. */
function histBtn(kind: "undo" | "redo", test: string, cls = "") {
  const label = kind === "undo" ? SU.undo : SU.redo;
  const ic = icon(kind === "undo" ? "undo2" : "redo2");
  ic.classList.add("ic-hist");
  const b = h("button", {
    class: `hist-btn ${cls}`.trim(), type: "button", disabled: true, "aria-label": label, "data-test": test,
    "aria-keyshortcuts": kind === "undo" ? "Control+Z" : "Control+Y Control+Shift+Z",
    onclick: () => void (kind === "undo" ? doUndo() : doRedo()),
  }, ic) as HTMLButtonElement;
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const keys = kind === "undo" ? SU.keysUndo : SU.keysRedo, id = `tip-${test}`;
    const tip = h("span", { class: "hist-tip", role: "tooltip", id, hidden: true, "data-test": `${test}-tip` }, label, " ", h("kbd", { dir: "ltr" }, isMac ? keys.mac : keys.win));
    b.append(tip);
    b.setAttribute("aria-describedby", id);
    let t = 0;
    const show = () => {
      tip.hidden = false;
      tip.classList.toggle("up", b.getBoundingClientRect().bottom + 48 > innerHeight); // أسفل الشاشة: فوق الزرّ
      requestAnimationFrame(() => tip.classList.add("on"));
    };
    const hide = () => { clearTimeout(t); tip.classList.remove("on"); tip.hidden = true; };
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { clearTimeout(t); t = window.setTimeout(show, 400); } });
    b.addEventListener("pointerleave", hide);
    b.addEventListener("pointerdown", hide);
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) show(); });
    b.addEventListener("blur", hide);
  }
  return b;
}

// الاختصارات بـe.code (KeyZ وKeyY) لا e.key: تعمل مع اللوحة العربية. ولا تعترض حقلاً ولا ورقة مفتوحة
document.addEventListener("keydown", (e) => {
  if (!hist || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const undo = e.code === "KeyZ" && !e.shiftKey, redo = e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey);
  if (!undo && !redo) return;
  const t = e.target as HTMLElement | null;
  if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) return;
  if (document.querySelector("dialog[open]")) return;
  e.preventDefault();
  void (undo ? doUndo() : doRedo());
});

const snapOf = (d: ItemData): ItemData => structuredClone(d);
const sameItem = (a: ItemData, b: ItemData) => JSON.stringify(a) === JSON.stringify(b);
/** ترتيب الحفظ (state.items) وترتيب الطبقات على الورقة كترتيب القائمة. */
function sortItems() {
  const all = state.opts!.items;
  state.items.sort((a, b) => all.indexOf(a.d) - all.indexOf(b.d));
  for (const it of state.items) it.el.parentElement?.append(it.el);
}
/** يطبّق لقطة عنصر بالـid: الإطار والصورة والوصف، ثم يحدّده ويُظهره. */
async function applyItem(s: ItemData) {
  const it = state.items.find((x) => x.d.id === s.id), o = state.opts;
  if (!it) return;
  const old = it.d.assetId;
  for (const k of Object.keys(it.d)) if (!(k in s)) delete (it.d as unknown as Record<string, unknown>)[k];
  Object.assign(it.d, structuredClone(s));
  if (it.d.assetId !== old) { const a = await assetOf(it.d.assetId); if (state.opts !== o) return; if (a) (it.el.querySelector("img") as HTMLImageElement).src = assetUrl(a); }
  it.el.setAttribute("aria-label", itemLabel(it.d));
  positionItem(it);
  select(it);
}
function dropItem(id: string) {
  const it = state.items.find((x) => x.d.id === id);
  if (!it) return;
  if (state.selected === it) select(null);
  it.el.remove();
  state.items = state.items.filter((x) => x !== it);
  const all = state.opts!.items, i = all.indexOf(it.d);
  if (i >= 0) all.splice(i, 1);
}
async function restoreItem(s: ItemData, at: number) {
  const o = state.opts;
  if (!o) return;
  const d = structuredClone(s), all = o.items;
  all.splice(Math.min(at, all.length), 0, d);
  const it = await addItem(d);
  if (!it || state.opts !== o) { all.splice(all.indexOf(d), 1); return; } // خرج المستخدم أثناء الانتظار: لا يُدخَل في ملف آخر
  sortItems();
  select(it);
}
/** لقطة قبل إيماءة (سحب، ضغطة مستمرة، قرص، زاوية) تُقيَّد عند انتهائها إن تغيّر شيء. `keep`: لا تُستبدل لقطة إيماءة جارية. */
const gesture = new Map<string, ItemData>();
function beginItem(it: Placed, keep = false) { if (hist && !(keep && gesture.has(it.d.id))) gesture.set(it.d.id, snapOf(it.d)); }
function commitItem(it: Placed) {
  const b = gesture.get(it.d.id);
  gesture.delete(it.d.id);
  if (b) recItem(b, it);
}
/** نقل أو تكبير أو تصغير، بحسب ما تغيّر من الإطار. */
function recItem(b: ItemData, it: Placed, key?: string) {
  const k = it.d.kind, a = it.d;
  recEdit(b, it, a.fw === b.fw && a.fh === b.fh ? SU.move(k) : a.fw > b.fw ? SU.grow(k) : SU.shrink(k), key);
}
function recEdit(b: ItemData, it: Placed, label: string, key?: string) {
  const a = snapOf(it.d);
  if (sameItem(a, b)) return;
  rec({ label, key, undo: () => applyItem(b), redo: () => applyItem(a) });
}
/** اسم تعديل النص من الفرق: المحتوى، ثم المحاذاة، ثم الخط، ثم اللون. */
function textEditLabel(a: TextVal | undefined, b: TextVal) {
  if (!a || a.text !== b.text) return SU.editText;
  if ((a.align ?? "") !== (b.align ?? "")) return SU.alignText;
  if ((a.font ?? "") !== (b.font ?? "")) return SU.fontText;
  if (JSON.stringify(a.ink) !== JSON.stringify(b.ink)) return SU.inkText;
  return SU.editText;
}
/** صورة نصّ أو تاريخ استُبدلت: تُحذف الآن، أو تبقى ما دام السجلّ يشير إليها. */
function dropImg(oldId: string, newId: string) {
  if (hist) { retained.add(oldId); retained.add(newId); return; }
  releaseImg(oldId);
}
function releaseImg(id: string) {
  const u = state.urls.get(id);
  if (u) { URL.revokeObjectURL(u); state.urls.delete(id); }
  memAssets.delete(id);
}

/* ───────── مفتاح الاختيار (.tool-seg) ───────── */
// تغيير الخيار باليد يُظهر الحبّة المنزلقة حتى ينتهي انتقالها، ثم تعود خلفية الخيار المختار (style.css)
document.addEventListener("change", (e) => {
  const seg = (e.target as Element).closest?.(".tool-seg");
  if (seg && !reducedMotion()) seg.classList.add("sliding");
}, true);
document.addEventListener("transitionend", (e) => {
  const t = e.target as Element;
  if (t.classList?.contains("tool-seg") && e.propertyName === "transform") t.classList.remove("sliding");
});

/* ───────── ورقة الاختيار ───────── */
const dialog = h("dialog", { class: "bottom-sheet", "aria-labelledby": "sheet-title" }) as HTMLDialogElement;
document.body.append(dialog);
dialog.addEventListener("click", (e) => { if (e.target === dialog && !sheetLocked) closeSheet(); }); // لمس الغطاء
// إشعار الإخفاء أثناء الحرق لا يُغلق (§٢-٤)، ولا بـEsc
let sheetLocked = false;
dialog.addEventListener("cancel", (e) => { if (sheetLocked) e.preventDefault(); });
dialog.addEventListener("close", () => {
  photoInput.onchange = null; fileInput.onchange = null; dialog.classList.remove("tools", "landed");
  settleSheet();
  leaveSheet();
  placeFbar(); // ١٧: يعود الشريط العائم إن بقي النصّ محدَّداً
});
// «تم الحفظ»: العلامة والأقواس تظهر بعد اكتمال دخول الورقة (.landed في CSS)، لا معه
dialog.addEventListener("animationend", (e) => { if (e.target === dialog) dialog.classList.add("landed"); });
// رجوع الورقة الناعم بعد سحبة قصيرة (swipeToClose): انتهى، فتعود إلى أسلوبها
dialog.addEventListener("transitionend", (e) => { if (e.target === dialog && e.propertyName === "transform" && dialog.style.transition) settleSheet(); });
function settleSheet() { dialog.style.transition = ""; dialog.style.transform = ""; }

/** ما يُنفَّذ حين تُغادر الورقة محتواها الحالي (إغلاقها أو استبدال محتواها): حذف المحفوظ الباهت (openPicker). */
let onSheetLeave: (() => void) | null = null;
function leaveSheet() {
  const f = onSheetLeave;
  onSheetLeave = null;
  f?.();
}

function openSheet(title: string, body: Node[], back?: () => void) {
  const handle = h("div", { class: "grab", "aria-hidden": "true" });
  const head = h("div", { class: "sheet-head" },
    back ? h("button", { class: "icon-btn", type: "button", "aria-label": S.back, onclick: back }, icon("back")) : h("span", { class: "icon-spacer" }),
    h("h2", { id: "sheet-title" }, title),
    h("button", { class: "icon-btn", type: "button", "aria-label": S.close, onclick: () => closeSheet() }, icon("close")),
  );
  leaveSheet();
  dialog.setAttribute("aria-labelledby", "sheet-title"); // إشعار الإخفاء يسمّيها بسطره الأول
  dialog.removeAttribute("aria-describedby");
  dialog.classList.remove("notice");
  dialog.replaceChildren(handle, head, h("div", { class: "sheet-body" }, ...body));
  swipeToClose(handle, head);
  if (!dialog.open) {
    dialog.classList.remove("landed");
    dialog.showModal();
    if (!dialog.getAnimations?.().length) dialog.classList.add("landed"); // بلا حركة دخول: لا animationend
  }
  void endEdit(); // ١٧: فتح ورقة يُخفي الشريط العائم ويغلق التحرير
  placeFbar();
}
function closeSheet() {
  settleSheet(); // الإغلاق من موضع السحب الحالي: .closing تنتقل منه
  dialog.classList.add("closing");
  setTimeout(() => { dialog.classList.remove("closing"); dialog.close(); }, 160);
}
/** إغلاق الورقة بالسحب للأسفل: بالمسافة أو بالنفضة، ودونهما ترجع ناعمة (صفحة تجربة الحركات، القسم ٥). */
function swipeToClose(...areas: HTMLElement[]) {
  const CLOSE_PX = 80;          // مسافة السحب للأسفل التي تُغلق الورقة
  const FLICK_PX_PER_MS = 0.5;  // سرعة النزول في آخر FLICK_WINDOW_MS التي تُغلقها (نفضة)
  const FLICK_WINDOW_MS = 100;
  const RETURN_MS = 200;        // رجوعها إلى مكانها دون العتبتين
  for (const a of areas) {
    let y0: number | null = null;
    let samples: { t: number; y: number }[] = [];
    a.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      // لُمست وهي ترجع: يبدأ السحب من موضعها الحالي
      let cur = 0;
      if (dialog.style.transition) {
        const m = getComputedStyle(dialog).transform;
        cur = m === "none" ? 0 : new DOMMatrixReadOnly(m).m42;
        dialog.style.transition = "";
        dialog.style.transform = `translateY(${cur}px)`;
      }
      y0 = e.clientY - cur;
      samples = [{ t: e.timeStamp, y: e.clientY }];
      a.setPointerCapture(e.pointerId);
    });
    a.addEventListener("pointermove", (e) => {
      if (y0 === null) return;
      samples.push({ t: e.timeStamp, y: e.clientY });
      dialog.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
    });
    const end = (e: PointerEvent) => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      samples.push({ t: e.timeStamp, y: e.clientY });
      const last = samples[samples.length - 1]!;
      const first = samples.find((s) => last.t - s.t <= FLICK_WINDOW_MS) ?? last;
      const v = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      if (dy > CLOSE_PX || v > FLICK_PX_PER_MS) { closeSheet(); return; }
      if (dy <= 0 || reducedMotion()) { settleSheet(); return; } // تقليل الحركة: الرجوع بلا انتقال
      dialog.style.transition = `transform ${RETURN_MS}ms var(--ease-out)`; // من الموضع الحالي، بلا تجاوز
      dialog.style.transform = "translateY(0px)";
    };
    a.addEventListener("pointerup", end);
    a.addEventListener("pointercancel", end);
  }
}

async function openPicker(kind: Kind) {
  select(null);
  const title = kind === "signature" ? S.addSignature : S.addStamp;
  const assets = await listAssets(kind);
  let editing = false;
  // حذف المحفوظ بلا نافذة سؤال (قرار نايف ٢٠٢٦/١١/١٠): الباهت يبقى في التخزين حتى تُغلق الورقة أو يُخرج من «تعديل»،
  // فإن تعطّل التطبيق قبل ذلك بقي المحفوظ
  const pending = new Set<Asset>();
  const commit = async () => {
    const gone = [...pending];
    pending.clear();
    for (const a of gone) assets.splice(assets.indexOf(a), 1);
    for (const a of gone) await deleteAsset(a.id);
  };
  const grid = h("div", { class: `grid ${kind}` });
  const editBtn = h("button", { class: "text-btn", type: "button", hidden: !assets.length }, S.edit);
  const renderGrid = () => {
    grid.replaceChildren(...assets.map((a) => {
      const tile = h("button", {
        class: "tile", type: "button", "data-test": "saved-tile",
        "aria-label": kind === "signature" ? S.savedSignature : S.savedStamp,
        onclick: () => { if (!editing) { closeSheet(); void placeAsset(a); } },
      }, h("img", { src: assetUrl(a), alt: "" }));
      const wrap = h("div", { class: "tile-wrap" }, tile);
      if (editing) {
        const x = icon("close"), undo = icon("undo");
        x.classList.add("ic", "ic-x");
        undo.classList.add("ic", "ic-undo");
        const del = h("button", { class: "tile-del", type: "button" }, x, undo);
        const sync = () => {
          const p = pending.has(a);
          wrap.classList.toggle("pending", p);
          x.classList.toggle("on", !p);
          undo.classList.toggle("on", p);
          del.setAttribute("aria-label", p ? S.undo : S.remove); // التراجع في موضع × نفسه
        };
        del.addEventListener("click", () => { if (!pending.delete(a)) pending.add(a); sync(); });
        sync();
        wrap.append(del);
      }
      return wrap;
    }));
    if (!assets.length) {
      grid.replaceChildren(h("div", { class: "empty marks" },
        h("p", { class: "empty-title" }, kind === "signature" ? S.emptySignature : S.emptyStamp),
        h("p", { class: "empty-hint" }, S.emptyHint)));
    }
    editBtn.textContent = editing ? S.done : S.edit;
  };
  editBtn.addEventListener("click", () => {
    editing = !editing;
    if (!editing) {
      void commit();
      editBtn.hidden = !assets.length;
    }
    renderGrid();
  });
  renderGrid();

  const onPick = (input: HTMLInputElement) => () => {
    const f = input.files?.[0];
    input.value = "";
    if (f) void showPreview(kind, f);
  };
  photoInput.onchange = onPick(photoInput);
  fileInput.onchange = onPick(fileInput);

  openSheet(title, [
    h("div", { class: "row-label" }, h("span", {}, S.savedLabel), editBtn),
    grid,
    h("div", { class: "sources" },
      h("button", { class: "btn source", type: "button", "data-test": "from-photos", onclick: () => photoInput.click() }, icon("photo"), S.fromPhotos),
      h("button", { class: "btn source", type: "button", "data-test": "from-files", onclick: () => fileInput.click() }, icon("folder"), S.fromFiles),
      kind === "signature" ? h("button", { class: "btn source draw", type: "button", "data-test": "draw-signature", onclick: () => openDrawScreen() }, icon("pen"), S4.drawSignature) : null),
  ]);
  onSheetLeave = () => void commit(); // بعد openSheet: الإغلاق أو الانتقال إلى غير هذه الورقة يحذف الباهت
}

/* ───────── المعاينة والتفريغ ───────── */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img); // يحترم اتجاه الصورة (EXIF)
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}

async function showPreview(kind: Kind, file: File) {
  const title = kind === "signature" ? S.addSignature : S.addStamp;
  const back = () => void openPicker(kind);
  const status = h("p", { class: "processing", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), S.processing);
  openSheet(title, [status], back);

  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch {
    openSheet(title, [h("p", { class: "alert", role: "alert" }, S.badImage), otherBtn()], back);
    return;
  }
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // يظهر المؤشّر قبل الحساب
  const k = Math.min(1, PROCESS_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let prep: Prepared;
  try {
    prep = prepare(ctx.getImageData(0, 0, c.width, c.height));
  } catch {
    openSheet(title, [h("p", { class: "alert", role: "alert" }, S.badImage), otherBtn()], back);
    return;
  }

  const after = h("img", { alt: "" }) as HTMLImageElement;
  const afterBox = h("div", { class: "pane checker marks" }, after);
  const alert = h("p", { class: "alert", role: "alert", hidden: true }, S.noInk);
  const placeBtn = h("button", { class: "btn primary block", type: "button", "data-test": "place" }, S.placeOnPage) as HTMLButtonElement;
  const slider = h("input", { type: "range", min: 0, max: 100, step: 1, value: prep.auto, id: "strength", "data-test": "strength" }) as HTMLInputElement;
  let result: HTMLCanvasElement | null = null;
  const erased = new EraseHistory(); // ١٣: المسحات باقية بين المعاينة والتحرير، وتغيير القوة لا يمسّها

  const run = () => {
    const strokes = erased.strokes;
    const out = extract(prep, Number(slider.value), strokes.length ? { erase: buildMask(prep.src.width, prep.src.height, strokes) } : undefined);
    if (!out) { result = null; after.removeAttribute("src"); alert.hidden = false; placeBtn.disabled = true; return; }
    alert.hidden = true; placeBtn.disabled = false;
    const oc = document.createElement("canvas");
    oc.width = out.width; oc.height = out.height;
    oc.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
    result = downscale(oc, OUTPUT_MAX);
    after.src = result.toDataURL("image/png");
  };
  slider.addEventListener("change", run);
  run();

  placeBtn.addEventListener("click", async () => {
    if (!result) return;
    placeBtn.disabled = true;
    const blob = await new Promise<Blob>((r) => result!.toBlob((b) => r(b!), "image/png"));
    const png = await blob.arrayBuffer();
    const asset: Asset = { id: crypto.randomUUID(), kind, png, w: result.width, h: result.height, created: Date.now() };
    let saved = true;
    try { await addAsset(asset); } catch { saved = false; memAssets.set(asset.id, asset); } // كل صورة جديدة تُحفظ في المحفوظ
    closeSheet();
    await placeAsset(asset);
    if (!saved) void notice(S.dialogs.placedSavedTitle[kind], S.dialogs.placedSavedLine); // الصورة توقيع أو ختم (`kind`)
  });

  const eraseBtn = h("button", { class: "text-btn erase-enter", type: "button", "aria-label": SR.enterLabel[kind], "data-test": "erase-enter", onclick: () => editErase() }, SR.enter) as HTMLButtonElement;
  const panes = [
    h("div", { class: "panes" },
      h("figure", {}, h("div", { class: "pane paper" }, h("img", { src: img.src, alt: "" })), h("figcaption", {}, S.original)),
      h("figure", {}, afterBox, h("figcaption", {}, S.afterRemoval))),
    eraseBtn,
    h("label", { class: "strength", for: "strength" }, h("span", {}, S.strength), slider),
    alert,
    placeBtn,
    otherBtn(),
  ];
  openSheet(title, panes, back);

  /** ١٣: الورقة نفسها تصير مسرح الممحاة، و«رجوع» و«تم» كلاهما يعيدانها إلى اللوحتين بالمسحات. */
  function editErase() {
    const { nodes, done, dispose } = eraseStage({ kind, prep, strength: Number(slider.value), history: erased });
    dialog.addEventListener("close", dispose, { once: true }); // إغلاق الورقة من المسرح (سحب، لمس الغطاء، Esc)
    const leave = (focus: HTMLElement) => { dialog.removeEventListener("close", dispose); dispose(); openSheet(title, panes, back); run(); focus.focus(); };
    done.addEventListener("click", () => leave(placeBtn));
    openSheet(title, nodes, () => leave(eraseBtn));
  }

  function otherBtn() {
    return h("button", { class: "text-btn center", type: "button", onclick: () => photoInput.click() }, S.otherImage);
  }
  photoInput.onchange = () => { const f = photoInput.files?.[0]; photoInput.value = ""; if (f) void showPreview(kind, f); };
}

function downscale(c: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = max / Math.max(c.width, c.height);
  if (k >= 1) return c;
  const o = document.createElement("canvas");
  o.width = Math.round(c.width * k);
  o.height = Math.round(c.height * k);
  const x = o.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

/* ───────── التوقيع بالإصبع (docs/design-spec-batch4.md §٣) ───────── */
/** شاشة الرسم المشتركة (src/draw-screen.ts): تحفظ في المحفوظ، وهنا يوضع التوقيع على الصفحة محدَّداً. */
function openDrawScreen() {
  closeSheet();
  drawScreen({
    back: () => void openPicker("signature"),
    async done(asset, saved) {
      if (!saved) memAssets.set(asset.id, asset); // إن تعذّر حفظه في المحفوظ يبقى في الذاكرة ويوضع على الصفحة كما هو
      await placeAsset(asset);
      if (!saved) void notice(S.dialogs.drawSavedTitle, S.dialogs.drawSavedLine); // الرسم بالإصبع توقيعٌ وحده (openDrawScreen)
    },
  });
}

/* ───────── التاريخ (docs/design-spec-batch4.md §٤) ───────── */
const DATE_FONT = 96; // بكسل لوحة الرسم للعرض على الشاشة
const DATE_DPI = 4; // بكسل لكل نقطة في الملف المحفوظ (≥ 4x)
const DATE_EM = 0.028; // حجم الخطّ عند الوضع من عرض الصفحة (≈ 16.7pt على A4)
const dateText = (d: ItemData) => (d.date ? formatLines(d.date.day, d.date.mode).join("، ") : "");
type DateVal = { day: number; mode: DateMode; ink: InkColor; font?: WebFontKey }; // لكل تاريخ حبره وخطّه (غير معطى ← خط المنصة)

/** يُرسم التاريخ على canvas بخطّه (src/font-pick.ts) 500 وبحبره (أسود أو أزرق أو مخصّص، src/ink.ts)، في الوسط، بلا خلفية، سطراً واحداً. */
async function dateCanvas({ day, mode, ink, font: face }: DateVal, font: number): Promise<HTMLCanvasElement> {
  const css = getComputedStyle(document.documentElement);
  await ensurePickFont(face);
  const lh = font * (parseFloat(css.getPropertyValue("--lh-tight")) || 1.35);
  const lines = formatLines(day, mode);
  const f = `500 ${font}px ${familyOf(face)}`;
  await document.fonts.load(f, lines.join(""));
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d")!;
  ctx.font = f;
  const pad = Math.ceil(font * 0.12);
  c.width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * pad);
  c.height = Math.ceil(lh * lines.length + 2 * pad);
  ctx = c.getContext("2d")!; // تغيير المقاس يعيد ضبط اللوحة
  ctx.font = f;
  ctx.direction = "rtl"; // لوحة خارج الصفحة اتجاهها ltr، فتنقلب الكلمات بدونه
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inkColor(ink);
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, pad + lh * (i + 0.5)));
  return c;
}
/** لوحة التاريخ بعرض لا يقلّ عن `minW` بكسلاً. */
async function dateCanvasFor(date: DateVal, minW: number): Promise<HTMLCanvasElement> {
  let font = DATE_FONT, c = await dateCanvas(date, font);
  for (let i = 0; i < 3 && c.width < minW; i++) {
    font = Math.ceil((font * minW * 1.01) / c.width);
    c = await dateCanvas(date, font);
  }
  return c;
}
/** PNG بلا `toBlob`: Chromium يؤجّل ردّه حتى يفرغ الخيط الرئيسي، فرُصد «أضف التاريخ» ينتظر >٥ ثوانٍ وصفحات الملف تُرسم
 * (docs/logs/merge-hang.md). و`toDataURL` متزامن، واللوحات هنا صغيرة. */
async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const bin = atob(c.toDataURL("image/png").split(",", 2)[1] ?? "");
  if (!bin.length) throw new Error("png");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function dateImg(date: DateVal): Promise<Img> {
  const c = await dateCanvas(date, DATE_FONT);
  const img: Img = { id: crypto.randomUUID(), png: (await canvasPng(c)).buffer as ArrayBuffer, w: c.width, h: c.height };
  memAssets.set(img.id, img);
  return img;
}

/** «أضف التاريخ»: تاريخ اليوم بالصيغة الافتراضية في وسط الصفحة الظاهرة، محدَّداً. */
async function placeDate() {
  select(null);
  const { page, cy } = currentPage();
  const { width: W, height: H } = pageSize(page);
  const date: DateVal = { day: todayDay(), mode: defaultMode(), ink: loadInkAny(), font: await readyFont(loadPickFont()) };
  const img = await dateImg(date);
  const k = (DATE_EM * W) / DATE_FONT, w = img.w * k, hh = img.h * k;
  const r = clampRect({ x: W / 2 - w / 2, y: cy - hh / 2, w, h: hh }, W, H);
  await placeItem({ id: crypto.randomUUID(), assetId: img.id, kind: "date", pageUid: page.ref.uid, fx: r.x / W, fy: r.y / H, fw: r.w / W, fh: r.h / H, date });
}

/** صندوق الصورة الجديدة على الشاشة بمقياس القديمة نفسه. والمُدارة ربعاً عرضُ صورتها ارتفاعُ صندوقها. */
function turnedSize(it: Placed, r: Rect, old: Img, img: Img): [number, number] {
  const side = (it.d.turn ?? 0) % 180 !== 0, k = (side ? r.h : r.w) / old.w, w = img.w * k, hh = img.h * k;
  return side ? [hh, w] : [w, hh];
}
/** يغيّر صيغة التاريخ أو يومه: يُعاد رسمه بالمقياس نفسه، ومركز الصندوق ثابت (ما لم تحبسه حافّة الصفحة). */
let dateQueue: Promise<void> = Promise.resolve();
function setDate(it: Placed, date: DateVal): Promise<void> {
  dateQueue = dateQueue.then(async () => {
    const old = memAssets.get(it.d.assetId);
    if (!old || !state.items.includes(it)) return;
    const img = await dateImg(date);
    const r = rectOf(it), [w, hh] = turnedSize(it, r, old, img);
    const { width: W, height: H } = pageSizeOf(it);
    it.d.date = date;
    it.d.assetId = img.id;
    (it.el.querySelector("img") as HTMLImageElement).src = assetUrl(img);
    it.el.setAttribute("aria-label", S4.dateLabel(dateText(it.d)));
    setRect(it, clampRect({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - hh / 2, w, h: hh }, W, H));
    dropImg(old.id, img.id);
    if (state.selected === it) updateLimits();
    markChanged();
  }).catch(() => {});
  return dateQueue;
}

/**
 * مفتاح الصيغة (طلب نايف ٢٠٢٦/١١/٠٨): جزآن على مسار واحد، «م» يميناً و«هـ» يساراً، والمختار مملوء.
 * radiogroup بزرّين radio، والسهمان ينقلان بينهما. و«هـ» معطّل خارج جدول أم القرى.
 */
function modeSwitch(onChange: (m: DateMode) => void) {
  const parts: [DateMode, string, string][] = [["gregorian", S4.modeGregorianShort, S4.modeGregorian], ["hijri", S4.modeHijriShort, S4.modeHijri]];
  const btns = new Map<DateMode, HTMLButtonElement>();
  const pick = (m: DateMode) => { if (!btns.get(m)!.disabled) { btns.get(m)!.focus(); onChange(m); } };
  for (const [m, text, label] of parts) {
    btns.set(m, h("button", {
      class: "mode-part", type: "button", role: "radio", "aria-label": label, "data-mode": m, "data-test": `date-mode-${m}`,
      onclick: () => pick(m),
      onkeydown: (e: Event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes((e as KeyboardEvent).key)) return;
        e.preventDefault();
        pick(m === "hijri" ? "gregorian" : "hijri"); // جزآن: كل سهم إلى الآخر
      },
    }, text) as HTMLButtonElement);
  }
  const el = h("div", { class: "mode-switch", role: "radiogroup", "aria-label": S4.dateModeLabel, "data-test": "date-mode" },
    h("span", { class: "mode-thumb", "aria-hidden": "true" }), ...btns.values());
  const set = (m: DateMode, hijriOk: boolean) => {
    el.dataset.mode = m;
    btns.get("hijri")!.disabled = !hijriOk;
    for (const [k, b] of btns) { b.setAttribute("aria-checked", String(k === m)); b.tabIndex = k === m ? 0 : -1; }
  };
  return { el, set };
}

/**
 * التقويم داخل ورقة التاريخ (الإضافة ١١، docs/logs/additions-10-11-lama-spec.md): شبكة شهر هجرية أو ميلادية
 * بحسب الصيغة، تبدأ بالأحد، بنمط APG (role=grid، وتركيز متنقّل). الأسهم منعكسة في RTL، وHome/End أول الأسبوع وآخره،
 * وPageUp/Down شهر، وShift+PageUp/Down سنة، وEnter/Space اختيار، وEsc إغلاق. وزرّا الشهر معطّلان عند حدود الجدول.
 */
function dateCalendar(get: () => DateVal, onPick: (day: number) => void, onClose: () => void) {
  const title = h("p", { id: "date-cal-title", class: "cal-title", "aria-live": "polite", "data-test": "cal-title" });
  const nav = (delta: 1 | -1) => h("button", {
    class: "icon-btn cal-nav", type: "button", "aria-label": delta < 0 ? S4.prevMonth : S4.nextMonth, "data-test": delta < 0 ? "cal-prev" : "cal-next",
    onclick: () => { move(adjust(focus, mode(), "month", delta), delta, false); },
  }, icon(delta < 0 ? "right" : "left")) as HTMLButtonElement; // RTL: السابق يمين، والتالي يسار
  const prev = nav(-1), next = nav(1);
  const grid = h("div", { class: "cal-grid", role: "grid", "aria-labelledby": "date-cal-title", "data-test": "cal-grid" });
  const el = h("div", { id: "date-cal", class: "date-cal", hidden: true, "data-test": "date-cal" },
    h("div", { class: "cal-head" }, prev, title, next), grid);
  const mode = () => shownMode(get().day, get().mode);
  let focus = get().day;
  const clamp = (d: number) => { const [a, b] = dayBounds(mode()); return Math.min(b, Math.max(a, d)); };
  function render(dir = 0, takeFocus = false) {
    const md = mode(), p = partsOf(focus, md), hijri = md === "hijri";
    const [y0, y1] = yearRange(md);
    title.textContent = `${(hijri ? SL.hijriMonths : SL.gregorianMonths)[p.m - 1]} ${ar(p.y)}${hijri ? "هـ" : "م"}`; // الشهر باسمه (صقل 1.0.2 §٩، هدى): «٥/١٤٤٨هـ» كانت تُعرض كتلة من اليسار
    prev.disabled = p.y === y0 && p.m === 1;
    next.disabled = p.y === y1 && p.m === 12;
    const first = dayOf(md, p.y, p.m, 1), len = monthLength(md, p.y, p.m), lead = weekdayOf(first);
    const today = todayDay(), sel = get().day;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < lead; i++) cells.push(h("div", { class: "cal-cell", role: "gridcell" }));
    for (let d = 1; d <= len; d++) {
      const day = first + d - 1;
      const b = h("button", {
        class: "cal-day", type: "button", tabindex: day === focus ? 0 : -1, "data-day": day, "data-test": "cal-day",
        "aria-label": S4.calDay(S4.weekdayNames[weekdayOf(day)]!, d, p.m, p.y, hijri),
        "aria-current": day === today ? "date" : undefined,
      }, ar(d));
      cells.push(h("div", { class: "cal-cell", role: "gridcell", "aria-selected": String(day === sel) }, b));
    }
    while (cells.length % 7) cells.push(h("div", { class: "cal-cell", role: "gridcell" }));
    const rows: HTMLElement[] = [h("div", { class: "cal-row cal-week", role: "row" },
      ...S4.weekdays.map((w, i) => h("div", { class: "cal-wd", role: "columnheader", "aria-label": S4.weekdayNames[i] }, w)))];
    for (let i = 0; i < cells.length; i += 7) rows.push(h("div", { class: "cal-row", role: "row" }, ...cells.slice(i, i + 7)));
    grid.replaceChildren(...rows);
    grid.classList.remove("to-next", "to-prev");
    if (dir) { void grid.offsetWidth; grid.classList.add(dir > 0 ? "to-next" : "to-prev"); }
    if (takeFocus) (grid.querySelector(`[data-day="${focus}"]`) as HTMLButtonElement | null)?.focus();
    // زرّ الشهر المركَّز صار معطّلاً عند الحدّ: التركيز إلى الآخر، فلا يضيع
    if (document.activeElement === prev && prev.disabled) next.focus();
    if (document.activeElement === next && next.disabled) prev.focus();
  }
  function move(to: number, dir: number, takeFocus = true) {
    to = clamp(to);
    const a = partsOf(focus, mode()), b = partsOf(to, mode());
    const d = a.y === b.y && a.m === b.m ? 0 : dir || Math.sign(to - focus);
    focus = to;
    render(d, takeFocus);
  }
  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".cal-day");
    if (b) onPick(Number(b.dataset.day));
  });
  grid.addEventListener("keydown", (e) => {
    const k = e.key, rtl = getComputedStyle(grid).direction === "rtl", md = mode(), wd = weekdayOf(focus);
    const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -7, ArrowDown: 7, Home: -wd, End: 6 - wd };
    if (k in step) move(focus + step[k]!, Math.sign(step[k]!));
    else if (k === "PageUp" || k === "PageDown") { const s = k === "PageUp" ? -1 : 1; move(adjust(focus, md, e.shiftKey ? "year" : "month", s), s); }
    else if (k === "Enter" || k === " ") onPick(focus);
    else if (k === "Escape") { e.stopPropagation(); onClose(); } // يغلق التقويم لا الورقة
    else return;
    e.preventDefault();
  });
  return {
    el,
    open: () => { focus = get().day; el.hidden = false; render(0, true); },
    close: () => { el.hidden = true; },
    isOpen: () => !el.hidden,
    /** تغيّرت الصيغة أو التاريخ والتقويم مفتوح: يُعاد رسمه حول اليوم المختار. */
    sync: () => { focus = clamp(get().day); render(); },
  };
}

/**
 * ورقة «تغيير التاريخ»: الصيغة وزرّ التقويم، ثم اليوم والشهر والسنة حقولاً تُكتب (الإضافة ١١) وبجانبها − و+،
 * أو الشبكة مكانها. الحقل يقبل 0-9 و٠-٩ و۰-۹ ويعرض الهندية، ويلتزم عند Enter وblur، والسهمان ±1.
 * الخطأ: aria-invalid ورسالة بأيقونة؛ Enter عليه يبقي التركيز، وblur يعيد آخر قيمة صحيحة ويقول ذلك، والفارغ يعود بلا رسالة.
 */
function openDateSheet() {
  const it = state.selected;
  if (!it?.d.date) return;
  let cur: DateVal = { ...it.d.date, mode: asMode(it.d.date.mode) };
  const units: [DateUnit, string][] = [["day", S4.unitDay], ["month", S4.unitMonth], ["year", S4.unitYear]];
  const fields = new Map<DateUnit, HTMLInputElement>(), errs = new Map<DateUnit, HTMLElement>();
  const valueOf = (unit: DateUnit) => { const p = partsOf(cur.day, cur.mode); return unit === "day" ? p.d : unit === "month" ? p.m : p.y; };
  const rangeText = (unit: DateUnit) => unit === "day" ? S4.dayRange(unitRange(cur.day, cur.mode, "day")[1]) : unit === "month" ? S4.monthRange
    : shownMode(cur.day, cur.mode) === "hijri" ? S4.yearHijriRange : S4.yearGregRange;
  const showErr = (unit: DateUnit, text: string, invalid: boolean) => {
    const f = fields.get(unit)!, e = errs.get(unit)!;
    if (invalid) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid");
    e.hidden = !text;
    e.lastElementChild!.textContent = text;
  };
  const clearErrs = () => { for (const [u] of units) showErr(u, "", false); };
  const refresh = () => {
    for (const [unit] of units) {
      const f = fields.get(unit)!, v = valueOf(unit), [lo, hi] = unitRange(cur.day, cur.mode, unit);
      f.value = ar(v); // بالرقم لا بالاسم (طلب نايف)
      f.setAttribute("aria-valuenow", String(v));
      f.setAttribute("aria-valuemin", String(lo));
      f.setAttribute("aria-valuemax", String(hi));
      f.setAttribute("aria-valuetext", ar(v));
      f.style.color = inkColor(cur.ink); // المعاينة بلون الحبر (CSSOM، لا سمة style)
    }
    mode.set(cur.mode, inHijriRange(cur.day));
    if (cal.isOpen()) cal.sync();
  };
  const apply = (next: DateVal) => { cur = next; refresh(); void setDate(it, cur); };
  const mode = modeSwitch((m) => { if (m !== cur.mode) { clearErrs(); apply({ ...cur, mode: m }); } });
  // الحبر: يفتح على لون هذا التاريخ، وتغييره يعيد رسمه ويصير الافتراضي للتاريخ القادم
  const ink = inkPicker({ value: cur.ink, testId: "date-ink", custom: true, onChange: (n) => apply({ ...cur, ink: n }) });
  // والخط كذلك (لمى، قبل الحبر): يفتح على خطّ هذا التاريخ، وتغييره يعيد رسمه وحده ويصير الافتراضي للعنصر القادم
  const font = fontPicker({ value: cur.font ?? "plex", testId: "date-font", onChange: (k) => apply({ ...cur, font: k }) });
  /** يلتزم بما في الحقل: true إن قُبل أو أُعيد، وfalse إن بقي خطأً (Enter). */
  const commit = (unit: DateUnit, how: "enter" | "blur"): boolean => {
    const f = fields.get(unit)!, raw = f.value.trim();
    if (!raw) { showErr(unit, "", false); f.value = ar(valueOf(unit)); return true; }
    const n = parseUnit(raw), day = n === null ? null : setUnit(cur.day, cur.mode, unit, n);
    if (day === null) {
      if (how === "enter") { showErr(unit, rangeText(unit), true); return false; }
      showErr(unit, `${rangeText(unit)} ${S4.dateKept}`, false);
      f.value = ar(valueOf(unit));
      return true;
    }
    showErr(unit, "", false);
    if (day !== cur.day) apply({ ...cur, day }); else f.value = ar(valueOf(unit)); // ٠٥ ← ٥
    return true;
  };
  const step = (unit: DateUnit, delta: number) => { clearErrs(); apply({ ...cur, day: adjust(cur.day, cur.mode, unit, delta) }); };
  const rows = units.map(([unit, label]) => {
    const errId = `date-err-${unit}`;
    const f = h("input", {
      class: "date-val", type: "text", inputmode: "numeric", enterkeyhint: "done", role: "spinbutton", autocomplete: "off",
      maxlength: unit === "year" ? 4 : 2, "aria-label": label, "aria-describedby": errId, "data-test": `date-${unit}`,
    }) as HTMLInputElement;
    fields.set(unit, f);
    errs.set(unit, h("p", { id: errId, class: "date-err", "aria-live": "polite", hidden: true, "data-test": errId },
      icon("triangleAlert"), h("span", {})));
    f.addEventListener("focus", () => { f.select(); f.scrollIntoView({ block: "nearest" }); });
    f.addEventListener("input", () => {
      const v = fieldDigits(f.value);
      if (v !== f.value) f.value = v; // الأرقام وحدها، هندية
    });
    f.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (commit(unit, "enter")) f.select(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(unit, e.key === "ArrowUp" ? 1 : -1); f.select(); }
    });
    f.addEventListener("blur", () => { commit(unit, "blur"); });
    const btn = (delta: number) => h("button", {
      class: "step", type: "button", "aria-label": S4.stepLabel(unit, delta), "data-test": `date-${unit}-${delta < 0 ? "minus" : "plus"}`,
      onclick: () => step(unit, delta),
    }, icon(delta < 0 ? "minus" : "plus"));
    return [h("div", { class: "date-row", role: "group", "aria-label": label }, h("span", { class: "date-unit", "aria-hidden": "true" }, label), btn(-1), f, btn(1)), errs.get(unit)!];
  }).flat();
  const fieldsBox = h("div", { class: "date-fields", "data-test": "date-fields" }, ...rows);
  const calBtn = h("button", {
    class: "icon-btn cal-btn", type: "button", "aria-label": S4.calendarOpen, "aria-expanded": "false", "aria-controls": "date-cal", "data-test": "date-cal-btn",
    onclick: () => (cal.isOpen() ? closeCal() : openCal()),
  }, icon("calendar")) as HTMLButtonElement;
  const setOpen = (open: boolean) => {
    calBtn.setAttribute("aria-expanded", String(open));
    calBtn.setAttribute("aria-label", open ? S4.calendarClose : S4.calendarOpen);
    fieldsBox.hidden = open;
  };
  const openCal = () => { clearErrs(); setOpen(true); cal.open(); };
  const closeCal = () => { cal.close(); setOpen(false); calBtn.focus(); };
  const cal = dateCalendar(() => cur, (day) => { if (day !== cur.day) apply({ ...cur, day }); closeCal(); }, closeCal);
  openSheet(S4.changeDate, [
    h("div", { class: "date-mode-row" }, mode.el, calBtn),
    fieldsBox,
    cal.el,
    font.el,
    h("div", { class: "date-ink" }, ink.el),
    ink.note,
    h("div", { class: "date-actions" },
      h("button", { class: "text-btn", type: "button", "data-test": "date-today", onclick: () => { clearErrs(); apply({ ...cur, day: todayDay() }); } }, S4.todayDate),
      h("button", { class: "btn primary", type: "button", "data-test": "date-done", onclick: () => closeSheet() }, S.done)),
  ]);
  if (hist) { const b = snapOf(it.d); onSheetLeave = () => void dateQueue.then(() => recEdit(b, it, SU.changeDate)); } // الورقة كلها مدخل واحد
  refresh();
}

/* ───────── النصّ (src/text-item.ts) ───────── */
const TEXT_WRAP_EM = 0.8 / DATE_EM; // عرض اللفّ: 80٪ من عرض الصفحة بحجم الخطّ الافتراضي
/** عرض مربّع النصّ الجديد في «تحرير ملف»: ثلث عرض الصفحة، كمربّع «+» في «إعداد خطاب» (TEXT_W 70 من 210 مم، src/letter/ui.ts) */
const TEXT_BOX_EM = 70 / 210 / DATE_EM;
async function textImg(val: TextVal): Promise<Img> {
  const { canvas: c, font } = await textCanvasScreen(val, DATE_FONT, TEXT_WRAP_EM);
  const img: Img = { id: crypto.randomUUID(), png: (await canvasPng(c)).buffer as ArrayBuffer, w: c.width, h: c.height, font };
  memAssets.set(img.id, img);
  return img;
}
/** «أضف نصاً» يفتح الورقة على آخر نصّ، و«تعديل النص» على نصّ العنصر وحبره. */
function openTextSheet(it?: Placed) {
  openSheet(it ? S4.editText : S4.addText, textSheetBody(it?.d.text ?? null, (val) => {
    closeSheet();
    void (it ? setText(it, val) : placeText(val));
  }));
}
/** النصّ في وسط الصفحة الظاهرة بحجم خطّ التاريخ، محدَّداً، ملفوفاً بعرض 80٪ منها (ويُصغَّر إلى الصفحة إن طال عنها). */
async function placeText(val: TextVal, record = true): Promise<Placed | null> {
  select(null);
  val = { ...val, font: await readyFont(val.font ?? "plex") }; // الخط المحفوظ لم يتنزّل (بلا شبكة): بلكس، لا خطّ لم يُرسم به
  const { page, cy } = currentPage();
  const { width: W, height: H } = pageSize(page);
  const img = await textImg(val);
  const k = (DATE_EM * W) / img.font!, w = img.w * k, hh = img.h * k;
  const r = clampRect({ x: W / 2 - w / 2, y: cy - hh / 2, w, h: hh }, W, H);
  return placeItem({ id: crypto.randomUUID(), assetId: img.id, kind: "text", pageUid: page.ref.uid, fx: r.x / W, fy: r.y / H, fw: r.w / W, fh: r.h / H, text: val }, record);
}
/** التعديل يستبدل الصورة في مكانها: المقياس نفسه، ومركز الصندوق ثابت (ما لم تحبسه حافّة الصفحة). */
/** `record = false`: جلسة تحرير (١٧) تقيّدها مرة عند إغلاقها بـ`recEdit(لقطة البداية، it، textEditLabel(…))`. */
async function setText(it: Placed, val: TextVal, record = true) {
  const old = memAssets.get(it.d.assetId);
  if (!old || !state.items.includes(it)) return;
  const b = snapOf(it.d);
  const img = await textImg(val);
  const q = img.font! / (old.font ?? DATE_FONT); // الصورتان بحجمَي خطّ مختلفين: يبقى حجم النصّ على الصفحة
  const r = rectOf(it), [w, hh] = turnedSize(it, r, { ...old, w: old.w * q, h: old.h * q }, img);
  const { width: W, height: H } = pageSizeOf(it);
  it.d.text = val;
  it.d.assetId = img.id;
  (it.el.querySelector("img") as HTMLImageElement).src = assetUrl(img);
  it.el.setAttribute("aria-label", S4.textLabel(labelText(val.text)));
  // ١٧: في «تحرير ملف» تثبت الحافّة التي يحاذيها النصّ وأعلاه، كما كُتب في الحقل (والمُدار يبقى على مركزه)
  const a = fullEdit() && !((it.d.turn ?? 0) % 360) ? alignOf(val) : null;
  const x = a === "right" ? r.x + r.w - w : a === "left" ? r.x : r.x + r.w / 2 - w / 2;
  setRect(it, clampRect({ x, y: a ? r.y : r.y + r.h / 2 - hh / 2, w, h: hh }, W, H));
  dropImg(old.id, img.id);
  if (state.selected === it) updateLimits();
  markChanged();
  if (record) recEdit(b, it, textEditLabel(b.text, val));
}

/* ───────── ١٧: الشريط العائم والتحرير في الصفحة («تحرير ملف» وحدها، docs/logs/additions-14-17-lama-spec.md §١٧) ───────── */
const editsInPlace = (it: Placed) => fullEdit() && it.d.kind === "text";
/** جلسة تحرير: حقل شفّاف فوق صورة النصّ بمقاييس رسمها، يُقيَّد مدخلاً واحداً عند إغلاقه (`before` لقطة بدايتها). */
/** `was`: علامتا العمل قبل «إضافة نص»، تعودان إن حُذف المربّع فارغاً (لا «عمل غير محفوظ» بلا عمل، docs/logs/swipe-back-text.md). */
type Edit = { it: Placed; ta: HTMLTextAreaElement; before: ItemData; isNew: boolean; was?: { unsaved: boolean; changed: boolean } };
let edit: Edit | null = null;
/** طابور ما يمسّ النصّ بعد الإغلاق أو التنسيق (setText غير متزامن): التراجع والحذف ينتظرانه. */
let editEnd: Promise<void> = Promise.resolve();
let editBusy = false, txPending = 0;
let holdEdit = 0; // لمسةٌ على الشريط أو منبثقته: لا تُغلق التحرير (iOS لا يركّز الزرّ، فـrelatedTarget فارغ)
function runTx(f: () => Promise<void> | void): Promise<void> {
  txPending++;
  editBusy = true;
  editEnd = editEnd.then(f).catch(() => undefined).finally(() => {
    editBusy = --txPending > 0;
    syncHist();
    placeFbar();
  });
  return editEnd;
}

function newTa(): HTMLTextAreaElement {
  const ta = h("textarea", {
    class: "tx-edit", dir: "auto", maxlength: LONG_TEXT_MAX, autocomplete: "off", spellcheck: "false", enterkeyhint: "enter",
    placeholder: S4.textLabelField, "aria-label": S4.textLabelField, "data-test": "tx-edit",
  }) as HTMLTextAreaElement;
  ta.addEventListener("input", () => { layoutEdit(); placeFbar(); keepAboveKeyboard(); });
  ta.addEventListener("keydown", (e) => {
    const it = edit?.ta === ta ? edit.it : null;
    if (!it) return;
    // Enter سطر جديد. وEscape وCtrl+Enter يُنهيان ويعيدان التركيز إلى العنصر، وTab إلى «تنسيق النص»
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); void endEdit(); it.el.focus({ preventScroll: true }); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); void endEdit(); fbarFocus(); }
  });
  ta.addEventListener("focusout", (e) => {
    if (edit?.ta !== ta) return;
    const to = e.relatedTarget as Node | null;
    if ((to && (fbar?.el.contains(to) || fpop?.contains(to))) || performance.now() - holdEdit < 500) return;
    void endEdit();
  });
  return ta;
}

/** يفتح التحرير: باللمس ضغطة ثانية، وبالفأرة نقر مزدوج، وEnter/F2، و✎. والمُدار يُعدَّل بالورقة كما كان. */
function beginEdit(it: Placed, isNew = false, ta = newTa(), was?: Edit["was"]) {
  if (edit?.it === it || state.saving || pen.on || !state.items.includes(it) || !editsInPlace(it)) { if (edit?.ta !== ta) ta.remove(); return; }
  if (edit) void endEdit();
  const img = memAssets.get(it.d.assetId);
  if (!img || (it.d.turn ?? 0) % 360) { ta.remove(); openTextSheet(it); return; }
  if (state.selected !== it) select(it);
  const sheet = it.el.parentElement!;
  if (ta.parentElement !== sheet) sheet.append(ta);
  ta.value = it.d.text!.text;
  ta.classList.remove("pending");
  edit = { it, ta, before: snapOf(it.d), isNew, was };
  it.el.classList.add("editing");
  app.classList.toggle("tx-typing", !WIDE.matches); // على الجوال: الحبّة والشريط السفلي يختفيان مع اللوحة
  layoutEdit();
  if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  if (isNew) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  syncHist();
  placeFbar();
  keepAboveKeyboard();
}

/** الحقل بمقاييس drawText: الحجم من مقياس الصورة، والسطر 1.35، والهامش 0.12، وعرض اللفّ TEXT_WRAP_EM، مثبَّتاً على حافّة محاذاته وأعلى العنصر. */
function layoutEdit() {
  const e = edit;
  if (!e) return;
  const it = e.it, img = memAssets.get(it.d.assetId);
  if (!img) return;
  const r = rectOf(it), base = img.font ?? DATE_FONT, k = r.w / img.w, fs = base * k, pad = Math.ceil(base * 0.12) * k;
  const { width: W } = pageSizeOf(it);
  const val = { ...it.d.text!, text: e.ta.value }, a = alignOf(val);
  // عرض اللفّ محصوراً بين المرساة وحافّة الصفحة، فلا تتحرّك المرساة
  const room = a === "right" ? r.x + r.w : a === "left" ? W - r.x : 2 * Math.min(r.x + r.w / 2, W - r.x - r.w / 2);
  const w = val.boxEm ? r.w : Math.max(r.w, Math.min(room, TEXT_WRAP_EM * fs + 2 * pad)); // المربّع: الحقل بعرضه، والمحاذاة داخله
  const x = Math.max(0, Math.min(W - w, a === "right" ? r.x + r.w - w : a === "left" ? r.x : r.x + r.w / 2 - w / 2));
  const st = e.ta.style;
  st.font = `500 ${fs}px ${familyOf(val.font)}`;
  st.lineHeight = "1.35";
  st.padding = `${pad}px`;
  st.inlineSize = `${w}px`;
  st.textAlign = a;
  st.color = st.caretColor = inkColor(val.ink);
  st.transform = `translate(${x}px, ${r.y}px)`;
  st.blockSize = "0px";
  st.blockSize = `${Math.max(e.ta.scrollHeight, r.h)}px`;
}

/** الحقل لا يختفي تحت اللوحة: حدّها أسفل visualViewport. */
function keepAboveKeyboard() {
  const ta = edit?.ta;
  if (!ta) return;
  const vv = window.visualViewport, lim = (vv ? vv.offsetTop + vv.height : innerHeight) - 12, b = ta.getBoundingClientRect().bottom;
  if (b > lim) window.scrollBy({ top: b - lim });
}

/** إغلاق الجلسة: لم يتغيّر ← لا مدخل، تغيّر ← «تعديل النص»، صار فارغاً ← يُحذف (والجديد بلا مدخل)، وجديد بمحتوى ← «إضافة نص». */
function endEdit(): Promise<void> {
  const e = edit;
  if (!e) return editEnd;
  edit = null;
  e.ta.remove();
  e.it.el.classList.remove("editing");
  app.classList.remove("tx-typing");
  const text = e.ta.value.trim(), it = e.it;
  // المربّع الجديد الفارغ يُحذف: تعود العلامتان الآن، فيقرأ التوازن (src/nav.ts) في popstate نفسه أن لا عمل
  if (!text && e.was) { const clean = hist?.isClean() ?? true; state.unsaved = e.was.unsaved || !clean; state.changed = e.was.changed || !clean; }
  syncHist();
  placeFbar();
  return runTx(async () => {
    if (!state.items.includes(it)) return;
    if (!text) {
      if (e.isNew) { dropItem(it.d.id); releaseImg(it.d.assetId); updateSaveState(); return; }
      editBusy = false; // removeSelected لا ينتظر نفسه
      select(it);
      removeSelected();
      return;
    }
    if (text !== it.d.text!.text) { saveLastText(text); await setText(it, { ...it.d.text!, text }, false); }
    if (e.isNew) { saveLastText(text); recAdd(it); } else recEdit(e.before, it, textEditLabel(e.before.text, it.d.text!));
  });
}
/** يقيّد ما كُتب ويُبقي الجلسة مفتوحة (التنسيق أثناء التحرير: مدخل للنصّ ثم مدخل للتنسيق). */
async function commitEdit() {
  const e = edit;
  if (!e) return;
  const text = e.ta.value.trim();
  if (!text) return;
  if (text !== e.it.d.text!.text) await setText(e.it, { ...e.it.d.text!, text }, false);
  if (e.isNew) { recAdd(e.it); e.isNew = false; } else recEdit(e.before, e.it, textEditLabel(e.before.text, e.it.d.text!));
  e.before = snapOf(e.it.d);
}
/** الخروج من العارض: لا شيء يُقيَّد. */
function dropEdit() {
  const ta = edit?.ta;
  edit = null; // قبل الإزالة: Chromium يطلق focusout على الحقل المركَّز وهو يُزال، فلا يُغلقه endEdit من داخلها (docs/logs/swipe-back-text.md)
  ta?.remove();
  app.classList.remove("tx-typing");
  closeFpop();
  fbar = null;
  editEnd = Promise.resolve();
  editBusy = false;
  txPending = 0;
}

/** «نص» في الحبّة: صندوق وسط الصفحة الظاهرة يُفتح للتحرير بآخر نصّ محدَّداً كله، وبالحبر والخط الأخيرين. */
function startNewText() {
  if (state.saving || !state.pages.length) return;
  const ta = newTa();
  ta.classList.add("pending");
  currentPage().page.sheet.append(ta);
  ta.focus({ preventScroll: true }); // iOS: التركيز في معالج الضغط نفسه، ثم يُوضع الحقل حين يجهز العنصر (placeText غير متزامن)
  const was = { unsaved: state.unsaved, changed: state.changed };
  // مربّع بعرض ثابت والنصّ موسَّط داخله (قرارا نايف ٢٠٢٦/١١/١٥)، ويغيّر المستخدم المحاذاة من الشريط؛ والموجود بمحاذاته المحفوظة
  void placeText({ text: loadLastText(), ink: loadInkAny(), font: loadPickFont(), align: "center", boxEm: TEXT_BOX_EM }, false)
    .then((it) => { if (it) beginEdit(it, true, ta, was); else ta.remove(); }, () => ta.remove());
}

/** التنسيق: يُقيَّد ما كُتب أولاً، ثم التنسيق مدخلاً مستقلاً، ويبقى الحقل مفتوحاً إن كان. */
function applyFormat(patch: Partial<TextVal>) {
  const it = state.selected;
  if (!it?.d.text || !editsInPlace(it)) return;
  void runTx(async () => {
    if (!state.items.includes(it)) return;
    if (edit?.it === it) await commitEdit();
    const cur = it.d.text!;
    if (patch.align && patch.align === alignOf(cur) && !(edit?.it === it && edit.ta.value.trim() !== cur.text)) return;
    const val: TextVal = { ...cur, ...patch };
    if (patch.font) val.font = await readyFont(patch.font);
    if (JSON.stringify(val) === JSON.stringify(cur)) return;
    await setText(it, val, true);
    if (edit?.it === it) { edit.before = snapOf(it.d); layoutEdit(); }
  });
}

type Fbar = { el: HTMLElement; btns: HTMLButtonElement[]; editB: HTMLButtonElement; al: Record<TextAlign, HTMLButtonElement>; inkB: HTMLButtonElement; fontB: HTMLButtonElement; dot: HTMLElement; ab: HTMLElement; on: boolean; below: boolean; t: number };
let fbar: Fbar | null = null;
let fpop: HTMLElement | null = null;
const FBAR_H = 52, FBAR_W = 298;

function makeFbar(): Fbar {
  const btn = (test: string, label: string, kid: Node, run: () => void) => {
    const b = h("button", { type: "button", tabindex: -1, "aria-label": label, "data-test": test }, kid) as HTMLButtonElement;
    b.addEventListener("pointerdown", (e) => { holdEdit = performance.now(); e.preventDefault(); }); // لا يأخذ التركيز من الحقل
    b.addEventListener("click", run);
    return b;
  };
  const editB = btn("fb-edit", S4.editText, icon("pen"), () => {
    const it = state.selected;
    if (!it) return;
    if (edit?.it === it) { void endEdit(); it.el.focus({ preventScroll: true }); } else beginEdit(it);
  });
  editB.setAttribute("aria-pressed", "false");
  const al = {} as Record<TextAlign, HTMLButtonElement>;
  for (const [a, label, ic] of [["right", SL.alignRight, "alignRight"], ["center", SL.alignCenterLong, "alignCenter"], ["left", SL.alignLeftLong, "alignLeft"]] as const) {
    al[a] = btn(`fb-align-${a}`, label, icon(ic), () => applyFormat({ align: a }));
  }
  const dot = h("span", { class: "fb-dot", "aria-hidden": "true" });
  const ab = h("span", { class: "fb-ab", "aria-hidden": "true" }, SU.fontSample);
  const inkB = btn("fb-ink", SU.inkBtn, dot, () => openFpop("ink"));
  const fontB = btn("fb-font", SU.fontBtn, ab, () => openFpop("font"));
  for (const b of [inkB, fontB]) { b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-expanded", "false"); }
  const sep = () => h("span", { class: "sep", "aria-hidden": "true" });
  const btns = [editB, al.right, al.center, al.left, inkB, fontB];
  btns[0]!.tabIndex = 0;
  const el = h("div", { class: "fbar", role: "toolbar", "aria-label": SL.format, hidden: true, "data-test": "fbar" },
    editB, sep(), al.right, al.center, al.left, sep(), inkB, fontB);
  // roving tabindex: الأسهم داخله (في RTL السهم الأيسر إلى التالي)، وEscape وShift+Tab من أوله إلى العنصر
  el.addEventListener("keydown", (e) => {
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = btns.length;
    const j = e.key === "ArrowLeft" ? (i + 1) % n : e.key === "ArrowRight" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j >= 0) { e.preventDefault(); btns[i]!.tabIndex = -1; btns[j]!.tabIndex = 0; btns[j]!.focus(); return; }
    if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey && i === 0)) { e.preventDefault(); state.selected?.el.focus({ preventScroll: true }); }
  });
  el.addEventListener("focusin", (e) => { const b = e.target as HTMLButtonElement; if (btns.includes(b)) for (const x of btns) x.tabIndex = x === b ? 0 : -1; });
  // تلميح الفأرة بعد 400ms (نمط histBtn): نصّه aria-label نفسه، في الجهة البعيدة عن العنصر، ولا يظهر ومنبثقةٌ مفتوحة
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const tip = h("span", { class: "fb-tip", "aria-hidden": "true", hidden: true, "data-test": "fb-tip" });
    el.append(tip);
    let t = 0;
    const hide = () => { clearTimeout(t); tip.hidden = true; };
    for (const b of btns) {
      b.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(t);
        t = window.setTimeout(() => {
          if (fpop || !fbar?.on) return;
          tip.textContent = b.getAttribute("aria-label");
          tip.hidden = false;
          tip.style.left = `${b.offsetLeft + b.offsetWidth / 2}px`;
        }, 400);
      });
      b.addEventListener("pointerleave", hide);
      b.addEventListener("pointerdown", hide);
    }
  }
  app.append(el);
  return { el, btns, editB, al, inkB, fontB, dot, ab, on: false, below: false, t: 0 };
}
function fbarFocus() { fbar?.btns.find((b) => b.tabIndex === 0)?.focus(); }

/**
 * الموضع: أسفل الشريط فوق إطار التحديد بـ8، وسط العنصر أفقياً محصوراً بهامش 12. يقلب تحته إن صار أعلاه فوق
 * أعلى المساحة الظاهرة + 8 (بتردّد 16)، وإن لم يتّسع فوق ولا تحت يثبت أعلى المساحة الظاهرة.
 */
function placeFbar() {
  const it = state.selected;
  if (!fbar && it && editsInPlace(it) && state.opts) fbar = makeFbar();
  const f = fbar;
  if (!f) return;
  const show = !!it && editsInPlace(it) && !pen.on && !dialog.open && !thumbs && !state.saving && state.items.includes(it);
  if (!show) { hideFbar(f); return; }
  const er = it.el.getBoundingClientRect(); // الوسط الأفقيّ من العنصر: الحقل شفّاف وعرضه عرض اللفّ
  let r = er;
  if (edit?.it === it) {
    const q = edit.ta.getBoundingClientRect();
    r = new DOMRect(Math.min(r.left, q.left), Math.min(r.top, q.top), Math.max(r.right, q.right) - Math.min(r.left, q.left), Math.max(r.bottom, q.bottom) - Math.min(r.top, q.top));
  }
  const top = r.top - 6, bottom = r.bottom + 6; // إطار التحديد 6px خارج العنصر
  const band = visibleBand(), vv = window.visualViewport; // وأثناء الكتابة على الجوال: من أسفل الرأس إلى أعلى اللوحة
  const floor = Math.min(WIDE.matches ? innerHeight : band.bottom, vv ? vv.offsetTop + vv.height : innerHeight);
  if (bottom < band.top || top > floor) { hideFbar(f); return; }
  const min = band.top + 8, above = top - 8 - FBAR_H;
  let below = f.below ? above < min + 16 : above < min;
  let y = below ? bottom + 8 : above;
  if (below && y + FBAR_H > floor - 8) { if (above >= min) { below = false; y = above; } else y = min; }
  const x = Math.max(12, Math.min(innerWidth - 12 - FBAR_W, (er.left + er.right) / 2 - FBAR_W / 2));
  f.below = below;
  f.el.classList.toggle("below", below);
  f.el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  const v = it.d.text!, a = alignOf(edit?.it === it ? { ...v, text: edit.ta.value } : v);
  const editing = edit?.it === it;
  if (f.editB.getAttribute("aria-pressed") !== String(editing)) f.editB.replaceChildren(icon(editing ? "checkL" : "pen")); // ✎ يصير ✓ أثناء التحرير (المدير، بعد لمى)
  f.editB.setAttribute("aria-pressed", String(editing));
  for (const k of ["right", "center", "left"] as const) f.al[k].setAttribute("aria-pressed", String(k === a));
  f.dot.style.background = inkColor(v.ink);
  f.ab.style.fontFamily = familyOf(v.font);
  if (fpop) placeFpop(f);
  if (!f.on) {
    f.on = true;
    clearTimeout(f.t);
    f.el.hidden = false;
    void f.el.offsetWidth; // يبدأ الدخول من opacity 0 وإزاحته
    f.el.classList.add("on");
  }
}
function hideFbar(f: Fbar) {
  closeFpop();
  if (!f.on) return;
  f.on = false;
  f.el.classList.remove("on");
  f.t = window.setTimeout(() => { if (!f.on) f.el.hidden = true; }, 120);
}
let fbarFrame = 0;
const fbarSoon = () => { if (fbar && state.selected && !fbarFrame) fbarFrame = requestAnimationFrame(() => { fbarFrame = 0; placeFbar(); }); };
addEventListener("scroll", fbarSoon, { passive: true });
addEventListener("resize", fbarSoon);
/** مستمعا visualViewport (١٧) مربوطان بدورة حياة العارض: يُضافان في buildViewer ويُبطَلان في closeViewer، فلا يبقيان حيّين في الأدوات الأخرى (fill-form:430) */
let vvAbort: AbortController | null = null;
function listenViewport() {
  vvAbort?.abort();
  const signal = (vvAbort = new AbortController()).signal;
  window.visualViewport?.addEventListener("resize", () => { fbarSoon(); keepAboveKeyboard(); }, { signal });
  window.visualViewport?.addEventListener("scroll", fbarSoon, { signal });
}
// لمسة خارج المنبثقة والشريط تغلقها
document.addEventListener("pointerdown", (e) => { const t = e.target as Node; if (fpop && !fpop.contains(t) && !fbar?.el.contains(t)) closeFpop(); }, true);

/** منبثقة الحبر (ومنه المخصّص) أو الخط تحت الشريط (أو فوقه إن كان تحت العنصر)، تأخذ التركيز ثم يعود إلى الحقل. */
function openFpop(kind: "ink" | "font") {
  const it = state.selected, f = fbar;
  if (!it?.d.text || !f) return;
  if (fpop?.dataset.kind === kind) { closeFpop(); return; }
  closeFpop();
  const v = it.d.text;
  const pick = (patch: Partial<TextVal>) => {
    const ta = edit?.it === it ? edit.ta : null;
    closeFpop();
    if (ta) ta.focus({ preventScroll: true }); else (kind === "ink" ? f.inkB : f.fontB).focus({ preventScroll: true });
    applyFormat(patch);
  };
  let body: Node[];
  if (kind === "ink") {
    const p = inkPicker({ value: v.ink, testId: "fb-inkpick", custom: true, compact: true, onChange: (n) => pick({ ink: n }) });
    body = [p.el, p.note];
  } else body = [fontPicker({ value: v.font ?? "plex", testId: "fb-fontpick", onChange: (k) => pick({ font: k }) }).el];
  const pop = h("div", { class: "fb-pop", role: "dialog", "aria-label": kind === "ink" ? SU.inkBtn : SU.fontBtn, "data-kind": kind, "data-test": "fb-pop" }, ...body);
  pop.addEventListener("pointerdown", () => (holdEdit = performance.now()));
  pop.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeFpop();
    if (edit?.it === it) edit.ta.focus({ preventScroll: true }); else (kind === "ink" ? f.inkB : f.fontB).focus({ preventScroll: true });
  });
  fpop = pop;
  f.el.querySelector<HTMLElement>(".fb-tip")?.setAttribute("hidden", ""); // لا تلميح والمنبثقة مفتوحة
  (kind === "ink" ? f.inkB : f.fontB).setAttribute("aria-expanded", "true");
  app.append(pop);
  placeFpop(f);
  pop.querySelector<HTMLElement>('[aria-pressed="true"], input:checked, button, input')?.focus({ preventScroll: true });
}
function placeFpop(f: Fbar) {
  if (!fpop) return;
  const b = f.el.getBoundingClientRect(), w = fpop.offsetWidth, hh = fpop.offsetHeight;
  const x = Math.max(12, Math.min(innerWidth - 12 - w, b.left + b.width / 2 - w / 2));
  const y = f.below ? Math.max(8, b.top - 8 - hh) : b.bottom + 8;
  fpop.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
}
function closeFpop() {
  if (!fpop) return;
  fbar?.el.querySelector<HTMLElement>(".fb-tip")?.setAttribute("hidden", "");
  fpop.remove();
  fpop = null;
  if (fbar) for (const b of [fbar.inkB, fbar.fontB]) b.setAttribute("aria-expanded", "false");
}

/* ───────── الأقلام: طمس نص وتحديد ورسم (docs/logs/pen-lama-spec.md، والتحديد والرسم docs/logs/pens-lama-spec.md) ───────── */
/** غطاء الطمس: مستطيل لكل سطر في فضاء الصفحة الأصلي (نقاط PDF)، فيبقى في موضعه مع تدوير الصفحة ونقلها. */
interface Cover { kind: "cover"; id: string; pageUid: string; rects: PdfRect[] }
type Mark = Cover | Highlight | Ink;
interface PageLum { key: string; g: Lum; k: number; vp0: pdfjs.PageViewport }
const pen = {
  on: false,
  tool: "highlight" as PenTool,
  covers: [] as Cover[],
  hls: [] as Highlight[],
  inks: [] as Ink[],
  layers: new Map<string, SVGSVGElement>(),
  marks: new Map<string, { hl: SVGSVGElement; ink: SVGSVGElement }>(), // طبقتا التحديد والرسم بعد طبقة الطمس (§٢)
  text: new Map<string, Promise<TextRun[]>>(), // قطع النصّ الأفقية بنقاط الصفحة غير المُدارة
  runs: new Map<string, TextRun[]>(),
  lum: new Map<string, PageLum>(), // شبكة الإضاءة لآخر صفحات لُمست (حتى LUM_KEEP)
};
const LUM_KEEP = 6;
const PEN_HINT_KEY = "pdfsa.penHint", PEN_TOOL_KEY = "pdfsa.penTool", INK_WIDTH_KEY = "pdfsa.inkWidth";
const TAP_PX = 10; // ضغطٌ بلا حركة (§٢-٣)
const PAN_MS = 120; // في الرسم: إصبع ثانٍ بعد هذه المدة والخطّ تحرّك يثبّت ما رُسم ثم يحرّك الصفحة (pens §٥)
let penBtn: HTMLButtonElement | null = null, penUndoBtn: HTMLButtonElement, penRedoBtn: HTMLButtonElement | null = null, penDoneBtn: HTMLButtonElement;
let penTray: HTMLElement, penHint: HTMLElement, penRow: HTMLElement, penNote: HTMLElement, penDrawRow: HTMLElement, penInk: InkPicker<InkColor>;
let penByTouch = false;
let inkWidth: InkWidth = "mid";
const stored = <T,>(key: string, ok: (v: unknown) => v is T, fallback: T): T => {
  try { const v = localStorage.getItem(key); return ok(v) ? v : fallback; } catch { return fallback; }
};
const store = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* للجلسة وحدها */ } };

function resetPen() {
  pen.on = false;
  pen.tool = stored(PEN_TOOL_KEY, isPenTool, "highlight"); // الافتراضي «تحديد»: لا يُتلف (§١)
  inkWidth = stored(INK_WIDTH_KEY, isInkWidth, "mid");
  pen.covers = [];
  pen.hls = [];
  pen.inks = [];
  pen.layers.clear();
  pen.marks.clear();
  pen.text.clear();
  pen.runs.clear();
  pen.lum.clear();
  penBtn = null;
  sheetLocked = false;
  app.classList.remove("pen-on", "tool-draw");
}

/** زرّ «اختر القلم» في الحبّة، و«تراجع» و«تم» مكان أزرارها، والدرج (الأقلام، ثم صفّ القلم) والتلميح فوق شريط الحفظ. */
function buildPen(pillBtn: (test: string, full: string, short: string, run: () => void) => HTMLButtonElement) {
  penBtn = pillBtn("pen", SP.penLabel, SP.pen, () => setPen(true));
  penBtn.addEventListener("pointerdown", (e) => (penByTouch = e.pointerType === "touch"));
  penBtn.addEventListener("keydown", () => (penByTouch = false));
  // ١٤: «تراجع» أيقونة ومعه «إعادة»، و«تم» يبقى نصّاً: [تم] [↶] [↷]. والتراجع والإعادة من السجلّ العام بنطاق القلم
  penUndoBtn = histBtn("undo", "pen-undo", "pen-act");
  penRedoBtn = histBtn("redo", "pen-redo", "pen-act");
  penDoneBtn = h("button", { class: "btn wash pen-act", type: "button", "data-test": "pen-done", onclick: () => setPen(false) }, icon("check"), h("span", {}, S.done)) as HTMLButtonElement;
  pill.insertBefore(penBtn, foldBtn);
  // حارس «اختر القلم» (pens-fixes §٣): إن لم يتّسع نصّه في سطر رجع زرّه وحده إلى سطرين، فلا «…». ويُقاس بعد الخطّ ومع كل تغيّر في الحبّة
  const penText = penBtn.querySelector("span")!, penB = penBtn;
  const fitPen = () => { penB.classList.remove("wrap"); if (penText.scrollWidth > penText.clientWidth) penB.classList.add("wrap"); };
  new ResizeObserver(fitPen).observe(pill);
  void document.fonts?.ready.then(fitPen);
  pill.append(penDoneBtn, penUndoBtn, penRedoBtn);
  pill.classList.add("has-pen");
  const radio = (name: string, value: string, checked: boolean, test: string, onPick: () => void) => {
    const input = h("input", { class: "sr-only", type: "radio", name, value, checked, "data-test": test }) as HTMLInputElement;
    input.addEventListener("change", () => input.checked && onPick());
    return input;
  };
  // الترتيب من اليمين: طمس نص، تحديد، رسم (§١)
  const tools = h("div", { class: "tool-seg pen-tools", role: "radiogroup", "aria-label": SP.penLabel },
    ...PEN_TOOLS.map((t) => h("label", {}, radio("pen-tool", t, t === pen.tool, `pen-${t}`, () => setTool(t)), icon(t), h("span", {}, SP[t]))));
  penNote = h("p", { class: "pen-note", "data-test": "pen-note" }, SP.redactNote);
  penInk = inkPicker({ testId: "pen-ink", custom: true, compact: true }); // حبر التاريخ والنص والرسم (pdfsa.inkAny)، ومعه دائرة الألوان
  const sample = { thin: 2, mid: 4, wide: 7 } as const, label = { thin: SP.widthThin, mid: SP.widthMid, wide: SP.widthWide } as const;
  const widths = h("div", { class: "tool-seg pen-widths", role: "radiogroup", "aria-label": SP.inkWidthLabel, "data-test": "ink-width" },
    ...(Object.keys(INK_WIDTHS) as InkWidth[]).map((w) => {
      const line = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
      line.append(svgEl("path", { d: "M4 12H20", "stroke-width": sample[w] }));
      return h("label", {}, radio("ink-width", w, w === inkWidth, `ink-width-${w}`, () => { inkWidth = w; store(INK_WIDTH_KEY, w); }), line, h("span", { class: "sr-only" }, label[w]));
    }));
  penDrawRow = h("div", { class: "pen-draw", "data-test": "pen-draw-row" }, penInk.el, widths);
  penRow = h("div", { class: "pen-row" }, penNote, penDrawRow);
  penTray = h("div", { class: "pen-tray", hidden: true, "data-test": "pen-tray" }, tools, penRow);
  penHint = h("p", { class: "pen-hint", role: "status", "aria-live": "polite", hidden: true, "data-test": "pen-hint" });
  showToolRow();
}
/** الصفّ الثاني بحسب القلم: سطر الطمس، أو الحبر والسماكة، ولا شيء للتحديد (§٣ و§٤). */
function showToolRow() {
  penNote.hidden = pen.tool !== "redact";
  penDrawRow.hidden = pen.tool !== "draw";
  penRow.hidden = pen.tool === "highlight";
  app.classList.toggle("tool-draw", pen.tool === "draw");
}
function setTool(t: PenTool) {
  if (t === pen.tool) return;
  endStroke();
  pen.tool = t;
  store(PEN_TOOL_KEY, t);
  showToolRow();
  for (const p of state.pages) { if (pen.layers.has(p.ref.uid)) drawCovers(p); if (pen.marks.has(p.ref.uid)) paintMarks(p); }
}

function setPen(on: boolean) {
  if (on === pen.on || state.saving || !penBtn || (on && histLock)) return; // م١: لا يُفتح القلم والإشعار يُبنى
  pen.on = on;
  if (on) { select(null); selectPage(null); penFloor = hist?.depth() ?? 0; } // في وضع القلم لا تراجع إلى ما قبل الدخول
  endStroke();
  app.classList.toggle("pen-on", on);
  scrollHandle?.update(); // ظاهر دائماً في القلم، وبعد الخروج يبقى IDLE_MS
  pill.classList.toggle("pen", on);
  penTray.hidden = !on;
  if (thumbsBtn) thumbsBtn.disabled = on;
  rotAllBtn.disabled = on;
  for (const p of state.pages) { if (pen.layers.has(p.ref.uid)) drawCovers(p); if (pen.marks.has(p.ref.uid)) paintMarks(p); }
  if (on) {
    syncHist();
    for (const p of state.pages) if (p.sheet.classList.contains("near")) void runsOf(p);
    let seen = true;
    try { seen = localStorage.getItem(PEN_HINT_KEY) === "1"; } catch { /* التخزين ممنوع: لا تلميح */ }
    if (penByTouch && !seen) {
      penHint.textContent = SP.hint;
      penHint.hidden = false;
      try { localStorage.setItem(PEN_HINT_KEY, "1"); } catch { /* */ }
    }
    penDoneBtn.focus();
  } else {
    hideHint();
    updateSaveState();
    penBtn.focus();
  }
}
function hideHint() { if (penHint && !penHint.hidden) { penHint.hidden = true; penHint.textContent = ""; } }

/** قطع النصّ الأفقية في الصفحة (مرة لكل صفحة)، بنقاط الصفحة غير المُدارة. */
function runsOf(pv: PageView): Promise<TextRun[]> {
  const uid = pv.ref.uid;
  let t = pen.text.get(uid);
  if (!t) {
    t = pv.ref.proxy.getTextContent().then((tc) => {
      const vp = pv.ref.proxy.getViewport({ scale: 1, rotation: 0 });
      const out: TextRun[] = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str) continue; // وقطعة الفراغ تبقى: تحدّ كلمتين (P1i)
        const tx = pdfjs.Util.transform(vp.transform, it.transform) as number[];
        const [a, b, c, d] = tx as [number, number, number, number];
        if (!(a > 0) || Math.abs(b) > 1e-3 * a || Math.abs(c) > 1e-3 * a) continue; // الأفقي القائم وحده
        out.push({ x: tx[4]!, base: tx[5]!, w: it.width, h: Math.abs(d), s: it.str });
      }
      return out;
    }).catch(() => []);
    t.then((r) => pen.runs.set(uid, r));
    pen.text.set(uid, t);
  }
  return t;
}

/** شبكة إضاءة الصفحة غير المُدارة من لوحتها المرسومة (بلا رسم جديد)، أو null إن لم تُرسم. */
function lumOf(pv: PageView): PageLum | null {
  const c = pv.canvas;
  if (!pv.rendered || !c.width || !c.height) return null;
  const g0 = pv.ref.geom, key = `${c.width}x${c.height}r${g0.rotate}`;
  const hit = pen.lum.get(pv.ref.uid);
  if (hit?.key === key) return hit;
  const proxy = pv.ref.proxy;
  const kd = c.width / proxy.getViewport({ scale: 1, rotation: g0.rotate }).width;
  const vp0 = proxy.getViewport({ scale: kd, rotation: 0 }), vpR = proxy.getViewport({ scale: kd, rotation: g0.rotate });
  const w = Math.round(vp0.width), hh = Math.round(vp0.height);
  const f = (x: number, y: number) => vp0.convertToViewportPoint(...(vpR.convertToPdfPoint(x, y) as [number, number])) as [number, number];
  const [e, ff] = f(0, 0), [a1, b1] = f(1, 0), [c1, d1] = f(0, 1);
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = hh;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, hh);
  ctx.setTransform(a1 - e, b1 - ff, c1 - e, d1 - ff, e, ff); // من العرض المُدار إلى الصفحة القائمة
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, w, hh).data;
  tmp.width = tmp.height = 0;
  const d = new Uint8Array(w * hh);
  for (let i = 0; i < d.length; i++) d[i] = (px[4 * i]! * 77 + px[4 * i + 1]! * 150 + px[4 * i + 2]! * 29) >> 8;
  const L: PageLum = { key, g: { w, h: hh, d }, k: kd, vp0 };
  pen.lum.delete(pv.ref.uid);
  pen.lum.set(pv.ref.uid, L);
  while (pen.lum.size > LUM_KEEP) pen.lum.delete(pen.lum.keys().next().value!);
  return L;
}

const cssViewport = (pv: PageView) => pv.ref.proxy.getViewport({ scale: pageScale(pv), rotation: pv.ref.geom.rotate });

type Snap = (L: PageLum, lines: TLine[], a: Pt, b: Pt) => Box[];
/** الطمس: على حبر الكلمات الممسوسة، وبلا نصّ على الحبر وحده. */
const coverSnap: Snap = (L, lines, a, b) => (lines.length ? snapText(L.g, lines, a, b) : snapInk(L.g, a, b));
/** التحديد: بارتفاع السطر، وبلا نصّ ولا حبر شريطٌ بعرض السحب (pens §٢). */
const hlSnap: Snap = (L, lines, a, b) => hlBoxes(L.g, lines, a, b, HL_BLANK_PT * L.k);
/** الأغطية (أو التحديد بـ`how`) الملتصقة بالحبر لمدى الإصبع a→b (بكسلات الصفحة على الشاشة)، أو null إن لم يكتمل رسمها أو نصّها. */
function snapNow(pv: PageView, a: Pt, b: Pt, how: Snap = coverSnap): PdfRect[] | null {
  const L = lumOf(pv), runs = pen.runs.get(pv.ref.uid);
  if (!L || !runs) return null;
  const vp = cssViewport(pv);
  const toLum = (p: Pt): Pt => { const [x, y] = L.vp0.convertToViewportPoint(...(vp.convertToPdfPoint(p.x, p.y) as [number, number])); return { x: x!, y: y! }; };
  const A = toLum(a), B = toLum(b);
  // وتُطابَق طبقة النصّ بحبر الشبكة نفسها (P1k): ما لا حبر تحته ليس من السطر
  const lines = textLines(runs.map((r) => ({ ...r, x: r.x * L.k, base: r.base * L.k, w: r.w * L.k, h: r.h * L.k })), L.g);
  const boxes = how(L, lines, A, B);
  return boxes.map((bx) => toPdf(L.vp0, bx.x0, bx.y0, bx.x1, bx.y1));
}
/** كـsnapNow، وينتظر رسم الصفحة ونصّها (§٢-١: يلتصق عند الرفع حين يكتمل). */
async function snapWhenReady(pv: PageView, a: Pt, b: Pt, how: Snap = coverSnap): Promise<PdfRect[]> {
  await runsOf(pv);
  for (let i = 0; i < 180; i++) {
    const r = snapNow(pv, a, b, how);
    if (r) return r;
    await new Promise((ok) => requestAnimationFrame(ok));
  }
  return [];
}

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
function layerOf(pv: PageView): SVGSVGElement {
  let layer = pen.layers.get(pv.ref.uid);
  if (!layer) {
    layer = svgEl("svg", { class: "pen-layer", preserveAspectRatio: "none", "data-test": "pen-layer" }) as SVGSVGElement;
    pv.badge.after(layer); // فوق رسم الصفحة، وتحت التوقيعات والأختام (§٠-٣)
    pen.layers.set(pv.ref.uid, layer);
  }
  return layer;
}
/** يرسم أغطية الصفحة بهندستها الحالية. والقلم مفعّلاً: كل غطاء زرّ «أزل الغطاء» في مجموعة صفحته. */
function drawCovers(pv: PageView, live: PdfRect[] = [], marks: Cover | null = null) {
  const mine = pen.covers.filter((c) => c.pageUid === pv.ref.uid);
  if (!mine.length && !live.length && !pen.layers.has(pv.ref.uid)) return;
  const layer = layerOf(pv);
  const vp = pv.ref.proxy.getViewport({ scale: 1, rotation: pv.ref.geom.rotate });
  layer.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
  const live_ = pen.on && pen.tool === "redact"; // الغطاء يُزال والقلم «طمس نص» وحده (pens §٢)
  if (live_) { layer.setAttribute("role", "group"); layer.removeAttribute("aria-hidden"); }
  else { layer.removeAttribute("role"); layer.setAttribute("aria-hidden", "true"); }
  const kids: SVGElement[] = [];
  mine.forEach((c, i) => c.rects.forEach((r, j) => {
    const v = toView(vp, r);
    const el = svgEl("rect", { class: "redact", x: v.x, y: v.y, width: v.w, height: v.h, "data-cover": c.id, "data-test": "cover" });
    if (j === 0 && live_) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", SP.removeCover(i + 1, mine.length)); // لا يحوي الكلمة المغطّاة أبداً
    } else el.setAttribute("aria-hidden", "true");
    kids.push(el);
  }));
  for (const r of live) { const v = toView(vp, r); kids.push(svgEl("rect", { class: "redact live", x: v.x, y: v.y, width: v.w, height: v.h, "aria-hidden": "true", "data-test": "cover-live" })); }
  if (marks) {
    const u = vp.width / pv.sheet.clientWidth, o = 4 * u, a = 8 * u; // زوايا خارج الغطاء: إزاحة 4، وذراع 8، وسُمك 2 (§٢-٣)
    const d = marks.rects.map((r) => {
      const v = toView(vp, r), x0 = v.x - o, y0 = v.y - o, x1 = v.x + v.w + o, y1 = v.y + v.h + o;
      return `M${x0} ${y0 + a}V${y0}H${x0 + a}M${x1 - a} ${y0}H${x1}V${y0 + a}M${x1} ${y1 - a}V${y1}H${x1 - a}M${x0 + a} ${y1}H${x0}V${y1 - a}`;
    }).join("");
    kids.push(svgEl("path", { class: "cover-marks", d, "stroke-width": 2 * u, "aria-hidden": "true", "data-test": "cover-marks" }));
  }
  layer.replaceChildren(...kids);
}

/** طبقتا التحديد والرسم: بعد طبقة الطمس وقبل التوقيعات (pens §٢)، والتحديد طبقته بمزج multiply والرسم فوقه، كترتيب الحفظ. */
function markLayersOf(pv: PageView) {
  let m = pen.marks.get(pv.ref.uid);
  if (!m) {
    const hl = svgEl("svg", { class: "mark-layer", preserveAspectRatio: "none", "aria-hidden": "true", "data-test": "mark-layer" }) as SVGSVGElement;
    const ink = svgEl("svg", { class: "ink-layer", preserveAspectRatio: "none", "aria-hidden": "true", "data-test": "ink-layer" }) as SVGSVGElement;
    (pen.layers.get(pv.ref.uid) ?? pv.badge).after(hl, ink); // وطبقة الطمس إن جاءت بعدُ تُدرج بعد الشارة، فتبقى تحتهما
    m = { hl, ink };
    pen.marks.set(pv.ref.uid, m);
  }
  return m;
}
/** يرسم التحديد والرسم بهندسة الصفحة الحالية، ومعهما ما يُسحب الآن. والقلم «تحديد»: كل تحديد زرّ «أزل التحديد». */
function paintMarks(pv: PageView, live: { hl?: PdfRect[]; ink?: Ink } = {}) {
  const uid = pv.ref.uid, hls = pen.hls.filter((m) => m.pageUid === uid), inks = pen.inks.filter((m) => m.pageUid === uid);
  if (!hls.length && !inks.length && !live.hl && !live.ink && !pen.marks.has(uid)) return;
  const { hl, ink } = markLayersOf(pv);
  const vp = pv.ref.proxy.getViewport({ scale: 1, rotation: pv.ref.geom.rotate });
  for (const l of [hl, ink]) l.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
  const live_ = pen.on && pen.tool === "highlight";
  if (live_) { hl.setAttribute("role", "group"); hl.removeAttribute("aria-hidden"); }
  else { hl.removeAttribute("role"); hl.setAttribute("aria-hidden", "true"); }
  const rects: SVGElement[] = [];
  hls.forEach((m, i) => m.rects.forEach((r, j) => {
    const v = toView(vp, r);
    const el = svgEl("rect", { class: "hl", x: v.x, y: v.y, width: v.w, height: v.h, "data-hl": m.id, "data-test": "highlight" });
    if (j === 0 && live_) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", SP.removeHighlight(i + 1, hls.length));
    } else el.setAttribute("aria-hidden", "true");
    rects.push(el);
  }));
  for (const r of live.hl ?? []) { const v = toView(vp, r); rects.push(svgEl("rect", { class: "hl live", x: v.x, y: v.y, width: v.w, height: v.h, "aria-hidden": "true", "data-test": "highlight-live" })); }
  hl.replaceChildren(...rects);
  const at = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
  ink.replaceChildren(...[...inks, ...(live.ink ? [live.ink] : [])].map((m) =>
    svgEl("path", { class: "ink", d: inkPath(m.pts, at), stroke: m.color, "stroke-width": m.width, "data-test": m === live.ink ? "ink-live" : "ink" })));
}

const listOf = (m: Mark): Mark[] => (m.kind === "cover" ? pen.covers : m.kind === "hl" ? pen.hls : pen.inks);
/** كل خطّ أو تحديد أو طمس مدخلٌ في السجلّ بنطاق القلم (١٤)، وكذلك رفعه بالضغط. */
const penLabel = (m: Mark) => (m.kind === "cover" ? SU.redact : m.kind === "hl" ? SU.highlight : SU.draw);
function addMark(m: Mark, record = true) {
  if (record && histLock) return; // م١: لا غطاء ولا خطّ من بدء إشعار الطمس حتى تُغلق ورقته (خطٌّ بدأ قبله يسقط)
  listOf(m).push(m);
  if (record) rec({ scope: "pen", label: penLabel(m), undo: () => removeMark(m, false), redo: () => addMark(m, false) });
  afterMarkChange(m);
}
function removeMark(m: Mark, record = true) {
  if (record && histLock) return; // م١
  const l = listOf(m), at = l.indexOf(m);
  if (at < 0) return;
  l.splice(at, 1);
  if (record) rec({ scope: "pen", label: penLabel(m), undo: () => { const l2 = listOf(m); l2.splice(Math.min(at, l2.length), 0, m); afterMarkChange(m); }, redo: () => removeMark(m, false) });
  afterMarkChange(m);
}
function afterMarkChange(m: Mark) {
  const pv = state.byUid.get(m.pageUid);
  if (pv) { if (m.kind === "cover") drawCovers(pv); else paintMarks(pv); }
  markChanged();
}
/** أغطية الصفحات الباقية في الملف، بـuid صفحتها. */
function liveCovers(): Map<string, PdfRect[]> {
  const m = new Map<string, PdfRect[]>();
  for (const c of pen.covers) if (state.byUid.has(c.pageUid)) m.set(c.pageUid, [...(m.get(c.pageUid) ?? []), ...c.rects]);
  return m;
}
/** الغطاء أو التحديد تحت النقطة (بكسلات الصفحة على الشاشة): منطقة ضغط ارتفاعها ≥ 24px، وعند التداخل أقربها بمركزه. */
function markAt<M extends Cover | Highlight>(list: M[], pv: PageView, p: Pt): M | null {
  const vp = cssViewport(pv);
  let best: M | null = null, bd = Infinity;
  for (const c of list) {
    if (c.pageUid !== pv.ref.uid) continue;
    for (const r of c.rects) {
      const v = toView(vp, r), grow = Math.max(0, (24 - v.h) / 2);
      if (p.x < v.x || p.x > v.x + v.w || p.y < v.y - grow || p.y > v.y + v.h + grow) continue;
      const dd = Math.hypot(p.x - (v.x + v.w / 2), p.y - (v.y + v.h / 2));
      if (dd < bd) { bd = dd; best = c; }
    }
  }
  return best;
}
const coverAt = (pv: PageView, p: Pt) => markAt(pen.covers, pv, p);
/** ما يُزال بضغطة بالقلم الحالي: الغطاء مع «طمس نص»، والتحديد مع «تحديد»، ولا شيء مع «رسم» (التراجع وحده). */
const hitAt = (pv: PageView, p: Pt): Cover | Highlight | null => (pen.tool === "redact" ? coverAt(pv, p) : pen.tool === "highlight" ? markAt(pen.hls, pv, p) : null);

/* السحب: إصبع واحد يرسم، وإصبعان يحرّكان الصفحة (قرار نايف) */
interface Stroke { pv: PageView; id: number; tool: PenTool; t0: number; a: Pt; b: Pt; moved: boolean; hit: Cover | Highlight | null; frame: number; ink: Ink | null; last: Pt }
let stroke: Stroke | null = null;
const touches = new Map<number, Pt & { t: number }>();
let pan: Pt | null = null;
let panHold = false; // بعد التحريك: لا رسم حتى ترتفع الأصابع كلها
function endStroke() {
  if (!stroke) return;
  cancelAnimationFrame(stroke.frame);
  const pv = stroke.pv;
  stroke = null;
  drawCovers(pv);
  paintMarks(pv);
}
/** يثبّت الخطّ المرسوم (ولو نقطةً واحدة: ضغطة بلا حركة ترسم نقطة، pens §٣). */
function commitInk(s: Stroke) {
  if (!s.ink || !pen.on) return;
  hideHint();
  addMark(s.ink);
  s.ink = null;
}
const localPt = (pv: PageView, e: PointerEvent): Pt => { const r = pv.sheet.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const mid = (): Pt => { const v = [...touches.values()]; return { x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length }; };
function pageOf(t: EventTarget | null): PageView | null {
  const sheet = (t as Element | null)?.closest?.(".page") as HTMLElement | null;
  return sheet ? state.pages[Number(sheet.dataset.page)] ?? null : null;
}

function attachPen(host: HTMLElement) {
  host.addEventListener("pointerdown", (e) => {
    if (!pen.on || state.saving || histLock || scrollHandle?.dragging()) return; // ١٢: لا يجتمع سحب المقبض والرسم. وم١: لا رسم والإشعار يُبنى
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (touches.size >= 2) {
        // في الرسم: خطٌّ تحرّك وجاء الإصبع الثاني بعد PAN_MS يُثبَّت، ثم التحريك. وغيره يُمحى (pens §٥)
        if (stroke?.tool === "draw" && stroke.moved && e.timeStamp - stroke.t0 >= PAN_MS) commitInk(stroke);
        endStroke(); pan = mid(); panHold = true; return;
      }
      if (panHold) return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const pv = pageOf(e.target);
    if (!pv) return;
    e.preventDefault();
    try { pv.sheet.setPointerCapture(e.pointerId); } catch { /* */ }
    const tool = pen.tool, a = localPt(pv, e);
    if (tool !== "draw") void runsOf(pv);
    const hit = hitAt(pv, a);
    let ink: Ink | null = null;
    if (tool === "draw") {
      const [x, y] = cssViewport(pv).convertToPdfPoint(a.x, a.y) as [number, number];
      ink = { kind: "ink", id: crypto.randomUUID(), pageUid: pv.ref.uid, pts: [x, y], width: INK_WIDTHS[inkWidth], color: inkColor(penInk.value()) };
    }
    stroke = { pv, id: e.pointerId, tool, t0: e.timeStamp, a, b: a, moved: false, hit, frame: 0, ink, last: a };
    if (ink) paintMarks(pv, { ink });
    else if (hit?.kind === "cover") drawCovers(pv, [], hit); // زوايا حوله عند النزول
  });
  host.addEventListener("pointermove", (e) => {
    if (!pen.on) return;
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { ...touches.get(e.pointerId)!, x: e.clientX, y: e.clientY });
      if (pan && touches.size >= 2) { const m = mid(); window.scrollBy(pan.x - m.x, pan.y - m.y); pan = m; return; } // 1:1 بفرق المتوسّط
    }
    if (!stroke) {
      if (e.pointerType !== "mouse") return;
      const pv = pageOf(e.target);
      if (!pv) return;
      const hit = hitAt(pv, localPt(pv, e)); // hover: مؤشّر اليد فوق ما يُزال، وزوايا حول الغطاء
      pv.sheet.style.cursor = hit ? "pointer" : "";
      if (pen.layers.has(pv.ref.uid)) drawCovers(pv, [], hit?.kind === "cover" ? hit : null);
      return;
    }
    if (e.pointerId !== stroke.id) return;
    const s = stroke;
    s.b = localPt(s.pv, e);
    if (!s.moved && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= TAP_PX) { s.moved = true; hideHint(); }
    if (s.ink) {
      // الرسم: كل نقاط الحركة (getCoalescedEvents)، وما بينه وبين سابقه ≥ 0.75px وحده
      const vp = cssViewport(s.pv);
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const p = localPt(s.pv, ev);
        if (Math.hypot(p.x - s.last.x, p.y - s.last.y) < INK_MIN_PX) continue;
        s.last = p;
        s.ink.pts.push(...(vp.convertToPdfPoint(p.x, p.y) as [number, number]));
      }
    } else if (!s.moved) return;
    if (s.frame) return;
    s.frame = requestAnimationFrame(() => {
      s.frame = 0;
      if (stroke !== s) return;
      if (s.ink) { paintMarks(s.pv, { ink: s.ink }); return; }
      // يلتصق بالنص أثناء السحب، وقبل اكتمال الرسم أو النصّ يتبع الإصبع
      const snapped = snapNow(s.pv, s.a, s.b, s.tool === "highlight" ? hlSnap : coverSnap) ?? [toPdf(cssViewport(s.pv), s.a.x, s.a.y, s.b.x, s.b.y)];
      if (s.tool === "highlight") paintMarks(s.pv, { hl: snapped });
      else drawCovers(s.pv, snapped);
    });
  });
  const up = (e: PointerEvent, cancel: boolean) => {
    if (touches.delete(e.pointerId)) {
      if (touches.size < 2) pan = null;
      if (!touches.size) panHold = false;
    }
    if (!stroke || e.pointerId !== stroke.id) return;
    const s = stroke;
    if (!cancel && s.tool === "draw") commitInk(s);
    endStroke();
    if (cancel || !pen.on || s.tool === "draw") return;
    if (!s.moved && s.hit) { removeMark(s.hit); return; } // ضغطٌ بلا حركة على غطاء أو تحديد يرفعه
    const hl = s.tool === "highlight";
    void snapWhenReady(s.pv, s.a, s.moved ? s.b : s.a, hl ? hlSnap : coverSnap).then((rects) => {
      // سحب بلا نص يزول بلا أثر، والضغط على كلمة يغطّيها (أو يحدّدها) وحدها
      if (!rects.length || !pen.on) return;
      hideHint();
      addMark(hl ? { kind: "hl", id: crypto.randomUUID(), pageUid: s.pv.ref.uid, rects } : { kind: "cover", id: crypto.randomUUID(), pageUid: s.pv.ref.uid, rects });
    });
  };
  host.addEventListener("pointerup", (e) => up(e, false));
  // ارتفعت الأصابع كلها: لا يبقى إصبع معلّق إن فات المتصفح pointerup لأحدها
  host.addEventListener("touchend", (e) => { if (!e.touches.length) { touches.clear(); pan = null; panHold = false; } });
  host.addEventListener("pointercancel", (e) => up(e, true));
  host.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" || stroke || !pen.on) return;
    const pv = pageOf(e.target);
    if (pv) { pv.sheet.style.cursor = ""; if (pen.layers.has(pv.ref.uid)) drawCovers(pv); }
  }, true);
  // لوحة المفاتيح: Enter أو Space على غطاء أو تحديد يزيله، ثم التركيز إلى التالي وإلا إلى «تراجع» (§٢-٣)
  host.addEventListener("keydown", (e) => {
    const t = e.target as Element, sel = "rect.redact[role=button], rect.hl[role=button]";
    if (!pen.on || (e.key !== "Enter" && e.key !== " ") || !t.matches?.(sel)) return;
    e.preventDefault();
    const all = [...host.querySelectorAll(sel)], i = all.indexOf(t), d = (t as SVGElement).dataset;
    const m = d.cover ? pen.covers.find((x) => x.id === d.cover) : pen.hls.find((x) => x.id === d.hl);
    if (!m) return;
    removeMark(m);
    const next = host.querySelectorAll<SVGElement>(sel)[i];
    (next ?? penUndoBtn).focus();
  });
}

/** مهلة انتظار التراجع الجاري قبل الإشعار (م٢). والاختبار يقصّرها بـ`window.__noticeIdleMs`. */
const NOTICE_IDLE_MS = () => (window as unknown as { __noticeIdleMs?: number }).__noticeIdleMs ?? 5000;
/* إشعار الحفظ مع الإخفاء (§٢-٤): ورقة سفلية على الجوال ونافذة على الكمبيوتر، بلا عنوان ظاهر */
async function openRedactNotice() {
  while (edit || editBusy) { await endEdit(); await editEnd; } // ١٧: كما في savePdf (حلقة: أمين)
  lockHist(true); // ١٤: لا تراجع ولا إعادة حتى تُغلق الورقة، فالأغطية الملتقطة هنا هي ما يُرى
  // وتراجعٌ بدأ قبلها يكتمل قبل الالتقاط. ومهلة (م٢): إن علق المخزن لا يبقى القفل، ويظهر خطأ الحفظ ولا يُحفظ شيء
  let stall = 0;
  await Promise.race([hist?.idle(), new Promise((_, no) => { stall = window.setTimeout(() => no(new Error("idle timeout")), NOTICE_IDLE_MS()); })]).finally(() => clearTimeout(stall));
  // م١: الالتقاط بعد آخر انتظار: إن تغيّرت الأغطية أثناءه (حذف صفحة مثلاً) يُعاد، فلا شيء بين الالتقاط والورقة
  let covers: Map<string, PdfRect[]>, burnUids: Set<string>, hidden: string[] | null, ex: Awaited<ReturnType<typeof fileExtras>>[], annots: boolean, hit: PageView[];
  do {
    covers = liveCovers();
    [burnUids, hidden] = await Promise.all([burnSet(covers), hiddenText(covers)]);
    hit = state.pages.filter((p) => burnUids.has(p.ref.uid));
    ex = await Promise.all([...new Set(state.pages.map((p) => p.ref.src))].map((s) => fileExtras(s.doc)));
    annots = (await Promise.all(hit.map((p) => pageHasAnnots(p.ref.proxy)))).some(Boolean);
  } while (JSON.stringify([...covers]) !== JSON.stringify([...liveCovers()]));
  const pos = (ps: PageView[]) => ps.map((p) => state.pages.indexOf(p) + 1);
  const low = hit.filter((p) => { const { width, height } = viewportSize(p.ref.geom, 1); return burnScale(width, height).lowered; });
  // العنوان الذي يشترك مع النصّ المغطّى لا يُعرض ولا يُبقى: يُحذف مع البيانات الوصفية (ملاحظة أمين ٥)
  const found = ex.find((x) => x.title)?.title ?? "", title = sharesText(found, hidden) ? "" : found;
  const removed = SP.removed({ attachments: ex.some((x) => x.attachments), outlines: ex.some((x) => x.outlines), metadata: ex.some((x) => x.metadata) });
  let keep = false;
  const keepBtn = removed && title ? h("button", { class: "ink-btn keep-title", type: "button", "aria-pressed": "false", "aria-describedby": "keep-value", "data-test": "keep-title" }, h("span", { class: "keep-box", "aria-hidden": "true" }), h("span", {}, SP.keepTitle)) as HTMLButtonElement : null;
  // قيمة العنوان بجانب الزرّ: القيمة وحدها بين علامتي تنصيص، بخطّ ثانوي
  const keepVal = keepBtn ? h("span", { id: "keep-value", class: "keep-value", "data-test": "keep-value" }, "«", h("bdi", {}, title), "»") : null;
  keepBtn?.addEventListener("click", () => {
    keep = !keep;
    keepBtn.setAttribute("aria-pressed", String(keep));
    keepBtn.firstElementChild!.replaceChildren(...(keep ? [icon("check")] : []));
  });
  const line = (text: string, test: string, cls = "") => h("p", { class: cls, "data-test": test }, text);
  const rest = h("div", { id: "notice-rest", class: "notice-rest" },
    annots ? line(SP.forms, "notice-forms") : null,
    low.length ? line(SP.lowered(pos(low)), "notice-lowered") : null,
    removed ? h("div", { class: "notice-group" }, line(removed, "notice-removed"), keepBtn ? h("div", { class: "keep-row" }, keepBtn, keepVal) : null) : null,
    line(SP.noRestore, "notice-restore", "small"));
  const saveB = h("button", { class: "btn primary block", type: "button", "data-test": "notice-save" }, S.save) as HTMLButtonElement;
  const backB = h("button", { class: "text-btn center", type: "button", "data-test": "notice-back", onclick: () => closeSheet() }, S.back) as HTMLButtonElement;
  saveB.addEventListener("click", async () => {
    if (sheetLocked) return;
    sheetLocked = true;
    saveB.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.saving);
    saveB.setAttribute("aria-busy", "true");
    backB.disabled = true;
    if (keepBtn) keepBtn.disabled = true;
    const ok = await savePdf({ covers, pages: burnUids, hidden, title: keep ? title : undefined });
    sheetLocked = false;
    if (ok) return; // «الملف جاهز» حلّت محلّها
    saveB.removeAttribute("aria-busy");
    saveB.replaceChildren(S.save);
    backB.disabled = false;
    if (keepBtn) keepBtn.disabled = false;
  });
  leaveSheet();
  onSheetLeave = () => lockHist(false); // إغلاق الورقة أو استبدالها («الملف جاهز»)
  dialog.replaceChildren(h("div", { class: "grab", "aria-hidden": "true" }),
    h("div", { class: "sheet-body" }, line(SP.burnPages(pos(hit), state.pages.length), "notice-pages", "lead"), rest, saveB, backB));
  dialog.querySelector(".lead")!.id = "notice-1";
  dialog.setAttribute("aria-labelledby", "notice-1");
  dialog.setAttribute("aria-describedby", "notice-rest");
  dialog.classList.add("notice");
  if (!dialog.open) {
    dialog.classList.remove("landed");
    dialog.showModal();
    if (!dialog.getAnimations?.().length) dialog.classList.add("landed");
  }
  saveB.focus();
}

/* ───────── الحفظ ───────── */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * يبني الملف الناتج من قائمة الصفحات بترتيبها، ويرسم كل توقيع وختم على صفحته.
 * إن كانت الصفحات هي صفحات ملف واحد بترتيبها كلها (توقيع ملف): يُحمَّل الملف نفسه كما في النسخة الأولى.
 * وإلا (ترتيب أو حذف أو دمج): ملف جديد تُنسخ إليه الصفحات وحدها، فلا يبقى في الناتج شيء من صفحة محذوفة.
 */
/** الإخفاء عند الحفظ: أغطية كل صفحة (بـuid)، والصفحات التي تُحرق (`burnSet`)، والنصّ المغطّى، والعنوان إن طلب المستخدم إبقاءه. */
interface Burn { covers: Map<string, PdfRect[]>; pages: Set<string>; hidden: string[] | null; title?: string; }

/**
 * الصفحات التي تُحرق: ما عليه غطاء، وكل صفحة تشارك صفحةً محروقة خطّاً (قرار نايف ٢٠٢٦/١١/١١، `fontLinked`).
 * لكل ملف مصدر على حدة: النسخ إلى الناتج نسخةٌ لكل ملف، فلا يشترك خطٌّ بين ملفين. وملفٌّ لا يُقرأ تُحرق صفحاته كلها.
 */
async function burnSet(covers: Map<string, PdfRect[]>): Promise<Set<string>> {
  const out = new Set(covers.keys());
  for (const src of new Set(state.pages.map((p) => p.ref.src))) {
    const mine = state.pages.map((p) => p.ref).filter((r) => r.src === src);
    const cov = mine.filter((r) => covers.has(r.uid)).map((r) => r.index);
    if (!cov.length) continue;
    let linked: Set<number> | null = null;
    try { linked = await burnClosure(() => PDFDocument.load(src.bytes, { updateMetadata: false }), mine.map((r) => r.index), cov); } catch { /* كلها */ }
    for (const r of mine) if (!linked || linked.has(r.index)) out.add(r.uid);
  }
  return out;
}
/**
 * النصّ تحت الأغطية في كل الصفحات (`coveredText`)، للمقارنة بالعنوان واسم الملف.
 * وnull إن تعذّرت قراءة نصّ صفحة: يُعدّ مشتركاً، فلا يُعرض العنوان والاسم «ملف» (ملاحظة أمين ٤، P1e).
 */
function hiddenText(covers: Map<string, PdfRect[]>): Promise<string[] | null> {
  return hiddenOf(state.pages.filter((p) => covers.has(p.ref.uid)).map((p) => ({ text: () => p.ref.proxy.getTextContent(), rects: covers.get(p.ref.uid)! })));
}
/** فحص القلم منع حرق صفحاتٍ (مواضعها في الملف الناتج، من ١). */
class PenRefused extends Error { constructor(readonly pages: number[]) { super("pen refused"); } }

async function buildOutput(pages: PageRef[], items: ItemData[], burn?: Burn, marks: { hls: Highlight[]; inks: Ink[] } = { hls: [], inks: [] }): Promise<Uint8Array> {
  const first = pages[0]!.src;
  const burned = (p: PageRef) => !!burn?.pages.has(p.uid);
  // مع الإخفاء ملف جديد دائماً: لا يُحمَّل الأصل ببياناته الوصفية ومرفقاته وإشاراته
  const whole = !burn && pages.every((p, i) => p.src === first && p.index === i) && pages.length === first.doc.numPages;
  let doc: PDFDocument;
  if (whole) {
    doc = await PDFDocument.load(first.bytes, { updateMetadata: false });
  } else {
    doc = await PDFDocument.create();
    const copied = new Map<Source, Map<number, PDFPage>>();
    // الصفحة المخفية لا تُنسخ أصلاً: لا يدخل الملف شيء من محتواها ولا من مواردها
    for (const src of new Set(pages.filter((p) => !burned(p)).map((p) => p.src))) {
      for (;;) {
        const idx = pages.filter((p) => p.src === src && !burned(p)).map((p) => p.index);
        const from = await PDFDocument.load(src.bytes, { updateMetadata: false });
        // حارس وقت الحفظ (ملاحظة أمين ١، P1e): خطوط المحروقة قبل التقليم، ثم ما يُنسخ من الباقية بعده.
        // وصفحة باقية تصل إلى خطّ محروقة تُحرق هي أيضاً، ويُعاد الحساب من ملف جديد
        const hot = burn && idx.length ? burnedFonts(from, pages.filter((p) => p.src === src && burned(p)).map((p) => p.index)) : new Set<object>();
        prepareCopy(from, idx, { prune: !!burn }); // نسخة واحدة لكل ملف، فتُشارَك الخطوط والموارد، ومع الإخفاء ما تستعمله كل صفحة وحده
        const leak = new Set(leakedPages(from, idx, hot));
        if (leak.size) { for (const p of pages) if (p.src === src && leak.has(p.index)) burn!.pages.add(p.uid); continue; }
        const out = await doc.copyPages(from, idx);
        copied.set(src, new Map(idx.map((i, k) => [i, out[k]!])));
        break;
      }
    }
    const refused: number[] = []; // مواضع الصفحات التي منع فحصُ القلم حرقها: تُجمع كلها لرسالةٍ واحدة (SP.penRefused)
    for (const [n, p] of pages.entries()) {
      if (!burned(p)) { doc.addPage(copied.get(p.src)!.get(p.index)!); continue; }
      // صورة الصفحة كما تُعرض (بتدويرها) وعليها الغطاء، في صفحة جديدة بمقاسها
      const { width, height } = viewportSize(p.geom, 1);
      let img: Uint8Array;
      try { img = await burnPage(p.proxy, p.geom, burn!.covers.get(p.uid) ?? []); } // بلا غطاء: صفحة تشارك محروقةً خطّاً
      catch (e) { if (!(e instanceof BurnRefused)) throw e; refused.push(n + 1); continue; }
      const jpg = await doc.embedJpg(img);
      doc.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height });
    }
    if (refused.length) throw new PenRefused(refused);
    if (burn?.title) doc.setTitle(burn.title);
  }
  pages.forEach((p, i) => { if (!burned(p) && (p.turns ?? 0) % 4) rotatePage(doc.getPage(i), p.turns); }); // يُضاف إلى /Rotate الموجود
  // التحديد والرسم في محتوى الصفحة بعد الطمس وقبل التوقيع (pens §٤)، لا تعليقاً ولا في صورة الطمس. والمطموسة صفحة جديدة قائمة بمقاس العرض:
  // فيُحوَّل الموضع من فضاء الصفحة الأصلي إلى العرض (بتدويره) مقلوباً رأسياً
  pages.forEach((p, i) => {
    // وعلى المطموسة يُطرح من كل مستطيل تحديد ما تحت أغطيتها، فلا تُكتب حدود الكلمات المخفية (pens-fixes §١)
    const cuts = burned(p) ? burn!.covers.get(p.uid) ?? [] : [];
    const hls = marks.hls.filter((m) => m.pageUid === p.uid).map((m) => (cuts.length ? { ...m, rects: m.rects.flatMap((r) => cutRects(r, cuts)) } : m));
    const inks = marks.inks.filter((m) => m.pageUid === p.uid);
    if (!hls.length && !inks.length) return;
    const vp = burned(p) ? p.proxy.getViewport({ scale: 1, rotation: p.geom.rotate }) : null;
    drawPenMarks(doc.getPage(i), hls, inks, vp ? (x, y) => { const [u, v] = vp.convertToViewportPoint(x, y) as [number, number]; return [u, vp.height - v]; } : undefined);
  });
  const at = new Map(pages.map((p, i) => [p.uid, i]));
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const it of items) {
    const i = at.get(it.pageUid);
    if (i === undefined) continue;
    const pg = pages[i]!;
    // المحروقة صفحة جديدة قائمة بلا تدوير، مقاسها مقاس العرض
    const geom: PageGeom = burned(pg) ? { view: [0, 0, ...Object.values(viewportSize(pg.geom, 1))] as PageGeom["view"], rotate: 0 } : pg.geom;
    const { width: W, height: H } = viewportSize(geom, 1); // بالنقاط
    const r = clampRect({ x: it.fx * W, y: it.fy * H, w: it.fw * W, h: it.fh * H }, W, H);
    let png = embedded.get(it.assetId);
    const turn = it.turn ?? 0, iw = turn % 180 ? r.h : r.w; // عرض الصورة نفسها في الملف
    if (it.text) {
      // النصّ كالتاريخ: يُرسم من جديد بدقّة ≥ 4x من عرضه في الملف، ثم PNG
      png = await doc.embedPng(await canvasPng(await textCanvasFor(it.text, DATE_DPI * iw, DATE_FONT, TEXT_WRAP_EM)));
    } else if (it.date) {
      // التاريخ يُرسم من جديد بدقّة ≥ 4x من عرضه في الملف (بالنقاط)، بخطّ المنصة، ثم يُضمَّن PNG (لا نصّ pdf-lib)
      png = await doc.embedPng(await canvasPng(await dateCanvasFor(it.date, DATE_DPI * iw)));
    } else if (!png) {
      const a = await assetOf(it.assetId);
      if (!a) continue;
      png = await doc.embedPng(new Uint8Array(a.png));
      embedded.set(it.assetId, png);
    }
    const pl = placementTurned(geom, 1, r, turn);
    doc.getPage(i).drawImage(png, { x: pl.x, y: pl.y, width: pl.width, height: pl.height, rotate: degrees(pl.rotate) });
  }
  return doc.save();
}

function setBusy(on: boolean) {
  addSigBtn.disabled = addStampBtn.disabled = addDateBtn.disabled = addTextBtn.disabled = foldBtn.disabled = tab.disabled = on;
  if (penBtn) penBtn.disabled = on;
  if (thumbsBtn) thumbsBtn.disabled = on;
  rotAllBtn.disabled = on;
  for (const p of state.pages) p.rot.disabled = on;
}

/** يحفظ الملف. وعليه غطاء ولم يُعطَ `burn`: يفتح إشعار الإخفاء أولاً (§٢-٤). يعيد true إن حُفظ. */
async function savePdf(burn?: Burn): Promise<boolean> {
  // ١٧ (أمين م-١٧-١): جلسة التحرير تُغلق ويُطبَّق ما كُتب قبل أن تُقرأ العناصر، فيُحفظ ما في الحقل
  // حلقة (أمين): لا تنفتح جلسة جديدة بين الانتظار والقراءة
  while (edit || editBusy) { await endEdit(); await editEnd; }
  const o = state.opts;
  if (!o || state.saving || dragging || saveBtn.disabled) return false;
  if (!burn && liveCovers().size) { void openRedactNotice().catch(() => { lockHist(false); void notice(S.dialogs.saveFailedTitle, S.dialogs.saveFailedLine); }); return false; }
  state.saving = true;
  syncHist(); // معطّلان أثناء الحفظ
  select(null);
  selectPage(null);
  saveBtn.disabled = true;
  setBusy(true);
  saveBtn.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.saving);
  saveBtn.setAttribute("aria-busy", "true");
  try {
    const out = await buildOutput(state.pages.map((p) => p.ref), state.items.map((it) => it.d), burn, { hls: pen.hls, inks: pen.inks });
    const file = new File([out as BlobPart], o.outName(state.items.length > 0, writtenOnly(state.items.map((it) => it.d.kind)), burn?.hidden), { type: "application/pdf" });
    state.unsaved = false;
    state.savedTurns = turnKey();
    hist?.markClean(); // يبقى السجلّ ما دامت الشاشة مفتوحة، والعودة إلى هنا «محفوظ»
    cleanChanged = state.changed;
    const op: Op | null = o.mode === "merged" ? "merge" : o.mode === "merge-edit" ? null : o.mode;
    showSaved(file, op, state.pages.length);
    return true;
  } catch (e) {
    if (e instanceof PenRefused) void notice(S.dialogs.penRefusedTitle, S.dialogs.penRefusedLine(e.pages));
    else void notice(S.dialogs.saveFailedTitle, S.dialogs.saveFailedLine);
    return false;
  } finally {
    state.saving = false;
    saveBtn.removeAttribute("aria-busy");
    saveBtn.replaceChildren(S.save);
    setBusy(false);
    updateSaveState();
  }
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: file.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * `op` العملية التي خرج منها الملف، و`pages` عدد صفحاته: لزرّ «الأدوات» تحت «حفظ أو مشاركة» (وبلا `op` لا زرّ).
 * `from` أداة «أدوات أخرى» التي خرج منها، فلا تُعرض في ورقتها.
 * `images` (٢٤، «PDF إلى صور» على الجوال، docs/logs/pdf-images-24-lama-spec.md): الصور منفصلة لـ«حفظ كصور»، أو سطر الحدّ.
 */
function showSaved(file: File, op: Op | null, pages: number, from?: string, images?: SavedImages) {
  // على iPhone: «حفظ أو مشاركة» تفتح لوحة المشاركة وفيها «حفظ في الملفات».
  // وفي غيره يُنزَّل الملف مباشرة (مرّة واحدة، ولو رجع المستخدم من ورقة الأدوات إلى هذه الورقة)
  const share = isIOS() && !!navigator.canShare?.({ files: [file] });
  // (٢٤) الشرط الثالث بعد العدد والجوال (pdf-to-jpg.ts): أن تقبل قائمة المشاركة الصور. وحينها، أو مع سطر الحدّ، لا تنزيل
  // تلقائي على Android: لا يُحفظ شيء قبل أن يختار المستخدم
  const imgs = Array.isArray(images) && images.length > 1 && !!navigator.canShare?.({ files: images }) ? images : null;
  const limit = images === "over-limit";
  if (imgs || limit) {
    if (!imgs && !share) download(file); // فوق ٢٠ على Android: التنزيل التلقائي كما كان، فلا يضيع الملف إن أُغلقت الورقة
    return showSavedImages(file, imgs, share);
  }
  if (!share) download(file);
  const render = () => {
    const primary = share
      ? h("button", { class: "btn primary block", type: "button", "data-test": "share", onclick: () => void navigator.share({ files: [file] }).catch(() => {}) }, S.share)
      : h("button", { class: "btn primary block", type: "button", "data-test": "done", onclick: () => closeSheet() }, S.done);
    openSheet(share ? S.ready : S.saved, [
      h("div", { class: "saved" },
        h("div", { class: "check marks" }, icon("check")),
        h("p", { class: "saved-name", dir: "rtl", "data-test": "saved-name" }, h("bdi", {}, file.name))),
      primary,
      ...(op ? [toolsButton(() => openTools(op, pages, async () => file, render, undefined, { from }))] : []),
      h("div", { class: "text-row" },
        h("button", { class: "text-btn", type: "button", onclick: () => closeSheet() }, S.continueEdit),
        h("button", { class: "text-btn", type: "button", onclick: () => { closeSheet(); goHome(); } }, S.newFile)),
    ]);
  };
  render();
}

/**
 * ورقة «PDF إلى صور» على الجوال (٢٤): «حفظ كصور» تفتح قائمة المشاركة بالصور منفصلة، و«حفظ كملف مضغوط (ZIP)» تحتها
 * (مشاركة على iPhone، وتنزيل في غيره). و`imgs` فارغة لأكثر من ٢٠ صفحة: الملف المضغوط وحده أساسياً، وتحته سطر الحدّ.
 * `navigator.share` تُستدعى في الضغطة نفسها بلا await قبلها، وإلا أسقطها Safari.
 */
function showSavedImages(file: File, imgs: File[] | null, shareZip: boolean) {
  const err = h("p", { class: "tool-note", role: "alert", hidden: true, "data-test": "pj-share-error" }, S.shareImagesFailed);
  const zipBtn = h("button", { class: imgs ? "btn source block zip-btn" : "btn primary block", type: "button", "data-test": "save-zip" },
    ...(imgs ? [icon("fileArchive")] : []), S.saveZip) as HTMLButtonElement;
  // فشل مشاركة الملف المضغوط على iPhone (غير الإلغاء) يُظهر سطره، ولا يُبتلع
  const zipErr = h("p", { class: "tool-note", role: "alert", hidden: true, "data-test": "pj-zip-error" }, S.saveFailed);
  zipBtn.addEventListener("click", () => {
    zipErr.hidden = true;
    if (shareZip) void shareFiles([file]).catch((e: unknown) => { if (!isAbort(e)) zipErr.hidden = false; });
    else download(file);
  });
  const body: Node[] = [
    h("div", { class: "saved" },
      h("div", { class: "check marks" }, icon("check")),
      h("p", { class: "saved-name", dir: "rtl", "data-test": "saved-name" }, h("bdi", {}, file.name))),
  ];
  if (imgs) {
    const imgBtn = h("button", { class: "btn primary block", type: "button", "data-test": "share-images", "aria-describedby": "pj-share-hint" }, S.shareImages) as HTMLButtonElement;
    imgBtn.addEventListener("click", () => {
      if (imgBtn.getAttribute("aria-busy")) return;
      imgBtn.setAttribute("aria-busy", "true");
      imgBtn.disabled = zipBtn.disabled = true;
      err.hidden = true;
      let aborted = false;
      const idle = () => {
        clearTimeout(timer);
        imgBtn.removeAttribute("aria-busy");
        imgBtn.disabled = zipBtn.disabled = false;
      };
      // قائمة مشاركة لا تُرجع شيئاً: بعد ٦٠ ثانية يعود الزرّان بلا رسالة، ونتيجتها المتأخرة تُعامَل كما هي
      const timer = setTimeout(idle, SHARE_IMAGES_TIMEOUT_MS);
      shareFiles(imgs)
        .catch((e: unknown) => { if (isAbort(e)) aborted = true; else err.hidden = false; })
        .finally(() => {
          idle();
          if (aborted) imgBtn.focus(); // الإلغاء بلا رسالة، والورقة باقية
        });
    });
    body.push(imgBtn, h("p", { class: "tool-note", id: "pj-share-hint" }, S.shareImagesHint), err, zipErr, zipBtn);
  } else {
    zipBtn.setAttribute("aria-describedby", "pj-share-limit");
    body.push(zipErr, zipBtn, h("p", { class: "tool-note", id: "pj-share-limit", "data-test": "pj-share-limit" }, S.shareImagesLimit));
  }
  body.push(h("div", { class: "text-row" },
    h("button", { class: "text-btn", type: "button", onclick: () => closeSheet() }, S.continueEdit),
    h("button", { class: "text-btn", type: "button", onclick: () => { closeSheet(); goHome(); } }, S.newFile)));
  openSheet(!imgs && !shareZip ? S.saved : S.ready, body); // فوق ٢٠ على Android نُزِّل الملف سلفاً
}
const SHARE_IMAGES_TIMEOUT_MS = 60_000;
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";
/** `navigator.share` في الضغطة نفسها (لا microtask قبلها)، وما يرميه متزامناً يصير promise مرفوضاً. */
function shareFiles(files: File[]): Promise<void> {
  try { return navigator.share({ files }); } catch (e) { return Promise.reject(e); }
}

/* ───────── الرجوع بسجلّ المتصفح (src/nav.ts) ───────── */
/** الأساس: الرئيسية، أو أداة صفحة البحث التي فُتحت منها الصفحة (`/compress`…)، فالرجوع منه يُخرج من الموقع كما كان. */
function navRoot() {
  const top = app.querySelector(":scope > main");
  if (!top || top.classList.contains("home")) return true;
  const tool = document.body.dataset.tool;
  return !!tool && top.getAttribute("data-test") === `tool-${tool}`;
}
/** النوافذ المفتوحة فوق الشاشة (ورقة الاختيار، وشاشة الرسم)، بلا ما يُغلق الآن (.closing). */
const navLayers = () => [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter((d) => {
  if (d.classList.contains("closing")) return false;
  try { return d.matches(":modal"); } catch { return true; }
});
/** حالة العمل غير المحفوظ فوق الشاشة (src/nav.ts): في الشاشات التي يسأل زرّ رجوعها (leaveThen)، لا تحرير ملف في الدمج («تم» بلا سؤال). */
const mergeListUnsaved = () => !state.opts && !!merge?.files.length && !!app.querySelector(":scope > main.merge > .merge-list"); // قائمة ملفات الدمج وفيها ملف: الشرط نفسه الذي يسأل به زرّ رجوعها
const navUnsaved = () => (!!state.opts && state.opts.mode !== "merge-edit" && unsavedWork()) || mergeListUnsaved();
navRefresh = installNav({
  depth: () => (navRoot() ? 0 : 1 + (navUnsaved() ? 1 : 0)) + navLayers().length,
  // رجوع الطبقة العليا بزرّها: رجوع الورقة إن كان لها، وإلا إغلاقها (لا أثناء الحرق)، وشاشة الرسم بـEsc نفسه،
  // والشاشة بزرّ «رجوع» في رأسها (ومعه سؤال العمل غير المحفوظ)، وتحرير ملف في الدمج بـ«تم»
  back: () => {
    const top = navLayers().at(-1);
    if (top === dialog) {
      if (sheetLocked) return;
      const b = dialog.querySelector<HTMLButtonElement>(":scope > .sheet-head > button:first-child");
      if (b) b.click(); else closeSheet();
    } else if (top) top.dispatchEvent(new Event("cancel", { cancelable: true }));
    else if (edit?.isNew && !edit.ta.value.trim()) void endEdit(); // مربّع «إضافة نص» فارغ: الرجوع يغلق الكتابة بلا سؤال، ويبقى الملف
    else app.querySelector<HTMLButtonElement>('[data-test="back"], [data-test="done-edit"]')?.click();
  },
  // لقطة الشاشة تحت حالة العمل تُجدَّد بعد كل تعديل يستقرّ (src/nav.ts، docs/logs/swipe-snap.md): ولا نافذة فوقها
  workOnTop: () => !navRoot() && navUnsaved() && navLayers().length === 0,
}, app);
// مغادرة الصفحة نفسها بعملٍ غير محفوظ: نافذة المتصفح شبكةَ أمان (src/leave-guard.ts). شرطها «لم يُحفظ» نفسه إلا في «توقيع ملف»:
// سؤاله بعناصر موضوعة ولو بعد الحفظ (الحفظ لا يفرّغها)، والشبكة بعد الحفظ لا تسأل (مراجعة أمين). وكل وضعٍ لعنصر يمرّ على markChanged
// ومحرّر ملف الدمج (merge-edit) جزءٌ من قائمة الدمج وفيها ملف: إغلاق اللسان منه يُضيع الطمس والإضافات التي في merge.marks وmerge.items،
// فيُعدّ غير محفوظ هنا وحده (مراجعة أمين). و«تم» وزرّ ✕ والرجوع داخل التطبيق بلا سؤال كما هي (navUnsaved لا يتغيّر).
guardLeave(() => !navRoot() && ((!!state.opts && (state.opts.mode === "merge-edit" ? !!merge?.files.length : state.unsaved || turnKey() !== state.savedTurns)) || mergeListUnsaved()));

// صفحة بحث لأداة (`<body data-tool="…">`، scripts/gen-tool-pages.mjs) تفتح الأداة مباشرة، وغيرها الرئيسية
const bootTool = moreTool(document.body.dataset.tool);
if (bootTool) bootTool.open(toolHost);
else showHome();
