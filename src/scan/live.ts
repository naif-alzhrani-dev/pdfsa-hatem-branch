/**
 * منطق المسح الحيّ (docs/design-spec-livescan.md §١ و§٣) بدوالّ نقيّة تُختبر في Node بلا DOM:
 * الثبات، والعدّ، ومنع الالتقاط المكرّر، والتنعيم، والإضاءة الضعيفة، ورسم طبقة الورقة بـ`matrix3d`.
 *
 * الزوايا كلها بمقاس الإطار الذي كُشفت فيه (بكسل)، وبشكل `Corners` من geom.ts.
 */
import type { Corners } from "./geom";
import { homography } from "./warp";
import type { Img, Pt, Quad } from "./types";

/**
 * الثبات (دفعة الضبط بعد تجربة نايف على آيفون، ٢٠٢٦/١١/٠٨: «يتأخر… ويضل يرتكب في التحديد»):
 * - يُحكم بالزوايا **المنعَّمة**: وسيط آخر `MEDIAN_N` كشوف (لا أقدم من `MEDIAN_MS`)، لا الخام.
 * - **نافذة زمنية** `STABLE_MS` لا عدد إطارات: معدّل الكشف على الجوال أبطأ من الحاسوب.
 * - ثابتة إن بقي وسيط كل كشف في النافذة ضمن `STABLE_TOL` من الضلع القصير عن الوسيط الحالي،
 *   ولم يبتعد كشفٌ خام فيها أكثر من `RAW_TOL` (حارس: الوسيط وحده يهدّئ اهتزازاً حقيقياً فيبدو ثابتاً).
 */
export const STABLE_TOL = 0.04;
export const RAW_TOL = 0.04;
export const STABLE_MS = 300;
export const MEDIAN_N = 5;
export const MEDIAN_MS = 600;
/**
 * كشفٌ فائت أقصر من هذا لا يقطع الثبات (إطار يخطئ فيه الكشف). **حدّه الأدنى**: المهلة الفعلية نسبية إلى معدّل الكشف
 * المقيس (`MISS_K` × وسيط الفاصل بين الكشوف، حتى `MISS_MAX`)، فجهازٌ يكشف كل 300ms لا يُعاد عدّه من الصفر بكل إطار فائت.
 */
export const MISS_MS = 250;
export const MISS_K = 2.5;
export const MISS_MAX = 1500;
/**
 * الاتّساق الزمني (دفعة الإصلاح الثانية، ٢٠٢٦/١١/٠٨: «لم ينجح ولا مرّة الالتقاط التلقائي»). كل كشفٍ يُصنَّف إزاء الوسيط المتتبَّع:
 * - **سليم**: كل زواياه ضمن `RAW_TOL`.
 * - **حركة**: ثلاث زوايا أو أكثر خارجه معاً (الورقة أو الجوال يتحرّك فعلاً): يدخل التاريخ ويكسر الثبات.
 * - **شاذّ**: زاوية أو اثنتان فقط خارجه (زاوية قفزت إلى عرق خشب أو ظلّ)، أو قفزة كاملة أبعد من `JUMP_TOL`،
 *   أو تغيّر مساحة أكثر من `AREA_JUMP`، أو شكل غير معقول (زاوية داخلية أحدّ من `MIN_ANGLE` أو غير محدّب).
 *   الشاذّ **لا يدخل الوسيط ولا يكسر الثبات**، ويُعامل ككشفٍ فائت؛ لكن إن زادت نسبته في آخر `GLITCH_MS` عن `GLITCH_MAX` فلا ثبات.
 */
export const JUMP_TOL = 0.25;
export const AREA_JUMP = 0.25;
/** كانت 35°؛ صارت 20° (live-fix3): منظور مائل بشدّة يعطي زاوية داخلية نحو 25–30°، والمستحيل يبقى مرفوضاً. */
export const MIN_ANGLE = 20;
export const GLITCH_MS = 1000;
export const GLITCH_MAX = 0.5;
/** الثبات يحتاج هذا العدد من الكشوف السليمة على الأقل في النافذة (فالجهاز البطيء لا يثبت بكشفين اتّفاقاً). */
export const STABLE_N = 3;
/** ولا حركة (كشفٌ خامٌ أبعد من `RAW_TOL`) في آخر `CALM_MS`: النافذة التي يُفحص فيها الخام أطول من نافذة الحضور. */
export const CALM_MS = 600;
/**
 * احتياط بالزمن (live-fix3، نايف: «في الأوراق التي فيها زوايا حاده واذا يوجد زاوية غير متزنه لا تلتقط»):
 * ورقة مكتشفة منذ `FALLBACK_MS` بلا «حركة» حقيقية فيها، ولم يبدأ العدّ لأن الشواذّ تمنعه (زاوية مطويّة أو تتأرجح بين موضعين)،
 * يجري العدّ كالمعتاد ثم يُلتقط بالرباعي الأكثر اتّساقاً في آخر `FALLBACK_WIN`: لكل زاوية الموضع الذي يجاوره (ضمن `RAW_TOL`)
 * أكثر الكشوف، ولا يُقبل إلا إن جاوره `FALLBACK_SUPPORT` منها على الأقل.
 */
export const FALLBACK_MS = 1300;
export const FALLBACK_WIN = 1200;
export const FALLBACK_SUPPORT = 0.35;
/** «بلا حركة»: كشوف «حركة» لا تزيد عن هذه النسبة من كشوف آخر `FALLBACK_MS` (ورقة تهتزّ ±8% نحو 80% منها حركة). */
export const FALLBACK_MOVE_MAX = 0.2;
/**
 * بوابة الحدّة (نايف ٢٠٢٦/١١/٠٩: «لا يلتقط حتى يثبت الزوم على الورقة بضبط»): العدّ لا يكتمل حتى تكون آخر `SHARP_N` قيم حدّة
 * (src/scan/sharp.ts) كلها ≥ `SHARP_NEAR` × أفضل ما رُئي للورقة نفسها في آخر `SHARP_WIN`. نسبية لا مطلقة: الورق والإضاءة يختلفان.
 * و**مستقرّة**: أدناها ≥ `SHARP_STEADY` من أعلاها. فالتركيز الذي ما زال يتحسّن (القيم تصعد ولو ببطء) يؤخّر، والإطار الذي اهتزّ (قيمة هابطة) يؤخّر.
 * **المهلة:** إن لم تتحقق خلال `SHARP_MAX_MS` من بدء **أول** عدٍّ للورقة الحاضرة، يُلتقط على أيّ حال: لا يعلق المسح أبداً.
 *   ولا تُعاد المهلة إن انقطع العدّ وبدأ (الشاذّ الغالب يعيد السلسلة): كانت تُعاد في WebKit فيبقى ينتظر 6–8 ث (الجولة الثانية).
 * **لا تُحسب حدّة الكشف الشاذّ** (`glitch`: رباعيٌّ قفزت زاويته، فداخله ليس الورقة وحدها)، و«الأفضل» أعلى **وسيطٍ لكل ثلاث متتالية**
 *   لا أعلى قيمة: قمّة منفردة (+30% في إطار، المقصوص الزاوية في WebKit) كانت تؤخّر الالتقاط حتى تخرج من النافذة (docs/logs/live-sharp-white.md).
 * 0.8 من القياس: تذبذب الإطارات المتماثلة 1–5%، وضبابية نصف بكسل بمقاس الكشف تُنزل القيمة إلى 0.64.
 */
export const SHARP_NEAR = 0.8;
export const SHARP_N = 3;
export const SHARP_STEADY = 0.88;
export const SHARP_WIN = 1500;
/** ما زالت تصعد (الجولة الثانية): منحدر Chromium المصطنع 176 → 180 → 189 → 191 → 208 مرّ من «مستقرّة» فالتُقط عند 900ms بنصف الحدّة؛ ووسيطٌ لوسيط 191 ÷ 173 = 1.10 مرّ من ×1.12. ×1.08: وسيط الثلاث يكبح تذبذب الإطارات (بثّ المقصوص الزاوية ≈1.02)، واختبار ±5% بعشر بذور يحرسه. */
export const SHARP_RISE = 1.08;
export const SHARP_MAX_MS = 1500;
/** العدّ قبل الالتقاط التلقائي (قرار المدير على طلب نايف السرعة؛ كان 700ms). */
export const COUNTDOWN_MS = 400;
/** بعد الالتقاط يتوقّف التلقائي حتى يقلّ تطابق موضع الورقة مع الملتقطة عن 60%… */
export const REARM_IOU = 0.6;
/** …أو تغيب الورقة هذه المدّة (قرار تنفيذ: مدّة بقاء الطبقة نفسها، فإطار واحد يخطئ فيه الكشف لا يعدّ غياباً). */
export const ABSENT_MS = 300;
/** الطبقة المرسومة: تنعيم أُسّي بمعامل 0.35 فوق الوسيط، ومنطقة ميّتة 2% من الضلع القصير (كانت 1% على الخام). */
export const SMOOTH = 0.35;
export const DEAD_ZONE = 0.02;
/** الإضاءة الضعيفة: متوسط سطوع أقل من 40/255 مدّة ثانية. */
export const DARK_LUMA = 40;
export const DARK_MS = 1000;

const pts = (c: Corners): Quad => [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** أقصر أضلاع الرباعي. */
export function shortSide(c: Corners): number {
  const q = pts(c);
  let m = Infinity;
  for (let i = 0; i < 4; i++) m = Math.min(m, dist(q[i]!, q[(i + 1) % 4]!));
  return m;
}

/** أكبر ما تحرّكته زاوية بين رباعيَّين. */
export function maxCornerMove(a: Corners, b: Corners): number {
  const p = pts(a), q = pts(b);
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(p[i]!, q[i]!));
  return m;
}

function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, n = poly[(i + 1) % poly.length]!;
    s += p.x * n.y - n.x * p.y;
  }
  return s / 2;
}

/** يقصّ مضلّعاً محدّباً بآخر محدّب (Sutherland–Hodgman). كلاهما بالاتجاه نفسه. */
function clip(subject: Pt[], by: Pt[]): Pt[] {
  let out = subject;
  const sign = Math.sign(area(by)) || 1;
  for (let i = 0; i < by.length && out.length; i++) {
    const a = by[i]!, b = by[(i + 1) % by.length]!;
    const side = (p: Pt) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j]!, q = inp[(j + 1) % inp.length]!;
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
  }
  return out;
}

/** تطابق الموضع: مساحة التقاطع ÷ مساحة الاتحاد (0–1). */
export function overlap(a: Corners, b: Corners): number {
  const p = pts(a), q = pts(b);
  const ap = Math.abs(area(p)), aq = Math.abs(area(q));
  if (!ap || !aq) return 0;
  const i = Math.abs(area(clip(p, q)));
  return i / (ap + aq - i);
}

/**
 * التنعيم لكل إطار: الزاوية التي تحرّكت أقل من المنطقة الميّتة تبقى مكانها (لا ارتعاش)،
 * وغيرها تقترب من موضعها الجديد بنسبة `alpha`.
 */
export function smoothCorners(prev: Corners | null, next: Corners, alpha = SMOOTH, dead = DEAD_ZONE): Corners {
  if (!prev) return next;
  const tol = dead * shortSide(next);
  const s = (a: Pt, b: Pt): Pt => (dist(a, b) < tol ? a : { x: a.x + alpha * (b.x - a.x), y: a.y + alpha * (b.y - a.y) });
  return {
    topLeft: s(prev.topLeft, next.topLeft),
    topRight: s(prev.topRight, next.topRight),
    bottomRight: s(prev.bottomRight, next.bottomRight),
    bottomLeft: s(prev.bottomLeft, next.bottomLeft),
  };
}

/** وسيط كل إحداثي على حدة (يقاوم كشفاً شاذّاً واحداً، بخلاف المتوسط). */
export function medianCorners(list: Corners[]): Corners {
  const med = (v: number[]) => { const a = v.slice().sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
  const k = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
  const out = {} as Corners;
  for (const key of k) out[key] = { x: med(list.map((c) => c[key].x)), y: med(list.map((c) => c[key].y)) };
  return out;
}

/**
 * - `none`: لا ورقة.
 * - `unstable`: ورقة تتحرّك.
 * - `stable`: ورقة ثابتة في الوضع اليدوي (لا عدّ).
 * - `counting`: ثابتة ويجري العدّ (`progress` من 0 إلى 1).
 * - `locked`: بعد الالتقاط، حتى تغيب الورقة أو تتحرّك عن موضعها.
 * `corners`: الزوايا المنعَّمة (الوسيط) لهذا الإطار، أو null بلا ورقة. تُرسم بها الطبقة ويُلتقط بها.
 */
export type Phase = "none" | "unstable" | "stable" | "counting" | "locked";
export interface Step { phase: Phase; progress: number; capture: boolean; corners: Corners | null }
/** تصنيف الكشف إزاء الوسيط المتتبَّع (انظر `JUMP_TOL`). */
export type Kind = "ok" | "move" | "glitch";

/** عدّادات التشخيص (`?debug=1`): أين يتوقّف المسار على جهاز حقيقي. */
export interface LiveStats {
  ok: number; move: number; glitch: number; miss: number;
  /** كم مرّة بلغ «ثابت» (دخل العدّ أو الثبات اليدوي)، وكم مرّة اكتمل العدّ. */
  stable: number; countdowns: number;
  /** التقاطات الاحتياط بالزمن. */
  fallbacks: number;
  /** إعادة السلسلة من الصفر وسببها. */
  resets: { miss: number; glitch: number; captured: number; mode: number; rearm: number };
  /** آخر انحراف (نسبة من الضلع القصير): أبعد خامٍ وأبعد وسيطٍ في النافذة عن الوسيط الحالي. */
  rawDev: number; medDev: number;
  /** مهلة الكشف الفائت الفعلية (ms). */
  missMs: number;
  /** الحدّة: آخر قيمة وأفضلها في النافذة (0 بلا قياس)، وحالة البوابة. */
  sharp: number; sharpBest: number; gate: "-" | "ok" | "hold";
  /** كم مرّة أخّرت البوابة التقاطاً اكتمل عدّه، وكم مرّة التُقط بالمهلة وهي لم تتحقق. */
  sharpHolds: number; sharpTimeouts: number;
}

interface Entry { t: number; raw: Corners; med: Corners }

/** زوايا الرباعي الداخلية بالدرجات، أو null إن لم يكن محدّباً. */
export function interiorAngles(c: Corners): number[] | null {
  const q = pts(c);
  const out: number[] = [];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4]!, o = q[i]!, n = q[(i + 1) % 4]!;
    const ax = p.x - o.x, ay = p.y - o.y, bx = n.x - o.x, by = n.y - o.y;
    const sg = Math.sign((o.x - p.x) * (n.y - o.y) - (o.y - p.y) * (n.x - o.x));
    if (!sg || (sign && sg !== sign)) return null;
    sign = sg;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    out.push((Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180) / Math.PI);
  }
  return out;
}

/** شكل معقول لورقة: محدّب، وكل زاوية داخلية بين `MIN_ANGLE` و`180 − MIN_ANGLE`. */
export function plausible(c: Corners): boolean {
  const a = interiorAngles(c);
  return !!a && a.every((x) => x >= MIN_ANGLE && x <= 180 - MIN_ANGLE);
}

/** يصنّف كشفاً إزاء الوسيط المتتبَّع (`ref`؛ null أول السلسلة). */
export function classify(c: Corners, ref: Corners | null): Kind {
  if (!plausible(c)) return "glitch";
  if (!ref) return "ok";
  const s = shortSide(ref);
  const p = pts(c), q = pts(ref);
  let off = 0, far = 0;
  for (let i = 0; i < 4; i++) {
    const d = dist(p[i]!, q[i]!);
    if (d > RAW_TOL * s) off++;
    if (d > JUMP_TOL * s) far++;
  }
  const ar = Math.abs(area(p)) / (Math.abs(area(q)) || 1);
  if (far || ar > 1 + AREA_JUMP || ar < 1 / (1 + AREA_JUMP)) return "glitch";
  if (off === 0) return "ok";
  return off >= 3 ? "move" : "glitch";
}

/**
 * الرباعي الأكثر اتّساقاً: لكل زاوية الكشف الذي يجاوره (ضمن `RAW_TOL` من الضلع القصير) أكثر الكشوف، ومتوسط جيرانه.
 * فزاوية تتأرجح بين موضعين تأخذ الأكثر تكراراً. null إن قلّ الجيران عن `FALLBACK_SUPPORT` أو لم يكن الشكل معقولاً.
 */
export function consensus(list: Corners[]): Corners | null {
  if (list.length < STABLE_N) return null;
  const tol = RAW_TOL * shortSide(medianCorners(list));
  const out = {} as Corners;
  for (const k of ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const) {
    const ps = list.map((c) => c[k]);
    let best: Pt[] = [];
    for (const p of ps) { const n = ps.filter((q) => dist(p, q) <= tol); if (n.length > best.length) best = n; }
    if (best.length < FALLBACK_SUPPORT * ps.length) return null;
    out[k] = { x: best.reduce((a, p) => a + p.x, 0) / best.length, y: best.reduce((a, p) => a + p.y, 0) / best.length };
  }
  return plausible(out) ? out : null;
}

const median = (v: number[]) => { const a = v.slice().sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

export class LiveController {
  auto: boolean;
  private hist: Entry[] = []; // كشوف السلسلة الحالية غير الشاذّة (حضورٌ متصل)
  private glitches: number[] = []; // أوقات الشواذّ في السلسلة
  private since: number | null = null; // بداية الحضور المتصل
  private seenAt: number | null = null;
  private countFrom: number | null = null;
  private last: Corners | null = null; // موضع آخر صفحة ملتقطة
  private absentFrom: number | null = null;
  private prev: Step = { phase: "none", progress: 0, capture: false, corners: null };
  private calls: number[] = []; // أوقات آخر الاستدعاءات (لمعدّل الكشف)
  kind: Kind | null = null; // تصنيف الكشف الأخير (يقرؤه التشخيص)
  private pool: { t: number; c: Corners }[] = []; // كل الكشوف (مع الشاذّ) في الحضور الحالي، للاحتياط
  private presentFrom: number | null = null;
  private lastSeen: number | null = null;
  private moves: number[] = []; // أوقات كشوف «الحركة» في الحضور الحالي
  private fbFrom: number | null = null;
  private sharps: { t: number; v: number }[] = []; // قيم الحدّة للورقة الحالية
  private heldFor: number | null = null; // بداية العدّ الذي أُحصي تأخيره
  private gateFrom: number | null = null; // بداية أول عدٍّ انتظر البوابة للورقة الحاضرة (المهلة منه)
  private sharpIn: number | undefined; // حدّة الإطار الجاري، تُحفظ بعد تصنيفه
  stats: LiveStats = { ok: 0, move: 0, glitch: 0, miss: 0, stable: 0, countdowns: 0, fallbacks: 0, resets: { miss: 0, glitch: 0, captured: 0, mode: 0, rearm: 0 }, rawDev: 0, medDev: 0, missMs: MISS_MS, sharp: 0, sharpBest: 0, gate: "-", sharpHolds: 0, sharpTimeouts: 0 };

  constructor(auto = true) { this.auto = auto; }

  /** مهلة الكشف الفائت: `MISS_K` × وسيط الفاصل بين آخر الاستدعاءات، بين `MISS_MS` و`MISS_MAX`. */
  missMs(): number {
    const c = this.calls;
    if (c.length < 3) return MISS_MS;
    const gaps: number[] = [];
    for (let i = 1; i < c.length; i++) gaps.push(c[i]! - c[i - 1]!);
    return Math.min(MISS_MAX, Math.max(MISS_MS, MISS_K * median(gaps)));
  }

  /**
   * إطار جديد: الزوايا المكتشفة (أو null) ووقته بالمللي ثانية، وحدّة الورقة فيه (`sharp`؛ بدونها لا بوابة).
   * `capture` صحيحة مرّة واحدة لكل التقاط تلقائي.
   */
  update(c: Corners | null, now: number, sharp?: number): Step {
    // الحدّة لكل كشفٍ فيه ورقة (والشاذّ منه: داخله المنكمش ورقةٌ في الغالب)، وتُنسى حين تغيب الورقة أو تُلتقط
    if (c && sharp !== undefined) this.stats.sharp = sharp;
    this.sharpIn = c ? sharp : undefined;
    return this.fallback(c, now, this.core(c, now));
  }

  /** هل تسمح البوابة بالالتقاط الآن، لعدٍّ بدأ عند `from`؟ وتُحصي التأخير والمهلة. */
  private sharpGo(from: number, now: number): boolean {
    const v = this.sharps.filter((e) => now - e.t <= SHARP_WIN);
    if (!v.length) { this.stats.gate = "-"; return true; }
    this.gateFrom ??= from;
    const x = v.map((e) => e.v);
    const best = x.length < 3 ? Math.max(...x) : Math.max(...x.slice(1, -1).map((m, i) => median3(x[i]!, m, x[i + 2]!)));
    const last = v.slice(-SHARP_N);
    this.stats.sharpBest = best;
    const lo = Math.min(...last.map((e) => e.v)), hi = Math.max(...last.map((e) => e.v));
    // وما زالت تصعد: وسيط آخر ثلاث ≥ `SHARP_RISE` × وسيط الثلاث قبلها (منحدر بطيء 5% لكل إطار يمرّ من شرط «مستقرّة» وحده)
    const m3 = (k: number) => median3(x[k]!, x[k + 1]!, x[k + 2]!), n = x.length;
    const rising = n >= 6 && m3(n - 3) >= SHARP_RISE * m3(n - 6);
    const ok = last.length >= SHARP_N && lo >= SHARP_NEAR * best && lo >= SHARP_STEADY * hi && !rising;
    this.stats.gate = ok ? "ok" : "hold";
    if (ok) return true;
    if (now - this.gateFrom >= SHARP_MAX_MS) { this.stats.sharpTimeouts++; return true; }
    if (this.heldFor !== from) { this.heldFor = from; this.stats.sharpHolds++; }
    return false;
  }

  /** المسار المعتاد: التصنيف والوسيط والثبات والعدّ. */
  private core(c: Corners | null, now: number): Step {
    this.calls.push(now);
    if (this.calls.length > 9) this.calls.shift();
    const missMs = (this.stats.missMs = this.missMs());
    const ref = this.hist.length ? this.hist[this.hist.length - 1]!.med : null;
    const kind = (this.kind = c ? classify(c, ref) : null);
    if (kind) this.stats[kind]++; else this.stats.miss++;
    if (c && kind !== "glitch" && this.sharpIn !== undefined) {
      this.sharps.push({ t: now, v: this.sharpIn });
      this.sharps = this.sharps.filter((e) => now - e.t <= SHARP_WIN);
    }
    if (!c || kind === "glitch") {
      // فائت أو شاذّ قصير: كأن شيئاً لم يتغيّر (لا يقطع الثبات ولا العدّ، ولا يلتقط، ولا تتحرّك الطبقة إليه)
      if (c) this.glitches = [...this.glitches.filter((t) => now - t <= GLITCH_MS), now];
      const ok = this.hist.filter((e) => now - e.t <= GLITCH_MS).length;
      // …إلا إن صار الشاذّ أغلب الكشوف: فالمتتبَّع هو الخطأ، ويُبدأ من الكشف الحالي (الأغلبية تغلب)
      const outvoted = !!c && this.glitches.length >= 3 && this.glitches.length > ok + 1;
      if (outvoted) this.stats.resets.glitch++;
      else if (this.seenAt !== null && now - this.seenAt < missMs) return (this.prev = { ...this.prev, capture: false });
      else if (this.seenAt !== null) this.stats.resets.miss++;
      this.resetStreak();
      if (this.last) {
        this.absentFrom ??= now;
        if (now - this.absentFrom >= ABSENT_MS) this.last = null;
      }
      // شاذّ بعد انقطاعٍ أطول من المهلة: يبدأ به سلسلة جديدة (إعادة الاقتناء)، إلا إن كان شكله غير معقول
      if (!c || !plausible(c)) return (this.prev = { phase: this.last ? "locked" : "none", progress: 0, capture: false, corners: null });
    }
    this.absentFrom = null;
    this.seenAt = now;
    this.since ??= now;
    const recent = this.hist.filter((e) => now - e.t <= MEDIAN_MS).slice(-(MEDIAN_N - 1)).map((e) => e.raw);
    const med = medianCorners([...recent, c]);
    this.hist.push({ t: now, raw: c, med });
    this.hist = this.hist.filter((e, i, a) => now - e.t <= Math.max(MEDIAN_MS, STABLE_MS) || i >= a.length - STABLE_N);
    this.glitches = this.glitches.filter((t) => now - t <= GLITCH_MS);

    if (this.last) {
      if (overlap(med, this.last) >= REARM_IOU) return (this.prev = { phase: "locked", progress: 0, capture: false, corners: med });
      this.last = null;
      this.stats.resets.rearm++;
      this.hist = [{ t: now, raw: c, med }];
      this.glitches = [];
      this.since = now;
    }
    if (!this.stable(med, now)) { this.countFrom = null; return (this.prev = { phase: "unstable", progress: 0, capture: false, corners: med }); }
    if (this.prev.phase !== "stable" && this.prev.phase !== "counting") this.stats.stable++;
    if (!this.auto) return (this.prev = { phase: "stable", progress: 0, capture: false, corners: med });
    this.countFrom ??= now;
    const progress = Math.min(1, (now - this.countFrom) / COUNTDOWN_MS);
    if (progress < 1 || !this.sharpGo(this.countFrom, now)) return (this.prev = { phase: "counting", progress, capture: false, corners: med });
    this.stats.countdowns++;
    this.captured(med);
    return (this.prev = { phase: "counting", progress: 1, capture: true, corners: med });
  }

  /**
   * حضورٌ متصل مدّة النافذة، وفيها `STABLE_N` كشوف غير شاذّة على الأقل (تمتدّ النافذة إليها إن كان الكشف بطيئاً)،
   * وكلها قريبة من الوسيط الحالي (منعَّمةً، وخاماً بحدٍّ أوسع)، ونسبة الشواذّ في آخر ثانية لا تزيد عن `GLITCH_MAX`.
   */
  private stable(med: Corners, now: number): boolean {
    const s = shortSide(med);
    const win = this.hist.filter((e, i, a) => now - e.t <= CALM_MS || i >= a.length - STABLE_N);
    let raw = 0, mm = 0;
    // «حركة» في النافذة بقاعدة التصنيف نفسها: ثلاث زوايا فأكثر أبعد من `RAW_TOL` معاً. فزاوية أو اثنتان تجاوزتا الحدّ
    // بالضجيج وحده لا تقطعان الثبات (عزل الذيل في live-fix3: الضجيج ±1.5% كان يتأخّر إلى 1.3–3 ث في 2–4 من 10، وفي de2f171 أيضاً)
    let moved = false;
    for (const e of win) {
      raw = Math.max(raw, maxCornerMove(e.raw, med) / s);
      mm = Math.max(mm, maxCornerMove(e.med, med) / s);
      const p = pts(e.raw), q = pts(med);
      if (p.filter((v, i) => dist(v, q[i]!) > RAW_TOL * s).length >= 3) moved = true;
    }
    this.stats.rawDev = raw; this.stats.medDev = mm;
    if (this.since === null || now - this.since < STABLE_MS || win.length < STABLE_N) return false;
    const ok = this.hist.filter((e) => now - e.t <= GLITCH_MS).length;
    if (this.glitches.length > GLITCH_MAX * (this.glitches.length + ok)) return false;
    return mm <= STABLE_TOL && !moved;
  }

  /** التُقطت صفحة (تلقائياً أو باليد) في هذا الموضع: لا التقاط تلقائي حتى تغيب أو تتحرّك. null: بلا قفل (ومنه فشل الالتقاط). */
  captured(c: Corners | null) {
    this.stats.resets.captured++;
    this.sharps = []; this.stats.gate = "-"; this.gateFrom = null;
    this.pool = []; this.presentFrom = null; this.fbFrom = null;
    this.resetStreak();
    this.last = c;
    this.absentFrom = null;
  }

  /** الاحتياط بالزمن (انظر `FALLBACK_MS`). لا يتدخّل إن كان المسار المعتاد يعدّ أو مقفلاً، ولا في الوضع اليدوي. */
  private fallback(c: Corners | null, now: number, st: Step): Step {
    if (c) {
      if (this.lastSeen === null || now - this.lastSeen >= this.stats.missMs) { this.presentFrom = now; this.pool = []; }
      this.lastSeen = now;
      if (this.kind === "move") this.moves.push(now);
      this.moves = this.moves.filter((t) => now - t <= FALLBACK_MS);
      this.pool.push({ t: now, c });
      this.pool = this.pool.filter((e) => now - e.t <= FALLBACK_WIN);
    } else if (this.lastSeen !== null && now - this.lastSeen >= this.stats.missMs) { this.presentFrom = null; this.pool = []; this.fbFrom = null; this.sharps = []; this.gateFrom = null; }
    const busy = st.capture || st.phase === "locked" || st.phase === "stable" || (st.phase === "counting" && this.fbFrom === null);
    if (!c || !this.auto || this.last || busy || this.presentFrom === null
      || now - this.presentFrom < FALLBACK_MS
      || this.moves.length > FALLBACK_MOVE_MAX * this.pool.filter((e) => now - e.t <= FALLBACK_MS).length) { this.fbFrom = null; return st; }
    const q = consensus(this.pool.map((e) => e.c));
    if (!q) { this.fbFrom = null; return st; }
    this.fbFrom ??= now;
    const progress = Math.min(1, (now - this.fbFrom) / COUNTDOWN_MS);
    if (progress < 1 || !this.sharpGo(this.fbFrom, now)) return (this.prev = { phase: "counting", progress, capture: false, corners: q });
    this.stats.fallbacks++;
    this.stats.countdowns++;
    this.captured(q);
    return (this.prev = { phase: "counting", progress: 1, capture: true, corners: q });
  }

  /** تبديل الوضع: يبدأ العدّ من جديد. */
  setAuto(auto: boolean) { this.auto = auto; this.stats.resets.mode++; this.resetStreak(); }

  private resetStreak() { this.hist = []; this.glitches = []; this.since = null; this.seenAt = null; this.countFrom = null; }
}

/** كل الزوايا داخل صورة w×h (بهامش `m` من الضلع)؛ وإلا فالرباعي يخرج عمّا يراه المستخدم (live-fix3). */
export function insideFrame(c: Corners, w: number, h: number, m = 0.01): boolean {
  return pts(c).every((p) => p.x >= -m * w && p.x <= (1 + m) * w && p.y >= -m * h && p.y <= (1 + m) * h);
}

/** إزاحة الزوايا. */
export function shiftCorners(c: Corners, dx: number, dy: number): Corners {
  const s = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return { topLeft: s(c.topLeft), topRight: s(c.topRight), bottomRight: s(c.bottomRight), bottomLeft: s(c.bottomLeft) };
}

/** متوسط السطوع (0–255) لصورة صغيرة. */
export function meanLuma(img: Img): number {
  const d = img.data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  return s / (d.length / 4 || 1);
}

/** الإضاءة ضعيفة إن بقي السطوع دون `DARK_LUMA` مدّة `DARK_MS` متصلة. */
export class LowLight {
  private from: number | null = null;
  update(luma: number, now: number): boolean {
    if (luma >= DARK_LUMA) { this.from = null; return false; }
    this.from ??= now;
    return now - this.from >= DARK_MS;
  }
}

/**
 * الإطار إلى الشاشة بـ`object-fit: cover`: المقياس الأكبر، والفائض مقصوص بالتساوي من الجهتين.
 * يعيد دالّة تنقل نقطة من الإطار (fw×fh) إلى الفيديو المعروض (vw×vh).
 */
export function coverMap(fw: number, fh: number, vw: number, vh: number): (p: Pt) => Pt {
  const k = Math.max(vw / fw, vh / fh);
  const ox = (vw - fw * k) / 2, oy = (vh - fh * k) / 2;
  return (p) => ({ x: ox + p.x * k, y: oy + p.y * k });
}

/**
 * مقاس العنصر الذي يُرسم بـ`matrix3d` (متوسط الأضلاع المتقابلة، فتبقى الحافّة نحو 2px بعد التحويل)،
 * والتحويل من مستطيله (0,0)–(w,h) إلى الزوايا الأربع على الشاشة. `transform-origin` على 0 0.
 */
export function quadTransform(c: Corners): { width: number; height: number; matrix: string } {
  const q = pts(c);
  const width = Math.max(1, (dist(q[0], q[1]) + dist(q[3], q[2])) / 2);
  const height = Math.max(1, (dist(q[0], q[3]) + dist(q[1], q[2])) / 2);
  const H = homography([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], q);
  // المصفوفة 3×3 (صفوف) إلى matrix3d (أعمدة 4×4، z لا يتغيّر)
  const [a, b, cc, d, e, f, g, hh] = H as [number, number, number, number, number, number, number, number];
  const m = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, cc, f, 0, 1];
  return { width, height, matrix: `matrix3d(${m.map((v) => +v.toPrecision(12)).join(",")})` };
}
