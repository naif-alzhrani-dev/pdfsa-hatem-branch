/**
 * خيارات المسح في شاشة النتيجة (طلب نايف ٢٠٢٦/١١/٠٨: «ابيض واسود او التبييض يتم تخفيفه بشريط سحب»):
 * مفتاح «ملوّن» / «أبيض وأسود»، وشريط «التبييض» من 0 إلى 100. المعالجة نفسها في `enhance.ts`.
 *
 * - **إعدادٌ واحد لكل صفحات التصوير**، والصفحات الجديدة تأخذه (`currentFilter()` في `makePage`)، ويُحفظ آخره على الجهاز.
 * - **لكل صفحة صورتها بعد التقويم وقبل التبييض** (`flat`: JPEG بجودة 0.92)، فتُعاد المعالجة بلا تقويم جديد.
 * - **أثناء السحب:** تُعاد على نسخة مصغّرة (نحو مليون بكسل) للصفحة الكبيرة المعروضة وحدها، بعد 120ms من آخر حركة.
 * - **عند الإفلات أو تغيير المفتاح:** تُعاد كل الصفحات بالدقّة الكاملة، المعروضة أولاً، صفحةً بعد صفحة في طابورٍ واحد؛
 *   وتغييرٌ جديد يوقف الدورة القديمة بعد صفحتها الجارية. و`settleFilter` قبل بناء الملف ينتظر حتى تكون كلها بالإعداد الأخير.
 */
import { h } from "../dom";
import { S, ar } from "../strings";
import { enhance, DEFAULT_FILTER, type Filter, type FilterMode } from "./enhance";
import { loadImage } from "./load";
import { downscale, rotateCW } from "./geom";
import { encodeCapped, encodeJpeg, packBits, type PdfPage } from "./to-pdf";
import type { Img } from "./types";

export type { Filter } from "./enhance";
export const THUMB_MAX = 240;
const FULL_PIXELS = 4_000_000; // الصفحة المقوّمة سقفها 2000px، فلا تُصغَّر عند إعادة التحميل
const PREVIEW_PIXELS = 1_000_000; // المعاينة أثناء السحب: نحو 840×1190 لصفحة A4، أكبر مما تعرضه الشاشة (50dvh × 3)
const FLAT_QUALITY = 0.92;
const PREVIEW_DELAY = 120;
const KEY = "pdfsa.scanFilter";

/** الصورة كما تُعرض وتُحفظ: JPEG ومقاسه ومصغّرة (رابط blob). */
export interface Shot { jpeg: Uint8Array; width: number; height: number; thumb: string }
/** ما تحتاجه إعادة المعالجة من صفحة التصوير (`ScanPage` في scan-ui.ts). */
export interface Filterable extends Shot { id: string; flat: Blob; fkey: string; turn: number; base: Shot }

export const filterKey = (f: Filter) => `${f.mode}:${f.strength}`;

function load(): Filter {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Filter> | null;
    const mode: FilterMode = v?.mode === "bw" ? "bw" : "color";
    const s = Number(v?.strength);
    return { mode, strength: Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : DEFAULT_FILTER.strength };
  } catch { return { ...DEFAULT_FILTER }; }
}
function save(f: Filter) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* التخزين ممنوع: يبقى للجلسة */ }
}

let current: Filter = load();
export const currentFilter = (): Filter => ({ ...current });

/** الصورة المقوّمة قبل التبييض، تُحفظ مع الصفحة. */
export async function flatBlob(flat: Img): Promise<Blob> {
  return new Blob([(await encodeJpeg(flat, FLAT_QUALITY)) as BlobPart], { type: "image/jpeg" });
}

async function shotOf(img: Img): Promise<Shot> {
  const jpeg = await encodeCapped(img, encodeJpeg);
  const small = await encodeJpeg(downscale(img, THUMB_MAX), 0.8);
  return { jpeg, width: img.width, height: img.height, thumb: URL.createObjectURL(new Blob([small as BlobPart], { type: "image/jpeg" })) };
}
const turned = (img: Img, turn: number) => { for (let i = 0; i < turn; i++) img = rotateCW(img); return img; };

/**
 * يعيد صفحةً بالإعداد `f` بالدقّة الكاملة: `base` الجديد، ثم المعروض بعد تدويرها (`turn`). يُسند في خطوة واحدة بلا انتظار،
 * فلا يرى «دوّر الصفحة» نصف تحديث؛ وإن دُوّرت أثناء الترميز يُعاد ترميز المدار.
 */
async function refilter(p: Filterable, f: Filter): Promise<void> {
  const out = enhance(await loadImage(p.flat, FULL_PIXELS), f);
  const base = await shotOf(out);
  let shown = base, turn = -1;
  while (turn !== p.turn) {
    if (shown !== base) URL.revokeObjectURL(shown.thumb);
    turn = p.turn;
    shown = turn ? await shotOf(turned(out, turn)) : base;
  }
  URL.revokeObjectURL(p.base.thumb);
  if (p.thumb !== p.base.thumb) URL.revokeObjectURL(p.thumb);
  Object.assign(p, shown, { base, fkey: filterKey(f) });
}

/* ───────── الطابور: دورة واحدة في كل وقت ───────── */
let chain: Promise<unknown> = Promise.resolve();
let gen = 0;
function enqueue(job: () => Promise<void>) {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}
/** يعيد ما لم يُعَد من الصفحات بالإعداد الحالي، المعروضة أولاً. يقف إن تغيّر الإعداد (دورة أحدث في الطابور). */
function refilterAll(o: Hooks, stopOnChange: boolean) {
  const g = ++gen;
  return enqueue(async () => {
    for (;;) {
      if (stopOnChange && g !== gen) return;
      const f = current, key = filterKey(f);
      const shown = o.shown();
      const list = o.pages();
      const p = (shown && list.includes(shown) && shown.fkey !== key ? shown : null) ?? list.find((x) => x.fkey !== key);
      if (!p) return;
      await refilter(p, f);
      if (o.pages().includes(p)) o.paint(p);
      else { URL.revokeObjectURL(p.base.thumb); if (p.thumb !== p.base.thumb) URL.revokeObjectURL(p.thumb); } // حُذفت أو استُبدلت أثناء المعالجة
    }
  });
}

/* ───────── المعاينة أثناء السحب ───────── */
let small: { flat: Blob; img: Img } | null = null; // النسخة المصغّرة للصفحة المعروضة
let previewTimer = 0;
let previewGen = 0;
async function preview(o: Hooks) {
  const p = o.shown();
  if (!p) return;
  const g = ++previewGen, f = current;
  if (small?.flat !== p.flat) small = { flat: p.flat, img: await loadImage(p.flat, PREVIEW_PIXELS) };
  if (g !== previewGen) return;
  const jpeg = await encodeJpeg(turned(enhance(small.img, f), p.turn), 0.85);
  if (g !== previewGen || o.shown() !== p) return;
  o.preview(URL.createObjectURL(new Blob([jpeg as BlobPart], { type: "image/jpeg" })));
}

/** يحرّر نسخة المعاينة ويوقف ما يجري (الخروج من التصوير). */
export function dropFilterCache() {
  clearTimeout(previewTimer);
  previewGen++;
  gen++;
  small = null;
}

/** قبل بناء الملف: تنتظر حتى تكون كل الصفحات بالإعداد الأخير. */
export function settleFilter(o: Hooks) {
  return refilterAll(o, false);
}

/**
 * صفحات الملف: «أبيض وأسود» (بقوّة فوق 0) بتٌّ واحد للبكسل (to-pdf.ts)، يُفكّ من JPEG الصفحة كما تُرى (بتدويرها)
 * ثم يُقطع عند 128 — والهالات حول الحروف أضعف من أن تعبره. وغيرها JPEG كما هو.
 */
export async function pdfPages(pages: Filterable[]): Promise<PdfPage[]> {
  const out: PdfPage[] = [];
  for (const p of pages) {
    if (!/^bw:(?!0$)/.test(p.fkey)) { out.push({ jpeg: p.jpeg, width: p.width, height: p.height }); continue; }
    const img = await loadImage(new Blob([p.jpeg as BlobPart], { type: "image/jpeg" }), FULL_PIXELS);
    out.push({ bits: packBits(img), width: img.width, height: img.height });
  }
  return out;
}

export interface Hooks {
  pages: () => Filterable[];
  shown: () => Filterable | null;
  /** صفحة أُعيدت بالدقّة الكاملة: تُحدَّث مصغّرتها، والصفحة الكبيرة إن كانت المعروضة. */
  paint: (p: Filterable) => void;
  /** معاينة الصفحة المعروضة أثناء السحب (رابط blob يتولّى المستدعي إلغاءه). */
  preview: (url: string) => void;
}

/** اللوحة: المفتاح بجزأين، وشريط «التبييض». */
export function filterPanel(o: Hooks): HTMLElement {
  const pct = (n: number) => `${ar(n)}٪`;
  const opts: [FilterMode, string][] = [["color", S.filterColor], ["bw", S.filterBw]];
  const radios = opts.map(([mode, label]) => h("button", {
    class: "seg-opt", type: "button", role: "radio", "aria-checked": String(current.mode === mode), tabindex: current.mode === mode ? 0 : -1,
    "data-mode": mode, "data-test": `scan-filter-${mode}`, onclick: () => pick(mode, true),
  }, label) as HTMLButtonElement);
  const group = h("div", { class: "seg", role: "radiogroup", "aria-label": S.scanOptions, "data-on": current.mode, "data-test": "scan-filter-mode" }, ...radios);
  group.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(k)) return;
    e.preventDefault();
    const i = opts.findIndex(([m]) => m === current.mode);
    const n = k === "Home" ? 0 : k === "End" ? opts.length - 1 : (i + (k === "ArrowLeft" || k === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; // RTL: اليسار هو التالي
    pick(opts[n]![0], true);
  });
  const range = h("input", {
    type: "range", min: 0, max: 100, step: 1, value: current.strength, "aria-label": S.whitening, "aria-valuetext": pct(current.strength), "data-test": "scan-strength",
  }) as HTMLInputElement;

  function pick(mode: FilterMode, focus: boolean) {
    for (const r of radios) {
      const on = r.dataset.mode === mode;
      r.setAttribute("aria-checked", String(on));
      r.tabIndex = on ? 0 : -1;
      if (on && focus) r.focus();
    }
    group.dataset.on = mode;
    if (current.mode === mode) return;
    current = { ...current, mode };
    save(current);
    clearTimeout(previewTimer);
    previewGen++;
    void refilterAll(o, true);
  }
  range.addEventListener("input", () => {
    current = { ...current, strength: Number(range.value) };
    range.setAttribute("aria-valuetext", pct(current.strength));
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void preview(o), PREVIEW_DELAY);
  });
  range.addEventListener("change", () => {
    current = { ...current, strength: Number(range.value) };
    save(current);
    clearTimeout(previewTimer);
    previewGen++; // معاينةٌ متأخّرة لا تغطّي الدقّة الكاملة
    void refilterAll(o, true);
  });

  return h("section", { class: "scan-filter", "aria-label": S.scanOptions, "data-test": "scan-filter" },
    group,
    h("label", { class: "strength scan-strength" }, h("span", { "aria-hidden": "true" }, S.whitening), range));
}
