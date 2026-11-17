/**
 * قلم الإخفاء: التصاق الغطاء بحبر الكلمات (docs/logs/pen-lama-spec.md §٢-١، وقرار نايف «لا أكبر منه ولا أصغر»).
 * كل الحساب على شبكة إضاءة (`Lum`) للصفحة غير المُدارة، بكسلاتها من لوحة الصفحة المرسومة.
 * - صفحة فيها نصّ: الأسطر من `getTextContent` (خطّ القاعدة وارتفاع الخط)، والكلمات عناقيد أعمدة الحبر في قلب السطر.
 * - صفحة ممسوحة (بلا نصّ): الأسطر من الحبر نفسه (مقطع أفقي في موضع الإصبع).
 * والناتج مستطيل واحد لكل سطر: من حبر أول كلمة إلى حبر آخرها، بارتفاع أعلى حبرها وأدناه.
 */

export interface Lum { w: number; h: number; d: Uint8Array } // إضاءة 0..255، صفّاً صفّاً
export interface Box { x0: number; y0: number; x1: number; y1: number } // بكسلات الشبكة، x1 وy1 خارج المستطيل
/** قطعة نصّ أفقية على الشبكة: يسارها، وخطّ قاعدتها، وعرضها، وارتفاع خطّها، ونصّها (`s`، والفراغ وحده قطعةٌ تحدّ كلمتين). */
export interface TextRun { x: number; base: number; w: number; h: number; s?: string }
/**
 * سطر نصّ. `words`: عدد كلماته من نصّ قطعه، و`cuts`: مواضع حدود الكلمات فيه وعددها في كلٍّ (مدى الفراغ بين قطعتين بينهما قطعة فراغ: حدٌّ واحد، أو مدى
 * قطعةٍ في نصّها فراغ لا يُعرف موضعه منها: بعدد مجموعات الفراغ فيه). وبلا نصّ لقطعةٍ من السطر لا يُعرف أيٌّ منهما (P1i).
 * و`spans`: مدى كل كلمةٍ في طبقة النصّ (من أول قطعها إلى آخرها، بين حدّين)، إلا ما في قطعه فراغٌ لا يُعرف موضعه (P1n).
 */
export interface TLine { x0: number; x1: number; base: number; h: number; words?: number; cuts?: [number, number, number][]; spans?: [number, number][] }
export interface Pt { x: number; y: number }

/** الفرق عن لون الخلفية الذي يُعدّ حبراً (من 255). الخلفية الرمادية الفاتحة والعلامة المائية الباهتة ليستا حبراً. */
const INK_DELTA = 64;
/**
 * أصغر فجوة بين عنقودين تفصل كلمتين، من ارتفاع الخط. وهي حدٌّ أدنى لا يكفي وحده: الفجوة بين حروف عربية لا تتّصل تبلغه وتتجاوزه
 * في Arial وTahoma وSimplified Arabic («يو|سف»، ملاحظة أمين ٣)، فالفاصل في السطر الذي فيه نصّ يُقاس منه (`splits`).
 */
const WORD_GAP = 0.16;

/**
 * يجمع قطع النصّ في أسطر: خطّ قاعدة متقارب (≤ ‎0.3 من الارتفاع) وارتفاع متقارب. وقطع الفراغ لا تصنع سطراً، وتُعدّ حدود كلماته.
 * ومع شبكة الإضاءة (`g`) تُطابَق طبقة النصّ بالحبر (P1k، ملاحظة أمين ١ على P1i)، فلا تدخل عدّ الكلمات ولا حدودها:
 * - قطعةٌ لا حبر تحت مستطيلها: نصٌّ أبيض أو مخفيّ فوق البياض.
 * - وقطعة فراغٍ تحتها حبر (`inkedSpace`): فراغٌ في طبقةٍ فوق الحبر لا في فجوة بين كلمتين (نصٌّ فوق نصّ، أو OCR يفصل «يو سف»).
 */
export function textLines(runs: TextRun[], g?: Lum): TLine[] {
  const out: (TLine & { rs: TextRun[] })[] = [];
  const near = (l: TLine, r: TextRun) => Math.abs(l.base - r.base) <= 0.3 * Math.min(l.h, r.h) && Math.max(l.h, r.h) / Math.min(l.h, r.h) < 1.6;
  const blank = (r: TextRun) => r.s !== undefined && !r.s.trim();
  for (const r of [...runs].filter((r) => r.w > 0 && r.h > 0 && !blank(r) && (!g || inkedRun(g, r))).sort((a, b) => a.base - b.base)) {
    const l = out.find((l) => near(l, r));
    if (l) { l.x0 = Math.min(l.x0, r.x); l.x1 = Math.max(l.x1, r.x + r.w); l.h = Math.max(l.h, r.h); l.rs.push(r); }
    else out.push({ x0: r.x, x1: r.x + r.w, base: r.base, h: r.h, rs: [r] });
  }
  // قطعة فراغ أضيق من ‎0.1 من الخط ليست فراغاً بين كلمتين: pdf.js يضعها عند الشدّة داخل الكلمة («ووقّع»)
  const gaps = runs.filter((r) => blank(r) && r.h > 0 && r.w >= 0.1 * r.h && !(g && inkedSpace(g, r)));
  return out.map(({ rs, ...l }) => (rs.every((r) => r.s !== undefined) ? { ...l, ...wordsOf(rs, gaps.filter((r) => near(l, r)), l.h) } : l));
}

/**
 * عدد أعمدة الحبر بين العمودين x0 وx1 (x1 خارج المدى) والصفّين ya وyb، تحت قطعة نصّ (`r`). والخلفية من منطقة سطرها (كما في `snapText`):
 * ظلٌّ أو لون صفحة ليس حبراً.
 */
function inkCols(g: Lum, r: TextRun, x0: number, x1: number, ya: number, yb: number): { ink: number; n: number } {
  const h = r.h, y0 = clamp(Math.floor(ya), 0, g.h), y1 = clamp(Math.ceil(yb), 0, g.h);
  x0 = clamp(x0, 0, g.w); x1 = clamp(x1, 0, g.w);
  if (x1 <= x0 || y1 <= y0) return { ink: 0, n: 0 };
  const bg = background(g, clamp(Math.floor(r.x - h), 0, g.w), clamp(Math.ceil(r.x + r.w + h), 0, g.w), clamp(Math.floor(r.base - 1.3 * h), 0, g.h), clamp(Math.ceil(r.base + 0.55 * h), 0, g.h));
  let ink = 0;
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) if (Math.abs(g.d[y * g.w + x]! - bg) > INK_DELTA) { ink++; break; }
  return { ink, n: x1 - x0 };
}
/** قطعة نصّ تحت مستطيلها حبرٌ (من أعلى الخط إلى ما دون القاعدة بـ‎0.3 منه، فالنقطة والذيل منه). */
const inkedRun = (g: Lum, r: TextRun) => inkCols(g, r, Math.floor(r.x), Math.ceil(r.x + r.w), r.base - r.h, r.base + 0.3 * r.h).ink > 0;
/**
 * قطعة فراغٍ تحتها حبرٌ في قلب السطر (جسم الحروف) في ربع أعمدة داخلها فأكثر: ليست فجوةً بين كلمتين. وداخلها بلا ‎0.06 من الخط من كل
 * طرف (بكسلٌ على الأقل): تنعيم الحرف المجاور وذيله (ذيل «ى» في Arial يبلغ عموداً من الفراغ قبلها عند المقياس 1.0). وإن ضاق الفراغ عن
 * ذلك فعموده الأوسط. وفي الملفات القائمة (P1i وP1j وP1h وm3 والجداول) بلغ حبر الفراغ الحقيقي 20٪، وأقلّ الفراغات المزاحة في p1k-ocr 29٪.
 * والحدّ أقرب إلى الحقيقي لأن ما يُسقطه لا يفصل كلمة: يكبر الغطاء ولا يصغر.
 */
function inkedSpace(g: Lum, r: TextRun): boolean {
  const t = Math.max(1, 0.06 * r.h);
  let x0 = Math.ceil(r.x + t), x1 = Math.floor(r.x + r.w - t);
  if (x1 <= x0) { x0 = Math.floor(r.x + r.w / 2); x1 = x0 + 1; }
  const { ink, n } = inkCols(g, r, x0, x1, r.base - 0.72 * r.h, r.base + 0.02 * r.h);
  return n > 0 && ink >= 0.25 * n;
}

/**
 * عدد كلمات السطر ومواضع حدودها من قطعه (`rs`) وقطع الفراغ فيه (`sp`). القطعتان المتجاورتان بلا فراغ بينهما كلمةٌ واحدة إن قرُبتا
 * (pdf.js يضع الفراغ حين يرى بين حرفين في الرسم نفسه مسافةً، فإن لم يضعه فالأمان أن تُعدّا كلمة). وموضع الفراغ يُقبل في مدى ‎0.05 من
 * الخط حول ما بين القطعتين، فلا يُنسب فراغٌ إلى غير موضعه فيُفصل داخل كلمة.
 * وطبقتا نصٍّ على الحبر نفسه (نصٌّ أبيض أو مخفيّ فوق نصّ، P1k) تتراكب قطعهما، فلا يُقاس ما بين قطعتين إلا من آخر ما بلغته القطع قبلهما،
 * ولا حدّ بينهما إن تراكبتا. والقطعة التي في نصّها فراغٌ لا يُعرف موضعه وتتراكب مع غيرها لا يُعدّ مداها حدّاً: لا يُعرف من أيّ الطبقتين حبرُه.
 */
function wordsOf(rs: TextRun[], sp: TextRun[], h: number): { words: number; cuts: [number, number, number][]; spans: [number, number][] } {
  const ns = [...rs].sort((a, b) => a.x - b.x), cuts: [number, number, number][] = [], tol = 0.05 * h, lap = 0.15 * h;
  const layered = (r: TextRun) => ns.some((q) => q !== r && Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x) > lap);
  // والقطعة المتراكبة التي في نصّها فراغ تُعدّ كلماتها وحدها: لا يُقاس إليها ما بين غيرها
  const used = ns.filter((r) => !/\s/.test(r.s!) || !layered(r));
  let text = ns.filter((r) => !used.includes(r)).map((r) => ` ${r.s} `).join(""), end = -Infinity;
  // ومدى كل كلمة (P1n): يُغلق عند كل حدٍّ بين قطعتين، ولا يُعدّ إن كان في قطعه فراغ (موضع الحدّ داخلها لا يُعرف)
  const spans: [number, number][] = [];
  let cur: [number, number, boolean] | null = null;
  const close = () => { if (cur?.[2]) spans.push([cur[0], cur[1]]); cur = null; };
  used.forEach((r, i) => {
    const next = used[i + 1];
    const a = i ? end : r.x, b = next ? next.x : r.x + r.w;
    // أو بينهما ‎0.3 من الخط فأكثر: قطعتان من رسمين (خليّتا جدول، أو كلمتا طبقة نصّ ممسوح)، والحروف في الرسم الواحد متلاصقة المدى
    if (i && r.x >= a - lap && (r.x - a >= 0.3 * h || sp.some((w) => w.x >= Math.min(a, r.x) - tol && w.x <= Math.max(a, r.x) + tol))) { cuts.push([Math.min(a, r.x), Math.max(a, r.x), 1]); text += " "; close(); }
    // فراغ داخل القطعة: موضعه في مداها، وفيه من الحدود بعدد مجموعات الفراغ في نصّها
    // ويبلغ ما قبلها أو بعدها إن كان الفراغ في طرفها، وإلا فلا يمسّ الحدّ الذي عند طرفها (له حدّه)
    const k = r.s!.match(/\s+/g)?.length ?? 0;
    if (k) cuts.push([/^\s/.test(r.s!) ? Math.min(a, r.x) : r.x + tol, /\s$/.test(r.s!) ? Math.max(b, r.x + r.w) : r.x + r.w - tol, k]);
    text += r.s;
    end = Math.max(end, r.x + r.w);
    if (!cur) cur = [r.x, r.x + r.w, !k];
    else { cur[0] = Math.min(cur[0], r.x); cur[1] = Math.max(cur[1], r.x + r.w); if (k) cur[2] = false; }
  });
  close();
  return { words: text.split(/\s+/).filter(Boolean).length, cuts, spans };
}

/**
 * الفجوات التي تفصل كلمتين بين عناقيد سطر (`cs`، بفجوة بكسل واحد فأكثر)، بثلاثة شروط معاً، وما شكّ فيه يُضمّ (الأمان أولاً: الغطاء
 * الأكبر لا يُبقي جزء كلمة ظاهراً):
 * - لا تقلّ عن `floor`.
 * - وفي السطر الذي فيه نصّ: تمسّ حدّ كلمة من نصّه (`cuts`)، فلا تُفصل الكلمة عند فجوة بين حروفها. وفي كل مدى حدٍّ الفجوات الأوسع
 *   بعدد حدوده وحدها (P1k، ملاحظة أمين ١ و٣ على P1i): بين كلمتين حدٌّ واحد، فما بجانب الأوسع فيه من حروفهما. والتساوي عند آخرها يُضمّ.
 * - وهي من أكبر (عدد الكلمات − 1) فجوةً من هذه، بأكبر من التي تليها: المسافة بين الكلمات مقيسةٌ من السطر نفسه، فلا يزيد ما يُفصل
 *   على حدود الكلمات في نصّه. والتساوي يُضمّ.
 * والفجوة عند طرف نصّ السطر أو خارجه (في هامش المنطقة) يكفيها الحدّ الأدنى.
 */
function splits(cs: [number, number][], l: TLine, floor: number): boolean[] {
  const gap = cs.slice(1).map(([s], i) => s - cs[i]![1]);
  // فجوةٌ عند طرف نصّ السطر أو خارجه: ما بعدها ليس من كلماته (طبقة OCR فيها كلمة السرّ وحدها، وبقيّة السطر صورة)
  const out = gap.map((_, i) => cs[i]![1] - 1 <= l.x0 || cs[i + 1]![0] + 1 >= l.x1);
  const best = gap.map(() => !l.cuts);
  for (const [a, b, k] of l.cuts ?? []) {
    const at = gap.flatMap((g, i) => (g >= floor && cs[i]![1] - 1 <= b && cs[i + 1]![0] + 1 >= a ? [i] : []));
    const by = at.map((i) => gap[i]!).sort((p, q) => q - p), t = by.length > k ? by[k]! : -1;
    for (const i of at) if (gap[i]! > t) best[i] = true;
  }
  const ok = gap.map((g, i) => g >= floor && best[i]!);
  if (l.words === undefined) return ok;
  const ranked = gap.filter((_, i) => ok[i] && !out[i]).sort((p, q) => q - p), t = ranked.length >= l.words ? ranked[l.words - 1]! : -1;
  return gap.map((g, i) => (out[i] ? g >= floor : ok[i]! && l.words! > 1 && g > t));
}

/** يضمّ عناقيد السطر (`cs`) كلماتٍ: عند كل فجوة لا تفصل كلمتين (`splits`). */
function words(cs: [number, number][], l: TLine, floor: number): [number, number][] {
  const cut = splits(cs, l, floor), out: [number, number][] = [];
  cs.forEach((c, i) => { if (i && !cut[i - 1]) out.at(-1)![1] = c[1]; else out.push([c[0], c[1]]); });
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** لون الخلفية في منطقة: أكثر الإضاءات تكراراً (بفئات 8). */
function background(g: Lum, x0: number, x1: number, y0: number, y1: number): number {
  const hist = new Uint32Array(32);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[g.d[y * g.w + x]! >> 3]!++;
  let best = 31;
  for (let i = 0; i < 32; i++) if (hist[i]! > hist[best]!) best = i;
  return best * 8 + 4;
}

class Region {
  readonly bg: number;
  /** ما ليس من حرف السطر (`notLetters`): لا يُعدّ حبراً. */
  skip: Uint8Array | null = null;
  /** الخطوط (حدود الجدول والتسطير، ولو لامسها حرف): ليست علامةً ولا حبراً تُقاس إليه العلامات الصغيرة (`ownMarks`، P1j). */
  lines: Uint8Array | null = null;
  constructor(readonly g: Lum, readonly x0: number, readonly x1: number, readonly y0: number, readonly y1: number) {
    this.bg = background(g, x0, x1, y0, y1);
  }
  raw(x: number, y: number) { return Math.abs(this.g.d[y * this.g.w + x]! - this.bg) > INK_DELTA; }
  ink(x: number, y: number) { return this.raw(x, y) && !this.skip?.[(y - this.y0) * (this.x1 - this.x0) + x - this.x0]; }
  rowInk(y: number, xa: number, xb: number) { for (let x = xa; x < xb; x++) if (this.ink(x, y)) return true; return false; }
  colInk(x: number, ya: number, yb: number) { for (let y = ya; y < yb; y++) if (this.ink(x, y)) return true; return false; }
}

/** عناقيد الأعمدة التي فيها حبر بين ya وyb، تفصلها فجوة ≥ gap. */
function clusters(r: Region, xa: number, xb: number, ya: number, yb: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1, last = -1;
  for (let x = xa; x < xb; x++) {
    if (!r.colInk(x, ya, yb)) continue;
    if (start < 0) start = x;
    else if (x - last - 1 >= gap) { out.push([start, last + 1]); start = x; }
    last = x;
  }
  if (start >= 0) out.push([start, last + 1]);
  return out;
}

/** العناقيد التي يمسّها مدى الإصبع الأفقي (والنقرة تمسّ أقرب كلمة في حدود tol). */
function picked(cs: [number, number][], xa: number, xb: number, tol: number) {
  return cs.filter(([s, e]) => e > xa - tol && s <= xb + tol);
}

/**
 * يمدّ مدى الحبر رأسياً من القلب إلى ما يتّصل به (النقاط والحركات والألف واللام)، بفجوة لا تزيد على gap صفّاً، وفي حدود [lo, hi).
 * ثم يضبط الطرفين الأفقيين على آخر عمود حبر قريب (النقطة التي تبرز قليلاً عن جسم الحرف).
 */
function grow(r: Region, cx0: number, cx1: number, ya: number, yb: number, lo: number, hi: number, gap: number, side: number): Box | null {
  let top = -1, bot = -1;
  for (let y = ya; y < yb; y++) if (r.rowInk(y, cx0, cx1)) { if (top < 0) top = y; bot = y; }
  if (top < 0) return null;
  for (let y = top - 1, miss = 0; y >= lo && miss <= gap; y--) { if (r.rowInk(y, cx0, cx1)) { top = y; miss = 0; } else miss++; }
  for (let y = bot + 1, miss = 0; y < hi && miss <= gap; y++) { if (r.rowInk(y, cx0, cx1)) { bot = y; miss = 0; } else miss++; }
  let x0 = cx0, x1 = cx1;
  for (let x = cx0 - 1; x >= Math.max(r.x0, cx0 - side); x--) if (r.colInk(x, top, bot + 1)) x0 = x;
  for (let x = cx1; x < Math.min(r.x1, cx1 + side); x++) if (r.colInk(x, top, bot + 1)) x1 = x + 1;
  return { x0, y0: top, x1, y1: bot + 1 };
}

/**
 * ما ليس من حرف السطر في منطقته (ملاحظة أمين م٣، P1f)، فلا يدخل الغطاء على الشاشة:
 * - عمود حبر يملأ المنطقة رأسياً كلها، بعرض ≤ `LINE_W`: حدّ جدول (ولا حرف يملأ من فوق السطر بـ1.3 إلى تحته بـ0.55).
 * - امتداد أفقي ≥ ‎1.5 من ارتفاع الخط خارج قلب السطر، وسُمكه عند البكسل ≤ `LINE_W`: تسطير أو حدّ جدول.
 * - عنقود حبر لا يمسّ قلب السطر ويمسّ حدّ المنطقة الأعلى أو الأسفل (`topEdge`/`botEdge`: لم يقصّه طرف الصفحة): سطر مجاور.
 */
function notLetters(r: Region, cy0: number, cy1: number, h: number, topEdge: boolean, botEdge: boolean) {
  const W = r.x1 - r.x0, H = r.y1 - r.y0, sk = new Uint8Array(W * H);
  const at = (x: number, y: number) => (y - r.y0) * W + x - r.x0;
  for (let x = r.x0; x < r.x1;) {
    let e = x;
    while (e < r.x1 && (() => { for (let y = r.y0; y < r.y1; y++) if (!r.raw(e, y)) return false; return true; })()) e++;
    if (e > x && e - x <= LINE_W) for (let xx = x; xx < e; xx++) for (let y = r.y0; y < r.y1; y++) sk[at(xx, y)] = 1;
    x = Math.max(e, x + 1);
  }
  const thin = (x: number, y: number) => { let k = 1; for (let d = 1; k <= LINE_W && y - d >= r.y0 && r.raw(x, y - d); d++) k++; for (let d = 1; k <= LINE_W && y + d < r.y1 && r.raw(x, y + d); d++) k++; return k <= LINE_W; };
  const ln = new Uint8Array(W * H);
  for (let y = r.y0; y < r.y1; y++) {
    if (y >= cy0 && y < cy1) continue;
    for (let s = r.x0; s < r.x1;) {
      if (!r.raw(s, y)) { s++; continue; }
      let e = s;
      while (e < r.x1 && r.raw(e, y)) e++;
      if (e - s >= 1.5 * h) for (let x = s; x < e; x++) if (thin(x, y) && !sk[at(x, y)]) ln[at(x, y)] = 1;
      s = e;
    }
  }
  // الخطوط كلها قبل إلغاء ما يلامسه حرف: العلامة الصغيرة على التسطير منفصلةٌ عنه (`ownMarks`، P1j)
  const lines = sk.slice();
  for (let i = 0; i < ln.length; i++) if (ln[i]) lines[i] = 1;
  r.lines = lines;
  // خطٌّ يمسّه حبرٌ ليس خطّاً (ذيل حرف نزل إليه: «ى» في «يرجى» مسطّرةً، P1h) يبقى حبراً كله، فيمدّ الغطاءَ إليه ولا يُخرج جزء الحرف
  lineAttached(ln, W, H, (i) => !sk[i] && r.raw(r.x0 + (i % W), r.y0 + Math.floor(i / W)), { x0: 0, x1: W, y0: cy0 - r.y0, y1: cy1 - r.y0 });
  for (let i = 0; i < ln.length; i++) if (ln[i]) sk[i] = 1;
  const seen = new Uint8Array(W * H);
  for (let y0 = r.y0; y0 < r.y1; y0++) for (let x0 = r.x0; x0 < r.x1; x0++) {
    if (seen[at(x0, y0)] || sk[at(x0, y0)] || !r.raw(x0, y0)) continue;
    const comp = [at(x0, y0)];
    seen[comp[0]!] = 1;
    let core = false, edge = false;
    for (let q = 0; q < comp.length; q++) {
      const x = r.x0 + (comp[q]! % W), y = r.y0 + Math.floor(comp[q]! / W);
      if (y >= cy0 && y < cy1) core = true;
      if ((topEdge && y === r.y0) || (botEdge && y === r.y1 - 1)) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < r.x0 || yy < r.y0 || xx >= r.x1 || yy >= r.y1) continue;
        const j = at(xx, yy);
        if (!seen[j] && !sk[j] && r.raw(xx, yy)) { seen[j] = 1; comp.push(j); }
      }
    }
    if (edge && !core) for (const j of comp) sk[j] = 1;
  }
  r.skip = sk;
}

/**
 * يمحو من `ln` (1 خطّ أفقي، 2 رأسي، 3 ملتقاهما) كل مكوّن متّصل (8 جيران) يلامسه عنقودُ حبرٍ ليس خطّاً (`loose`، 8 جيران) من جهة
 * المنطقة `near` (الغطاء، أو قلب السطر على الشاشة): حرفٌ نزل إلى الخطّ (ذيل «ى» في «يرجى» مسطّرةً، P1h، ملاحظة أمين ١).
 * وجهة الغطاء: للخطّ الأفقي عند البكسل الملامَس، وسُمكه عنده الصفوف [r0, r1]، والغطاء فوقه: في العنقود صفٌّ < r0 − LINE_W؛
 * أو تحته: صفٌّ > r1 + LINE_W؛ أو في صفوفه: أحدهما. والرأسي كذلك بالأعمدة. فما يلامس الخطّ من الجهة الأخرى (حدّ خلية مجاورة
 * أو نصّها)، أو لا يتجاوزه إلا بحافّته المنعَّمة أو بملتقى خطّين، لا يُلغيه.
 * ويُلغى المكوّن كله ولو بعُد موضع الملامسة عن الغطاء.
 */
function lineAttached(ln: Uint8Array, W: number, H: number, loose: (i: number) => boolean, near: Box) {
  // عناقيد الحبر الذي ليس خطّاً، وحدود كلٍّ منها
  const lab = new Int32Array(W * H).fill(-1), bb: number[][] = [];
  for (let i0 = 0; i0 < lab.length; i0++) {
    if (lab[i0] !== -1 || ln[i0] || !loose(i0)) continue;
    const id = bb.length, st = [i0], q = [W, H, -1, -1]; // minX, minY, maxX, maxY
    lab[i0] = id;
    while (st.length) {
      const i = st.pop()!, x = i % W, y = Math.floor(i / W);
      q[0] = Math.min(q[0]!, x); q[1] = Math.min(q[1]!, y); q[2] = Math.max(q[2]!, x); q[3] = Math.max(q[3]!, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (lab[j] === -1 && !ln[j] && loose(j)) { lab[j] = id; st.push(j); }
      }
    }
    bb.push(q);
  }
  // يتجاوز الخطّ إلى جهة الغطاء بأكثر من LINE_W (فلا تُعدّ حافّته المنعَّمة ولا ملتقى خطّين حرفاً)، أو إلى أيّ جهة إن كان في صفوفه
  const side = (lo: number, hi: number, n0: number, n1: number, cmin: number, cmax: number) =>
    n1 <= lo ? cmin < lo - LINE_W : n0 > hi ? cmax > hi + LINE_W : cmin < lo - LINE_W || cmax > hi + LINE_W;
  const nearCluster = (i: number, j: number) => {
    const q = bb[lab[j]!]!, x = i % W, y = Math.floor(i / W);
    if (ln[i]! & 1) {
      let r0 = y, r1 = y;
      while (r0 > 0 && ln[(r0 - 1) * W + x]! & 1) r0--;
      while (r1 < H - 1 && ln[(r1 + 1) * W + x]! & 1) r1++;
      if (side(r0, r1, near.y0, near.y1, q[1]!, q[3]!)) return true;
    }
    if (ln[i]! & 2) {
      let c0 = x, c1 = x;
      while (c0 > 0 && ln[y * W + c0 - 1]! & 2) c0--;
      while (c1 < W - 1 && ln[y * W + c1 + 1]! & 2) c1++;
      if (side(c0, c1, near.x0, near.x1, q[0]!, q[2]!)) return true;
    }
    return false;
  };
  const seen = new Uint8Array(W * H);
  for (let i0 = 0; i0 < ln.length; i0++) {
    if (!ln[i0] || seen[i0]) continue;
    const comp = [i0];
    seen[i0] = 1;
    let touched = false;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q]!, x = i % W, y = Math.floor(i / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (ln[j]) { if (!seen[j]) { seen[j] = 1; comp.push(j); } } else if (!touched && lab[j]! >= 0 && nearCluster(i, j)) touched = true;
      }
    }
    if (touched) for (const j of comp) ln[j] = 0;
  }
}

/**
 * العلامات الصغيرة المنفصلة (نقاط الحروف وحركاتها) فوق الغطاء `b` أو تحته في أعمدته، وهي له (P1j، ملاحظة أمين ١ على P1h):
 * نقطتا الياء في «سعيد» بـSimplified Arabic 12pt تبعدان عن جسمها أكثر من فجوة التمديد وأكثر من حلقة الحرق، فتبقيان ظاهرتين.
 * - العلامة: عنقود (8 جيران) من `mark` خارج الغطاء لا يمسّ حدّ النافذة، ارتفاعه ≤ ‎0.5 من `size` وعرضه ≤ ‎0.8 منه، كله فوق صفوف
 *   الغطاء أو تحتها، ويمسّ أعمدته (± ‎0.15 من `size`)، وأقربه إلى الغطاء في حدود ‎0.5 من `size` (فما أبعد لا يُفحص هنا).
 * - وهي للغطاء ما لم يكن حبرٌ آخر (`body`، بلا العلامات الصغيرة ولا الغطاء ولا ما ارتفاعه ≤ `LINE_W`) أقرب إليها منه (مسافة الرقعة، Chebyshev): نقطة السطر
 *   المجاور أقرب إلى حرفها، ونقطة الكلمة المجاورة أقرب إلى كلمتها. والتساوي للغطاء (الشكّ يغطّي أو يمنع).
 * - والعناقيد التي بينها ≤ `gap` بكسلاً تُعدّ مجموعةً واحدة قبل هذا كله (نقطتا الياء معاً)، وما جاوره في صفوفه حبرٌ بارتفاعٍ قريب
 *   (‎1.5 من ارتفاعه) حرفٌ في سطر لا علامة.
 * الإحداثيات محلّية في نافذة W×H، و`b` فيها (x1 وy1 خارجه). ويعيد مستطيل كل علامة وعدد بكسلاتها.
 */
// أعرض العلامة من `size`، وبه أيضاً `flat` في freeInk: ما يُفصل امتداداً رفيعاً أعرضُ منه، فلا فجوة بين العتبتين (P1m، م١ من أمين على P1l)
export const MARK_W = 0.8;
export function ownMarks(W: number, H: number, mark: (i: number) => boolean, body: (i: number) => boolean, b: Box, size: number, gap: number): (Box & { n: number })[] {
  const inB = (i: number) => { const x = i % W, y = (i - x) / W; return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1; };
  /** عناقيد ما يحقّق `ok` خارج الغطاء (8 جيران): رقم كلٍّ لبكسلاته، وحدوده، وهل يمسّ حدّ النافذة. */
  const label = (ok: (i: number) => boolean) => {
    const lab = new Int32Array(W * H).fill(-1), comps: { px: number[]; x0: number; y0: number; x1: number; y1: number; edge: boolean }[] = [];
    for (let i0 = 0; i0 < lab.length; i0++) {
      if (lab[i0] !== -1 || !ok(i0) || inB(i0)) continue;
      const c = { px: [i0], x0: W, y0: H, x1: -1, y1: -1, edge: false };
      lab[i0] = comps.length;
      for (let q = 0; q < c.px.length; q++) {
        const i = c.px[q]!, x = i % W, y = (i - x) / W;
        c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.edge = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * W + xx;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || lab[j] !== -1 || !ok(j) || inB(j)) continue;
          lab[j] = comps.length; c.px.push(j);
        }
      }
      comps.push(c);
    }
    return { lab, comps };
  };
  const M = label(mark);
  // والعناقيد التي بينها ≤ `gap` مجموعةٌ واحدة: نقطتا الياء معاً، وحروف الكلمة اللاتينية المتفرّقة معاً (فلا تُعدّ كلٌّ منها علامةً صغيرة
  // لا حبر حولها، والغطاء الطويل يجعل الحرف اللاتيني دون ‎0.5 من ارتفاعه: «TABLEC» في table.pdf)
  const up = M.comps.map((_, k) => k), root = (k: number): number => (up[k] === k ? k : (up[k] = root(up[k]!)));
  // وما ارتفاعه ≤ LINE_W لا يُجمع مع غيره (P1o، ملاحظة أمين ١ على P1n): قطعة تسطيرٍ أقصر من MARK_W والنقطة في فجوة skip-ink على بعد
  // 1–2 من طرفها مجموعةٌ أعرض من MARK_W فليستا علامة، فتُحفظ النقطة ظاهرة. وكلٌّ منهما وحده علامة
  const thinC = M.comps.map((c) => c.y1 - c.y0 + 1 <= LINE_W);
  M.comps.forEach((c, k) => {
    if (thinC[k]) return;
    for (const i of c.px) {
      const x = i % W, y = (i - x) / W;
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const o = M.lab[yy * W + xx]!;
        if (o >= 0 && !thinC[o]) { const p = root(o), q = root(M.lab[i]!); if (p !== q) up[p] = q; }
      }
    }
  });
  const groups = new Map<number, { px: number[]; x0: number; y0: number; x1: number; y1: number; edge: boolean }>();
  M.comps.forEach((c, k) => {
    const r = root(k), gr = groups.get(r);
    if (!gr) groups.set(r, { ...c, px: [...c.px] });
    else { gr.px.push(...c.px); gr.x0 = Math.min(gr.x0, c.x0); gr.y0 = Math.min(gr.y0, c.y0); gr.x1 = Math.max(gr.x1, c.x1); gr.y1 = Math.max(gr.y1, c.y1); gr.edge ||= c.edge; }
  });
  type G = { x0: number; y0: number; x1: number; y1: number; edge: boolean };
  const gs = [...groups.values()];
  // وما بجانبه في صفوفه حبرٌ بارتفاعٍ قريب، على بعد ≤ ‎1.5 من ارتفاعه، فهو حرفٌ في سطر لا علامة: حروف «TABLEB» فوق غطاءٍ طويل منفصلةٌ
  // بفجوة أوسع من `gap`، وكلٌّ منها دون ‎0.5 من ارتفاع الغطاء. والنقطة والحركة لا يجاورهما في صفوفهما مثلهما بهذا القرب
  // (والعلامة الدقيقة دون ‎0.25 من `size` لا تُعدّ حرفاً، ولا ما ارتفاعه ≤ LINE_W جاراً: قطعة التسطير ليست حرفاً)
  const inLine = (a: G) => a.y1 - a.y0 + 1 >= 0.25 * size && gs.some((c) => {
    if (c === a || c.y1 - c.y0 + 1 <= LINE_W) return false;
    const ha = a.y1 - a.y0 + 1, hc = c.y1 - c.y0 + 1, ov = Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) + 1;
    const dx = Math.max(c.x0 - a.x1, a.x0 - c.x1) - 1;
    return ov >= 0.5 * Math.min(ha, hc) && Math.min(ha, hc) >= 0.5 * Math.max(ha, hc) && dx <= 1.5 * Math.max(ha, hc);
  });
  const smallOf = new Map<G, boolean>();
  for (const c of gs) smallOf.set(c, !c.edge && c.y1 - c.y0 + 1 <= 0.5 * size && c.x1 - c.x0 + 1 <= MARK_W * size && !inLine(c));
  const isSmall = (c: G) => smallOf.get(c)!;
  const small = M.comps.map((_, k) => isSmall(groups.get(root(k))!));
  // وما ارتفاعه ≤ LINE_W ليس حبراً تُقاس إليه: قطعة تسطيرٍ متقطّع عند الحروف النازلة (text-decoration-skip-ink) لا تعبر الغطاء فلا تُعدّ
  // خطّاً، ونقطتا الياء في فجوتها أقرب إليها منهما إلى الغطاء (P1j، «سعيد» مسطّرةً)
  const mine = (i: number) => M.lab[i]! >= 0 && small[M.lab[i]!]!;
  const Bd = label((i) => body(i) && !mine(i)), flat = Bd.comps.map((c) => c.y1 - c.y0 + 1 <= LINE_W);
  // مسافة الرقعة إلى أقرب حبرٍ آخر (تحويل المسافة بمرورين)
  const INF = 1 << 29, dt = new Int32Array(W * H);
  for (let i = 0; i < dt.length; i++) dt[i] = Bd.lab[i]! >= 0 && !flat[Bd.lab[i]!] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let d = dt[i]!;
    if (x > 0) d = Math.min(d, dt[i - 1]! + 1);
    if (y > 0) { d = Math.min(d, dt[i - W]! + 1); if (x > 0) d = Math.min(d, dt[i - W - 1]! + 1); if (x < W - 1) d = Math.min(d, dt[i - W + 1]! + 1); }
    dt[i] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let d = dt[i]!;
    if (x < W - 1) d = Math.min(d, dt[i + 1]! + 1);
    if (y < H - 1) { d = Math.min(d, dt[i + W]! + 1); if (x < W - 1) d = Math.min(d, dt[i + W + 1]! + 1); if (x > 0) d = Math.min(d, dt[i + W - 1]! + 1); }
    dt[i] = d;
  }
  // والعلامة في حدود ‎0.5 من `size` عن الغطاء: حرفها (إن لم يكن تحته) أقرب إليها منه، فهو في حدود `size` عنه، والنافذة تبلغه
  const m = 0.15 * size, out: (Box & { n: number })[] = [];
  groups.forEach((c) => {
    if (!isSmall(c) || !(c.y1 < b.y0 || c.y0 >= b.y1) || c.x1 < b.x0 - m || c.x0 >= b.x1 + m) return;
    let dc = INF, db = INF;
    for (const i of c.px) { const x = i % W, y = (i - x) / W; dc = Math.min(dc, Math.max(b.x0 - x, x - b.x1 + 1, b.y0 - y, y - b.y1 + 1)); db = Math.min(db, dt[i]!); }
    if (dc <= 0.5 * size && db >= dc) out.push({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1, n: c.px.length });
  });
  return out;
}

/** أغطية صفحة فيها نصّ: لكل سطر يمسّه مدى الإصبع (a إلى b) مستطيلٌ على حبر كلماته الممسوسة. */
export function snapText(g: Lum, lines: TLine[], a: Pt, b: Pt): Box[] {
  const ya = Math.min(a.y, b.y), yb = Math.max(a.y, b.y), xa = Math.min(a.x, b.x), xb = Math.max(a.x, b.x);
  const out: Box[] = [];
  for (const l of lines) {
    const h = l.h;
    if (l.base - h > yb || l.base + 0.3 * h < ya) continue; // السطر خارج مدى الإصبع رأسياً
    const lo = clamp(Math.floor(l.base - 1.3 * h), 0, g.h), hi = clamp(Math.ceil(l.base + 0.55 * h), 0, g.h);
    const cy0 = clamp(Math.floor(l.base - 0.72 * h), 0, g.h), cy1 = clamp(Math.ceil(l.base + 0.02 * h), 0, g.h); // قلب السطر: جسم الحروف
    const rx0 = clamp(Math.floor(l.x0 - 0.3 * h), 0, g.w), rx1 = clamp(Math.ceil(l.x1 + 0.3 * h), 0, g.w);
    if (cy1 <= cy0 || rx1 <= rx0) continue;
    const r = new Region(g, rx0, rx1, lo, hi);
    notLetters(r, cy0, cy1, h, l.base - 1.3 * h >= 0, l.base + 0.55 * h <= g.h);
    const cs = picked(words(clusters(r, rx0, rx1, cy0, cy1, 1), l, Math.max(2, WORD_GAP * h)), xa, xb, xa === xb ? 0.08 * h : 0);
    if (!cs.length) continue;
    const [cx0, cx1] = inSpan(r, l, cs[0]![0], cs.at(-1)![1], cy0, cy1);
    const box = grow(r, cx0, cx1, cy0, cy1, lo, hi, Math.max(1, 0.14 * h), Math.max(1, Math.round(0.12 * h)));
    if (box) out.push(withMarks(r, box, h));
  }
  return out;
}

/** أقصى ما يُمدّ إليه الغطاء أفقياً في مدى كلمته من طبقة النصّ (`inSpan`)، من ارتفاع الخط. */
export const SPAN_REACH = 0.7;
/**
 * يمدّ مدى الحبر المختار (`x0` إلى `x1`، عناقيد كلماته) إلى الحبر الواقع داخل مدى كلمته في طبقة النصّ (م٢ من أمين على P1l، P1n): رسمٌ
 * أبيض لاحق (نصٌّ فوق الاسم) يمحو وصلة «ف» فيفصل طرفها عن جسمها بفجوةٍ أوسع من الفراغ بين الكلمتين، فيُنسب الطرف إلى الكلمة المجاورة
 * ويبقى على الحرق شريحةً ظاهرة. وبثلاثة شروط:
 * - المدى للكلمة المختارة: نصفه فأكثر على حبرها.
 * - والعنقود (أعمدة فيها حبرٌ في قلب السطر، منفصلٌ عن المختار) كله داخل المدى، بهامش ‎0.05 من الخط (بكسلٌ على الأقلّ)، فلا يُمدّ إلى
 *   كلمةٍ مجاورة يمسّ المدى طرفها (طبقة OCR مزاحة).
 * - والمدّ لا يزيد على `SPAN_REACH` من الخط (حدّ النافذة).
 * والحبر هنا بنصف `INK_DELTA`: طرف «ف» عند المقياس 0.98 تنعيمٌ (أدنى إضاءته 200) لا يبلغ عتبة الحبر، وعلى الحرق شريحةٌ داكنة.
 * فطبقةٌ مزاحة بلا حبر لا تغيّر شيئاً، والغطاء يبقى بحجم الحبر.
 */
function inSpan(r: Region, l: TLine, x0: number, x1: number, cy0: number, cy1: number): [number, number] {
  const h = l.h, m = Math.max(1, 0.05 * h), cap = SPAN_REACH * h, W = r.x1 - r.x0, g = r.g;
  const faint = (x: number) => {
    for (let y = cy0; y < cy1; y++) if (Math.abs(g.d[y * g.w + x]! - r.bg) > INK_DELTA / 2 && !r.skip?.[(y - r.y0) * W + x - r.x0]) return true;
    return false;
  };
  // العناقيد في مدى المدّ من الجهتين، والسقف حدّ النافذة: وما يمسّ حدّها لا يُعرف أوّله فلا يُعدّ (عنقودٌ أطول قطعته النافذة)
  const a = clamp(Math.floor(x0 - cap) - 1, r.x0, r.x1), b = clamp(Math.ceil(x1 + cap) + 1, r.x0, r.x1), cs: [number, number][] = [];
  for (let x = a, s = -1; x <= b; x++) {
    const f = x < b && faint(x);
    if (f && s < 0) s = x;
    if (!f && s >= 0) { if (s > a && x < b) cs.push([s, x]); s = -1; }
  }
  let n0 = x0, n1 = x1;
  for (const [s0, s1] of l.spans ?? []) {
    if (Math.min(s1, x1) - Math.max(s0, x0) < 0.5 * (s1 - s0)) continue;
    for (const [s, e] of cs) {
      if (s < s0 - m || e > s1 + m) continue;
      if (e < x0) n0 = Math.min(n0, s);
      if (s > x1) n1 = Math.max(n1, e);
    }
  }
  return [n0, n1];
}

/**
 * يمدّ الغطاء إلى علامات كلمته الصغيرة المنفصلة (نقاطها وحركاتها، `ownMarks`) في منطقة السطر، حتى لا يبقى منها شيء خارجه (P1j).
 * والحبر الذي تُقاس إليه من نافذةٍ أوسع من منطقة السطر (`size` حول الغطاء): نقطة السطر المجاور يُرى حرفها ولو كان خارج المنطقة.
 */
function withMarks(r: Region, box: Box, h: number): Box {
  const g = r.g, size = 0.7 * h, E = Math.ceil(size), RW = r.x1 - r.x0, b = { ...box };
  const inR = (x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  const line = (x: number, y: number) => inR(x, y) && !!r.lines?.[(y - r.y0) * RW + x - r.x0];
  for (let k = 0; k < 3; k++) {
    const ox = clamp(b.x0 - E, 0, g.w), oy = clamp(b.y0 - E, 0, g.h), W = clamp(b.x1 + E, 0, g.w) - ox, H = clamp(b.y1 + E, 0, g.h) - oy;
    const xy = (i: number) => [ox + (i % W), oy + Math.floor(i / W)] as const;
    const mark = (i: number) => { const [x, y] = xy(i); return inR(x, y) && r.ink(x, y) && !line(x, y); };
    const body = (i: number) => { const [x, y] = xy(i); return r.raw(x, y) && !line(x, y); };
    const ms = ownMarks(W, H, mark, body, { x0: b.x0 - ox, y0: b.y0 - oy, x1: b.x1 - ox, y1: b.y1 - oy }, size, Math.max(1, Math.round(0.06 * h)));
    if (!ms.length) break;
    for (const q of ms) { b.x0 = Math.min(b.x0, q.x0 + ox); b.y0 = Math.min(b.y0, q.y0 + oy); b.x1 = Math.max(b.x1, q.x1 + ox); b.y1 = Math.max(b.y1, q.y1 + oy); }
  }
  return b;
}

/** أغطية صفحة بلا نصّ (ممسوحة): الأسطر من الحبر نفسه في موضع الإصبع. */
export function snapInk(g: Lum, a: Pt, b: Pt): Box[] {
  const ya = clamp(Math.floor(Math.min(a.y, b.y)), 0, g.h - 1), yb = clamp(Math.ceil(Math.max(a.y, b.y)), ya + 1, g.h);
  const xa = clamp(Math.floor(Math.min(a.x, b.x)), 0, g.w - 1), xb = clamp(Math.ceil(Math.max(a.x, b.x)), xa + 1, g.w);
  const pad = Math.max(8, Math.round(0.02 * g.w));
  const reg = new Region(g, clamp(xa - 4 * pad, 0, g.w), clamp(xb + 4 * pad, 0, g.w), clamp(ya - 4 * pad, 0, g.h), clamp(yb + 4 * pad, 0, g.h));
  const sx0 = clamp(xa - 2, 0, g.w), sx1 = clamp(xb + 2, 0, g.w);
  // مقاطع الحبر الأفقية التي يمسّها مدى الإصبع، وإن وقع بين سطرين فأقرب سطر في حدود pad
  const bands: [number, number][] = [];
  let y = ya;
  if (!reg.rowInk(y, sx0, sx1) && ya + 1 >= yb) {
    for (let d = 1; d <= pad; d++) {
      if (y - d >= reg.y0 && reg.rowInk(y - d, sx0, sx1)) { y -= d; break; }
      if (y + d < reg.y1 && reg.rowInk(y + d, sx0, sx1)) { y += d; break; }
    }
  }
  for (let yy = Math.min(y, ya); yy < Math.max(yb, y + 1); yy++) {
    if (!reg.rowInk(yy, sx0, sx1)) continue;
    let s = yy, e = yy + 1;
    while (s > reg.y0 && reg.rowInk(s - 1, sx0, sx1)) s--;
    while (e < reg.y1 && reg.rowInk(e, sx0, sx1)) e++;
    bands.push([s, e]);
    yy = e;
  }
  const out: Box[] = [];
  // المقطع يمتدّ إلى السطر كله حول موضع الإصبع (حبرٌ في pad من كل جانب)، فالفاصل والحروف من ارتفاع السطر لا من حبر الموضع وحده:
  // النقرة على جرّة «ف» أو ذيلها مقطعها صفوفٌ قليلة، والفجوة بين حروف لا تتّصل («يو|سف») كانت تبلغ فاصلها فتُفصل الكلمة (P1i).
  // والفاصل من السطر كله يضمّ أحياناً الكلمة المجاورة (الأمان أولاً: لا نصّ في الصفحة يُعرف منه موضع الفراغ)
  const wx0 = clamp(xa - pad, 0, g.w), wx1 = clamp(xb + pad, 0, g.w);
  for (const [s0, e0] of bands) {
    let s = s0, e = e0;
    while (s > reg.y0 && reg.rowInk(s - 1, wx0, wx1)) s--;
    while (e < reg.y1 && reg.rowInk(e, wx0, wx1)) e++;
    const h = e - s, gap = Math.max(2, 0.35 * h);
    const cs = picked(clusters(reg, reg.x0, reg.x1, s, e, gap), xa, xb, xa + 1 >= xb ? 0.1 * h : 0);
    if (!cs.length) continue;
    const box = grow(reg, cs[0]![0], cs.at(-1)![1], s, e, clamp(s - h, reg.y0, reg.y1), clamp(e + h, reg.y0, reg.y1), Math.max(1, 0.3 * h), Math.max(1, Math.round(0.2 * h)));
    if (box && !out.some((o) => o.y0 === box.y0 && o.x0 === box.x0)) out.push(box);
  }
  return out;
}

/* ───────── دقّة الحرق ───────── */
/** دقّة الحرق المطلوبة (200 نقطة في البوصة)، وسقفها: 12 مليون بكسل للصفحة و6000 للضلع (لوحات iOS تُرفض فوق 16.7 مليون). */
export const BURN_DPI = 200;
export const BURN_MAX_AREA = 12_000_000;
export const BURN_MAX_SIDE = 6000;
/** مقياس الحرق (بكسل لكل نقطة) لصفحة مقاسها بالنقاط، و`lowered` إن خُفّض عن الدقّة المطلوبة. */
export function burnScale(wPt: number, hPt: number): { k: number; lowered: boolean } {
  const want = BURN_DPI / 72;
  const k = Math.min(want, Math.sqrt(BURN_MAX_AREA / (wPt * hPt)), BURN_MAX_SIDE / Math.max(wPt, hPt));
  return { k, lowered: k < want - 1e-9 };
}

/* ───────── الحرق: الغطاء يُمدّ إلى حبرٍ بقي خارجه (ملاحظة أمين ٢، docs/logs/pen-p1.md «P1b») ───────── */
/**
 * الغطاء يُحسب من رسم الشاشة، والحرق يرسم الصفحة بدقّة أخرى (200 نقطة في البوصة)، فقد يبقى صفّ حبر أو عمود خارجه
 * (مقيساً: ص٣ بدوران ١٨٠ صفّ فوق الغطاء أدنى إضاءته 25، وحافّة باهتة 203–229 عند طرف أول حرف أو آخره).
 * فعلى لوحة الحرق نفسها يُمدّ كل ضلع ما دام في الصفّين أو العمودين المجاورين بكسلٌ يختلف عن الخلفية بأكثر من العتبة،
 * بسقف `BURN_GROW_PT`، ثم يُفحص الحلقة حوله بعد الطلي: إن بقي حبر لا يُحفظ الملف. وليس هذا هامشاً: لا مدّ بلا حبر.
 */
export const BURN_INK_DIFF = 10;
/** سقف المدّ لكل ضلع بالنقاط (≈ ‎0.5 مم). */
export const BURN_GROW_PT = 1.5;
/** عرض الحلقة المفحوصة حول الغطاء بالبكسل. */
export const BURN_RING = 2;
const BURN_BAND = 6;
export interface InkRef { bg: number; thr: number }

/**
 * الخلفية حول الغطاء: أكثر الإضاءات تكراراً في شريطين فوقه وتحته بعد الحلقة (لا يميناً ويساراً، ففيهما الكلمات المجاورة).
 * والعتبة `BURN_INK_DIFF` يُزاد عليها ضجيج الشريطين (المئين 90 من البعد عن الخلفية)، فلا يُعدّ ضجيج المسح حبراً.
 * والضجيج من البكسلات القريبة من الخلفية وحدها (≤ `BURN_NOISE_NEAR`)، والعتبة بسقف `BURN_THR_MAX` (ملاحظة أمين م١، P1d):
 * حدّ خلية جدول أو سطر ملاصق في الشريطين حبرٌ لا ضجيج، ولو عُدّ لصارت العتبة فوق 255 فلا يُرى حبر باقٍ.
 */
const BURN_NOISE_NEAR = 40;
export const BURN_THR_MAX = 40;
export function inkRef(g: Lum, b: Box): InkRef {
  const hist = new Uint32Array(256), vals: number[] = [];
  for (const top of [b.y0 - BURN_RING - BURN_BAND, b.y1 + BURN_RING]) {
    for (let y = Math.max(0, top); y < Math.min(g.h, top + BURN_BAND); y++) {
      for (let x = Math.max(0, b.x0); x < Math.min(g.w, b.x1); x++) { const v = g.d[y * g.w + x]!; hist[v]!++; vals.push(v); }
    }
  }
  if (!vals.length) return { bg: 255, thr: BURN_INK_DIFF };
  let bg = 0;
  for (let i = 1; i < 256; i++) if (hist[i]! > hist[bg]!) bg = i;
  const dev = vals.map((v) => Math.abs(v - bg)).filter((d) => d <= BURN_NOISE_NEAR).sort((p, q) => p - q);
  return { bg, thr: Math.min(BURN_THR_MAX, BURN_INK_DIFF + (dev[Math.floor(0.9 * (dev.length - 1))] ?? 0)) };
}
const isInk = (g: Lum, r: InkRef, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && Math.abs(g.d[y * g.w + x]! - r.bg) > r.thr;

/** يمدّ الضلع ما دام في `BURN_RING` صفوفاً أو أعمدةً خارجه حبرٌ (مع الزوايا)، بسقف `cap` بكسلاً. `grown`: أعلى، يمين، أسفل، يسار.
 * وما يعيده `skip` (ما ليس من الحرف، `freeInk`) لا يُمدّ إليه. */
export function growToInk(g: Lum, b: Box, cap: number, r: InkRef, skip: (x: number, y: number) => boolean = () => false): { box: Box; grown: [number, number, number, number] } {
  const o = { ...b };
  const grown: [number, number, number, number] = [0, 0, 0, 0];
  const rowInk = (y: number) => { for (let x = o.x0 - BURN_RING; x < o.x1 + BURN_RING; x++) if (isInk(g, r, x, y) && !skip(x, y)) return true; return false; };
  const colInk = (x: number) => { for (let y = o.y0 - BURN_RING; y < o.y1 + BURN_RING; y++) if (isInk(g, r, x, y) && !skip(x, y)) return true; return false; };
  const near = (f: (v: number) => boolean, from: number, step: number) => { for (let d = 0; d < BURN_RING; d++) if (f(from + step * d)) return true; return false; };
  for (let moved = true; moved;) {
    moved = false;
    if (grown[0] < cap && o.y0 > 0 && near(rowInk, o.y0 - 1, -1)) { o.y0--; grown[0]++; moved = true; }
    if (grown[1] < cap && o.x1 < g.w && near(colInk, o.x1, 1)) { o.x1++; grown[1]++; moved = true; }
    if (grown[2] < cap && o.y1 < g.h && near(rowInk, o.y1, 1)) { o.y1++; grown[2]++; moved = true; }
    if (grown[3] < cap && o.x0 > 0 && near(colInk, o.x0 - 1, -1)) { o.x0--; grown[3]++; moved = true; }
  }
  return { box: o, grown };
}

/** عدد بكسلات الحبر في حلقة بعرض `BURN_RING` حول المستطيل (بزواياها)، وما يُعيده `skip` (غطاء آخر مطليّ) لا يُعدّ. */
export function ringInk(g: Lum, b: Box, r: InkRef, skip: (x: number, y: number) => boolean = () => false): number {
  let n = 0;
  for (let y = b.y0 - BURN_RING; y < b.y1 + BURN_RING; y++) {
    for (let x = b.x0 - BURN_RING; x < b.x1 + BURN_RING; x++) {
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) continue;
      if (!skip(x, y) && isInk(g, r, x, y)) n++;
    }
  }
  return n;
}

/* ───────── ما ليس من الحرف حول الغطاء (ملاحظة أمين م٣، docs/logs/pen-p1.md «P1f») ───────── */
/** أقصى عرض للخطّ المستقيم (تسطير، حدّ جدول) بالبكسل. */
export const LINE_W = 3;
/** المدى (بالبكسل) الذي يُعدّ بعده الحبر بعيداً عن الغطاء: ضعف ما يبلغه المدّ مع الحلقة. `cap` سقف المدّ. */
export const farReach = (cap: number) => 2 * (cap + BURN_RING);
/** ما تمتدّ إليه نافذة `freeInk` من كل ضلع (بلا الحلقة): المدى البعيد، أو ارتفاع الغطاء إن زاد عليه، ليبلغ فحصُ الخطّ ذيلَ حرفٍ
 * امتدّ عليه خارج الغطاء (P1h). وعلى لوحة الحرق يُقرأ حول الغطاء بهذا الهامش. */
export const freeSpan = (b: Box, reach: number) => Math.max(reach, b.y1 - b.y0);

/**
 * يعيد ما يُستثنى من حبر الحلقة حول الغطاء `b`، لأنه ليس من حرفٍ تحته (والغطاء نفسه يُعدّ حبراً في هذا الحساب):
 * - **تظليل:** لون واحد (± العتبة) يغطّي نصف الحلقة على الأقلّ ويبعد عن الخلفية أكثر من العتبة: بكسله ليس حبراً،
 *   ولا حافّته المنعَّمة (بكسل أو اثنان لونهما بينه وبين الخلفية، بين بكسل تظليل وبكسل خلفية، أفقياً أو رأسياً).
 * - **خطّ مستقيم:** بكسل في امتداد أفقي (أو رأسي) متّصل يتجاوز ضلعَي الغطاء كليهما ويبعد عن الحلقة `reach` على الأقلّ في جهة
 *   (وفي الجهتين إن كان الامتداد في صفوف الغطاء نفسها أو أعمدته)، وسُمكه عند البكسل (خارج الغطاء) ≤ `LINE_W`، أو ملتقى امتدادين
 *   أفقي ورأسي. **ولا يُعدّ خطّاً مكوّنٌ منه (8 جيران) يجاوره حبرٌ ليس خطّاً في النافذة** (حرفٌ نزل إليه، P1h)، والنافذة تمتدّ
 *   `freeSpan` من كل ضلع.
 * - **سطر مجاور:** عنقود حبر (8 جيران، بلا التظليل والخطوط) لا يمسّ الغطاء (كله على بعد ≥ 2)، ولا شيء منه في صفوف الغطاء
 *   (فوقه أو تحته وحده، P1h: ما على جانبيه حبر)، ويبلغ `reach` أو حدّ النافذة.
 * وما سواها حبرٌ: ما يمسّ الغطاء من غير خطّ (جزء حرف خرج منه)، وما قرب منه صغيراً (نقطة).
 */
export function freeInk(g: Lum, b: Box, r: InkRef, reach: number): ((x: number, y: number) => boolean) & { stray: number } {
  const P = BURN_RING + freeSpan(b, reach) + 1;
  const wx0 = Math.max(0, b.x0 - P), wy0 = Math.max(0, b.y0 - P), wx1 = Math.min(g.w, b.x1 + P), wy1 = Math.min(g.h, b.y1 + P);
  const W = wx1 - wx0, H = wy1 - wy0;
  if (W <= 0 || H <= 0) return Object.assign(() => false, { stray: 0 });
  const inBox = (x: number, y: number) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  const val = (x: number, y: number) => g.d[y * g.w + x]!;
  // التظليل: أكثر الألوان في الحلقة (± العتبة) إن غطّى نصفها وبَعُد عن الخلفية
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = b.y0 - BURN_RING; y < b.y1 + BURN_RING; y++) for (let x = b.x0 - BURN_RING; x < b.x1 + BURN_RING; x++) {
    if (inBox(x, y) || x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    hist[val(x, y)]!++; n++;
  }
  let shade = -1, best = 0;
  for (let m = 0; m < 256; m++) {
    if (Math.abs(m - r.bg) <= r.thr) continue;
    let c = 0;
    for (let v = Math.max(0, m - r.thr); v <= Math.min(255, m + r.thr); v++) c += hist[v]!;
    if (c > best) { best = c; shade = m; }
  }
  if (2 * best < n) shade = -1;
  const FREE = 1, INK = 2, LINE = 4, RUN_H = 8, RUN_V = 16;
  const m = new Uint8Array(W * H);
  const at = (x: number, y: number) => (y - wy0) * W + (x - wx0);
  for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) {
    if (inBox(x, y)) continue;
    const v = val(x, y);
    if (Math.abs(v - r.bg) <= r.thr) continue;
    m[at(x, y)] = shade >= 0 && Math.abs(v - shade) <= r.thr ? FREE : INK;
  }
  // حافّة التظليل المنعَّمة: بكسل (أو اثنان) لونه بين التظليل والخلفية يصل بكسلَ تظليل ببكسلِ خلفية، أفقياً أو رأسياً
  if (shade >= 0) {
    const lo = Math.min(shade, r.bg), hi = Math.max(shade, r.bg);
    const kind = (x: number, y: number) => {
      if (x < wx0 || y < wy0 || x >= wx1 || y >= wy1 || inBox(x, y)) return "x";
      const v = val(x, y);
      if (Math.abs(v - r.bg) <= r.thr) return "b";
      if (Math.abs(v - shade) <= r.thr) return "s";
      return v > lo && v < hi ? "m" : "x";
    };
    const edge: number[] = [];
    for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) {
      if (m[at(x, y)] !== INK || kind(x, y) !== "m") continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const end = (sg: number) => { for (let t = 1; t <= 2; t++) { const k = kind(x + sg * t * dx, y + sg * t * dy); if (k !== "m") return { k, t }; } return { k: "x", t: 3 }; };
        const a = end(-1), c = end(1);
        if (a.t + c.t - 1 <= 2 && ((a.k === "s" && c.k === "b") || (a.k === "b" && c.k === "s"))) { edge.push(at(x, y)); break; }
      }
    }
    for (const i of edge) m[i] = FREE;
  }
  const ink = (x: number, y: number) => x >= wx0 && y >= wy0 && x < wx1 && y < wy1 && !inBox(x, y) && (m[at(x, y)]! & INK) !== 0;
  const runInk = (x: number, y: number) => inBox(x, y) || ink(x, y);
  // الخطوط: أفقية ثم رأسية
  for (const horiz of [true, false]) {
    const outer = horiz ? [wy0, wy1] : [wx0, wx1], inner = horiz ? [wx0, wx1] : [wy0, wy1];
    const lo = horiz ? b.x0 : b.y0, hi = horiz ? b.x1 : b.y1, across = horiz ? [b.y0, b.y1] : [b.x0, b.x1];
    for (let u = outer[0]!; u < outer[1]!; u++) {
      // امتدادٌ يعبر الغطاء نفسه (في صفوفه) يُطلب بعيداً من الجهتين: لا يُعدّ خطّاً حرفٌ خرج منه بعيداً وتحته خطٌّ يمسّه
      const through = u >= across[0]! && u < across[1]!;
      for (let s = inner[0]!; s < inner[1]!;) {
        const px = (t: number): [number, number] => (horiz ? [t, u] : [u, t]);
        if (!runInk(...px(s))) { s++; continue; }
        let e = s;
        while (e < inner[1]! && runInk(...px(e))) e++;
        const farLo = s <= lo - BURN_RING - reach, farHi = e >= hi + BURN_RING + reach;
        if (s <= lo - 1 && e >= hi + 1 && (through ? farLo && farHi : farLo || farHi)) {
          for (let t = s; t < e; t++) {
            const [x, y] = px(t);
            if (!ink(x, y)) continue;
            m[at(x, y)]! |= horiz ? RUN_H : RUN_V;
            let k = 1;
            for (let d = 1; k <= LINE_W && (horiz ? ink(x, y - d) : ink(x - d, y)); d++) k++;
            for (let d = 1; k <= LINE_W && (horiz ? ink(x, y + d) : ink(x + d, y)); d++) k++;
            if (k <= LINE_W) m[at(x, y)]! |= LINE;
          }
        }
        s = e;
      }
    }
  }
  // ملتقى خطّين (زاوية خلية): في امتدادٍ أفقي وآخر رأسي، فسُمكه في كلٍّ أكبر من الخطّ، وهو منهما لا من حرف
  for (let i = 0; i < m.length; i++) if ((m[i]! & RUN_H) && (m[i]! & RUN_V)) m[i]! |= LINE;
  // خطٌّ يمسّه حبرٌ ليس خطّاً يبقى حبراً كله (P1h، ملاحظة أمين ١): ذيل «ى» في «يرجى» ينزل إلى التسطير ويمتدّ عليه خارج الغطاء،
  // فلو عُدّ خطّاً لما مُدّ الغطاء إليه، ولبقي ما بعده (أبعد من الحلقة) ظاهراً. والنافذة تمتدّ ارتفاع الغطاء (freeSpan) لتبلغ الذيل
  const ln = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) if (m[i]! & LINE) ln[i] = (m[i]! & RUN_H ? 1 : 0) | (m[i]! & RUN_V ? 2 : 0);
  const ln0 = ln.slice(); // الخطوط قبل إلغاء ما يلامسه حرف (للعلامات الصغيرة، P1j)
  lineAttached(ln, W, H, (j) => (m[j]! & (INK | LINE)) === INK, { x0: b.x0 - wx0, x1: b.x1 - wx0, y0: b.y0 - wy0, y1: b.y1 - wy0 });
  for (let i = 0; i < m.length; i++) if ((m[i]! & LINE) && !ln[i]) m[i]! &= ~LINE;
  // نقاط الحرف وحركاته خارج الغطاء فوقه أو تحته، أبعد من الحلقة (P1j، ملاحظة أمين ١ على P1h): `stray` عدد بكسلاتها، وبه لا يُحفظ الملف
  // والعلامة على التسطير منفصلةٌ عنه ولو لامسته: لولا ذلك صارت والتسطيرُ عنقوداً واحداً بعيداً يُعدّ سطراً مجاوراً
  // ومثله الصفّ الأفقي الرفيع (≤ LINE_W عند البكسل) في امتدادٍ أعرض من MARK_W من ارتفاع الغطاء (أعرض العلامة، P1m)، ولو لم يبلغ البعيد فلم يُعدّ خطّاً (P1l، ملاحظة أمين ١
  // على P1j): قطعة التسطير تحت «سعيد» بـTraditional Arabic 12pt تقطعها فجوات skip-ink عند الحروف النازلة، فلولا هذا وصلت النقطتين
  // بحروف الجارتين في مجموعةٍ تمسّ حدّ النافذة، فلا تُعدّان علامة، وتجعلهما قاعدة السطر المجاور خارج الحبر. وما تحت النقطة من القطعة
  // (سُمكه معها أكبر) يبقى معها
  const flat = new Uint8Array(W * H);
  const thin = (x: number, y: number) => { let k = 1; for (let d = 1; k <= LINE_W && ink(x, y - d); d++) k++; for (let d = 1; k <= LINE_W && ink(x, y + d); d++) k++; return k <= LINE_W; };
  for (let y = wy0; y < wy1; y++) for (let s = wx0; s < wx1;) {
    if (!ink(s, y)) { s++; continue; }
    let e = s;
    while (e < wx1 && ink(e, y)) e++;
    if (e - s > MARK_W * (b.y1 - b.y0)) for (let x = s; x < e; x++) if (thin(x, y)) flat[at(x, y)] = 1;
    s = e;
  }
  // وعنقودٌ (8 جيران) أعرض من MARK_W وبارتفاع العلامة (≤ ‎0.5 من الغطاء) يُفصل منه ما رفُع (P1n، ملاحظة أمين ١ على P1m): نقطةٌ على قطعة
  // تسطيرٍ أقصر من MARK_W تخرج عن طرفها، فعرضهما معاً فوقه فليسا علامةً، والقطعة وحدها دونه فلا يفصلها flat. فتبقى النقطة وما تحتها علامةً
  const Hb = b.y1 - b.y0, seen0 = new Uint8Array(W * H);
  const lone = (i: number) => (m[i]! & INK) !== 0 && !ln0[i] && !flat[i];
  for (let i0 = 0; i0 < m.length; i0++) {
    if (seen0[i0] || !lone(i0)) continue;
    const comp = [i0];
    seen0[i0] = 1;
    let cx0 = W, cx1 = -1, cy0 = H, cy1 = -1;
    for (let q = 0; q < comp.length; q++) {
      const x = comp[q]! % W, y = (comp[q]! - x) / W;
      cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * W + xx;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || seen0[j] || !lone(j)) continue;
        seen0[j] = 1; comp.push(j);
      }
    }
    if (cx1 - cx0 + 1 > MARK_W * Hb && cy1 - cy0 + 1 <= 0.5 * Hb) for (const j of comp) if (thin(wx0 + (j % W), wy0 + Math.floor(j / W))) flat[j] = 1;
  }
  const stray = ownMarks(W, H, lone, lone, { x0: b.x0 - wx0, x1: b.x1 - wx0, y0: b.y0 - wy0, y1: b.y1 - wy0 }, b.y1 - b.y0, Math.max(1, Math.round((reach / 2 - BURN_RING) / 2))).reduce((s, q) => s + q.n, 0);
  // السطر المجاور: عناقيد لا تمسّ الغطاء وتبلغ البعيد، وكلها فوقه أو تحته (P1h، ملاحظة أمين ٢: ما على جانبيه حبرٌ يمنع الحفظ)
  const loose = (i: number) => (m[i]! & (INK | LINE)) === INK; // حبرٌ ليس خطّاً (ولو كان في امتداد خطٍّ وسُمكه أكبر)
  const dist = (x: number, y: number) => Math.max(b.x0 - x, x - b.x1 + 1, b.y0 - y, y - b.y1 + 1);
  const seen = new Uint8Array(W * H);
  for (let y0 = wy0; y0 < wy1; y0++) for (let x0 = wx0; x0 < wx1; x0++) {
    const i0 = at(x0, y0);
    if (seen[i0] || !loose(i0)) continue;
    const comp: number[] = [i0];
    seen[i0] = 1;
    let touch = false, far = false;
    for (let q = 0; q < comp.length; q++) {
      const x = wx0 + (comp[q]! % W), y = wy0 + Math.floor(comp[q]! / W);
      const d = dist(x, y);
      if (d <= 1 || (y >= b.y0 && y < b.y1)) touch = true;
      if (d >= reach || x === wx0 || y === wy0 || x === wx1 - 1 || y === wy1 - 1) far = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < wx0 || yy < wy0 || xx >= wx1 || yy >= wy1) continue;
        const j = at(xx, yy);
        if (!seen[j] && loose(j)) { seen[j] = 1; comp.push(j); }
      }
    }
    if (!touch && far) for (const j of comp) m[j] = FREE;
  }
  const free = (x: number, y: number) => x >= wx0 && y >= wy0 && x < wx1 && y < wy1 && !inBox(x, y) && (m[at(x, y)] === FREE || (m[at(x, y)]! & LINE) !== 0);
  return Object.assign(free, { stray });
}
