/**
 * لوحة رسم التوقيع بالإصبع: غلاف حول `signature_pad` (5.1.4، MIT، يُحزم في بنائنا بـVite ولا يُحمَّل من CDN).
 * التصدير PNG وحده (شرط 🕵️ أمين): لا SVG.
 *
 * النقاط تُحفظ بإحداثيات CSS، فتغيير المقاس أو الاتجاه يعيد الرسم بـ`fromData` ولا يمسح.
 * والتصدير يعيد الرسم على لوحة خفية بدقّة ≥ 3x، ثم يُقصّ على الحبر بهامش شفاف بقدر `maxWidth`.
 */
import SignaturePad from "signature_pad";

export const PAD_OPTIONS = {
  penColor: "#1D1B30", // --ink-1
  minWidth: 1.5,
  maxWidth: 3.5,
  backgroundColor: "rgba(0,0,0,0)", // شفاف
} as const;
export const EXPORT_SCALE = 3;

export interface Bounds { x0: number; y0: number; x1: number; y1: number } // x1 وy1 خارج الحدّ
export interface Pixels { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }

/** حدود الحبر من قناة alpha (RGBA)، أو null إن لم يكن فيها حبر. */
export function inkBounds(data: ArrayLike<number>, width: number, height: number): Bounds | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * يقصّ الصورة على الحبر ويحيطه بهامش شفاف `margin` من كل جهة. والهامش يُضاف خارج الصورة إن لزم،
 * فالزوايا الأربع شفافة دائماً ولو لمس الحبر حافّة اللوحة.
 */
export function cropToInk(data: ArrayLike<number>, width: number, height: number, margin: number): Pixels | null {
  const b = inkBounds(data, width, height);
  if (!b) return null;
  const m = Math.max(1, Math.ceil(margin));
  const w = b.x1 - b.x0 + 2 * m, h = b.y1 - b.y0 + 2 * m;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const s = (y * width + x) * 4, d = ((y - b.y0 + m) * w + (x - b.x0 + m)) * 4;
      out[d] = data[s]!; out[d + 1] = data[s + 1]!; out[d + 2] = data[s + 2]!; out[d + 3] = data[s + 3]!;
    }
  }
  return { data: out, width: w, height: h };
}

export class DrawPad {
  private readonly pad: SignaturePad;
  private cssW = 0;
  private cssH = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onChange?: () => void, penColor: string = PAD_OPTIONS.penColor) {
    this.pad = new SignaturePad(canvas, { ...PAD_OPTIONS, penColor });
    this.pad.addEventListener("endStroke", () => this.onChange?.());
    canvas.style.touchAction = "none";
    this.resize();
  }

  /** لون الحبر: للخطوط القادمة، وما رُسم يُعاد رسمه به (كل مجموعة نقاط تحمل لونها)، ولا يُمسح. */
  setColor(color: string): void {
    this.pad.penColor = color;
    const data = this.pad.toData();
    for (const g of data) g.penColor = color;
    this.pad.fromData(data);
  }

  /** يُستدعى عند تغيّر مقاس اللوحة أو اتجاه الشاشة: يُعيد ضبط الدقّة ويُعيد الرسم ولا يمسح. */
  resize(): void {
    const data = this.pad.toData();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.cssW = this.canvas.offsetWidth;
    this.cssH = this.canvas.offsetHeight;
    this.canvas.width = Math.round(this.cssW * ratio);
    this.canvas.height = Math.round(this.cssH * ratio);
    this.canvas.getContext("2d")!.scale(ratio, ratio);
    this.pad.fromData(data); // يمسح اللوحة ثم يعيد الرسم من النقاط
  }

  isEmpty(): boolean {
    return this.pad.isEmpty();
  }

  clear(): void {
    this.pad.clear();
    this.onChange?.();
  }

  /** PNG مقصوص على الحبر بدقّة ≥ 3x، أو null إن كانت اللوحة فارغة. */
  async toPng(): Promise<Blob | null> {
    if (this.pad.isEmpty()) return null;
    const scale = Math.max(EXPORT_SCALE, window.devicePixelRatio || 1);
    const off = document.createElement("canvas");
    off.width = Math.round(this.cssW * scale);
    off.height = Math.round(this.cssH * scale);
    const ctx = off.getContext("2d")!;
    ctx.scale(scale, scale);
    const p = new SignaturePad(off, { ...PAD_OPTIONS });
    p.off();
    p.fromData(this.pad.toData());
    const img = ctx.getImageData(0, 0, off.width, off.height);
    const cut = cropToInk(img.data, off.width, off.height, PAD_OPTIONS.maxWidth * scale);
    if (!cut) return null;
    const out = document.createElement("canvas");
    out.width = cut.width;
    out.height = cut.height;
    out.getContext("2d")!.putImageData(new ImageData(cut.data, cut.width, cut.height), 0, 0);
    return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
  }

  destroy(): void {
    this.pad.off();
  }
}
