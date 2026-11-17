/**
 * التبييض: ورق أبيض نظيف، وحبر أوضح، ولون الحبر باقٍ (أزرق الختم يبقى أزرق). مرشّح واحد تلقائي.
 *
 * على نهج `bg-remove.ts`:
 *  - **لون الورق المحلي**: في كل مربّع يُؤخذ متوسط أفتح ١٠٪ منه، ثم مرشّح أقصى ٣×٣ (مربّع غلب
 *    عليه الحبر يأخذ ورق جاره)، ثم استيفاء ثنائي الخطّ بين المراكز. فيتبع ظلَّ اليد والإضاءة المائلة.
 *  - **القسمة على الورق**: كل قناة تُقسم على لون الورق تحتها، فيصير الورق ≈1 أينما كان ظلّه
 *    ويزول اصفرار الإضاءة، ويبقى للحبر لونه.
 *  - **مستويات واحدة للقنوات الثلاث** (`(n − BLACK) / (WHITE − BLACK)`): تحويلٌ واحد لكل القنوات
 *    لا يغيّر التدرّج اللوني (hue) إلا حيث تُقصّ قناة عند الصفر.
 *
 * حدّ معروف: مساحة داكنة مصمتة أعرض من نحو ثلاثة مربّعات (صورة فوتوغرافية، شريط أسود) قد
 * يُظنّ ظلّها ورقاً فتُفتَّح؛ ولذلك أرضيّة: لا يُقدَّر ورقٌ أعتم من نصف إضاءة الورق العامة.
 *
 * **الخيارات (`Filter`):** «ملوّن» أو «أبيض وأسود»، و«التبييض» من 0 إلى 100.
 *  - **ملوّن:** 0 يعيد المدخل كما هو؛ وبين 0 و`DEFAULT_STRENGTH` مزجٌ خطّي بين المدخل والتبييض أعلاه؛
 *    و`DEFAULT_STRENGTH` هو التبييض أعلاه نفسه، بالمعادلة والأعداد نفسها (اختبارٌ يقارنه بنسخة d82ea90 بكسلاً بكسلاً)؛
 *    وفوقه يضيق المدى (`WHITE` ينزل و`BLACK` يصعد) فيبيضّ الورق أكثر ويسودّ الحبر أكثر.
 *  - **أبيض وأسود:** عتبة محلية: البكسل يُقسم على **لون الورق المحلي** نفسه (المربّعات أعلاه)، فيصير الورق ≈1
 *    أينما كان ظلّه، والحبر نسبةً منه. ثم أسود إن كانت النسبة دون `1 − cut(strength)`، بمنحدر ضيّق (`BW_RAMP`)
 *    يُبقي الحافّة ناعمة. فالعتبة تتبع الإضاءة كعتبة Bradley، لكن مرجعها أفتح ١٠٪ من كل مربّع لا متوسطه،
 *    فلا تنزل في السطور الكثيفة فتفرّغ الحروف العريضة. والقوّة الأعلى تقطع أبعد (حبرٌ أعتم وحده يبقى، فورقٌ أنظف).
 *    و0 رماديّ المدخل بلا تحويل.
 */
import type { Img } from "./types";

export type FilterMode = "color" | "bw";
export interface Filter { mode: FilterMode; strength: number }
/** القيمة الافتراضية للشريط: تعطي التبييض الذي نُشر قبل الخيارات، كما هو. */
export const DEFAULT_STRENGTH = 50;
export const DEFAULT_FILTER: Filter = { mode: "color", strength: DEFAULT_STRENGTH };

const BW_CUT_MIN = 0.12; // عند 1: يسودّ ما كان دون 88% من ورقه (أقلّ منه يسوّد ضجيج الظلّ)
const BW_CUT_MAX = 0.5; // عند 100: يسودّ ما كان دون نصف ورقه
const BW_RAMP = 0.04; // عرض المنحدر بين الأسود والأبيض (نسبةً من الورق)
/** مقدار القطع في «أبيض وأسود»: نحو 0.31 عند القيمة الافتراضية. */
export const bwCut = (strength: number) => BW_CUT_MIN + ((BW_CUT_MAX - BW_CUT_MIN) * (strength - 1)) / 99;

const WHITE = 0.88; // ما فوقه من الورق المقسوم أبيض تماماً
const BLACK = 0.1; // ما دونه أسود تماماً
const FLOOR = 0.5; // أعتم ورقٍ مقبول نسبةً إلى الورق العام

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function enhance(src: Img, f: Filter = DEFAULT_FILTER): Img {
  const { data, width: w, height: h } = src;
  const strength = Math.max(0, Math.min(100, Math.round(f.strength)));
  if (strength === 0) return f.mode === "bw" ? gray(src) : { data: new Uint8ClampedArray(data), width: w, height: h };
  const bs = Math.max(16, Math.ceil(Math.max(w, h) / 32));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  const gR = new Float32Array(gw * gh), gG = new Float32Array(gw * gh), gB = new Float32Array(gw * gh), gL = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);

  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      const x0 = bx * bs, y0 = by * bs, x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, i = (y * w + x0) * 4; x < x1; x++, i += 4) {
        hist[Math.round(lum(data[i]!, data[i + 1]!, data[i + 2]!))]!++;
        n++;
      }
      let acc = 0, p = 255;
      for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= n * 0.1) { p = v; break; } }
      let sr = 0, sg = 0, sb = 0, k = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, i = (y * w + x0) * 4; x < x1; x++, i += 4) {
        if (Math.round(lum(data[i]!, data[i + 1]!, data[i + 2]!)) >= p) { sr += data[i]!; sg += data[i + 1]!; sb += data[i + 2]!; k++; }
      }
      const gi = by * gw + bx;
      gR[gi] = sr / k; gG[gi] = sg / k; gB[gi] = sb / k; gL[gi] = lum(sr / k, sg / k, sb / k);
    }
  }

  // مرشّح أقصى ٣×٣ على الإضاءة
  const mR = new Float32Array(gR), mG = new Float32Array(gG), mB = new Float32Array(gB), mL = new Float32Array(gL);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let best = by * gw + bx;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      if (gL[ny * gw + nx]! > gL[best]!) best = ny * gw + nx;
    }
    const gi = by * gw + bx;
    mR[gi] = gR[best]!; mG[gi] = gG[best]!; mB[gi] = gB[best]!; mL[gi] = gL[best]!;
  }

  // أرضيّة: الورق العام = المئين ٧٥ من إضاءات المربّعات
  const sorted = Array.from(mL).sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.75)] ?? 255;
  for (let gi = 0; gi < mL.length; gi++) {
    const floor = FLOOR * paper;
    if (mL[gi]! < floor) {
      const k = floor / Math.max(mL[gi]!, 1);
      mR[gi] = mR[gi]! * k; mG[gi] = mG[gi]! * k; mB[gi] = mB[gi]! * k;
    }
  }

  const out = new Uint8ClampedArray(w * h * 4);
  const bw = f.mode === "bw";
  const t = bw ? 1 : Math.min(1, strength / DEFAULT_STRENGTH); // نسبة المزج مع المدخل (ملوّن، دون الافتراضي)
  const u = bw ? 0 : Math.max(0, (strength - DEFAULT_STRENGTH) / (100 - DEFAULT_STRENGTH)); // ما فوق الافتراضي
  const white = u ? WHITE - 0.16 * u : WHITE, black = u ? BLACK + 0.12 * u : BLACK;
  const scale = 255 / (white - black);
  const thr = bw ? 1 - bwCut(strength) : 0;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(gh - 1, (y + 0.5) / bs - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(gw - 1, (x + 0.5) / bs - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const a = y0 * gw + x0, b = y0 * gw + x1, c = y1 * gw + x0, d = y1 * gw + x1;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const br = mR[a]! * w00 + mR[b]! * w01 + mR[c]! * w10 + mR[d]! * w11;
      const bg = mG[a]! * w00 + mG[b]! * w01 + mG[c]! * w10 + mG[d]! * w11;
      const bb = mB[a]! * w00 + mB[b]! * w01 + mB[c]! * w10 + mB[d]! * w11;
      const i = (y * w + x) * 4;
      if (bw) {
        const n = lum(data[i]! / Math.max(br, 1), data[i + 1]! / Math.max(bg, 1), data[i + 2]! / Math.max(bb, 1));
        out[i] = out[i + 1] = out[i + 2] = ((n - thr) / BW_RAMP + 0.5) * 255;
      } else if (t === 1) { // الافتراضي وما فوقه: المعادلة المنشورة نفسها حرفاً (والقيمة الافتراضية بأعدادها نفسها)
        out[i] = (data[i]! / Math.max(br, 1) - black) * scale;
        out[i + 1] = (data[i + 1]! / Math.max(bg, 1) - black) * scale;
        out[i + 2] = (data[i + 2]! / Math.max(bb, 1) - black) * scale;
      } else {
        for (let c = 0; c < 3; c++) {
          const e = Math.max(0, Math.min(255, (data[i + c]! / Math.max(c === 0 ? br : c === 1 ? bg : bb, 1) - black) * scale));
          out[i + c] = data[i + c]! + (e - data[i + c]!) * t;
        }
      }
      out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** رماديّ المدخل بلا تبييض («أبيض وأسود» عند 0). */
function gray(src: Img): Img {
  const { data, width: w, height: h } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = lum(data[i]!, data[i + 1]!, data[i + 2]!);
    out[i + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
