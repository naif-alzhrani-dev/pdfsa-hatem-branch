// رسم الشعار حركةً في الرئيسية (فكرة لمى docs/logs/logo-motion-lama-concept.md، واللوحة المعتمدة docs/logs/logo-motion-s1.md، والنهائي docs/logs/logo-motion-s2.md).
// تُطلب من main.ts مرة في الجلسة. ستّ طبقات من الصورة المعتمدة نفسها بقصّ ثابت (src/logo-motion-clips.ts)، والحركة transform وopacity وحدهما.
// ?t=<ms> يوقفها عند زمن، للاختبار ولوحة الإطارات وحدهما (main.ts).
import { BOX, CLIPS } from "./logo-motion-clips";

type Clip = keyof typeof CLIPS;
type Part = { clip: Clip; at: number; dur: number; kind: "wipe" | "scale" | "fade"; ease: string; from?: number; origin?: string };
const EASE = "cubic-bezier(0.23,1,0.32,1)"; // القوس والمسح (لمى)
const BOUNCE = "cubic-bezier(0.34,1.56,0.64,1)"; // ارتداد الطيّة (لمى)
// الأزمنة من فكرة لمى. والأسطر الثلاثة بفارق 40ms بين 280 و520، فكلّ سطر 160ms
export const PARTS: Part[] = [
  { clip: "arc", at: 0, dur: 300, kind: "wipe", ease: EASE },
  { clip: "frame", at: 160, dur: 260, kind: "scale", from: 0.96, origin: "38.5px 24.5px", ease: EASE }, // مركز الإطار المقيس (45–186 × 0–147 من الأصل)
  { clip: "line1", at: 280, dur: 160, kind: "wipe", ease: EASE },
  { clip: "line2", at: 320, dur: 160, kind: "wipe", ease: EASE },
  { clip: "line3", at: 360, dur: 160, kind: "wipe", ease: EASE },
  { clip: "fold", at: 480, dur: 280, kind: "scale", from: 0.5, origin: "62px 0px", ease: BOUNCE }, // من زاوية الورقة (186، 0 من الأصل)
  { clip: "pdf", at: 600, dur: 280, kind: "wipe", ease: EASE },
  { clip: "sa", at: 820, dur: 200, kind: "fade", ease: EASE },
];
const LATE = 600; // مهلة التحميل من بدء الصفحة (فكرة لمى)
export const TOTAL = Math.max(...PARTS.map((p) => p.at + p.dur)); // 1020

function frames(p: Part): [Keyframe[], Keyframe[] | null] {
  if (p.kind === "fade") return [[{ opacity: 0 }, { opacity: 1 }], null];
  if (p.kind === "scale") return [[{ opacity: 0, transform: `scale(${p.from})` }, { opacity: 1, offset: 0.35 }, { opacity: 1, transform: "none" }], null];
  // المسح بإزاحتين متعاكستين: النافذة تتحرّك من اليسار والمحتوى يتحرّك ضدّها، فيثبت الشكل وتنكشف حافّته
  const w = BOX[p.clip][2] - BOX[p.clip][0];
  return [[{ transform: `translateX(${w}px)` }, { transform: "none" }], [{ transform: `translateX(${-w}px)` }, { transform: "none" }]];
}

function img(src: HTMLImageElement): HTMLImageElement {
  const i = document.createElement("img");
  i.src = src.currentSrc || src.src;
  i.alt = "";
  i.className = `lm-img ${src.classList.contains("logo-dark") ? "logo-dark" : "logo-light"}`;
  return i;
}

/** يبني الطبقات فوق صورتي الشعار ويشغّلها، أو يوقفها عند t. ومع تقليل الحركة لا يبني شيئاً فيبقى الشعار ثابتاً كاملاً */
export async function run(brand: HTMLElement, t: number | null): Promise<void> {
  // لا تبدأ إن تأخّر الشعار عن نحو 600ms من بدء الصفحة، أو صارت الصفحة في الخلفية، أو أعاد main.ts الثابت بمهلته القصوى (أزال lm-pending)
  const late = () => t === null && (!brand.classList.contains("lm-pending") || performance.now() > LATE || document.visibilityState !== "visible");
  const still = () => { brand.classList.remove("lm-pending"); brand.dataset.lm = "static"; };
  const logos = [...brand.querySelectorAll<HTMLImageElement>("img.home-logo")];
  if (!logos.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return still();
  await Promise.all(logos.map((l) => l.decode().catch(() => undefined)));
  if (late()) return still();
  const wrap = document.createElement("span");
  wrap.className = "lm";
  logos[0]!.before(wrap);
  wrap.append(...logos);
  const layers = document.createElement("span");
  layers.className = "lm-layers";
  layers.setAttribute("aria-hidden", "true");
  const anims: Animation[] = [];
  for (const p of PARTS) {
    const [x0, y0, x1, y1] = BOX[p.clip];
    const win = document.createElement("span"); // نافذة الطبقة بصندوقها المقيس
    win.className = "lm-win";
    win.dataset.part = p.clip;
    Object.assign(win.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px`, overflow: p.kind === "wipe" ? "hidden" : "visible" });
    const inner = document.createElement("span");
    inner.className = "lm-in";
    Object.assign(inner.style, { left: `${-x0}px`, top: `${-y0}px`, clipPath: `path("${CLIPS[p.clip]}")` });
    if (p.origin) inner.style.transformOrigin = p.origin;
    inner.append(...logos.map(img));
    win.append(inner);
    layers.append(win);
    const [kin, kwin] = frames(p);
    const opt: KeyframeAnimationOptions = { delay: p.at, duration: p.dur, easing: p.ease, fill: "backwards" };
    anims.push(inner.animate(kin, opt));
    if (kwin) anims.push(win.animate(kwin, opt));
    for (const a of anims) a.pause(); // تبدأ بعد فكّ الصور، لا قبله
  }
  wrap.append(layers);
  await Promise.all([...layers.querySelectorAll("img")].map((i) => i.decode().catch(() => undefined)));
  if (late()) {
    layers.remove();
    return still();
  }
  if (t !== null) {
    for (const a of anims) a.currentTime = t;
  } else {
    for (const a of anims) a.play();
    // عند التمام تُزال الطبقات ويعود رسم الصورة الأصلية نفسها، فالشعار الثابت هو الأصل بالتعريف. والطبقات مجتمعةً تطابقه في Chromium
    // بكسلاً بكسلاً، وفي WebKit يقصّ path() عبر طبقة وسيطة فيفرق 1/255 في بكسلات الحافّة الشفيفة وحدها (docs/logs/logo-motion-s1.md)
    void Promise.all(anims.map((a) => a.finished)).then(() => {
      for (const a of anims) a.cancel();
      layers.remove();
      wrap.classList.remove("lm-on");
      brand.dataset.lm = "done";
    });
  }
  wrap.classList.add("lm-on"); // يخفي رسم الصورتين الأصليتين ويُبقي لوحهما، بعد أن صارت الطبقات جاهزة
  brand.classList.remove("lm-pending");
  brand.dataset.lm = t !== null ? "frozen" : "playing";
}
