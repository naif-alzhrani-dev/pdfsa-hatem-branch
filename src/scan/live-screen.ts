/**
 * شاشة المسح الحيّ (docs/design-spec-livescan.md): كاميرا داخل الصفحة، وكشف الورقة في كل إطار، والتقاط تلقائي حين تثبت.
 *
 * - **الكشف** بـscanic 1.7.1 (`classical` وحده، كما في scan-ui.ts) على نسخة من الإطار أطول ضلعها 480px (`DETECT_SIDE`)،
 *   نحو 12 مرّة في الثانية (`requestVideoFrameCallback`، وإلا `requestAnimationFrame` مع خنق)، ولا كشفان معاً.
 *   الكشف في عامل (live-worker.ts) يستلم البكسلات المصغّرة منقولة؛ وإن لم يردّ أو رمى قبل أول نجاح عاد إلى الخيط الرئيس.
 *   وسياسة الأمان `script-src 'self'` بلا `wasm-unsafe-eval`، فscanic تعمل بـJavaScript في الحالين.
 * - **التشخيص** `?debug=1`: أسطر صغيرة أعلى الشاشة بأرقام الكشف والثبات والمسار وآخر خطأ (للقياس على جهاز حقيقي).
 * - **الالتقاط** من الإطار الكامل بدقّة الفيديو (حتى 4M بكسل، كأصل «من الصور»)، ثم يمرّ بالمسار الحالي نفسه
 *   (التقويم ثم التبييض ثم الصفحة) عبر `host.add` في scan-ui.ts. فلا تكرار للمسار هنا.
 * - **الإيقاف:** `track.stop()` عند الخروج، وعند الإخفاء (`visibilitychange`)، وعند فتح النتيجة أو الضبط.
 * - المنطق (الثبات والعدّ ومنع التكرار والتنعيم والإضاءة) دوالّ نقيّة في live.ts.
 */
import { S, ar } from "../strings";
import { h, icon } from "../dom";
import { downscale, scaleCorners, type Corners } from "./geom";
import { detectFrame } from "./live-detect";
import { sharpness } from "./sharp";
import { LiveController, LowLight, coverMap, insideFrame, shiftCorners, maxCornerMove, quadTransform, shortSide, smoothCorners, meanLuma, ABSENT_MS, RAW_TOL, STABLE_TOL, type Phase } from "./live";
import type { LiveJob, LiveResult } from "./live-worker";
import type { Img } from "./types";

const DETECT_SIDE = 480; // كان 320؛ قيس على الحاسوب بلا WebAssembly: 320 ← 10.2/ث، 480 ← 10.0، 640 ← 9.6 (دون الحدّ 10)
/**
 * live-fix3: الكشف على **ما يظهر على الشاشة وحده** (الفيديو بـcover يقصّ جانبي الإطار العمودي: على آيفون نايف يُرى نحو 62% من عرض
 * 1920×2560)، فلا يلتقط الكاشف حوافّ إطار أو انعكاساً لا يراه المستخدم. وبميزانية بكسلات ثابتة (كإطار 480×360) لا بضلع أطول ثابت،
 * فالمقصوص الضيّق يُكشف بدقّة أعلى بالكلفة نفسها تقريباً.
 */
const DETECT_PIXELS = DETECT_SIDE * 360;
/** لحظة الالتقاط: كشفٌ ثانٍ أدقّ على نسخة من الإطار الكامل أطول ضلعها 1100px (شريط الخشب في تجربة نايف). */
const REFINE_SIDE = 1100;
/** يُقبل الكشف الدقيق إن لم تبتعد أيّ زاوية فيه عن الحيّة أكثر من 5% من الضلع القصير؛ وإلا فالحيّة. */
const REFINE_MAX = 0.05;
const DETECT_GAP = 80; // ≈ 12 كشفاً في الثانية على الأكثر
const REDUCED_GAP = 250; // مع تقليل الحركة: الطبقة تُحدَّث ≤ ٤ مرّات في الثانية
const SOURCE_PIXELS = 4_000_000; // كأصل «من الصور» في scan-ui.ts
/** إن فشل التقاط الإطار الكامل (حدود canvas في iOS) يُجرَّب بهذه الدقّات تباعاً. */
const SOURCE_FALLBACK = [SOURCE_PIXELS, 2_000_000, 1_000_000];
/** مهلة ردّ العامل: أول ردّ (هل يعمل أصلاً؟)، ثم كل كشف. فإن لم يردّ أولاً عاد الكشف إلى الخيط الرئيس. */
const WORKER_FIRST_MS = 4000;
const WORKER_MS = 3000;
const MIN_CONFIDENCE = 0.3; // كما في scan-ui.ts
/**
 * لحظة الالتقاط: أحدّ إطارٍ من `PICK_N` إطارات متتالية خلال `PICK_MS` (بوابة الحدّة، ٢٠٢٦/١١/٠٩). يُقاس كل إطار بدقّته الكاملة
 * على مربّع في وسط الورقة ضلعه 35% من ضلعها القصير وحتى `PICK_PATCH` بكسلاً، فلا يُقرأ الإطار الكامل إلا للمختار.
 */
const PICK_N = 3;
const PICK_MS = 250;
const PICK_PATCH = 384;
const MODE_KEY = "pdfsa.liveMode";

export interface LiveHost {
  app: HTMLElement;
  announce: (msg: string) => void;
  /** عدد الصفحات الملتقطة وآخر مصغّر. */
  count: () => number;
  lastThumb: () => string | null;
  /** صفحة ملتقطة: الملف (لإعادة الضبط)، والإطار، والزوايا بمقاسه. تمرّ بالمسار الحالي، وتعيد النجاح أو ترمي بالسبب. */
  add: (file: Blob, src: Img, corners: Corners) => Promise<boolean>;
  /** التقاط يدوي بلا ورقة مكتشفة: الإطار كاملاً إلى «اضبط الزوايا». */
  adjust: (file: Blob) => void;
  done: () => void; // النتيجة
  discard: () => void; // «تجاهل» الصفحات الملتقطة
  close: () => void; // الخروج بلا صفحات
  fallbackCamera: () => void; // «صوّر بكاميرا الجهاز» (حقل الملف)
  fallbackPhotos: () => void;
  noCamera: () => void;
  /** «أعد التصوير»: صفحة واحدة تحلّ محلّ الموجودة، ثم النتيجة. */
  once?: boolean;
  /** رسم الورقة تحت أزرار شاشة الاحتياط. */
  art?: () => HTMLElement;
}

/** يمكن فتح الكاميرا داخل الصفحة. */
export const liveSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

let stopCurrent: (() => void) | null = null;
/** يوقف الكاميرا إن كانت تعمل (عند مغادرة شاشة التصوير من خارجها). */
export function stopLive() { stopCurrent?.(); }

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function readMode(): boolean {
  try { return localStorage.getItem(MODE_KEY) !== "manual"; } catch { return true; }
}
function saveMode(auto: boolean) {
  try { localStorage.setItem(MODE_KEY, auto ? "auto" : "manual"); } catch { /* التخزين ممنوع: يبقى للجلسة */ }
}

export function openLive(host: LiveHost) {
  stopLive();
  let alive = true;
  let stream: MediaStream | null = null;
  let vfc = 0, raf = 0;
  let busy = false, lastRun = 0, lastDraw = 0;
  let shown: Corners | null = null; // ما تعرضه الطبقة (بعد التنعيم)
  let seen: { c: Corners; w: number; h: number; t: number } | null = null; // آخر كشف
  let phase: Phase | "" = "";
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let shots = 0; // ما التُقط في هذه الجلسة (للسؤال عند ✕)
  let torchOn = false;
  const ctl = new LiveController(readMode());
  const dark = new LowLight();
  const q = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
  /** `?debug=1`: شاشة التشخيص. و`&wrf=0` يلغي `willReadFrequently` على لوح الكشف (للمقارنة على الجهاز في الجلسة نفسها). */
  const debug = q.get("debug") === "1";
  const wrf = q.get("wrf") !== "0";
  /** `&bmp=1`: الإطار يُصغَّر بـ`createImageBitmap` (resizeQuality: low) بدل `drawImage` من الفيديو، للمقارنة على الجوال. */
  let bmp = q.get("bmp") === "1" && typeof createImageBitmap === "function";
  /**
   * **بوابة الحدّة مطفأة افتراضياً، وتُشغَّل بـ`&sharp=1`** (الجولة الثانية، docs/logs/live-sharp-white.md): على المقصوص الزاوية في WebKit
   *   لم تبلغ شرط النشر (3 من 3 ≤ 2.5 ث ثلاث مرّات متتالية)، ولا بلغه القديم نفسه في الجلسة ذاتها؛ فالافتراضي كشفٌ مطابقٌ لـmain
   *   (لا قياس حدّة في كل إطار)، والبوابة تُجرَّب على آيفون نايف أولاً.
   * **وانتقاء أحدّ إطار لحظة الالتقاط معها خلف `&sharp=1`:** لا يؤخّر الوميض، لكنه أخّر ظهور الصفحة بعده (وسيط أربعة: WebKit
   *   1546 مقابل 1188ms، وChromium 791 مقابل 775ms)، فالافتراضي مطابقٌ لـmain تماماً.
   * `&low=1` يشغّل مسار التباين المنخفض (live-detect.ts). **مطفأ افتراضياً:** لم يُثبت القياس على البثّ المصطنع أنه يلتقط ورقةً
   * على الطاولة البيضاء لا يلتقطها الكشف المعتاد (0 من 3 في الحالين)، وكلفته كشفٌ ثانٍ في كل إطار فاتح فاشل. فيُجرَّب على آيفون أولاً.
   */
  const opts = { sharp: q.get("sharp") === "1", low: q.get("low") === "1" };
  const pick = opts.sharp;
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d", { willReadFrequently: wrf })!;
  /* ───── التشخيص: عدّادات المسار وآخر خطأ (تُعرض مع ?debug=1، وتُحسب دائماً) ───── */
  let rootEl: HTMLElement | null = null;
  const diag = { dets: [] as number[], found: [] as [number, boolean][], draw: [] as number[], scan: [] as number[], sharpMs: [] as number[], out: 0, shots: 0, done: 0, failed: 0, err: "",
    lowTried: 0, lowFound: 0, lowRejected: 0, lowOn: false, pick: "-", focus: "-", why: "-" };
  const note = (step: string, e: unknown) => {
    diag.err = `${step}: ${String((e as Error)?.message ?? e).slice(0, 90)}`;
    if (rootEl) rootEl.dataset.lastError = diag.err;
  };
  /* ───── عامل الكشف: يُجرَّب، وإن لم يردّ أو رمى عاد الكشف إلى الخيط الرئيس ───── */
  let worker: Worker | null = null, workerOk = false, jobId = 0;
  const waiting = new Map<number, (r: LiveResult | null) => void>();
  function dropWorker(why: string) {
    note("worker", why);
    worker?.terminate();
    worker = null;
    for (const f of waiting.values()) f(null);
    waiting.clear();
    if (rootEl) rootEl.dataset.detector = "main";
  }
  try {
    if (typeof Worker !== "undefined") {
      worker = new Worker(new URL("./live-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<LiveResult>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
      worker.onerror = (e) => dropWorker(e.message || "error");
    }
  } catch (e) { worker = null; note("worker", e); }

  const video = h("video", { class: "live-video", playsinline: true, muted: true, autoplay: true, "data-test": "live-video" }) as HTMLVideoElement;
  video.muted = true; // الخاصّية لا السمة وحدها: iOS يشترطها للتشغيل التلقائي
  const quad = h("div", { class: "live-quad", "aria-hidden": "true", "data-test": "live-quad" });
  const dots = [0, 1, 2, 3].map(() => h("span", { class: "live-dot", "aria-hidden": "true" }));
  const flashEl = h("div", { class: "live-flash", "aria-hidden": "true" });
  const wait = h("p", { class: "live-wait", "data-test": "live-wait" }, S.liveAllow);
  const hint = h("p", { class: "live-hint", "data-test": "live-hint" }, S.liveAim);
  const torch = h("button", { class: "live-round live-torch", type: "button", hidden: true, "aria-pressed": "false", "aria-label": S.liveTorch, "data-test": "live-torch", onclick: () => void toggleTorch() }, flashIcon()) as HTMLButtonElement;
  const autoBtn = h("button", { type: "button", "data-test": "live-auto", onclick: () => setMode(true) }, S.liveAuto) as HTMLButtonElement;
  const manualBtn = h("button", { type: "button", "data-test": "live-manual", onclick: () => setMode(false) }, S.liveManual) as HTMLButtonElement;
  const thumbImg = h("img", { alt: "" }) as HTMLImageElement;
  const countEl = h("span", { class: "live-count", "aria-hidden": "true", "data-test": "live-count" });
  const thumb = h("button", { class: "live-thumb", type: "button", hidden: true, "aria-label": S.done, "data-test": "live-thumb", onclick: () => void finish() }, thumbImg, countEl) as HTMLButtonElement;
  const doneBtn = h("button", { class: "live-done", type: "button", hidden: true, "data-test": "live-done", onclick: () => void finish() }, S.done) as HTMLButtonElement;
  const shutter = h("button", { class: "live-shutter", type: "button", "aria-label": S.liveShoot, "data-test": "live-shutter", onclick: () => shoot(true) }) as HTMLButtonElement;
  const ring = h("span", { class: "live-ring", "aria-hidden": "true", "data-test": "live-ring" },
    h("span", { class: "half a" }, h("span", { class: "arc" })), h("span", { class: "half b" }, h("span", { class: "arc" })));
  const ask = h("div", { class: "live-ask", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "live-ask-q", hidden: true, "data-test": "live-ask" },
    h("p", { id: "live-ask-q" }, S.liveDiscardQ),
    h("div", { class: "live-ask-row" },
      h("button", { class: "text-btn danger", type: "button", "data-test": "live-discard", onclick: () => { stop(); host.discard(); } }, S.liveDiscard),
      h("button", { class: "text-btn", type: "button", "data-test": "live-continue", onclick: () => { ask.hidden = true; closeBtn.focus(); } }, S.liveContinue)));
  const dbg = h("div", { class: "live-debug", "aria-hidden": "true", "data-test": "live-debug" });
  Object.assign(dbg.style, { position: "absolute", insetInline: "8px", top: "calc(env(safe-area-inset-top) + 60px)", zIndex: "30", pointerEvents: "none", direction: "ltr", textAlign: "left", font: "11px/1.35 ui-monospace, Menlo, monospace", color: "#fff", background: "rgba(0,0,0,.62)", padding: "4px 6px", borderRadius: "6px", whiteSpace: "pre-wrap" });
  const closeBtn = h("button", { class: "live-round live-close", type: "button", "aria-label": S.liveClose, "data-test": "live-close", onclick: () => onClose() }, icon("close")) as HTMLButtonElement;
  const root = h("main", { class: "live", "data-test": "live-scan", "data-phase": "none" },
    video, quad, ...dots, flashEl, wait, closeBtn, torch, hint,
    h("div", { class: "live-bar" },
      h("div", { class: "live-mode", role: "group" }, autoBtn, manualBtn),
      h("div", { class: "live-row" },
        h("span", { class: "live-slot" }, thumb),
        h("span", { class: "live-shutter-wrap" }, ring, shutter),
        h("span", { class: "live-slot end" }, doneBtn))),
    ask, dbg);
  rootEl = root;
  root.dataset.detector = worker ? "worker" : "main";
  dbg.hidden = !debug;
  host.app.replaceChildren(root);
  setMode(ctl.auto, false);
  refreshThumb();

  function setMode(auto: boolean, save = true) {
    ctl.setAuto(auto);
    autoBtn.setAttribute("aria-pressed", String(auto));
    manualBtn.setAttribute("aria-pressed", String(!auto));
    root.classList.toggle("manual", !auto);
    if (save) saveMode(auto);
  }

  /* ───── الكاميرا ───── */
  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
    } catch (e) {
      if (!alive) return;
      return fail((e as DOMException)?.name);
    }
    if (!alive) { stopTracks(); return; }
    // أُخفيت الصفحة أثناء نافذة الإذن: لا يبقى البثّ شغّالاً، والعودة تستأنف من onVisibility
    if (document.visibilityState === "hidden") { stopTracks(); return; }
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay مع muted وplaysinline: لا يُرفض عادةً */ }
    if (!alive) return;
    wait.hidden = true;
    root.classList.add("on");
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    torch.hidden = !caps.torch;
    // التركيز المستمرّ إن أعلن المتصفّح دعمه (Chrome على Android يعلنه؛ Safari على iOS غير مؤكد: يظهر في ?debug=1)
    const fm = (caps as { focusMode?: string[] }).focusMode;
    diag.focus = fm?.length ? fm.join(",") : "-";
    // ويُطلب مع `&sharp=1` وحده، فالافتراضي مطابقٌ لـmain (الجولة الثانية)؛ وما يعلنه الجهاز يظهر في التشخيص دائماً
    if (opts.sharp && fm?.includes("continuous") && track) {
      track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
        .then(() => { diag.focus += " >cont"; }, (e) => note("focus", e));
    }
    schedule();
  }
  function stopTracks() {
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    video.srcObject = null;
    torchOn = false;
    torch.setAttribute("aria-pressed", "false");
  }
  function stop() {
    if (!alive) return;
    alive = false;
    stopTracks();
    if (vfc) video.cancelVideoFrameCallback?.(vfc);
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", stop);
    small.width = small.height = 0;
    worker?.terminate();
    worker = null;
    if (stopCurrent === stop) stopCurrent = null;
  }
  stopCurrent = stop;
  function onVisibility() {
    if (document.visibilityState === "hidden") { stopTracks(); root.classList.remove("on"); }
    else if (alive && !stream) void start();
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", stop);

  function fail(name: string | undefined) {
    stop();
    if (name === "NotFoundError" || name === "OverconstrainedError") return host.noCamera();
    const denied = name === "NotAllowedError" || name === "SecurityError";
    host.app.replaceChildren(
      h("header", { class: "topbar" },
        h("button", { class: "icon-btn", type: "button", "aria-label": S.back, "data-test": "back", onclick: () => host.close() }, icon("back")),
        h("h1", { class: "route-title" }, S.scanFile),
        h("span", { class: "icon-spacer" })),
      h("main", { class: "start live-fallback", "data-test": "live-fallback" },
        h("p", { class: "live-fallback-msg", role: "alert", "data-test": "live-fallback-msg" }, denied ? S.liveDenied : S.liveBusy),
        h("button", { class: "btn primary block", type: "button", "data-test": "live-fallback-camera", onclick: () => host.fallbackCamera() }, icon("camera"), S.liveDeviceCamera),
        h("button", { class: "text-btn", type: "button", "data-test": "live-fallback-photos", onclick: () => host.fallbackPhotos() }, S.fromPhotos),
        denied ? h("p", { class: "live-fallback-note" }, S.liveSettings) : null,
        host.art?.() ?? null));
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      torchOn = !torchOn;
      torch.setAttribute("aria-pressed", String(torchOn));
    } catch { torch.hidden = true; }
  }

  /* ───── الكشف ───── */
  function schedule() {
    if (!alive || !stream) return;
    if (video.requestVideoFrameCallback) vfc = video.requestVideoFrameCallback(() => void tick());
    else raf = requestAnimationFrame(() => void tick());
  }
  async function tick() {
    if (!alive || !stream) return;
    const t = performance.now();
    if (busy || t - lastRun < DETECT_GAP || video.readyState < 2 || !video.videoWidth) return schedule();
    lastRun = t;
    busy = true;
    schedule();
    try { await detect(); } finally { busy = false; }
  }
  async function detect() {
    const fw = video.videoWidth, fh = video.videoHeight;
    const vw = video.clientWidth || fw, vh = video.clientHeight || fh;
    const cov = Math.max(vw / fw, vh / fh);
    const sw = Math.min(fw, vw / cov), sh = Math.min(fh, vh / cov); // الجزء الظاهر من الإطار
    const sx = (fw - sw) / 2, sy = (fh - sh) / 2;
    const k = Math.min(1, Math.sqrt(DETECT_PIXELS / (sw * sh)));
    const w = Math.max(1, Math.round(sw * k)), hh = Math.max(1, Math.round(sh * k));
    if (small.width !== w || small.height !== hh) { small.width = w; small.height = hh; }
    const t0 = performance.now();
    let img: ImageData;
    try {
      if (bmp) {
        const b = await createImageBitmap(video, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: hh, resizeQuality: "low" });
        sctx.drawImage(b, 0, 0);
        b.close();
      } else sctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, hh);
      img = sctx.getImageData(0, 0, w, hh);
    } catch (e) { note(bmp ? "bitmap" : "frame", e); bmp = false; return; }
    const t1 = performance.now();
    const r = await find(img, w, hh);
    if (!alive) return;
    // رباعيٌّ تخرج زاويةٌ منه عن الجزء الظاهر: ليس ورقة يراها المستخدم
    if (r.corners && !insideFrame(r.corners, w, hh)) { r.corners = null; diag.out++; }
    // إلى إحداثيات الإطار الكامل بمقياس الكشف (الطبقة والالتقاط يعملان بها)
    const FW = fw * (w / sw), FH = fh * (hh / sh);
    if (r.corners) r.corners = shiftCorners(r.corners, sx * (w / sw), sy * (hh / sh));
    const now = performance.now();
    push(diag.draw, t1 - t0);
    push(diag.scan, r.ms);
    diag.dets.push(now);
    diag.found.push([now, !!r.corners]);
    const c = r.corners;
    if (r.lowTried) diag.lowTried++;
    if (r.low) diag.lowFound++;
    if (r.rejected) diag.lowRejected++;
    diag.lowOn = !!r.low;
    if (r.sharpMs !== undefined) push(diag.sharpMs, r.sharpMs);
    const low = dark.update(r.luma, now);
    const step = ctl.update(c, now, c ? r.sharp : undefined);
    const sm = c ? step.corners : null; // الطبقة والالتقاط بالزوايا المنعَّمة (الوسيط)، لا بالخام
    if (sm) seen = { c: sm, w: FW, h: FH, t: now };
    show(step.phase, sm, FW, FH, now, low);
    // التشخيص: سجلّ الإطارات (الوقت، المرحلة، الحدّة، البوابة) لقراءته إطاراً إطاراً من الاختبار أو من أدوات المطوّر
    if (debug) {
      // لماذا لا يُلتقط الآن (سطر why): بترتيب ما يمنع أولاً
      diag.why = step.capture ? "shot" : step.phase === "locked" ? "taken" : !c ? (r.rejected ? "notpaper" : "nopaper")
        : ctl.kind === "glitch" ? "jump" : step.phase === "unstable" ? "moving" : step.phase === "counting" && ctl.stats.gate === "hold" ? "blur" : step.phase;
      const tr = ((window as unknown as { __liveTrace?: unknown[] }).__liveTrace ??= []);
      tr.push([Math.round(now), step.phase, r.sharp === undefined || !c ? null : Math.round(r.sharp), ctl.stats.gate, +step.progress.toFixed(2), step.capture ? 1 : 0, ctl.kind,
        c ? [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map((p) => [+(p.x / FW).toFixed(3), +(p.y / FH).toFixed(3)]) : null]);
      if (tr.length > 600) tr.shift();
    }
    if (step.capture) {
      try { shoot(false); } catch (e) { note("shoot", e); diag.failed++; ctl.captured(null); }
    }
    if (debug) report(now);
  }
  const push = (a: number[], v: number) => { a.push(v); if (a.length > 15) a.shift(); };

  /** كشف إطار مصغّر: في العامل إن كان يعمل، وإلا هنا. */
  async function find(img: ImageData, w: number, hh: number): Promise<{ corners: Corners | null; luma: number; ms: number; sharp?: number; sharpMs?: number; lowTried?: boolean; low?: boolean; rejected?: boolean }> {
    if (worker) {
      const wk = worker;
      const id = ++jobId;
      const res = await new Promise<LiveResult | null>((done) => {
        const timer = setTimeout(() => { waiting.delete(id); done(null); }, workerOk ? WORKER_MS : WORKER_FIRST_MS);
        waiting.set(id, (v) => { clearTimeout(timer); done(v); });
        const job: LiveJob = { id, w, h: hh, buf: img.data.buffer as ArrayBuffer, minConfidence: MIN_CONFIDENCE, ...opts };
        try { wk.postMessage(job, [job.buf]); } catch (e) { waiting.delete(id); clearTimeout(timer); note("post", e); done(null); }
      });
      if (res && !res.error) { workerOk = true; return res; }
      if (res?.error) note("scan(worker)", res.error);
      // لم يردّ قطّ، أو رمى قبل أن يعمل مرّة: الكشف على الخيط الرئيس من الإطار التالي
      if (!workerOk && worker === wk) dropWorker(res?.error ?? "timeout");
      return { corners: null, luma: 255, ms: 0 };
    }
    try { return await detectFrame(img, MIN_CONFIDENCE, opts); }
    catch (e) { note("scan", e); return { corners: null, luma: meanLuma(img), ms: 0 }; }
  }

  /** شاشة التشخيص (`?debug=1`): أرقام الكشف والثبات والمسار، ≤ أربع مرّات في الثانية. */
  let lastReport = 0;
  function report(now: number) {
    if (now - lastReport < 250) return;
    lastReport = now;
    const win = (a: number[]) => a.filter((t) => now - t <= 1000);
    diag.dets = win(diag.dets);
    diag.found = diag.found.filter(([t]) => now - t <= 1000);
    const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : 0; };
    const st = ctl.stats, pc = (v: number) => (v * 100).toFixed(1);
    const set = stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
    const fps = set.frameRate ? `@${Math.round(set.frameRate)}` : "";
    const found = diag.found.length ? Math.round((100 * diag.found.filter(([, f]) => f).length) / diag.found.length) : 0;
    const lines = [
      `${diag.dets.length}/s · draw ${med(diag.draw).toFixed(0)} · scan ${med(diag.scan).toFixed(0)}ms · found ${found}% · ${worker ? "W" : "M"}${wrf ? "" : " wrf0"}${bmp ? " bmp" : ""} · ${small.width}×${small.height} · ${video.videoWidth}×${video.videoHeight}${fps}`,
      `raw ${pc(st.rawDev)}/${pc(RAW_TOL)}% · med ${pc(st.medDev)}/${pc(STABLE_TOL)}% · ${phase || "-"} · miss ${st.missMs.toFixed(0)}ms`,
      `ok ${st.ok} mv ${st.move} gl ${st.glitch} miss ${st.miss} out ${diag.out} · reset m${st.resets.miss} g${st.resets.glitch} r${st.resets.rearm}`,
      `stable ${st.stable} · count ${st.countdowns} · fb ${st.fallbacks} · shot ${diag.shots} done ${diag.done} fail ${diag.failed} · fine ${root.dataset.refineUsed ?? 0}/${root.dataset.refineLive ?? 0}`,
      `why ${diag.why} · sharp ${opts.sharp ? `${st.sharp.toFixed(0)}/${st.sharpBest.toFixed(0)} ${st.gate} ${med(diag.sharpMs).toFixed(1)}ms` : "off"} · hold ${st.sharpHolds} tmo ${st.sharpTimeouts} · pick ${diag.pick} · low ${opts.low ? `${diag.lowOn ? "ON" : "-"} ${diag.lowFound}/${diag.lowTried} rej ${diag.lowRejected}` : "off"} · focus ${diag.focus}`,
    ];
    if (diag.err) lines.push(`err ${diag.err}`);
    const text = lines.join("\n");
    if (dbg.textContent !== text) dbg.textContent = text;
  }

  /* ───── الرسم ───── */
  function show(p: Phase, c: Corners | null, w: number, hh: number, now: number, low: boolean) {
    if (p !== phase) {
      if (p === "counting") { ring.classList.remove("run"); void ring.offsetWidth; ring.classList.add("run"); }
      else ring.classList.remove("run");
      root.dataset.phase = p;
      phase = p;
    }
    const text = low ? S.liveDark : p === "none" ? S.liveAim : p === "locked" ? S.liveNext : S.liveHold;
    if (hint.textContent !== text) hint.textContent = text;
    // الطبقة: تبقى 300ms بعد غياب الورقة ثم تتلاشى، وتتلاشى بعد الالتقاط
    const visible = p !== "locked" && (!!c || (!!seen && now - seen.t < ABSENT_MS));
    root.classList.toggle("paper", visible);
    if (!c) { if (!visible) shown = null; return; }
    const rm = reduced();
    if (rm && now - lastDraw < REDUCED_GAP) return;
    lastDraw = now;
    shown = rm ? c : smoothCorners(shown, c);
    const map = coverMap(w, hh, video.clientWidth, video.clientHeight);
    const sc = { topLeft: map(shown.topLeft), topRight: map(shown.topRight), bottomRight: map(shown.bottomRight), bottomLeft: map(shown.bottomLeft) };
    const m = quadTransform(sc);
    quad.style.inlineSize = `${m.width}px`;
    quad.style.blockSize = `${m.height}px`;
    quad.style.transform = m.matrix;
    [sc.topLeft, sc.topRight, sc.bottomRight, sc.bottomLeft].forEach((q, i) => (dots[i]!.style.transform = `translate(${q.x - 10}px, ${q.y - 10}px)`));
  }

  function flash() {
    flashEl.classList.remove("go");
    void flashEl.offsetWidth;
    flashEl.classList.add("go");
    try { navigator.vibrate?.(10); } catch { /* غير مدعوم */ }
  }
  function refreshThumb() {
    const n = host.count(), url = host.lastThumb();
    thumb.hidden = doneBtn.hidden = n === 0;
    if (url && thumbImg.src !== url) {
      thumbImg.src = url;
      thumb.classList.remove("pop"); void thumb.offsetWidth; thumb.classList.add("pop");
    }
    countEl.textContent = ar(n);
  }

  /* ───── الالتقاط ───── */
  /** من الإطار الكامل. `manual`: زرّ الغالق، بالورقة المكتشفة إن كانت حديثة، وإلا الإطار كاملاً إلى «اضبط الزوايا». */
  function shoot(manual: boolean) {
    if (!alive || !stream || !video.videoWidth) return;
    const det = seen && performance.now() - seen.t < ABSENT_MS ? seen : null;
    if (manual) ctl.captured(det?.c ?? null);
    diag.shots++;
    const fw = video.videoWidth, fh = video.videoHeight;
    // الإطار يُؤخذ الآن، والترميز والمسار بعده بالترتيب. وإن فشل بالدقّة الكاملة (حدود canvas) فبأقلّ منها
    let got: { cv: HTMLCanvasElement; W: number; H: number; src: ImageData | null } | null = null;
    for (const px of SOURCE_FALLBACK) {
      const s = Math.min(1, Math.sqrt(px / (fw * fh)));
      const W = Math.max(1, Math.floor(fw * s)), H = Math.max(1, Math.floor(fh * s));
      const cv = document.createElement("canvas");
      try {
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error(`no 2d context ${W}×${H}`);
        ctx.drawImage(video, 0, 0, W, H);
        got = { cv, W, H, src: det ? ctx.getImageData(0, 0, W, H) : null };
        break;
      } catch (e) { note(`grab ${W}×${H}`, e); cv.width = cv.height = 0; }
    }
    if (!got) { diag.failed++; if (!manual) ctl.captured(null); return; }
    const { W, H } = got;
    let { cv, src } = got;
    flash();
    const toFile = () => new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.92)).finally(() => { cv.width = cv.height = 0; });
    if (!det || !src) {
      stop();
      void toFile().then((f) => f && host.adjust(f));
      return;
    }
    const live = scaleCorners(det.c, W / det.w, H / det.h);
    // أحدّ إطارٍ من التالية (يبدأ الآن، لا بعد ما قبله في الطابور)
    const chosen = pick ? pickSharpest(cv, src, W, H, live) : null;
    pending++;
    queue = queue.then(async () => {
      let ok = false;
      try {
        if (chosen) ({ cv, src } = await chosen);
        const corners = await refine(src!, live);
        // التشخيص: زوايا الصفحة الملتقطة نسبةً إلى الإطار (لقياس الالتقاط الخاطئ في الاختبار)
        if (debug) root.dataset.shot = JSON.stringify([corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].map((p) => [+(p.x / W).toFixed(4), +(p.y / H).toFixed(4)]));
        const file = await toFile();
        if (!file) throw new Error(`toBlob null ${W}×${H}`);
        if (!(await host.add(file, src!, corners))) throw new Error("add false");
        ok = true;
        diag.done++;
        shots++;
        refreshThumb();
        if (host.once) { if (alive) { pending--; stop(); host.done(); return; } }
        else host.announce(S.liveCaptured(host.count()));
      } catch (e) { note("add", e); }
      if (!ok) { diag.failed++; if (!manual) ctl.captured(null); } // الصفحة لم تُضف: يبقى العدد كما هو، ويعود التلقائي
      pending--;
    });
  }

  /** الإطار التالي من الفيديو، أو انقضاء `ms`. */
  const nextFrame = (ms: number) => new Promise<void>((done) => {
    const t = setTimeout(done, Math.max(0, ms));
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { clearTimeout(t); done(); });
  });
  /**
   * أحدّ إطار من `PICK_N` متتالية خلال `PICK_MS`، أولها `first` (المأخوذ لحظة الالتقاط). يُقاس كلٌّ على مربّع وسط الورقة بدقّته
   * الكاملة، ولا يُقرأ الإطار كاملاً إلا إن غلب. فإن فشلت قراءته بقي الأول. ويُكتب في التشخيص: رقم المختار من العدد، وأضعفها ÷ أحدّها.
   */
  async function pickSharpest(first: HTMLCanvasElement, src: ImageData | null, W: number, H: number, c: Corners): Promise<{ cv: HTMLCanvasElement; src: ImageData | null }> {
    const t0 = performance.now();
    const side = Math.max(8, Math.round(Math.min(PICK_PATCH, 0.35 * shortSide(c), W, H)));
    const ps = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
    const px = Math.min(W - side, Math.max(0, Math.round(ps.reduce((a, p) => a + p.x, 0) / 4 - side / 2)));
    const py = Math.min(H - side, Math.max(0, Math.round(ps.reduce((a, p) => a + p.y, 0) / 4 - side / 2)));
    const score = (cv: HTMLCanvasElement) => sharpness(cv.getContext("2d", { willReadFrequently: true })!.getImageData(px, py, side, side), null);
    let best = { cv: first, src, v: 0 }, at = 0, n = 1;
    const vals: number[] = [];
    try { best.v = score(first); vals.push(best.v); } catch (e) { note("pick", e); return best; }
    while (n < PICK_N && alive && stream) {
      await nextFrame(t0 + PICK_MS - performance.now());
      if (!alive || !stream || performance.now() - t0 > PICK_MS) break;
      const cv = document.createElement("canvas");
      try {
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error(`no 2d context ${W}×${H}`);
        ctx.drawImage(video, 0, 0, W, H);
        n++;
        const v = score(cv);
        vals.push(v);
        if (v > best.v) {
          const full = ctx.getImageData(0, 0, W, H);
          best.cv.width = best.cv.height = 0;
          best = { cv, src: full, v };
          at = n - 1;
          continue;
        }
      } catch (e) { note("pick", e); }
      cv.width = cv.height = 0;
    }
    diag.pick = `${at + 1}/${n} ${best.v ? (Math.min(...vals) / best.v).toFixed(2) : "-"}`;
    if (rootEl) rootEl.dataset.pick = diag.pick;
    return best;
  }

  /** الكشف الدقيق عند الالتقاط، ويبدأ من الحيّ: لا يُقبل إلا قريباً منه. ويُعدّ ما استُعمل منه وما رُدّ. */
  async function refine(src: ImageData, live: Corners): Promise<Corners> {
    let c: Corners | null = null;
    try {
      const small = downscale(src, REFINE_SIDE);
      const img = small === src ? src : new ImageData(small.data as Uint8ClampedArray<ArrayBuffer>, small.width, small.height);
      // ومسار التباين المنخفض إن كان هو الذي وجد الورقة حيّاً (scanic يفشل على الطاولة البيضاء بالدقّة الأعلى أيضاً)
      const d = (await detectFrame(img, MIN_CONFIDENCE, { sharp: false, low: opts.low && diag.lowOn })).corners;
      if (d) c = scaleCorners(d, src.width / small.width, src.height / small.height);
    } catch (e) { note("refine", e); } // فشل الكشف الدقيق: الحيّة
    const ok = !!c && maxCornerMove(c, live) <= REFINE_MAX * shortSide(live);
    const key = ok ? "refineUsed" : "refineLive";
    root.dataset[key] = String(Number(root.dataset[key] ?? 0) + 1);
    return ok ? c! : live;
  }

  async function finish() {
    if (!alive) return;
    thumb.disabled = doneBtn.disabled = shutter.disabled = true;
    stop();
    await queue;
    host.done();
  }
  function onClose() {
    if (shots || pending) { ask.hidden = false; ask.querySelector<HTMLButtonElement>('[data-test="live-continue"]')!.focus(); return; }
    stop();
    host.close();
  }

  void start();
}

/** أيقونة الفلاش (برق) بخطوط الأيقونات الحالية نفسها. */
function flashIcon(): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/></svg>';
  return t.content.firstElementChild as SVGElement;
}
