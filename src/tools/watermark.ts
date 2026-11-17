/**
 * «علامة مائية» على قالب `.tool`: الحالة الفارغة، ثم المعاينة (الصفحة الأولى وفوقها العلامة بمقياسها) والخيارات
 * (النصّ حتى TEXT_MAX، وقوة الظهور)، ثم «أضف العلامة» فورقة الحفظ الموجودة.
 * النصّ يُرسم بـcanvas بخطّه المختار (src/font-pick.ts، بلكس خطّ المنصة) واتجاهه من `baseDir`، فيصحّ تشكيل العربية، ثم PNG، والكتابة في watermark-core.ts.
 */
import { S, pagesCount } from "../strings";
import { h } from "../dom";
import { TEXT_MAX, baseDir } from "../text-item";
import type { WebFontKey } from "../font-load";
import { ensurePickFont, familyOf, fontPicker, readyInitial } from "../font-pick";
import { outputName } from "../out-name";
import { ANGLE, FONT_MAX_PT, GRAY, OPACITY, markSize, watermarkPages, type MarkImage, type Strength } from "./watermark-core";
import { SWM } from "./watermark-strings";
import type { OpenedPdf, ToolHost } from "./host";
import { busy, previewFirstPage, seg, showEmpty, topbar } from "./tool-ui";

const DPI = 4; // بكسل لكل نقطة عند FONT_MAX_PT
const CANVAS_MAX = 4000; // أعرض لوحة: النصّ الطويل يُرسم بخطّ أصغر فلا يتجاوزها

/** صورة العلامة: سطر بخطّها (500) رماديّ مصمت (العتمة تُضبط في الملف)، بعرضها وارتفاعها بالنقاط عند FONT_MAX_PT. */
export async function renderMark(text: string, font?: WebFontKey): Promise<MarkImage> {
  await ensurePickFont(font);
  const family = familyOf(font);
  const fontAt = (px: number) => `500 ${px}px ${family}`;
  await document.fonts.load(fontAt(100), text);
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d")!;
  ctx.font = fontAt(100);
  const px = Math.min(FONT_MAX_PT * DPI, (100 * CANVAS_MAX) / Math.max(1, ctx.measureText(text).width * 1.25));
  ctx.font = fontAt(px);
  const pad = Math.ceil(px * 0.12);
  c.width = Math.ceil(ctx.measureText(text).width + 2 * pad);
  c.height = Math.ceil(px * 1.35 + 2 * pad);
  ctx = c.getContext("2d")!; // تغيير المقاس يعيد ضبط اللوحة
  ctx.font = fontAt(px);
  ctx.direction = baseDir(text);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = GRAY;
  ctx.fillText(text, c.width / 2, c.height / 2);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
  if (!blob) throw new Error("png");
  const ptPerPx = FONT_MAX_PT / px; // الصورة بمقاسها عند الخطّ الأكبر
  return { png: new Uint8Array(await blob.arrayBuffer()), w: c.width * ptPerPx, h: c.height * ptPerPx };
}

export function showWatermark(host: ToolHost, error?: string, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً («أدوات أخرى» بعد الحفظ في main.ts)
  showEmpty(host, { slug: "watermark", p: "wm", name: SWM.name, lead: SWM.lead }, (src) => showWork(host, src), error);
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  let strength: Strength = "light";
  // عنصر واحد، فالخط له: يبدأ بآخر خط اختاره المستخدم، وتغييره يصير خطّ ما بعده (قرار نايف)
  const picker = fontPicker({ testId: "wm-font", onChange: () => paintMark() });

  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const mark = h("span", { class: "wm-mark", "aria-hidden": "true", "data-test": "wm-mark" });
  const preview = h("div", { class: "pn-preview", "data-test": "wm-preview" }, canvas, mark);

  const input = h("input", {
    class: "split-input tool-input", id: "wm-text", type: "text", dir: "auto", autocomplete: "off",
    maxlength: TEXT_MAX, enterkeyhint: "done", placeholder: SWM.textExample, "data-test": "wm-text",
  }) as HTMLInputElement;
  const text = () => input.value.trim();
  input.addEventListener("input", () => { run.disabled = !text(); paintMark(); });

  const run = h("button", { class: "btn primary block", type: "button", "data-test": "wm-run", disabled: true }, SWM.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true });
  const options = h("div", { class: "tool-options" },
    h("div", { class: "tool-field" }, h("label", { class: "tool-label", for: "wm-text" }, SWM.textLabel), input),
    picker.el,
    seg<Strength>("wm-strength", SWM.strengthLabel, [["light", SWM.light], ["medium", SWM.medium]], strength, (v) => { strength = v; paintMark(); }));
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "wm-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, fail, run));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(topbar(host, SWM.name), h("main", { class: "tool", "data-test": "tool-watermark" }, work, rail));
  window.scrollTo(0, 0);

  /* المعاينة: العلامة فوق الصفحة الأولى بالمقياس نفسه، بطولها في الملف (FIT من القطر على الأكثر) */
  const { scale, pw, ph } = await previewFirstPage(src, work, preview, canvas);
  mark.style.color = GRAY;
  function paintMark() {
    const t = text();
    mark.textContent = t;
    mark.dir = baseDir(t);
    mark.style.fontFamily = familyOf(picker.value());
    mark.style.opacity = String(OPACITY[strength]);
    mark.style.fontSize = `${FONT_MAX_PT * scale}px`;
    mark.style.transform = `translate(-50%, -50%) rotate(-${ANGLE}deg)`;
    if (!t) return;
    const w = mark.offsetWidth; // بخطّه الأكبر، ثم يُصغَّر كما في الملف
    const k = markSize(pw, ph, w / scale, 1).w / (w / scale);
    mark.style.fontSize = `${FONT_MAX_PT * scale * k}px`;
  }
  paintMark();
  readyInitial(picker, () => paintMark());

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy") || !text()) return;
    const done = busy(run, rail, SWM.running);
    fail.hidden = true;
    let out: File | null = null;
    try {
      const bytes = await watermarkPages(src.bytes, await renderMark(text(), picker.value()), strength);
      out = new File([bytes as BlobPart], outputName("edit", src.name, false), { type: "application/pdf" });
    } catch {
      fail.textContent = S.saveFailed;
      fail.hidden = false;
    } finally {
      done();
    }
    if (out) host.saved(out, n, "watermark");
  });
}
