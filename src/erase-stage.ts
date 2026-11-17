/**
 * ١٣ — ممحاة التوقيع والختم في شاشة المعاينة (docs/logs/additions-13-16-lama-spec.md §١٣، والنصوص §١٣ من
 * additions-12-18-texts-huda.md).
 *
 * المسحات بإحداثيات `prep.src` قبل القصّ، فالقناع بحجمه، و`extract` يُسقط ما تحته قبل حساب الحدود.
 * ولا `extract` لكل حركة: الأساس غير المقصوص يُرسم مرّة، والمسحة الحيّة تُطرح منه على لوحة العرض
 * (`destination-out`)، والقناع يُبنى عند تغيّر السجلّ وحده.
 */
import { INK_ALPHA, extract, type Prepared } from "./bg-remove";
import type { Kind } from "./place";
import { h, icon } from "./dom";
import { S, SR } from "./strings";

export interface Stroke { pts: [number, number][]; r: number }

/** نصف قطر الممحاة ببكسل `src`: القطر ببكسل الشاشة ÷ (مقياس الملاءمة × التكبير). */
export function brushSrcRadius(d: number, fit: number, zoom: number): number {
  return d / 2 / (fit * zoom);
}

/**
 * القناع من المسحات: كل مسحة خطٌّ بنهايات مستديرة عرضه 2r (كـ`lineCap/lineJoin: round` في canvas)، ويُعدّ البكسل
 * ممسوحاً إن مسّه شيءٌ منه (مركزه على بُعد r + ½ من الخطّ، كالألفا > 0 في الرسم المنعَّم).
 */
export function buildMask(w: number, h: number, strokes: readonly Stroke[]): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const s of strokes) {
    const R = s.r + 0.5, R2 = R * R;
    const pts = s.pts.length === 1 ? [s.pts[0]!, s.pts[0]!] : s.pts;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + R));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - R)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + R));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const p = y * w + x;
          if (m[p]) continue;
          const px = x + 0.5;
          const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
          const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
          if (ex * ex + ey * ey <= R2) m[p] = 1;
        }
      }
    }
  }
  return m;
}

/** سجلّ المسحات: كل فعل (مسحة أو «استعادة») خطوة واحدة يُتراجع عنها. */
export class EraseHistory {
  strokes: readonly Stroke[] = [];
  private past: (readonly Stroke[])[] = [];
  private future: (readonly Stroke[])[] = [];
  private set(next: readonly Stroke[]) { this.past.push(this.strokes); this.future = []; this.strokes = next; }
  add(s: Stroke) { this.set([...this.strokes, s]); }
  restore() { if (this.strokes.length) this.set([]); }
  undo() { const p = this.past.pop(); if (!p) return false; this.future.push(this.strokes); this.strokes = p; return true; }
  redo() { const f = this.future.pop(); if (!f) return false; this.past.push(this.strokes); this.strokes = f; return true; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

const D_MIN = 8, D_MAX = 64, D_STEP = 2, D_DEFAULT = 24;
const Z_MAX = 8, Z_STEP = 1.5;
const START_PX = 3; // المسحة لا تبدأ قبل هذه الحركة
const RUBBER = 0.55;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const rubber = (o: number, dim: number) => (o * dim * RUBBER) / (dim + RUBBER * Math.abs(o));

export interface EraseStageOpts {
  kind: Kind;
  prep: Prepared;
  strength: number;
  history: EraseHistory;
}

/** يبني المسرح وأدواته وزرّ «تم»، ويعيد عُقدها لتوضع في الورقة. */
export function eraseStage(o: EraseStageOpts): { nodes: Node[]; done: HTMLButtonElement; dispose: () => void } {
  const { kind, prep, history } = o;
  const w = prep.src.width, hgt = prep.src.height;
  const base = extract(prep, o.strength, { crop: false })!;
  const baseData = new ImageData(new Uint8ClampedArray(base.data), w, hgt);

  const ghost = h("canvas", { class: "erase-ghost", width: w, height: hgt }) as HTMLCanvasElement;
  ghost.getContext("2d")!.putImageData(baseData, 0, 0);
  const live = h("canvas", { class: "erase-live", width: w, height: hgt }) as HTMLCanvasElement;
  const lx = live.getContext("2d")!;
  const view = h("div", { class: "erase-view" }, ghost, live);
  const ring = h("div", { class: "erase-ring", "aria-hidden": "true" });
  const stage = h("div", { class: "erase-stage checker", role: "group", "aria-label": SR.stageLabel[kind], "data-test": "erase-stage", "data-mode": "erase" }, view, ring);
  const status = h("p", { class: "erase-status", role: "status", "data-test": "erase-status" });
  const done = h("button", { class: "btn primary block", type: "button", "data-test": "erase-done" }, S.done) as HTMLButtonElement;

  /* ── الأدوات ── */
  let mode: "erase" | "move" = "erase";
  const modeBtn = (m: typeof mode, text: string, label: string) =>
    h("button", { type: "button", "aria-pressed": String(m === mode), "aria-label": label, "data-test": `erase-mode-${m}`, onclick: () => setMode(m) }, text) as HTMLButtonElement;
  const eraseModeBtn = modeBtn("erase", SR.modeErase, SR.modeEraseLabel);
  const moveModeBtn = modeBtn("move", SR.modeMove, SR.modeMoveLabel);
  const setMode = (m: typeof mode) => {
    mode = m;
    eraseModeBtn.setAttribute("aria-pressed", String(m === "erase"));
    moveModeBtn.setAttribute("aria-pressed", String(m === "move"));
    stage.dataset.mode = m;
    if (m === "move") ring.classList.remove("on");
  };
  const tool = (name: "undo2" | "redo2" | "plus" | "minus" | "maximize", label: string, test: string, fn: () => void, flip = false) =>
    h("button", { type: "button", class: flip ? "flip" : undefined, "aria-label": label, "data-test": test, onclick: (e: Event) => { if ((e.currentTarget as HTMLElement).getAttribute("aria-disabled") !== "true") fn(); } }, icon(name)) as HTMLButtonElement;
  const undoBtn = tool("undo2", SR.undo, "erase-undo", () => { history.undo(); changed(); }, true);
  const redoBtn = tool("redo2", SR.redo, "erase-redo", () => { history.redo(); changed(); }, true);
  const restoreBtn = h("button", { type: "button", class: "erase-restore", "aria-label": SR.restoreLabel, "data-test": "erase-restore",
    onclick: () => { if (restoreBtn.getAttribute("aria-disabled") !== "true") { history.restore(); changed(); } } }, SR.restore) as HTMLButtonElement;
  const zoomInBtn = tool("plus", SR.zoomIn, "erase-zoom-in", () => zoomBy(Z_STEP));
  const zoomOutBtn = tool("minus", SR.zoomOut, "erase-zoom-out", () => zoomBy(1 / Z_STEP));
  const fitBtn = tool("maximize", SR.fit, "erase-fit", () => { setView(1, NaN, NaN, true); });
  const size = h("input", { type: "range", min: D_MIN, max: D_MAX, step: D_STEP, value: D_DEFAULT, id: "erase-size", "data-test": "erase-size", "aria-valuetext": SR.sizeText(D_DEFAULT) }) as HTMLInputElement;
  const sizeRow = h("label", { class: "strength erase-size", for: "erase-size" }, h("span", {}, SR.size), size);
  const tools = h("div", { class: "erase-tools" },
    h("div", { class: "erase-modes" }, eraseModeBtn, moveModeBtn),
    h("div", { class: "erase-hist" }, undoBtn, redoBtn, restoreBtn),
    sizeRow,
    h("div", { class: "erase-zoom" }, zoomInBtn, zoomOutBtn, fitBtn));

  /* ── العرض: screen = src × fit × z + (px, py) بالنسبة إلى زاوية المسرح العليا اليسرى ── */
  let W = 0, H = 0, fit = 1, z = 1, px = 0, py = 0;
  const cw = () => w * fit * z, ch = () => hgt * fit * z;
  const clampAxis = (p: number, c: number, dim: number, soft: boolean) => {
    if (c <= dim) return (dim - c) / 2;
    const lo = dim - c;
    if (p > 0) return soft ? rubber(p, dim) : 0;
    if (p < lo) return soft ? lo - rubber(lo - p, dim) : lo;
    return p;
  };
  const apply = (anim: boolean) => {
    view.classList.toggle("anim", anim && !reduced());
    view.style.width = `${w * fit}px`;
    view.style.height = `${hgt * fit}px`;
    view.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
  };
  /** يكبّر إلى zz حول نقطة المسرح (sx, sy)، أو حول المنتصف إن كانت NaN. */
  const setView = (zz: number, sx: number, sy: number, anim: boolean, soft = false) => {
    if (Number.isNaN(sx)) { sx = W / 2; sy = H / 2; }
    const ux = (sx - px) / (fit * z), uy = (sy - py) / (fit * z);
    z = Math.max(1, Math.min(Z_MAX, zz));
    px = clampAxis(sx - ux * fit * z, cw(), W, soft && !reduced());
    py = clampAxis(sy - uy * fit * z, ch(), H, soft && !reduced());
    apply(anim);
  };
  const zoomBy = (k: number) => setView(z * k, NaN, NaN, true);
  const panTo = (nx: number, ny: number, soft: boolean) => {
    px = clampAxis(nx, cw(), W, soft && !reduced());
    py = clampAxis(ny, ch(), H, soft && !reduced());
    apply(false);
  };
  const settle = () => { px = clampAxis(px, cw(), W, false); py = clampAxis(py, ch(), H, false); apply(true); };
  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = W === 0;
    W = r.width; H = r.height;
    fit = Math.min(W / w, H / hgt);
    if (first) { z = 1; px = (W - cw()) / 2; py = (H - ch()) / 2; apply(false); } else settle();
  });
  ro.observe(stage);

  /* ── الرسم ── */
  const diameter = () => Number(size.value);
  const strokeOn = (s: Stroke, from = 1) => {
    lx.lineWidth = 2 * s.r; lx.lineCap = "round"; lx.lineJoin = "round";
    lx.beginPath();
    const p0 = s.pts[Math.max(0, from - 1)]!;
    lx.moveTo(p0[0], p0[1]);
    if (s.pts.length === 1) lx.lineTo(p0[0] + 0.01, p0[1]);
    for (let i = from; i < s.pts.length; i++) lx.lineTo(s.pts[i]![0], s.pts[i]![1]);
    lx.stroke();
  };
  const redraw = () => {
    lx.globalCompositeOperation = "source-over";
    lx.clearRect(0, 0, w, hgt);
    lx.putImageData(baseData, 0, 0);
    lx.globalCompositeOperation = "destination-out";
    for (const s of history.strokes) strokeOn(s);
  };
  const inkLeft = () => {
    const m = buildMask(w, hgt, history.strokes), a = baseData.data;
    for (let p = 0; p < m.length; p++) if (!m[p] && a[p * 4 + 3]! > INK_ALPHA) return true;
    return false;
  };
  const dis = (b: HTMLElement, off: boolean) => b.setAttribute("aria-disabled", String(off));
  const changed = () => {
    redraw();
    dis(undoBtn, !history.canUndo); dis(redoBtn, !history.canRedo); dis(restoreBtn, history.strokes.length === 0);
    stage.dataset.strokes = String(history.strokes.length);
    const left = inkLeft();
    done.disabled = !left;
    status.textContent = left ? "" : SR.allErased[kind];
  };
  changed();

  /* ── الحلقة ── */
  let ringTimer = 0;
  const ringAt = (sx: number, sy: number) => {
    const d = diameter();
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.transform = `translate(${sx - d / 2}px, ${sy - d / 2}px)`;
    ring.classList.add("on");
  };
  size.addEventListener("input", () => {
    size.setAttribute("aria-valuetext", SR.sizeText(diameter()));
    ringAt(W / 2, H / 2);
    clearTimeout(ringTimer);
    ringTimer = window.setTimeout(() => ring.classList.remove("on"), 600);
  });
  const nudgeSize = (k: number) => { size.value = String(Math.max(D_MIN, Math.min(D_MAX, diameter() + k * D_STEP))); size.dispatchEvent(new Event("input")); };

  /* ── الإيماءات ── */
  const pts = new Map<number, { x: number; y: number; type: string }>();
  let penSeen = false, spaceHeld = false;
  type G =
    | { k: "idle" }
    | { k: "erase"; id: number; x0: number; y0: number; s: Stroke | null }
    | { k: "pan"; id: number; x0: number; y0: number; px0: number; py0: number }
    | { k: "pinch"; d0: number; z0: number; ux: number; uy: number };
  let g: G = { k: "idle" };
  const local = (e: PointerEvent) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toSrc = (x: number, y: number): [number, number] => [(x - px) / (fit * z), (y - py) / (fit * z)];
  const startPinch = () => {
    const [a, b] = [...pts.values()];
    const mx = (a!.x + b!.x) / 2, my = (a!.y + b!.y) / 2;
    g = { k: "pinch", d0: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)), z0: z, ux: (mx - px) / (fit * z), uy: (my - py) / (fit * z) };
  };

  stage.addEventListener("pointerdown", (e) => {
    const p = local(e);
    if (e.pointerType === "pen") penSeen = true;
    pts.set(e.pointerId, { ...p, type: e.pointerType });
    try { stage.setPointerCapture(e.pointerId); } catch { /* مؤشّر مصطنع */ }
    if (pts.size >= 2) {
      // إصبع ثانٍ: تُلغى المسحة الجارية كلها، وتصير الإيماءة تكبيراً
      if (g.k === "erase" && g.s) redraw();
      ring.classList.remove("on");
      startPinch();
      return;
    }
    const panning = mode === "move" || e.button === 1 || spaceHeld || (penSeen && e.pointerType === "touch");
    if (panning) { g = { k: "pan", id: e.pointerId, x0: p.x, y0: p.y, px0: px, py0: py }; e.preventDefault(); return; }
    if (e.button !== 0) return;
    g = { k: "erase", id: e.pointerId, x0: p.x, y0: p.y, s: null };
  });
  stage.addEventListener("pointermove", (e) => {
    const p = local(e);
    const known = pts.get(e.pointerId);
    if (known) { known.x = p.x; known.y = p.y; }
    if (mode === "erase" && e.pointerType === "mouse" && g.k !== "pan" && g.k !== "pinch") ringAt(p.x, p.y);
    if (g.k === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const mx = (a!.x + b!.x) / 2, my = (a!.y + b!.y) / 2;
      z = Math.max(1, Math.min(Z_MAX, g.z0 * Math.hypot(a!.x - b!.x, a!.y - b!.y) / g.d0));
      panTo(mx - g.ux * fit * z, my - g.uy * fit * z, true);
      return;
    }
    if (g.k === "pan" && g.id === e.pointerId) { panTo(g.px0 + p.x - g.x0, g.py0 + p.y - g.y0, true); return; }
    if (g.k !== "erase" || g.id !== e.pointerId) return;
    if (!g.s) {
      if (Math.hypot(p.x - g.x0, p.y - g.y0) < START_PX) return;
      g.s = { pts: [toSrc(g.x0, g.y0)], r: brushSrcRadius(diameter(), fit, z) };
      lx.globalCompositeOperation = "destination-out";
    }
    g.s.pts.push(toSrc(p.x, p.y));
    strokeOn(g.s, g.s.pts.length - 1);
    if (e.pointerType !== "mouse") ringAt(p.x, p.y);
  });
  const end = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (g.k === "erase" && g.id === e.pointerId) {
      if (g.s && e.type === "pointerup") { history.add(g.s); changed(); } else if (g.s) redraw();
      g = { k: "idle" };
      if (e.pointerType !== "mouse") ring.classList.remove("on");
    } else if (g.k === "pan" && g.id === e.pointerId) { g = { k: "idle" }; settle(); }
    else if (g.k === "pinch" && pts.size < 2) { g = { k: "idle" }; settle(); } // بقيّة الإصبع لا تمسح حتى ترتفع
  };
  stage.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }); // لا تمرير تلقائيّ بالزرّ الأوسط
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && g.k === "idle") ring.classList.remove("on"); });
  stage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return; // العجلة وحدها تُمرّر الورقة
    e.preventDefault();
    const p = local(e as unknown as PointerEvent);
    setView(z * Math.exp(-e.deltaY * 0.01), p.x, p.y, false);
  }, { passive: false });

  /* ── لوحة المفاتيح: بـ`e.code` لا `e.key` (Z في اللوحة العربية «ئ») ── */
  const onKey = (e: KeyboardEvent) => {
    if (!stage.isConnected) { dispose(); return; } // احتياط: الفصل الصريح هو الأصل
    if (e.code === "Space" && !e.repeat) { spaceHeld = true; if (document.activeElement === document.body) e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    let hit = true;
    if (mod && e.code === "KeyZ") { if (e.shiftKey) history.redo(); else history.undo(); changed(); }
    else if (mod && e.code === "KeyY") { history.redo(); changed(); }
    else if (mod || e.altKey) hit = false;
    else if (e.code === "BracketLeft") nudgeSize(-1);
    else if (e.code === "BracketRight") nudgeSize(1);
    else if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(Z_STEP);
    else if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1 / Z_STEP);
    else if (e.code === "Digit0" || e.code === "Numpad0") setView(1, NaN, NaN, true);
    else hit = false;
    if (hit) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld = false; };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  /** يُستدعى من كل مخارج المسرح (تم، رجوع، إغلاق الورقة): يفصل المستمعين والمراقب فلا يبقى الإغلاق حاملاً للصورة. */
  function dispose() {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    ro.disconnect();
  }

  return { nodes: [stage, status, tools, done], done, dispose };
}
