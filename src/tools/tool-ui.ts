/**
 * أجزاء قالب `.tool` المشتركة بين أدوات «أدوات أخرى» (docs/logs/phase1/layout-lama.md): الرأس، والحالة الفارغة
 * (ورقة ووصف وزرّ اختيار)، ومفتاح الخيارات، ومعاينة الصفحة الأولى بمقاس يتّسع له المكان.
 * أُخرجت من page-numbers.ts كما هي حين صارت الأدوات ثلاثاً.
 */
import { S, SF } from "../strings";
import { h, icon } from "../dom";
import { viewportSize, normRotation, type PageGeom } from "../coords";
import { SPN } from "./page-numbers-strings";
import { toolArt } from "./tool-art";
import { toolName } from "../tool-name";
import type { OpenedPdf, ToolHost } from "./host";

export function topbar(host: ToolHost, title: string) {
  return h("header", { class: "topbar" },
    h("button", { class: "icon-btn", type: "button", "aria-label": S.backHome, "data-test": "back", onclick: () => host.exit() }, icon("back")),
    h("h1", { class: "route-title" }, toolName(title)),
    h("span", { class: "icon-spacer" }));
}

/**
 * الحالة الفارغة: الورقة، والوصف، و«اختر ملفاً»، ثم الخصوصية وتذييل مَحالة. ثم يُفتح الملف المختار،
 * والمحمي ← `SF.encryptedTool`، والتالف وبلا صفحات ← `S.badPdf`، والسليم ← `work`.
 * `p` بادئة `data-test` للأداة (`<p>-pick` و`<p>-alert`)، و`slug` اسمها (`tool-<slug>`، و`data-wa-from`).
 * `encrypted` نصّ المحمي بدل `SF.encryptedTool`. و`open` فتحٌ خاص بالأداة بدل `host.open` («فك الحماية» يقرأ المحمي):
 * يعيد نصّ خطأ يظهر هنا، أو null إن انتقل إلى شاشته. و`busy` نصّ الزرّ أثناء ذلك بدل `S.opening` («جارٍ الفحص…»).
 * و`note` سطر تحت الوصف بأيقونة «info» (حدود «PDF ← Word»، هدى ٢٠٢٦/١١/١٤؛ شكله من مواصفة لمى §٩).
 * وصفحات الشرح قبل الملف (الملاحظة ٩ من تحديث 1.0.2، update-1.0.2-lama-spec.md §٩): `points` بنود تحت الوصف (نقطة لكل بند)،
 * و`test` قيمة `data-test` للشاشة بدل `tool-<slug>` (بادئة `intro-`، فلا تتعارض مع بلاطات الأدوات)، و`art` رسمٌ بدل `toolArt(slug)`.
 * ومع البنود يلتصق «اختر ملفاً» بأسفل الشاشة تحت 1024 إن فاضت الصفحة، وظلّه وخلفيته حين يلتصق وحده.
 * يُرجع بدء الفتح لملف مختار سلفاً («افحص ملفاً آخر» يفتح المنتقي من شاشة النتيجة، ثم تعود هذه الحالة منتظرةً).
 */
export function showEmpty(host: ToolHost, t: { slug: string; p: string; name: string; lead: string; note?: string; points?: readonly string[]; test?: string; art?: Element | null; encrypted?: string; busy?: string; open?: (file: File) => Promise<string | null> }, work: (src: OpenedPdf) => Promise<void>, error?: string): (file: File) => void {
  const sheet = h("div", { class: "start-sheet mini", "aria-hidden": "true" },
    ...[78, 92, 64, 88, 70, 40].map((w) => { const l = h("span", { class: "line" }); l.style.inlineSize = `${w}%`; return l; }),
    t.art !== undefined ? t.art : toolArt(t.slug)); // رسم نتيجة الأداة بعد الأسطر (src/tools/tool-art.ts)، وnull لما لا رسم له
  const alert = h("p", { class: "alert", role: "alert", hidden: !error, "data-test": `${t.p}-alert` }, error ?? "");
  const pick = h("button", { class: "btn primary block", type: "button", "data-test": `${t.p}-pick` }, SPN.pick) as HTMLButtonElement;
  pick.addEventListener("click", () => host.pickPdf((f) => void opened(f)));
  const points = t.points ? h("ul", { class: "tool-points", "data-test": `${t.p}-points` }, ...t.points.map((x) => h("li", {}, h("span", { class: "dot", "aria-hidden": "true" }), h("span", {}, x)))) : null;
  const pickRow = points ? h("div", { class: "tool-pick" }, pick) : pick;
  const end = points ? h("span", { class: "tool-pick-end", "aria-hidden": "true" }) : null; // تحت الزرّ: إن لم يظهر فالزرّ ملتصق
  host.app.replaceChildren(topbar(host, t.name), h("main", { class: points ? "start tool-empty intro" : "start tool-empty", "data-test": t.test ?? `tool-${t.slug}` },
    sheet, h("p", { class: "tool-lead" }, t.lead), points,
    t.note ? h("p", { class: "tool-note", "data-test": `${t.p}-note` }, icon("info"), h("span", {}, t.note)) : null,
    pickRow, end, alert, ...host.footer(t.slug)));
  if (end && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => {
      if (!pickRow.isConnected) { io.disconnect(); return; }
      pickRow.classList.toggle("stuck", !e!.isIntersecting && e!.boundingClientRect.top > 0);
    });
    io.observe(end);
  }
  window.scrollTo(0, 0);
  return (file) => void opened(file);

  async function opened(file: File) {
    pick.disabled = true;
    pick.setAttribute("aria-busy", "true");
    pick.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), t.busy ?? S.opening);
    alert.hidden = true;
    const fail = (msg: string) => {
      pick.disabled = false;
      pick.removeAttribute("aria-busy");
      pick.replaceChildren(SPN.pick);
      alert.textContent = msg;
      alert.hidden = false;
    };
    if (t.open) {
      const msg = await t.open(file);
      if (msg !== null) fail(msg);
      return;
    }
    const src = await host.open(file);
    if (typeof src === "string" || src.doc.numPages < 1) {
      fail(src === "encrypted" ? t.encrypted ?? SF.encryptedTool : S.badPdf);
      return;
    }
    await work(src);
  }
}

/** خيار من مجموعة: أزرار راديو حقيقية بمظهر المفتاح (لوحة المفاتيح والقارئ مجاناً). بلا `label` لا عنوان فوقه. */
export function seg<T extends string>(name: string, label: string | null, opts: [T, string][], value: T, onChange: (v: T) => void) {
  const id = `${name}-label`;
  return h("div", { class: "tool-field" },
    label === null ? null : h("span", { class: "tool-label", id }, label),
    h("div", { class: "tool-seg", role: "radiogroup", "aria-labelledby": label === null ? undefined : id, "data-test": name },
      ...opts.map(([v, text]) => {
        const input = h("input", { class: "sr-only", type: "radio", name, value: v, checked: v === value, "data-test": `${name}-${v}` }) as HTMLInputElement;
        input.addEventListener("change", () => input.checked && onChange(v));
        return h("label", {}, input, h("span", {}, text));
      })));
}

/**
 * معاينة الصفحة الأولى داخل `preview` بمقاس يتّسع له `work`: على الجوال حتى 42% من الارتفاع، وعلى الكمبيوتر حتى `--work-w`.
 * تُرجع المقياس (بكسل CSS لكل نقطة) وهندسة الصفحة، ويبدأ الرسم ولا يُنتظر.
 */
export async function previewFirstPage(src: OpenedPdf, work: HTMLElement, preview: HTMLElement, canvas: HTMLCanvasElement, inset = 0) {
  const page = await src.doc.getPage(1);
  const geom: PageGeom = { view: page.view as [number, number, number, number], rotate: normRotation(page.rotate) };
  const { width: pw, height: ph } = viewportSize(geom, 1);
  const wide = matchMedia("(min-width: 1024px)").matches;
  const cs = getComputedStyle(work);
  const maxW = Math.min(wide ? 720 : Infinity, work.clientWidth - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd)); // 720: --work-w
  const maxH = wide ? innerHeight - 140 : innerHeight * 0.42;
  const scale = Math.min((maxW - 2 * inset) / pw, (maxH - 2 * inset) / ph); // `inset`: حاشية حولها (مقابض القص)
  preview.style.inlineSize = `${Math.round(pw * scale)}px`;
  preview.style.blockSize = `${Math.round(ph * scale)}px`;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  void page.render({ canvas, viewport: vp }).promise.catch(() => {});
  return { scale, geom, pw, ph };
}

/** زرّ التنفيذ مشغولاً: دوّارة، والخيارات معطّلة. `done` يعيده كما كان. */
export function busy(run: HTMLButtonElement, rail: HTMLElement, label: string | null) {
  run.setAttribute("aria-busy", "true");
  run.disabled = true;
  const inputs = [...rail.querySelectorAll<HTMLInputElement>("input")];
  for (const el of inputs) el.disabled = true;
  const old = [...run.childNodes];
  run.replaceChildren(h("span", { class: "spinner light", "aria-hidden": "true" }), ...(label === null ? old.map((n) => n.cloneNode(true)) : [label]));
  return () => {
    run.removeAttribute("aria-busy");
    run.disabled = false;
    for (const el of inputs) el.disabled = false;
    run.replaceChildren(...old);
  };
}
