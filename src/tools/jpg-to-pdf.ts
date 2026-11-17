/**
 * «صور إلى PDF» على قالب `.tool` (docs/logs/phase1/layout-lama.md): الحالة الفارغة ورقةٌ و«اختر الصور»، ثم قائمة الصور
 * بصفوف الدمج نفسها (عمود السهمين مقبضُ السحب، وحقل الرقم، والمصغّر والاسم)، والخيارات في العمود، ثم «حوّل إلى PDF».
 * الترتيب الأولي بالاسم. والبناء في jpg-to-pdf-core.ts: JPEG ببايتاته، وPNG كما هي، وما سواهما JPEG من canvas هنا.
 */
import { S, ar, pagesCount, rangeError } from "../strings";
import { h, icon } from "../dom";
import { toolName } from "../tool-name";
import { parsePosition } from "../numerals";
import { move } from "../page-ops";
import { attachReorder, dragging, liveIndex } from "../drag-reorder";
import { baseName } from "../split-pdf";
import { MAX_IMAGES, imagesToPdf, sniff, sortByName, type ImageKind, type PageSize, type PdfImage } from "./jpg-to-pdf-core";
import { SJP } from "./jpg-to-pdf-strings";
import { toolArt } from "./tool-art";
import { askLeave } from "../leave-ask";
import { guardLeave } from "../leave-guard";
import type { ToolHost } from "./host";

/** ما يُحوَّل بـcanvas لا يتجاوز حدّ لوحة الرسم في iOS. */
const MAX_DRAW_PIXELS = 16_777_216;
const JPEG_QUALITY = 0.92;
const FLIP_MS = 220;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Item { id: string; file: File; name: string; kind: ImageKind; bytes: Uint8Array; url: string }

function topbar(host: ToolHost, items: () => Item[]) {
  return h("header", { class: "topbar" },
    h("button", {
      class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back",
      onclick: () => {
        const go = () => { release(items()); host.exit(); };
        if (!items().length) go(); // نافذة «لم يُحفظ» في الصفحة بدل confirm الذي يكبته Safari iOS (src/leave-ask.ts)
        else void askLeave(S.leaveDialog.titleFile, undefined, document.querySelector<HTMLElement>('[data-test="back"]')).then((a) => { if (a === "exit") go(); });
      },
    }, icon("back")),
    h("h1", { class: "route-title" }, toolName(SJP.name)),
    h("span", { class: "icon-spacer" }));
}

/** شاشة العمل الحالية: صورٌ لم تُحفظ ملفاً بترتيبها ومقاسها الآن. مغادرة الصفحة بها تُطلق نافذة المتصفح (src/leave-guard.ts). */
let unsavedWork = () => false;
let guarded = false; // يُسجَّل في أول شاشة عمل

const release = (items: Item[]) => { for (const it of items) URL.revokeObjectURL(it.url); };

/** منتقي الصور: حقلٌ مخفيّ في الشاشة نفسها (Safari على iOS لا يفتح منتقياً خارج الصفحة). */
function imageInput(onFiles: (files: File[]) => void) {
  const input = h("input", { type: "file", accept: "image/*,.heic,.heif", multiple: true, hidden: true, "data-test": "jp-input" }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) onFiles(files);
  });
  return input;
}

/** صيغة لا يفكّها هذا المتصفح (HEIC وأخواتها) لا صورةٌ تالفة: صندوق ftyp في أولها، أو اسمٌ أو نوعٌ يقول ذلك. */
function unsupportedFormat(file: File, b: Uint8Array): boolean {
  const ftyp = b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  return ftyp || /\.(heic|heif|avif|tiff?)$/i.test(file.name) || /image\/(heic|heif|avif|tiff)/i.test(file.type);
}

/** يقرأ الصورة ويتحقّق أن المتصفح يفكّها. يُرجع الصورة، أو نصّ الخطأ المعتمد. */
async function readImage(file: File): Promise<Item | string> {
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { return S.badImage; }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    if (!im.naturalWidth || !im.naturalHeight) throw new Error("empty");
  } catch {
    URL.revokeObjectURL(url);
    return unsupportedFormat(file, bytes) ? SJP.heic : S.badImage;
  }
  return { id: crypto.randomUUID(), file, name: file.name, kind: sniff(bytes), bytes, url };
}

/** WebP وHEIC وغيرهما، أو JPEG لم يقرأه pdf-lib: تُرسم على أبيض (لا سواد مكان الشفافية) باتجاه EXIF، ثم JPEG. */
async function toJpeg(file: File): Promise<Uint8Array> {
  let src: CanvasImageSource, w: number, hh: number, close = () => {};
  let bmp: ImageBitmap | null = null;
  if (typeof createImageBitmap === "function") {
    for (const opts of [{ imageOrientation: "from-image" } as ImageBitmapOptions, undefined]) {
      try { bmp = await createImageBitmap(file, opts); break; } catch { /* القيمة غير مدعومة أو الصيغة: التالي */ }
    }
  }
  if (bmp) { const b = bmp; src = b; w = b.width; hh = b.height; close = () => b.close(); }
  else {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.src = url;
    try { await im.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
    src = im; w = im.naturalWidth; hh = im.naturalHeight; close = () => URL.revokeObjectURL(url);
  }
  try {
    const k = Math.min(1, Math.sqrt(MAX_DRAW_PIXELS / (w * hh)));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.floor(w * k));
    c.height = Math.max(1, Math.floor(hh * k));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", JPEG_QUALITY));
    c.width = c.height = 0; // يحرّر ذاكرة اللوحة في Safari
    if (!blob) throw new Error("jpeg");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    close();
  }
}

/** الحالة الفارغة: الورقة، والوصف، و«اختر الصور»، ثم الخصوصية وتذييل مَحالة. */
export function showJpgToPdf(host: ToolHost, files?: File[]) {
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }),
    toolArt("jpg-to-pdf")); // رسم نتيجة الأداة بعد الأسطر كما في showEmpty (src/tools/tool-art.ts)
  const alert = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "jp-alert" });
  const pick = h("button", { class: "btn primary block", type: "button", "data-test": "jp-pick" }, SJP.pick) as HTMLButtonElement;
  const input = imageInput((files) => void add(files));
  pick.addEventListener("click", () => input.click());
  host.app.replaceChildren(topbar(host, () => []), h("main", { class: "start tool-empty", "data-test": "tool-jpg-to-pdf" },
    sheet, h("p", { class: "tool-lead" }, SJP.lead), pick, alert, input, ...host.footer("jpg-to-pdf")));
  window.scrollTo(0, 0);
  if (files) return add(files); // صور مُسقطة (دائرة السحب في main.ts): بمسار «اختر الصور» نفسه

  async function add(files: File[]) {
    alert.hidden = true;
    if (files.length > MAX_IMAGES) { alert.textContent = SJP.tooMany(MAX_IMAGES); alert.hidden = false; return; }
    pick.disabled = true;
    pick.setAttribute("aria-busy", "true");
    pick.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), SJP.pick);
    const { items, error } = await readAll(files);
    if (!items.length) {
      pick.disabled = false;
      pick.removeAttribute("aria-busy");
      pick.replaceChildren(SJP.pick);
      alert.textContent = error ?? S.badImage;
      alert.hidden = false;
      return;
    }
    showWork(host, sortByName(items), error);
  }
}

async function readAll(files: File[]) {
  const items: Item[] = [];
  let error: string | null = null;
  for (const f of files) {
    const r = await readImage(f);
    if (typeof r === "string") error ??= r;
    else items.push(r);
  }
  return { items, error };
}

function seg<T extends string>(name: string, label: string, opts: [T, string][], value: T, onChange: (v: T) => void) {
  const id = `${name}-label`;
  return h("div", { class: "tool-field" },
    h("span", { class: "tool-label", id }, label),
    h("div", { class: "tool-seg", role: "radiogroup", "aria-labelledby": id, "data-test": name },
      ...opts.map(([v, text]) => {
        const input = h("input", { class: "sr-only", type: "radio", name, value: v, checked: v === value, "data-test": `${name}-${v}` }) as HTMLInputElement;
        input.addEventListener("change", () => input.checked && onChange(v));
        return h("label", {}, input, h("span", {}, text));
      })));
}

function showWork(host: ToolHost, start: Item[], firstError: string | null) {
  let items = start;
  let size: PageSize = "a4";
  let busy = false;

  const alert = h("p", { class: "alert", role: "alert", hidden: !firstError, "data-test": "jp-alert" }, firstError ?? "");
  const list = h("ol", { class: "merge-list img-list", "data-test": "jp-list" });
  const context = h("p", { class: "tool-context", "data-test": "jp-context" });
  const run = h("button", { class: "btn primary block", type: "button", "data-test": "jp-run" }, SJP.run) as HTMLButtonElement;
  const addBtn = h("button", { class: "btn source", type: "button", "data-test": "jp-add" }, icon("plus"), SJP.add) as HTMLButtonElement;
  const input = imageInput((files) => void more(files));
  addBtn.addEventListener("click", () => input.click());
  const header = topbar(host, () => items);
  let savedKey = ""; // ما حُفظ: الترتيب والمقاس، فتغييرهما بعد الحفظ عملٌ جديد
  const workKey = () => `${size}|${items.map((it) => it.id).join(",")}`;
  unsavedWork = () => header.isConnected && items.length > 0 && workKey() !== savedKey;
  if (!guarded) { guarded = true; guardLeave(() => unsavedWork()); }
  const options = h("div", { class: "tool-options" },
    addBtn,
    seg<PageSize>("jp-size", SJP.sizeLabel, [["a4", SJP.sizeA4], ["image", SJP.sizeImage]], size, (v) => { size = v; }));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, alert, run, input));
  const work = h("section", { class: "tool-work" }, list);
  host.app.replaceChildren(header, h("main", { class: "tool", "data-test": "tool-jpg-to-pdf" }, work, rail));
  window.scrollTo(0, 0);
  paint();

  async function more(files: File[]) {
    alert.hidden = true;
    if (items.length + files.length > MAX_IMAGES) { alert.textContent = SJP.tooMany(MAX_IMAGES); alert.hidden = false; return; }
    addBtn.disabled = true;
    const r = await readAll(files);
    addBtn.disabled = false;
    items = [...items, ...sortByName(r.items)]; // الجديدة بعد الموجودة، مرتّبةً بأسمائها
    if (r.error) { alert.textContent = r.error; alert.hidden = false; }
    paint();
  }

  const rowTops = () => new Map([...list.querySelectorAll<HTMLElement>(".merge-row")].map((r) => [r.dataset.id!, r.getBoundingClientRect().top]));
  function flip(first: Map<string, number>) {
    if (reducedMotion()) return;
    for (const r of list.querySelectorAll<HTMLElement>(".merge-row")) {
      const dy = (first.get(r.dataset.id!) ?? 0) - r.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: "cubic-bezier(.23, 1, .32, 1)" });
    }
  }
  const find = (id: string, test: string) => list.querySelector<HTMLElement>(`[data-id="${id}"] [data-test="${test}"]`);

  /** نقل صورة بالرقم أو بالسهم: إعادة رسم القائمة، ثم FLIP، والتركيز يتبع الصورة، وإعلان مرة واحدة. */
  function moveItem(it: Item, i: number, to: number, focus: () => HTMLElement | null) {
    const first = rowTops();
    items = move(items, i, to);
    paint();
    flip(first);
    focus()?.focus();
    host.announce(S.fileMoved(it.name, to + 1, items.length));
  }

  function paint() {
    const n = items.length;
    context.textContent = pagesCount(n);
    list.replaceChildren(...items.map((it, i) => {
      const movable = n >= 2;
      const arrow = (dir: -1 | 1) => {
        const test = dir < 0 ? "img-up" : "img-down", other = dir < 0 ? "img-down" : "img-up";
        const off = !movable || (dir < 0 ? i === 0 : i === n - 1);
        return h("button", {
          type: "button", "aria-label": dir < 0 ? S.moveFileUp(it.name) : S.moveFileDown(it.name), "aria-disabled": off ? "true" : undefined, "data-test": test,
          onclick: () => {
            if (off || busy) return;
            moveItem(it, i, i + dir, () => find(it.id, find(it.id, test)?.getAttribute("aria-disabled") === "true" ? other : test));
          },
        }, icon(dir < 0 ? "up" : "down"));
      };
      const col = h("div", { class: "reorder-col", "data-test": "reorder-col" }, arrow(-1), arrow(1));
      attachReorder({
        handle: col, axis: "y", zone: 48, lift: 1.02,
        elements: () => [...list.querySelectorAll<HTMLElement>(".merge-row")],
        index: () => i,
        canDrag: () => movable && !busy,
        band: () => ({ top: header.getBoundingClientRect().bottom, bottom: innerHeight }),
        onStart: () => { run.disabled = true; },
        onLive: (from, to) => list.querySelectorAll<HTMLInputElement>(".order").forEach((o, k) => (o.value = ar(liveIndex(k, from, to) + 1))),
        onDrop: (from, to) => { if (busy) return; items = move(items, from, to); host.announce(S.fileMoved(it.name, to + 1, n)); },
        onEnd: () => { run.disabled = false; paint(); list.querySelector<HTMLElement>(`[data-id="${it.id}"] .reorder-col button:not([aria-disabled="true"])`)?.focus(); },
      });
      const err = h("p", { class: "alert row-alert", role: "alert", hidden: true, id: `err-${it.id}` });
      const order = h("input", {
        class: "order", type: "text", inputmode: "numeric", enterkeyhint: "done", autocomplete: "off",
        value: ar(i + 1), "aria-label": S.orderLabel(it.name), "aria-describedby": `err-${it.id}`, "data-test": "order", disabled: n < 2,
      }) as HTMLInputElement;
      let applied = false; // Chrome يطلق change على الحقل المركَّز وهو يُزال عند إعادة الرسم، فلا يُنقل مرّتين
      const apply = () => {
        if (applied || dragging || busy || !order.isConnected) return;
        const p = parsePosition(order.value, n);
        if (p === null) { err.textContent = rangeError(n); err.hidden = false; order.setAttribute("aria-invalid", "true"); return; }
        err.hidden = true; order.removeAttribute("aria-invalid");
        if (p - 1 === i) { order.value = ar(i + 1); return; }
        applied = true;
        moveItem(it, i, p - 1, () => list.querySelector<HTMLInputElement>(`[data-id="${it.id}"] .order`));
      };
      order.addEventListener("focus", () => order.select());
      order.addEventListener("change", apply);
      order.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
      const thumb = h("img", { class: "img-thumb", src: it.url, alt: "", draggable: "false", decoding: "async", loading: "lazy" });
      const meta = h("div", { class: "meta" }, h("p", { class: "name", dir: "rtl" }, h("bdi", {}, it.name)));
      return h("li", { class: "merge-row img-row", "data-id": it.id, "data-test": "img-row" }, col, order, thumb, meta, err);
    }));
  }

  run.addEventListener("click", async () => {
    if (busy || dragging) return;
    busy = true;
    run.setAttribute("aria-busy", "true");
    run.disabled = true;
    addBtn.disabled = true;
    alert.hidden = true;
    for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = true;
    for (const el of list.querySelectorAll<HTMLInputElement>(".order")) el.disabled = true;
    run.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), SJP.run);
    const order = [...items];
    let out: File | null = null;
    try {
      const images: PdfImage[] = [];
      for (const it of order) {
        if (it.kind === "jpeg" || it.kind === "png") images.push({ kind: it.kind, bytes: it.bytes });
        else images.push({ kind: "jpeg", bytes: await toJpeg(it.file) });
      }
      const bytes = await imagesToPdf(images, size, (i) => toJpeg(order[i]!.file));
      out = new File([bytes as BlobPart], `${baseName(order[0]!.name.replace(/\.[^.]+$/, ""))}.pdf`, { type: "application/pdf" });
    } catch {
      alert.textContent = S.saveFailed;
      alert.hidden = false;
    } finally {
      busy = false;
      run.removeAttribute("aria-busy");
      run.disabled = false;
      addBtn.disabled = false;
      for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = false;
      for (const el of list.querySelectorAll<HTMLInputElement>(".order")) el.disabled = items.length < 2;
      run.replaceChildren(SJP.run);
    }
    if (out) { savedKey = `${size}|${order.map((it) => it.id).join(",")}`; host.saved(out, order.length, "jpg-to-pdf"); }
  });
}
