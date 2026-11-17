/**
 * «PDF إلى صور» على قالب `.tool` (docs/logs/phase1/layout-lama.md): الحالة الفارغة ورقةٌ و«اختر ملفاً»، ثم معاينة الصفحة
 * الأولى والصيغة في العمود، ثم «حوّل إلى صور». الرسم بـpdf.js صفحةً صفحة بمقياس 2، وكل لوحة تُفرَّغ بعد صورتها.
 * صفحة واحدة تُحفظ صورةً، وأكثر تُحفظ ZIP (fflate عند الطلب، pdf-to-jpg-core.ts). والحفظ بورقة «حُفظ الملف» نفسها.
 */
import type * as pdfjs from "pdfjs-dist";
import { S, SF, pagesCount } from "../strings";
import { toolName } from "../tool-name";
import { h, icon } from "../dom";
import { viewportSize, normRotation } from "../coords";
import { JPEG_QUALITY, imageName, imageType, imagesOffer, isPhone, renderScale, zipName, zipWriter, type ImageFormat } from "./pdf-to-jpg-core";
import { SPJ } from "./pdf-to-jpg-strings";
import { toolArt } from "./tool-art";
import type { OpenedPdf, ToolHost } from "./host";

function topbar(host: ToolHost) {
  return h("header", { class: "topbar" },
    h("button", { class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back", onclick: () => host.exit() }, icon("back")),
    h("h1", { class: "route-title" }, toolName(SPJ.name)),
    h("span", { class: "icon-spacer" }));
}

/** الحالة الفارغة: الورقة، والوصف، و«اختر ملفاً»، ثم الخصوصية وتذييل مَحالة. */
export function showPdfToJpg(host: ToolHost, src?: OpenedPdf) {
  if (src) return showWork(host, src); // ملف مفتوح سلفاً (دائرة السحب في main.ts)
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }),
    toolArt("pdf-to-jpg")); // رسم نتيجة الأداة بعد الأسطر كما في showEmpty (src/tools/tool-art.ts)
  const alert = h("p", { class: "alert", role: "alert", hidden: true, "data-test": "pj-alert" });
  const pick = h("button", { class: "btn primary block", type: "button", "data-test": "pj-pick" }, SPJ.pick) as HTMLButtonElement;
  pick.addEventListener("click", () => host.pickPdf((f) => void opened(f)));
  host.app.replaceChildren(topbar(host), h("main", { class: "start tool-empty", "data-test": "tool-pdf-to-jpg" },
    sheet, h("p", { class: "tool-lead" }, SPJ.lead), pick, alert, ...host.footer("pdf-to-jpg")));
  window.scrollTo(0, 0);

  async function opened(file: File) {
    pick.disabled = true;
    pick.setAttribute("aria-busy", "true");
    pick.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), S.opening);
    alert.hidden = true;
    const src = await host.open(file);
    if (typeof src === "string" || src.doc.numPages < 1) {
      pick.disabled = false;
      pick.removeAttribute("aria-busy");
      pick.replaceChildren(SPJ.pick);
      alert.textContent = src === "encrypted" ? SF.encryptedTool : S.badPdf;
      alert.hidden = false;
      return;
    }
    await showWork(host, src);
  }
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

/** يرسم صفحة على لوحة جديدة ويُرجع صورتها، ثم يفرّغ اللوحة. */
async function pageImage(page: pdfjs.PDFPageProxy, format: ImageFormat) {
  const base = page.getViewport({ scale: 1 });
  const r = renderScale(base.width, base.height);
  const vp = page.getViewport({ scale: r.scale });
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  try {
    // pdf.js يملأ اللوحة بالأبيض قبل الرسم، فلا سواد مكان الشفافية في JPEG
    await page.render({ canvas, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, imageType(format), JPEG_QUALITY));
    if (!blob) throw new Error("toBlob");
    return { blob, reduced: r.reduced };
  } finally {
    canvas.width = canvas.height = 0; // يحرّر ذاكرة اللوحة في Safari
    page.cleanup();
  }
}

async function showWork(host: ToolHost, src: OpenedPdf) {
  const n = src.doc.numPages;
  let format: ImageFormat = "jpg";

  const canvas = h("canvas", { "aria-hidden": "true" }) as HTMLCanvasElement;
  const preview = h("div", { class: "pn-preview", "data-test": "pj-preview" }, canvas);
  const run = h("button", { class: "btn primary block", type: "button", "data-test": "pj-run" }, SPJ.run) as HTMLButtonElement;
  const fail = h("p", { class: "alert", role: "alert", hidden: true });
  const notes = h("div", { class: "pj-notes", role: "status", "data-test": "pj-notes" });
  // شريط التقدّم تحت الزرّ (شكل «06 Signal» من colorion-css-loaders، MIT): يظهر إن طال العمل أكثر من 400ms، ويمتلئ صفحةً صفحة
  const fill = h("div", { class: "pbar-fill" });
  const bar = h("div", { class: "pbar", "aria-hidden": "true", "data-test": "pj-progress" }, fill);
  const options = h("div", { class: "tool-options" },
    seg<ImageFormat>("pj-format", SPJ.formatLabel, [["jpg", SPJ.formatJpg], ["png", SPJ.formatPng]], format, (v) => { format = v; }));
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "pj-context" }, h("bdi", {}, src.name), " · ", pagesCount(n));
  const rail = h("aside", { class: "tool-rail" }, options, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, notes, fail, h("div", { class: "pj-run" }, run, bar)));
  const work = h("section", { class: "tool-work" }, preview);
  host.app.replaceChildren(topbar(host), h("main", { class: "tool", "data-test": "tool-pdf-to-jpg" }, work, rail));
  window.scrollTo(0, 0);

  /* المعاينة: الصفحة الأولى بمقاس يتّسع له المكان، كما في «ترقيم الصفحات» */
  const first = await src.doc.getPage(1);
  const geom = { view: first.view as [number, number, number, number], rotate: normRotation(first.rotate) };
  const { width: pw, height: ph } = viewportSize(geom, 1);
  const wide = matchMedia("(min-width: 1024px)").matches;
  const cs = getComputedStyle(work);
  const maxW = Math.min(wide ? 720 : Infinity, work.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd)); // 720: --work-w
  const maxH = wide ? innerHeight - 140 : innerHeight * 0.42;
  const scale = Math.min(maxW / pw, maxH / ph);
  preview.style.inlineSize = `${Math.round(pw * scale)}px`;
  preview.style.blockSize = `${Math.round(ph * scale)}px`;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const vp = first.getViewport({ scale: scale * dpr });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  void first.render({ canvas, viewport: vp }).promise.catch(() => {});

  run.addEventListener("click", async () => {
    if (run.getAttribute("aria-busy")) return;
    run.setAttribute("aria-busy", "true");
    run.disabled = true;
    fail.hidden = true;
    notes.replaceChildren();
    for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = true;
    const label = document.createTextNode(SPJ.running(1, n));
    run.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), label);
    const fmt = format;
    fill.style.transform = "scaleX(0)";
    const showBar = setTimeout(() => bar.classList.add("show"), 400);
    let out: File | null = null;
    // (٢٤) على الجوال وحتى ٢٠ صفحة: الصور منفصلة تُجهَّز هنا بجانب ZIP، فتُشارك في الضغطة نفسها بلا await قبلها
    const offer = imagesOffer(n, isPhone(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    const images: File[] = [];
    try {
      const zip = n > 1 ? await zipWriter() : null;
      let single: Blob | null = null;
      for (let p = 1; p <= n; p++) {
        label.data = SPJ.running(p, n);
        const img = await pageImage(await src.doc.getPage(p), fmt);
        if (img.reduced) {
          notes.append(h("p", { class: "tool-note", "data-test": "pj-reduced" }, SPJ.reduced(p)));
        }
        if (zip) zip.add(imageName(src.name, p, n, fmt), new Uint8Array(await img.blob.arrayBuffer()));
        if (offer === "share") images.push(new File([img.blob], imageName(src.name, p, n, fmt), { type: imageType(fmt) }));
        else single = img.blob;
        fill.style.transform = `scaleX(${p / n})`;
      }
      out = zip
        ? new File([zip.end()], zipName(src.name), { type: "application/zip" })
        : new File([single!], imageName(src.name, 1, 1, fmt), { type: imageType(fmt) });
    } catch {
      fail.textContent = S.saveFailed;
      fail.hidden = false;
    } finally {
      clearTimeout(showBar);
      bar.classList.remove("show"); // بعد آخر صفحة
      run.removeAttribute("aria-busy");
      run.disabled = false;
      for (const el of rail.querySelectorAll<HTMLInputElement>("input")) el.disabled = false;
      run.replaceChildren(SPJ.run);
    }
    if (out) host.saved(out, n, undefined, offer === "share" ? images : offer === "over-limit" ? "over-limit" : undefined);
  });
}
