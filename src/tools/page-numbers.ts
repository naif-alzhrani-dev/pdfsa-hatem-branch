/**
 * «ترقيم الصفحات» على قالب `.tool` (docs/logs/phase1/layout-lama.md): الحالة الفارغة ورقةٌ وزرّ اختيار، ثم المعاينة
 * والخيارات (الموضع، والرقم الأول، والأرقام)، ثم «رقّم الصفحات» فورقة الحفظ الموجودة.
 * الرقم يُرسم بـcanvas بخطّه المختار (src/font-pick.ts) وحبر المنصة الأسود (`textCanvas` في src/text-item.ts)، ثم PNG، والكتابة في page-numbers-core.ts.
 * والرقعة ليست في الشبكة: الرقم FONT_PT نقطة، أصغر من 18px (قرار نايف «تختفي»).
 */
import { S, pagesCount } from "../strings";
import { h } from "../dom";
import { INK } from "../ink";
import { textCanvas } from "../text-item";
import type { WebFontKey } from "../font-load";
import { familyOf, fontPicker, readyInitial } from "../font-pick";
import { toLatinDigits } from "../numerals";
import { outputName } from "../out-name";
import { DEFAULTS, FONT_PT, MARGIN_BOTTOM, MARGIN_SIDE, START_MAX, numberLabel, numberPages, type Digits, type NumberImage, type NumberOpts, type NumberPos } from "./page-numbers-core";
import { SPN } from "./page-numbers-strings";
import type { OpenedPdf, ToolHost } from "./host";
import { previewFirstPage, seg, showEmpty, topbar } from "./tool-ui";

const DPI = 4; // بكسل لكل نقطة في صورة الرقم (≥ 4x، كالتاريخ والنصّ)

/** حجم الرقم بالبكسل (CSS) عند 100٪: ما تُقاس به الرقعة (18px). */
export const NUMBER_PX = (FONT_PT * 96) / 72;

/** صورة الرقم: سطر بخطّه (500) وحبر المنصة الأسود، حجمه FONT_PT نقطة. */
async function renderNumber(label: string, font?: WebFontKey): Promise<NumberImage> {
  const c = await textCanvas({ text: label, ink: "black", font }, FONT_PT * DPI);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  if (!blob) throw new Error("png");
  return { png: new Uint8Array(await blob.arrayBuffer()), w: c.width / DPI, h: c.height / DPI };
}

/** الحالة الفارغة: الورقة، والوصف، و«اختر ملفاً»، ثم الخصوصية وتذييل مَحالة (tool-ui.ts). */
export function showPageNumbers(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً («أدوات أخرى» بعد الحفظ في main.ts)
  showEmpty(host, { slug: "page-numbers", p: "pn", name: SPN.name, lead: SPN.lead }, (src) => showWork(host, src), error);
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  const o: NumberOpts = { ...DEFAULTS };
  // عنصر واحد، فالخط له: يبدأ بآخر خط اختاره المستخدم (والرقعة المحفوظة تُرسم هنا ببلكس ولا يُكتب فوقها)
  const picker = fontPicker({ minPx: NUMBER_PX, testId: "pn-font", onChange: () => paintMark() });

  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const mark = h("span", { class: "pn-mark", "aria-hidden": "true", "data-test": "pn-mark" });
  const preview = h("div", { class: "pn-preview", "data-test": "pn-preview" }, canvas, mark);

  const start = h("input", {
    class: "split-input tool-input", id: "pn-start", type: "text", inputmode: "numeric", dir: "rtl", autocomplete: "off",
    maxlength: 4, enterkeyhint: "done", "data-test": "pn-start",
  }) as HTMLInputElement;
  start.value = numberLabel(o.start, "arab");
  const readStart = () => {
    const s = toLatinDigits(start.value).trim();
    const v = /^\d{1,4}$/.test(s) ? Number(s) : NaN;
    return v >= 1 && v <= START_MAX ? v : null;
  };
  start.addEventListener("input", () => {
    const v = readStart();
    start.setAttribute("aria-invalid", String(v === null));
    if (v !== null) { o.start = v; paintMark(); }
    run.disabled = v === null;
  });
  start.addEventListener("blur", () => { // ما لا يصحّ يعود إلى آخر رقم صحيح
    if (readStart() === null) { start.value = numberLabel(o.start, o.digits); start.setAttribute("aria-invalid", "false"); run.disabled = false; }
  });

  const run = h("button", { class: "btn primary block", type: "button", "data-test": "pn-run" }, SPN.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true });
  const options = h("div", { class: "tool-options" },
    seg<NumberPos>("pn-pos", SPN.posLabel, [["right", SPN.posRight], ["center", SPN.posCenter], ["left", SPN.posLeft]], o.pos, (v) => { o.pos = v; paintMark(); }),
    h("div", { class: "tool-field" }, h("label", { class: "tool-label", for: "pn-start" }, SPN.startLabel), start),
    picker.el,
    seg<Digits>("pn-digits", SPN.digitsLabel, [["arab", SPN.digitsArab], ["latn", SPN.digitsLatn]], o.digits, (v) => { o.digits = v; paintMark(); }));
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "pn-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, fail, run));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(topbar(host, SPN.name), h("main", { class: "tool", "data-test": "tool-page-numbers" }, work, rail));
  window.scrollTo(0, 0);

  /* المعاينة: الصفحة الأولى بمقاس يتّسع له المكان، والرقم فوقها بالمقياس نفسه */
  const { scale } = await previewFirstPage(src, work, preview, canvas);
  mark.style.color = INK.black;
  function paintMark() {
    mark.textContent = numberLabel(o.start, o.digits);
    mark.style.fontFamily = familyOf(picker.value());
    mark.style.fontSize = `${Math.max(8, FONT_PT * scale)}px`;
    mark.style.bottom = `${MARGIN_BOTTOM * scale}px`;
    mark.style.left = o.pos === "left" ? `${MARGIN_SIDE * scale}px` : o.pos === "center" ? "50%" : "auto";
    mark.style.right = o.pos === "right" ? `${MARGIN_SIDE * scale}px` : "auto";
    mark.classList.toggle("center", o.pos === "center");
  }
  paintMark();
  readyInitial(picker, () => paintMark());

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy")) return;
    run.setAttribute("aria-busy", "true");
    run.disabled = true;
    fail.hidden = true;
    for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = true;
    run.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), SPN.running);
    let out: File | null = null;
    try {
      const bytes = await numberPages(src.bytes, o, (label) => renderNumber(label, picker.value()));
      out = new File([bytes as BlobPart], outputName("numbered", src.name, false), { type: "application/pdf" });
    } catch {
      fail.textContent = S.saveFailed;
      fail.hidden = false;
    } finally {
      run.removeAttribute("aria-busy");
      run.disabled = false;
      for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = false;
      run.replaceChildren(SPN.run);
    }
    if (out) host.saved(out, n, "page-numbers");
  });
}
