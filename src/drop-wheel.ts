/**
 * دائرة السحب (الدفعة ٨، docs/logs/phase1/requirements-drag-ring.md و drag-ring-lama.md): على الكمبيوتر وحده، سحب ملف
 * من خارج المتصفح إلى الرئيسية يُظهر حول المؤشر حلقةً بخيارات تناسب الملف، والإفلات على خيار يفتح أداته بالملف.
 * - (أ) إن كشف المتصفح نوع كل ملف أثناء السحب: تتبع الحلقة المؤشر، فإذا ثبت تتفتّح الخيارات ويُفلَت عليها.
 * - (ب) وإلا: «أفلت الملف هنا»، ثم الخيارات عند موضع الإفلات بعد قراءة الملفات، ويُختار منها بضغطة.
 * الاختيار النقيّ هنا (`wheelOptions`)، والفتح وأيقونات الأدوات وأسماؤها من main.ts (`WheelHost`).
 */
import "./drop-wheel.css";
import { h, icon } from "./dom";
import { toolName } from "./tool-name";
import { S } from "./strings";
import { SDW } from "./drop-wheel-strings";

export type WheelTool = "sign" | "edit" | "split" | "merge" | "compress" | "pdf-to-jpg" | "protect" | "unlock" | "jpg-to-pdf" | "word-to-pdf";
export type FileKind = "pdf" | "image" | "word" | "other";
export type WheelMessage = "mixed" | "unsupported" | "many-word";
export type WheelChoice = { tools: WheelTool[] } | { message: WheelMessage };

export const WHEEL_MAX = 6;
const PDF_EXT = /\.pdf$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;
/** Word بصيغة docx وحدها (الإضافة ٢٠). و`.doc` القديم «غير مدعوم» كما في دائرة ويندوز. */
const DOCX_EXT = /\.docx$/i;
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** نوع الملف من MIME واسمه. `null`: لا يُعرف (نوع فارغ بلا اسم، كما يكون أثناء السحب). */
export function kindOf(type: string, name = ""): FileKind | null {
  if (type === "application/pdf" || PDF_EXT.test(name)) return "pdf";
  if (type.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (type === DOCX_TYPE || DOCX_EXT.test(name)) return "word";
  return type || name ? "other" : null;
}

export interface WheelInput {
  kinds: readonly FileKind[];
  /** عدد صفحات الـPDF الواحد إن عُرف (بعد فتحه). */
  pages?: number;
  /** الـPDF الواحد محمي (بعد فتحه). */
  encrypted?: boolean;
  /** الأداة مبنية (أدوات «أدوات أخرى» من السجلّ). */
  available?: (t: WheelTool) => boolean;
}

/**
 * خيارات الدائرة (requirements-drag-ring.md §٣)، بترتيبها، ولا تزيد عن ٦. `null`: لا ملفات.
 * صور ← صور إلى PDF. عدة PDF ← دمج. PDF محمي ← فك الحماية. PDF واحد ← توقيع، تحرير، تقسيم (إلا لصفحة واحدة)، ضغط، PDF إلى صور، حماية.
 * ملف Word واحد ← Word إلى PDF، وعدّة ملفات Word ← رسالة «Word واحد»، وWord مع غيره ← رسالة «الجمع» (الإضافة ٢٠، كدائرة ويندوز).
 * خليط صور وPDF ← رسالة «الجمع»، وأي نوع آخر ← رسالة «غير مدعوم».
 */
export function wheelOptions({ kinds, pages, encrypted, available = () => true }: WheelInput): WheelChoice | null {
  if (!kinds.length) return null;
  if (kinds.includes("other")) return { message: "unsupported" };
  const words = kinds.filter((k) => k === "word").length;
  if (words && words < kinds.length) return { message: "mixed" };
  if (words > 1) return { message: "many-word" };
  const pdfs = kinds.filter((k) => k === "pdf").length;
  if (pdfs && pdfs < kinds.length) return { message: "mixed" };
  const tools: WheelTool[] = words ? ["word-to-pdf"]
    : !pdfs ? ["jpg-to-pdf"]
    : pdfs > 1 ? ["merge"]
    : encrypted ? ["unlock"]
    : ["sign", "edit", ...(pages === undefined || pages >= 2 ? ["split" as const] : []), "compress", "pdf-to-jpg", "protect"];
  const out = tools.filter(available).slice(0, WHEEL_MAX);
  return out.length ? { tools: out } : { message: "unsupported" };
}

/** نصف قطر الحلقة: مراكز البلاطات على خطّها. */
export const RING_R = 120;
/** مراكز n بلاطة من أعلى اليمين عكس عقارب الساعة (drag-ring-lama.md §2): θₖ = 180/n − k·360/n من الأعلى مع العقارب، وn = 1 ← θ = 0. x يمين وy أسفل. */
export function slots(n: number): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const th = (n === 1 ? 0 : 180 / n - (k * 360) / n) * (Math.PI / 180);
    return [RING_R * Math.sin(th), -RING_R * Math.cos(th)];
  });
}
/** أبعد امتداد 176×156، فيُقيَّد المركز على 192px من كل حافة (§4). */
export const EDGE = 192;
export const clampCenter = (x: number, y: number, w: number, hgt: number): [number, number] =>
  [Math.min(Math.max(x, EDGE), w - EDGE), Math.min(Math.max(y, EDGE), hgt - EDGE)];

/** ثبات المؤشر (§4): حركة < 6px خلال 160ms من عيّنات `dragover`. */
export const STILL_MS = 160, STILL_PX = 6, UNPIN_PX = 200;
export interface Sample { x: number; y: number; t: number }
/** يضيف العيّنة ويُبقي أحدث عيّنة قبل النافذة وما بعدها، ويعيد: هل ثبت المؤشر طوال النافذة. */
export function settle(samples: Sample[], p: Sample): boolean {
  samples.push(p);
  while (samples.length > 1 && samples[1]!.t <= p.t - STILL_MS) samples.shift();
  return samples[0]!.t <= p.t - STILL_MS && samples.every((q) => Math.hypot(q.x - p.x, q.y - p.y) < STILL_PX);
}

/* ───────── الطبقة ───────── */
export interface WheelHost {
  /** الرئيسية ظاهرة، بلا ورقة ولا عمل جارٍ. */
  active: () => boolean;
  available: (t: WheelTool) => boolean;
  /** أيقونة الأداة واسمها من مصدرهما (السجلّ، وبلاطات الرئيسية). */
  tile: (t: WheelTool) => { icon: Node; label: string };
  /**
   * يفتح الأداة بالملفات. يعيد خياراتٍ تتفتّح بها الدائرة من جديد عند موضعها (الخيار لم يصلح بعد قراءة الملف)،
   * أو لا شيء: فُتحت الأداة، أو أُغلق وظهر الخطأ في الرئيسية.
   */
  pick: (t: WheelTool, files: File[]) => Promise<WheelChoice | void>;
  /** أُغلقت الطبقة (يُغلق ما فتحه `pick` ولم يُستعمل). */
  closed: () => void;
}

const WIDE = "(min-width: 1024px) and (min-height: 400px) and (hover: hover) and (pointer: fine)";
const TILE_W = 112, TILE_H = 72;

interface Layer {
  root: HTMLElement; core: HTMLElement; at: HTMLElement;
  /** track: تتبع المؤشر. pinned: ثبتت وتفتّحت أثناء السحب (أ). open: بعد الإفلات (ب). */
  phase: "track" | "pinned" | "open";
  /** ما قُرئ أثناء السحب (أ)، وإلا null (ب). */
  sniffed: WheelChoice | null;
  cx: number; cy: number; pin: [number, number];
  samples: Sample[];
  tiles: { el: HTMLButtonElement; tool: WheelTool; x: number; y: number }[];
  armed: HTMLButtonElement | null;
  center: HTMLButtonElement | null;
  files: File[];
  busy: boolean;
}

/** يثبّت مستمعي السحب على المستند كله: خارج الرئيسية (وعلى الشاشات الصغيرة) يُتجاهل إسقاط الملفات حتى لا يفتحها المتصفّح. */
export function installDropWheel(host: WheelHost) {
  let layer: Layer | null = null;
  let leaveTimer = 0;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enabled = () => matchMedia(WIDE).matches && host.active();
  const hasFiles = (dt: DataTransfer | null): dt is DataTransfer => !!dt && [...dt.types].includes("Files");

  /** (أ) إن كان نوع كل عنصر مقروءاً أثناء السحب، وإلا null. */
  function sniff(dt: DataTransfer): WheelChoice | null {
    const items = [...dt.items];
    if (!items.length || items.some((i) => i.kind !== "file" || !i.type)) return null;
    return wheelOptions({ kinds: items.map((i) => kindOf(i.type)!), available: host.available });
  }

  function place(l: Layer, x: number, y: number) {
    [l.cx, l.cy] = clampCenter(x, y, innerWidth, innerHeight);
    l.core.style.setProperty("--cx", `${l.cx}px`);
    l.core.style.setProperty("--cy", `${l.cy}px`);
  }

  function create(sniffed: WheelChoice | null): Layer {
    const core = h("div", { class: "dw-core" });
    const at = h("div", { class: "dw-at" });
    const root = h("div", { class: "dw", "data-test": "drop-wheel" }, core);
    core.append(h("div", { class: "dw-ring", "aria-hidden": "true" }), at);
    const l: Layer = { root, core, at, phase: "track", sniffed, cx: 0, cy: 0, pin: [0, 0], samples: [], tiles: [], armed: null, center: null, files: [], busy: false };
    if (sniffed && "message" in sniffed) message(l, sniffed.message);
    else at.replaceChildren(h("div", { class: "dw-pill", "data-test": "dw-title" }, icon("folder"), h("span", {}, SDW.dropHere)));
    root.addEventListener("click", (e) => {
      if (l.busy || l.phase !== "open") return;
      // الرسالة: نقرة في أي مكان. والخيارات: خارج البلاطات
      if (l.tiles.length && (e.target as Element).closest(".dw-tile, .dw-center")) return;
      close();
    });
    document.body.append(root);
    return l;
  }

  function message(l: Layer, m: WheelMessage) {
    // «غير مدعوم» جملتان كلٌّ في span كتلة (صقل 1.0.2 §١٠)، والمسافة بينهما للقارئ الآلي ولنصّ العنصر
    const text = m === "mixed" ? [SDW.mixed] : m === "many-word" ? [SDW.manyWord] : [h("span", {}, SDW.unsupported), " ", h("span", {}, SDW.unsupportedAccepted)];
    l.at.replaceChildren(h("p", { class: "alert dw-msg", role: "alert", "data-test": "dw-message" }, ...text));
  }

  function bloom(l: Layer, tools: WheelTool[]) {
    for (const t of l.tiles) t.el.remove();
    l.tiles = slots(tools.length).map(([x, y], i) => {
      const { icon: ic, label } = host.tile(tools[i]!);
      const el = h("button", { class: "dw-tile", type: "button", "data-test": `dw-${tools[i]}`, onclick: () => void choose(l, tools[i]!, el) }, ic, h("span", {}, toolName(label))) as HTMLButtonElement;
      el.style.setProperty("--x", `${x}px`);
      el.style.setProperty("--y", `${y}px`);
      el.style.setProperty("--i", String(i));
      return { el, tool: tools[i]!, x, y };
    });
    l.core.append(...l.tiles.map((t) => t.el));
    l.root.classList.add("bloomed");
  }

  function wilt(l: Layer) {
    for (const t of l.tiles) t.el.remove();
    l.tiles = [];
    l.armed = null;
    l.root.classList.remove("bloomed");
  }

  function arm(l: Layer, el: HTMLButtonElement | null) {
    if (l.armed === el) return;
    l.armed?.classList.remove("armed");
    el?.classList.add("armed");
    l.armed = el;
  }

  const tileAt = (l: Layer, x: number, y: number) =>
    l.tiles.find((t) => Math.abs(x - (l.cx + t.x)) <= TILE_W / 2 && Math.abs(y - (l.cy + t.y)) <= TILE_H / 2)?.el ?? null;

  /** (ب): الخيارات أو الرسالة عند موضع الإفلات، وزرّ الإغلاق في المركز. */
  function open(l: Layer, choice: WheelChoice, x: number, y: number) {
    l.phase = "open";
    place(l, x, y);
    wilt(l);
    if (!l.center) {
      l.center = h("button", { class: "dw-center", type: "button", "aria-label": S.close, "data-test": "dw-close", onclick: () => { if (!l.busy) close(); } }, icon("close")) as HTMLButtonElement;
      l.core.append(l.center);
    }
    if ("message" in choice) { message(l, choice.message); l.center.focus(); return; }
    bloom(l, choice.tools);
    l.tiles[0]!.el.focus();
  }

  async function choose(l: Layer, tool: WheelTool, el: HTMLButtonElement) {
    if (l.busy || layer !== l) return;
    l.busy = true;
    arm(l, null);
    el.setAttribute("aria-busy", "true");
    el.firstElementChild!.replaceWith(h("span", { class: "spinner light", "aria-hidden": "true" }));
    for (const t of l.tiles) if (t.el !== el) t.el.disabled = true;
    // إلغاء الفتح لا يكون نظيفاً (pdf.js لا يُقطع في منتصفه): يُعطَّل زرّ المركز أثناء الانتظار
    if (l.center) l.center.disabled = true;
    let again: WheelChoice | void;
    try { again = await host.pick(tool, l.files); } catch { again = undefined; }
    if (layer !== l) return;
    l.busy = false;
    if (l.center) l.center.disabled = false;
    if (again) open(l, again, l.cx, l.cy);
    else close();
  }

  function close() {
    clearTimeout(leaveTimer);
    const l = layer;
    if (!l) return;
    layer = null;
    if (l.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    l.root.classList.add("closing");
    setTimeout(() => l.root.remove(), reduced() ? 150 : 120);
    host.closed();
  }
  const drop = () => { if (layer) { layer.root.remove(); layer = null; host.closed(); } };

  document.addEventListener("dragover", (e) => {
    const dt = e.dataTransfer;
    if (!hasFiles(dt)) return; // سحبٌ داخل الصفحة لا يُمسّ
    e.preventDefault();
    clearTimeout(leaveTimer);
    if (!enabled() || layer?.busy) { dt.dropEffect = "none"; return; }
    if (layer?.phase === "open") drop(); // سحب جديد يُغلق ما بعد الإفلات
    const l = layer ??= create(sniff(dt));
    const x = e.clientX, y = e.clientY;
    if (l.phase === "pinned") {
      if (Math.hypot(x - l.pin[0], y - l.pin[1]) > UNPIN_PX) {
        l.phase = "track";
        l.samples = [];
        wilt(l);
      } else {
        arm(l, tileAt(l, x, y));
        dt.dropEffect = l.armed ? "copy" : "none";
        return;
      }
    }
    place(l, x, y);
    const still = settle(l.samples, { x, y, t: e.timeStamp });
    if (l.sniffed && "message" in l.sniffed) { dt.dropEffect = "none"; return; }
    dt.dropEffect = "copy";
    if (still && l.sniffed) {
      l.phase = "pinned";
      l.pin = [x, y];
      bloom(l, l.sniffed.tools);
      arm(l, tileAt(l, x, y));
    }
  });

  document.addEventListener("dragleave", (e) => {
    if (!layer || layer.phase === "open" || e.relatedTarget) return;
    // مغادرة النافذة: لا يتبعها dragover. والتنقّل بين عناصر الصفحة يتبعه dragover قبل المهلة
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(close, 150);
  });

  document.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!hasFiles(dt)) return;
    e.preventDefault();
    clearTimeout(leaveTimer);
    if (!enabled() || layer?.busy) return;
    const l = layer ??= create(null);
    const files = [...dt.files];
    l.files = files;
    if (l.phase === "pinned") {
      const t = l.tiles.find((x) => x.el === l.armed);
      if (t) void choose(l, t.tool, t.el);
      else close();
      return;
    }
    if (l.sniffed && "message" in l.sniffed) { close(); return; }
    const choice = wheelOptions({ kinds: files.map((f) => kindOf(f.type, f.name) ?? "other"), available: host.available });
    if (!choice) { close(); return; }
    open(l, choice, e.clientX, e.clientY);
  });

  document.addEventListener("keydown", (e) => {
    if (!layer) return;
    if (e.key === "Escape") {
      if (layer.busy) return;
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || layer.phase !== "open") return;
    // التركيز يدور داخل الطبقة
    const els = [...layer.tiles.map((t) => t.el), ...(layer.center ? [layer.center] : [])].filter((b) => !b.disabled);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]!.focus();
  });
}
