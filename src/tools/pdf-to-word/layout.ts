/**
 * «PDF إلى Word»: من الرموز المرسومة إلى كتل منطقية (فقرات وعناوين وقوائم وجداول).
 * منقول من محرّك التجربة (`docs/logs/pdf-to-word-trial.md`، و`docs/samples/pdf-to-word-trial/code/`) بمراحل رائد:
 * ٣ الأسطر والكلمات · ٤ UAX #9 (bidi-js) · ٥ الفقرات ولصقها عبر الصفحات · ٦ العناوين بالحجم والوزن · ٧ الجداول من خطوط الحدود والقوائم.
 * ومعه إصلاحات ملفَّي نايف الخمسة (ملحق السجلّ ٢٠٢٦/١١/١٣)، كلٌّ في موضعه بتعليقه.
 * لا يعرف pdf.js: مدخله رموز وخطوط حدود (`extract.ts`)، فتُختبر مراحله بمدخلات مصنوعة.
 */
import bidiFactory from "bidi-js";

const bidi = bidiFactory();
export const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const LATIN = /[A-Za-z]/;

/** حرف مرسوم بنصّه وموضعه (نقاط PDF، y من الأسفل). `lig`: نصّ ترابطٍ من ToUnicode بترتيبه الخام، يُحسم بالتصويت. */
export interface Glyph { mark: false; s: string; lig: string | null; x0: number; x1: number; y: number; size: number; font: string | null }
/** علامة تشكيل: أصلها نقطة. */
export interface Mark { mark: true; s: string; x: number; y: number; size: number; font: string | null }
export type Item = Glyph | Mark;
/** خطّ حدود: عمودي (`v`) عند x من a إلى b، أو أفقي عند y. */
export type Seg = { v: true; x: number; a: number; b: number } | { v: false; y: number; a: number; b: number };
/** خلية الجدول بخانات شبكته: `r` من الأعلى و`c` من اليسار (بصرياً)، و`rs`/`cs` عدد الصفوف والأعمدة التي تمتدّ عليها. */
export interface TCell { r: number; c: number; rs: number; cs: number }
export interface Table { xs: number[]; ys: number[]; box: [number, number, number, number]; cells: TCell[] }
/** مستطيل بنقاط PDF: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];
export type FontInfo = Record<string, { bold: boolean; name: string }>;
/** خصائص الملف كله، تُحسب قبل بناء الأسطر. */
export interface DocFlags {
  /** المنتِج يكتب المسافة حرفاً (≥ 3% من الحروف): لا تُخترع مسافة من فجوة (الإصلاح ٤). */
  hasSpaces: boolean;
  /** العربي أكثر من اللاتيني: السطر بلا حرف قويّ يأخذ هذا الاتجاه (الإصلاح ٥). */
  docRtl: boolean;
  /** تطبيع «ی ھ» إلى «ي/ى ه»: يُلغى إن كان في الملف حرف فارسي (Tahoma في Chrome). */
  fixShared: boolean;
}

/**
 * UAX #9: إعادة الترتيب (منطقي ↔ بصري)، وهو يعكس نفسه في سطرٍ عربيٍّ فيه لاتيني وأرقام، فيُستعمل للاتجاهين.
 * بالمواضع لا بـ`getReorderedString`: ذاك يعكس الأقواس (bidi mirroring)، وToUnicode يعطي القوس المنطقي أصلاً،
 * فكانت «)1(» في ملف نايف (الإصلاح ٢).
 */
export function reorder(s: string, dir: "rtl" | "ltr"): string {
  if (!s) return s;
  const lv = bidi.getEmbeddingLevels(s, dir);
  const idx = bidi.getReorderedIndices(s, lv);
  return idx.map((i) => s[i]).join("");
}

// ── ٧ (أ): الجداول من خطوط الحدود ──────────────────────────────────────────────────
/**
 * سقوف ملفٍّ عدائيّ (الدفعة ٤، ملاحظات أمين): المهلة لا تحمي الذاكرة. فوق `MAX_SEGS` خطّاً أو `MAX_RECTS` مستطيلاً من مصدرٍ واحد لا جدول منه،
 * والشبكة بأكثر من `MAX_CELLS` خانة لا تُبنى (مصفوفة R×C)، ولا يُبقى من المستطيلات الضخمة إلا `MAX_BIG`. وما يُسقطه سقفٌ وفيه نصّ يُعدّ شكّاً (`doubt`).
 * الخطوط أقلّ لأن تجميعها في `grids` تربيعيّ ولا يُستبدل بلا تغيير سلوك: يضمّ الخطّ إلى المجموعة بصندوقها لا بخطوطها.
 */
const MAX_SEGS = 10_000, MAX_RECTS = 20_000, MAX_CELLS = 40_000, MAX_BIG = 50;
/** صندوق ما أسقطه سقف، إن كان فيه حرفان بنصّ أو أكثر: دليلٌ أن فيه جدولاً خرج فقرات. */
function dropped(bs: readonly (readonly number[])[], text: Glyph[]): Box[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b[0]!); y0 = Math.min(y0, b[1]!); x1 = Math.max(x1, b[2]!); y1 = Math.max(y1, b[3]!); }
  const box: Box = [x0, y0, x1, y1];
  let n = 0;
  for (const g of text) if (inBox(g, box) && ++n >= 2) return [box];
  return [];
}
const cluster = (vals: number[], tol = 1.5) => { const s = [...vals].sort((p, q) => p - q); const o: number[] = []; for (const v of s) if (!o.length || v - o[o.length - 1]! > tol) o.push(v); return o; };

/** المجموعات المتّصلة من الخطوط (صندوق كل خط موسَّعاً نقطتين)، وشبكة كلٍّ منها. */
function grids(segs: Seg[], text: Glyph[]): { tables: Table[]; over: Box[] } {
  type G = { segs: Seg[]; box: [number, number, number, number] };
  const box = (s: Seg): [number, number, number, number] => (s.v ? [s.x - 2, s.a - 2, s.x + 2, s.b + 2] : [s.a - 2, s.y - 2, s.b + 2, s.y + 2]);
  const groups: G[] = [];
  for (const s of segs) {
    const b = box(s);
    const hit = groups.filter((g) => g.box[0] <= b[2] && b[0] <= g.box[2] && g.box[1] <= b[3] && b[1] <= g.box[3]);
    const g: G = { segs: [s], box: b };
    for (const h of hit) { g.segs.push(...h.segs); g.box = [Math.min(g.box[0], h.box[0]), Math.min(g.box[1], h.box[1]), Math.max(g.box[2], h.box[2]), Math.max(g.box[3], h.box[3])]; groups.splice(groups.indexOf(h), 1); }
    groups.push(g);
  }
  const out: Table[] = [], over: Box[] = [];
  for (const g of groups) {
    const xs = cluster(g.segs.flatMap((s) => (s.v ? [s.x] : [])));
    const ys = cluster(g.segs.flatMap((s) => (s.v ? [] : [s.y]))).reverse(); // من الأعلى
    if (xs.length < 2 || ys.length < 2) continue;
    if ((xs.length - 1) * (ys.length - 1) > MAX_CELLS) { over.push(...dropped([[xs[0]!, ys[ys.length - 1]!, xs[xs.length - 1]!, ys[0]!]], text)); continue; }
    out.push({ xs, ys, box: [xs[0]!, ys[ys.length - 1]!, xs[xs.length - 1]!, ys[0]!], cells: cellsOf(g.segs, xs, ys) });
  }
  return { tables: out, over };
}

/** التسامح في موضع الضلع، ونسبة طوله التي يغطّيها خطّ حتى يُعدّ حدّاً بين خليتين. */
const WALL_TOL = 1.5, WALL_COVER = 0.9;
/**
 * الخطوط بحسب اتّجاهها مرتّبةً بموضعها، فيُطلب ما عند موضعٍ بالبحث الثنائي لا بالمرور على الكل (الدفعة ٣: كان `cellsOf`
 * يمرّ على كل الخطوط لكل ضلع، فصفحة بـ3000 خطّ تضاعف زمنها). ومع كلٍّ ترتيبه الأصلي، فيبقى الناتج كما كان.
 */
type WallIndex = Record<"v" | "h", { p: number; i: number; s: Seg }[]>;
function wallIndex(segs: Seg[]): WallIndex {
  const ix: WallIndex = { v: [], h: [] };
  segs.forEach((s, i) => ix[s.v ? "v" : "h"].push({ p: s.v ? s.x : s.y, i, s }));
  ix.v.sort((p, q) => p.p - q.p); ix.h.sort((p, q) => p.p - q.p);
  return ix;
}
/** طول ما تغطّيه الخطوط من الضلع [a, b] عند الموضع p (اتّحاد المقاطع، فالمتداخلة لا تُعدّ مرتين). */
function covered(ix: WallIndex, v: boolean, p: number, a: number, b: number): number {
  const arr = ix[v ? "v" : "h"];
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m]!.p < p - WALL_TOL - 1e-6) lo = m + 1; else hi = m; }
  const near: { i: number; s: Seg }[] = [];
  for (let k = lo; k < arr.length && arr[k]!.p <= p + WALL_TOL + 1e-6; k++) if (Math.abs(arr[k]!.p - p) <= WALL_TOL) near.push(arr[k]!);
  const iv = near.sort((x, y) => x.i - y.i).map(({ s }) => [Math.max(s.a, a), Math.min(s.b, b)] as const)
    .filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  let len = 0, end = a;
  for (const [x, y] of iv) if (y > end) { len += y - Math.max(x, end); end = y; }
  return len;
}

/**
 * الخلايا المدمجة من الخطوط: ضلعٌ بين خانتين متجاورتين لا يغطّي خطٌّ 90٪ من طوله يعني أنهما خلية واحدة.
 * والمنطقة غير المستطيلة، أو المستطيلة وفي داخلها حدّ، لا تُدمج: تبقى خاناتها خلايا مفردة.
 */
function cellsOf(segs: Seg[], xs: number[], ys: number[]): TCell[] {
  const R = ys.length - 1, C = xs.length - 1, id = (r: number, c: number) => r * C + c;
  const up = Array.from({ length: R * C }, (_, i) => i);
  const find = (i: number): number => { while (up[i] !== i) i = up[i] = up[up[i]!]!; return i; };
  // wallR[r][c]: حدّ بين (r,c) و(r,c+1)، وwallD[r][c]: حدّ بين (r,c) و(r+1,c)
  const wallR: boolean[][] = [], wallD: boolean[][] = [], ix = wallIndex(segs);
  for (let r = 0; r < R; r++) {
    wallR.push([]); wallD.push([]);
    for (let c = 0; c < C; c++) {
      const h = ys[r]! - ys[r + 1]!, w = xs[c + 1]! - xs[c]!;
      wallR[r]!.push(c + 1 < C && covered(ix, true, xs[c + 1]!, ys[r + 1]!, ys[r]!) >= WALL_COVER * h);
      wallD[r]!.push(r + 1 < R && covered(ix, false, ys[r + 1]!, xs[c]!, xs[c + 1]!) >= WALL_COVER * w);
      if (c + 1 < C && !wallR[r]![c]) up[find(id(r, c))] = find(id(r, c + 1));
      if (r + 1 < R && !wallD[r]![c]) up[find(id(r, c))] = find(id(r + 1, c));
    }
  }
  const groups = new Map<number, [number, number][]>();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const k = find(id(r, c)); (groups.get(k) ?? groups.set(k, []).get(k)!).push([r, c]); }
  const cells: TCell[] = [];
  for (const g of groups.values()) {
    const r0 = Math.min(...g.map((x) => x[0])), r1 = Math.max(...g.map((x) => x[0])) + 1;
    const c0 = Math.min(...g.map((x) => x[1])), c1 = Math.max(...g.map((x) => x[1])) + 1;
    const inner = g.some(([r, c]) => (c + 1 < c1 && wallR[r]![c]) || (r + 1 < r1 && wallD[r]![c]));
    if (g.length === (r1 - r0) * (c1 - c0) && !inner) cells.push({ r: r0, c: c0, rs: r1 - r0, cs: c1 - c0 });
    else for (const [r, c] of g) cells.push({ r, c, rs: 1, cs: 1 });
  }
  return cells.sort((p, q) => p.r - q.r || p.c - q.c);
}
/** صندوق الخلية بنقاط PDF: [x0, y0, x1, y1]. */
export const cellBox = (t: Table, c: TCell) => [t.xs[c.c]!, t.ys[c.r + c.rs]!, t.xs[c.c + c.cs]!, t.ys[c.r]!] as const;

/**
 * الجداول، ومعها ما رُفض إطاراً (`frames`).
 * الإطار ليس جدولاً (الإصلاح ١): إطار الصفحة في Word كان يُقرأ جدولاً من خلية واحدة يبتلع الصفحة. وصفّ واحد بأعمدة
 * قد يكون بقية جدول من الصفحة السابقة، فلا يُرفض (صيغة «عمود أو صف» أسقطت 3 من الـ13).
 * وشبكة فيها أقلّ من خليتين بنصّ إطارٌ لا جدول: خانات توقيع أو مربّعات فارغة حول نصّ واحد.
 * و`doubt`: صناديق شبكات مستطيلات رُفضت بالشكّ (`rectGrids`) وفيها مستطيلان بنصّ أو أكثر، حيث لم يقع جدول ولا إطار:
 * جدولٌ نُقل فقرات، فتُنبَّه إليه الشاشة (سبب «table»، قرار نايف ٢٠٢٦/١١/١٥).
 */
export function tablesOf(segs: Seg[], items: Item[], rects: { clips: Box[]; fills: Box[] } = { clips: [], fills: [] }): { tables: Table[]; frames: Table[]; doubt: Box[] } {
  const tables: Table[] = [], frames: Table[] = [];
  const text = items.filter((g): g is Glyph => !g.mark && !!g.s.trim());
  const withText = (t: Table) => t.cells.filter((c) => { const b = cellBox(t, c); return text.some((g) => inBox(g, b)); }).length;
  const doubted: Box[] = [];
  if (segs.length > MAX_SEGS) doubted.push(...dropped(segs.map((s) => (s.v ? [s.x, s.a, s.x, s.b] : [s.a, s.y, s.b, s.y])), text));
  else { const { tables: found, over } = grids(segs, text); doubted.push(...over); for (const t of found) (t.xs.length >= 3 && withText(t) >= 2 ? tables : frames).push(t); }
  // ثم القصّ، ثم التعبئة: حيث لا جدول ولا إطار من الخطوط. وما فيه أقلّ من خليتين بنصّ يُترك (لا يصير إطاراً)
  const overlaps = (a: Box, b: Box) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5;
  for (const src of [rects.clips, rects.fills]) {
    const { grids: found, doubt } = rectGrids(src, text);
    doubted.push(...doubt);
    for (const t of found) if (![...tables, ...frames].some((u) => overlaps(u.box, t.box)) && withText(t) >= 2) tables.push(t);
  }
  const doubt = doubted.filter((b) => ![...tables, ...frames].some((u) => overlaps(u.box, b)));
  return { tables, frames, doubt };
}

// ── ٧ (ب): الجداول من مستطيلات القصّ أو التعبئة، حين الحدود صورة أو لا حدود (الدفعة ٢) ──────────────
/**
 * فهرس مكاني للمستطيلات: شبكة دلاء ضلعها 24 نقطة، وكلٌّ في كل دلو يمسّه. والذي يمسّ أكثر من 64×64 دلواً (قصّ صفحة ضخم) في قائمة
 * تُرجَع دائماً. `near` يُرجع أرقام ما قد يقع في الصندوق موسَّعاً بـpad، وعلى المستدعي فحصه (الدفعة ٣: كان التجميع تربيعياً).
 */
class BoxIndex {
  /** يمسّ أكثر من 64×64 دلواً، فلا يُفهرس بدلائه. */
  static big(b: Box): boolean { const [x0, y0, x1, y1] = BoxIndex.span(b, 0); return (x1 - x0 + 1) * (y1 - y0 + 1) > 64 * 64; }
  private cells = new Map<number, number[]>();
  private big: number[] = [];
  private stamp: number[] = [];
  private q = 0;
  private static span(b: Box, pad: number): [number, number, number, number] {
    const S = 24, f = (v: number) => Math.max(-4096, Math.min(4095, Math.floor(v / S)));
    return [f(b[0] - pad), f(b[1] - pad), f(b[2] + pad), f(b[3] + pad)];
  }
  add(b: Box, k: number) {
    const [x0, y0, x1, y1] = BoxIndex.span(b, 0);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 * 64) { this.big.push(k); return; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const key = (x + 4096) * 8192 + y + 4096; (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(k); }
  }
  near(b: Box, pad: number): number[] {
    const [x0, y0, x1, y1] = BoxIndex.span(b, pad), out: number[] = [], q = ++this.q;
    const take = (k: number) => { if (this.stamp[k] !== q) { this.stamp[k] = q; out.push(k); } };
    this.big.forEach(take);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 * 64) { for (const ks of this.cells.values()) ks.forEach(take); return out; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.cells.get((x + 4096) * 8192 + y + 4096)?.forEach(take);
    return out;
  }
}

/**
 * المستطيلات المتلامسة شبكةٌ: حوافّها خطوط الشبكة، وكلٌّ منها خلية بامتداده. ويُرفض ما لا يكون شبكة:
 * أقلّ من ثلاثة مستطيلات، أو أقلّ من عمودين أو صفّين، أو مستطيلان يتداخلان، أو خانات فارغة لا يحسمها `gapCells`.
 * والمكرّر يُعدّ مرة، والمستطيل الذي يحيط بغيره (قصّ الصفحة، خلفيتها) ليس خلية.
 */
function rectGrids(all: Box[], text: Glyph[]): { grids: Table[]; doubt: Box[] } {
  if (all.length > MAX_RECTS) return { grids: [], doubt: dropped(all, text) };
  // الضخم يُرجَع مع كل بحث، فلا يُبقى منه إلا أوّل MAX_BIG (قصّ صفحة ضخم يتكرّر)
  let nBig = 0;
  const boxes = all.filter((b) => !BoxIndex.big(b) || ++nBig <= MAX_BIG);
  const same = (a: Box, b: Box) => a.every((v, k) => Math.abs(v - b[k]!) <= 0.5);
  const uniq: Box[] = [], ui = new BoxIndex();
  for (const b of boxes) if (!ui.near(b, 0.5).some((k) => same(uniq[k]!, b))) ui.add(b, uniq.push(b) - 1);
  const inside = (a: Box, b: Box) => a !== b && a[0] >= b[0] - 0.5 && a[1] >= b[1] - 0.5 && a[2] <= b[2] + 0.5 && a[3] <= b[3] + 0.5;
  const leaf = uniq.filter((b) => !ui.near(b, 0.5).some((k) => inside(uniq[k]!, b)));
  // المتلامسة (كلٌّ موسَّعاً بالتسامح): مجموعات متّصلة، وترتيبها بآخر من انضمّ إليها كما كانت تُبنى
  const T = WALL_TOL, li = new BoxIndex(), up = leaf.map((_, i) => i);
  const find = (i: number): number => { while (up[i] !== i) i = up[i] = up[up[i]!]!; return i; };
  const touch = (a: Box, b: Box) => a[0] <= b[2] + T && b[0] <= a[2] + T && a[1] <= b[3] + T && b[1] <= a[3] + T;
  leaf.forEach((b, i) => { for (const k of li.near(b, T)) if (touch(leaf[k]!, b)) up[find(k)] = find(i); li.add(b, i); });
  const byRoot = new Map<number, { last: number; g: Box[] }>();
  leaf.forEach((b, i) => { const e = byRoot.get(find(i)) ?? byRoot.set(find(i), { last: i, g: [] }).get(find(i))!; e.g.push(b); e.last = i; });
  const groups = [...byRoot.values()].sort((p, q) => p.last - q.last).map((e) => e.g);
  const out: Table[] = [], doubt: Box[] = [];
  for (const g of groups) {
    if (g.length < 3) continue;
    const xs = cluster(g.flatMap((b) => [b[0], b[2]])), ys = cluster(g.flatMap((b) => [b[1], b[3]])).reverse();
    const C = xs.length - 1, R = ys.length - 1;
    if (C < 2 || R < 2) continue;
    const hasText = () => g.filter((b) => text.some((t) => inBox(t, b))).length >= 2;
    // سُلّم مستطيلات على قُطر: كل حافّة عمود، فالمصفوفة R×C بعشرات الجيجابايت. تُرفض قبل أن تُبنى، شكّاً كالمرفوضة بعدها
    if (R * C > MAX_CELLS) { if (hasText()) doubt.push([xs[0]!, ys[R]!, xs[C]!, ys[0]!]); continue; }
    const occ = Array.from({ length: R }, () => Array<boolean>(C).fill(false));
    const cells: TCell[] = [];
    let ok = true;
    for (const b of g) {
      const c0 = at(xs, b[0]!), c1 = at(xs, b[2]!), r0 = at(ys, b[3]!), r1 = at(ys, b[1]!);
      if (c1 <= c0 || r1 <= r0) { ok = false; break; }
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { if (occ[r]![c]) ok = false; occ[r]![c] = true; }
      cells.push({ r: r0, c: c0, rs: r1 - r0, cs: c1 - c0 });
    }
    const rest = ok ? gapCells(xs, ys, occ, text) : null;
    if (!rest) {
      // رُفضت بالشكّ (تداخل، أو منطقة غير مستطيلة، أو كتل لا تقسم، أو مركز بعيد): دليل جدول إن كان النصّ في مستطيلين منها
      if (hasText()) doubt.push([xs[0]!, ys[R]!, xs[C]!, ys[0]!]);
      continue;
    }
    out.push({ xs, ys, box: [xs[0]!, ys[R]!, xs[C]!, ys[0]!], cells: [...cells, ...rest].sort((p, q) => p.r - q.r || p.c - q.c) });
  }
  return { grids: out, doubt };
}

/**
 * أقرب قيمة في مصفوفة مرتّبة (تصاعداً أو تنازلياً) إلى v، وعند التساوي الأسبق: كالمرور على الكل، بالبحث الثنائي (الدفعة ٤: كان O(C) لكل حافّة).
 */
function at(arr: number[], v: number): number {
  const n = arr.length, asc = n < 2 || arr[n - 1]! >= arr[0]!;
  let lo = 0, hi = n; // أول موضع ليس قبل v في الترتيب
  while (lo < hi) { const m = (lo + hi) >> 1; if (asc ? arr[m]! < v : arr[m]! > v) lo = m + 1; else hi = m; }
  if (lo === 0) return 0;
  if (lo === n) return n - 1;
  return Math.abs(arr[lo]! - v) < Math.abs(arr[lo - 1]! - v) ? lo : lo - 1;
}

/**
 * الخانات التي لا يغطّيها مستطيل (في ملف نايف: الممتدّة رأسياً كلها). كل مجموعة متّصلة منها مستطيلٌ، وإلا فلا جدول (null).
 * وتُقسم بالنصّ، وهو الدليل الثاني: أعمدتها منفصلة ما لم يعبر سطرٌ حدّاً بينها، ثم كل جزء رأسياً على كتل نصّه.
 * k كتلة تقسم صفوفه أقساماً متساوية إن قسمها k، وكان مركز كل كتلة في وسط قسمها (ربع ارتفاعه)، وإلا فلا جدول.
 * وبلا نصّ: خانة خانة، فلا دمج بلا دليل.
 */
function gapCells(xs: number[], ys: number[], occ: boolean[][], text: Glyph[]): TCell[] | null {
  const R = ys.length - 1, C = xs.length - 1, seen = occ.map((r) => [...r]);
  const out: TCell[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r]![c]) continue;
    const comp: [number, number][] = [], q: [number, number][] = [[r, c]];
    seen[r]![c] = true;
    while (q.length) {
      const [a, b] = q.pop()!; comp.push([a, b]);
      for (const [y, x] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]] as const) if (y >= 0 && y < R && x >= 0 && x < C && !seen[y]![x]) { seen[y]![x] = true; q.push([y, x]); }
    }
    const r0 = Math.min(...comp.map((p) => p[0])), r1 = Math.max(...comp.map((p) => p[0])) + 1;
    const c0 = Math.min(...comp.map((p) => p[1])), c1 = Math.max(...comp.map((p) => p[1])) + 1;
    if (comp.length !== (r1 - r0) * (c1 - c0)) return null;
    const own = text.filter((g) => inBox(g, [xs[c0]!, ys[r1]!, xs[c1]!, ys[r0]!]));
    const lines = textLines(own);
    // سطرٌ يعبر حدّ عمود: حرفٌ فوقه، أو حرفان متتاليان حوله بفجوة دون نصف الحجم
    const crosses = (x: number) => lines.some((l) => l.g.some((g) => g.x0 < x - 0.5 && g.x1 > x + 0.5) || l.g.some((g, i) => { const n = l.g[i + 1]; return !!n && g.x1 <= x + 0.5 && n.x0 >= x - 0.5 && n.x0 - g.x1 < 0.5 * l.size; }));
    const strips: [number, number][] = [];
    for (let k = c0; k < c1; k++) if (k > c0 && !crosses(xs[k]!)) strips.push([k, k + 1]); else if (k === c0) strips.push([k, k + 1]); else strips[strips.length - 1]![1] = k + 1;
    for (const [s0, s1] of strips) {
      const blocks = textBlocks(textLines(own.filter((g) => { const m = (g.x0 + g.x1) / 2; return m > xs[s0]! && m < xs[s1]!; })));
      const h = r1 - r0, k = blocks.length;
      if (!k) { for (let y = r0; y < r1; y++) out.push({ r: y, c: s0, rs: 1, cs: s1 - s0 }); continue; }
      if (h % k) return null;
      const seg = (ys[r0]! - ys[r1]!) / k;
      for (let i = 0; i < k; i++) {
        const mid = ys[r0]! - (i + 0.5) * seg, cen = (blocks[i]!.top + blocks[i]!.bot) / 2;
        if (Math.abs(cen - mid) > 0.25 * seg) return null;
        out.push({ r: r0 + (i * h) / k, c: s0, rs: h / k, cs: s1 - s0 });
      }
    }
  }
  return out;
}
/** أسطر الحروف بخطّ قاعدتها (من الأعلى)، وحروف كلٍّ من اليسار. */
function textLines(gs: Glyph[]): { y: number; size: number; g: Glyph[] }[] {
  const ls: { y: number; size: number; g: Glyph[] }[] = [];
  for (const g of [...gs].sort((p, q) => q.y - p.y)) {
    const l = ls.find((l) => Math.abs(l.y - g.y) < 0.25 * Math.max(l.size, g.size));
    if (l) { l.g.push(g); l.size = Math.max(l.size, g.size); } else ls.push({ y: g.y, size: g.size, g: [g] });
  }
  for (const l of ls) l.g.sort((p, q) => p.x0 - q.x0);
  return ls;
}
/** كتل النصّ: أسطر متتالية فجوتها دون 0.6 من الحجم. السطر من خطّ قاعدته بـ0.8 من الحجم فوقه و0.25 تحته. */
function textBlocks(ls: { y: number; size: number }[]): { top: number; bot: number }[] {
  const out: { top: number; bot: number }[] = [];
  for (const l of ls) {
    const top = l.y + 0.8 * l.size, bot = l.y - 0.25 * l.size, b = out[out.length - 1];
    if (b && b.bot - top < 0.6 * l.size) b.bot = bot; else out.push({ top, bot });
  }
  return out;
}

// ── ٣ و٤: الأسطر، والكلمات بالفجوة، وUAX #9 ──────────────────────────────────────────
export interface Line {
  text: string; dir: "rtl" | "ltr"; y: number; size: number; x0: number; x1: number; fonts: (string | null)[];
  /** نسبة الحروف العريضة. */
  boldFrac: (fb: FontInfo) => number;
  /** أكبر فجوة داخلية بين حرفين، بوحدة حجم السطر، وموضع وسطها: لكشف العمودين. */
  gap: { w: number; x: number };
  bold?: boolean;
}

export function linesOf(items: Item[], f: DocFlags): Line[] {
  const base = items.filter((g): g is Glyph => !g.mark).sort((p, q) => q.y - p.y);
  const lines: { y: number; size: number; g: Glyph[]; marks: Mark[] }[] = [];
  for (const g of base) {
    const l = lines.find((l) => Math.abs(l.y - g.y) < 0.25 * Math.max(l.size, g.size));
    if (l) l.g.push(g); else lines.push({ y: g.y, size: g.size, g: [g], marks: [] });
  }
  // التشكيل: إلى أقرب سطر، ثم إلى الحرف الذي يقع فوقه
  for (const m of items.filter((g): g is Mark => g.mark)) {
    let best = null, bd = Infinity;
    for (const l of lines) { const d = Math.abs(l.y - m.y); if (d < bd && d < 1.2 * l.size) { bd = d; best = l; } }
    if (best) best.marks.push(m);
  }
  return lines.map((l) => buildLine(l, f)).filter((l): l is Line => !!l && !!l.text);
}

const isWs = (s: string) => /^\s+$/.test(s);

export function buildLine(l: { y: number; size: number; g: Glyph[]; marks: Mark[] }, f: DocFlags): Line | null {
  let g = [...l.g].sort((p, q) => p.x0 - q.x0);
  // مسافة مرسومة فوق حرف ليست فاصلاً (الإصلاح ٣): Word يرسم مسافة آخر السطر فوق الحرف الأخير، فتنفصل التاء المربوطة والياء الأخيرة
  g = g.filter((x) => !isWs(x.s) || !g.some((y) => y !== x && !isWs(y.s) && Math.min(x.x1, y.x1) - Math.max(x.x0, y.x0) > 0.5 * (x.x1 - x.x0)));
  if (!g.length) return null;
  // كل حرف بصريّ بموضعه، ليُدخَل التشكيل قبل حرفه بصرياً (فيأتي بعده منطقياً)
  type Cell = { c: string; x0: number; x1: number; item: Glyph; pre?: string[] };
  const cells: Cell[] = [];
  for (const it of g) { const ch = [...it.s]; const w = (it.x1 - it.x0) / Math.max(ch.length, 1); ch.forEach((c, i) => cells.push({ c, x0: it.x0 + i * w, x1: it.x0 + (i + 1) * w, item: it })); }
  for (const m of l.marks) {
    // أصل العلامة عند الحافة اليسرى لحرفها («إعداد خطاب» تماماً، وChrome بفرق كسور)، أو داخله (Chrome)
    const EPS = 0.3;
    const ok = (c: Cell) => !/[\s\u0000-\u001F]/.test(c.c);
    let bi = cells.findIndex((c) => ok(c) && Math.abs(c.x0 - m.x) <= EPS);
    if (bi < 0) {
      let bd = Infinity;
      cells.forEach((c, i) => { if (!ok(c)) return; const d = m.x < c.x0 ? c.x0 - m.x : m.x > c.x1 ? m.x - c.x1 : 0; if (d < bd) { bd = d; bi = i; } });
    }
    if (bi >= 0) (cells[bi]!.pre ??= []).push(m.s);
  }
  let vis = "";
  let prev: Cell | null = null;
  const gap = { w: 0, x: 0 };
  for (const c of cells) {
    if (prev && prev.item !== c.item) {
      const d = c.x0 - prev.x1;
      // الفجوة الخالية بين قطعتين، ولو كانت إحداهما مسافة: Word يرسم مسافة آخر سطر العمود قبل الفاصل بين العمودين
      if (d / l.size > gap.w) { gap.w = d / l.size; gap.x = (c.x0 + prev.x1) / 2; }
      if (!f.hasSpaces && d > 0.18 * l.size && !/\s/.test(prev.c) && !/\s/.test(c.c)) vis += " ";
    }
    vis += (c.pre ? c.pre.join("") : "") + c.c;
    prev = c;
  }
  // السطر بلا حرف قويّ (أرقام وشَرطات وأقواس) يأخذ اتجاه الوثيقة لا LTR (الإصلاح ٥)
  const dir = AR.test(vis) ? "rtl" : LATIN.test(vis) || !f.docRtl ? "ltr" : "rtl";
  let text = reorder(vis, dir);
  text = text.replace(/\s+(?=\p{M})/gu, "");
  text = text.replace(/\s+/g, " ").trim();
  if (f.fixShared) text = text.replace(/ی(?=\p{M}*[ء-يٮ-ۓ])/gu, "ي").replace(/ی/g, "ى").replace(/ھ/g, "ه");
  const sizes = g.map((x) => x.size).sort((p, q) => p - q);
  const boldFrac = (fb: FontInfo) => { const n = g.filter((x) => x.s.trim()); return n.filter((x) => x.font !== null && fb[x.font]?.bold).length / Math.max(n.length, 1); };
  return { text, dir, y: l.y, size: sizes[Math.floor(sizes.length / 2)]!, x0: g[0]!.x0, x1: Math.max(...g.map((x) => x.x1)), fonts: [...new Set(g.map((x) => x.font))], boldFrac, gap };
}

// ── الصفحة: الجداول أولاً (تشترك خلايا الصف في خطّ قاعدة واحد)، ثم الأسطر ───────────────
/** `span`: عدد أعمدة الشبكة (gridSpan) إن زاد على واحد. `vm`: الدمج الرأسي، و`continue` خانةٌ فارغة تحت أول الخلية. */
export interface Cell { text: string; dir: "rtl" | "ltr"; bold: boolean; size: number; span?: number; vm?: "restart" | "continue" }
export type PageBlock = { type: "table"; y: number; rtl: boolean; xs: number[]; rows: Cell[][] } | { type: "line"; y: number; line: Line };

const inBox = (g: Item, b: readonly number[]) => { const x = g.mark ? g.x : (g.x0 + g.x1) / 2; return x > b[0]! && x < b[2]! && g.y > b[1]! && g.y < b[3]!; };
export const itemInBox = inBox;

/** `ligLogical=false`: نصّ الترابط في ToUnicode مقلوب سلفاً (بصريّ)، فلا يُقلب. */
export function pageBlocks(glyphs: Item[], tables: Table[], fonts: FontInfo, ligLogical: boolean, f: DocFlags): PageBlock[] {
  if (!ligLogical) for (const g of glyphs) if (!g.mark && g.lig) g.s = g.lig;
  const flow = glyphs.filter((g) => !tables.some((t) => inBox(g, t.box)));
  const blocks: PageBlock[] = [];
  for (const t of tables) {
    const own = new Map<TCell, Cell>();
    for (const tc of t.cells) {
      const ls = linesOf(glyphs.filter((g) => inBox(g, cellBox(t, tc))), f);
      own.set(tc, { text: ls.map((l) => l.text).join(" "), dir: ls.some((l) => l.dir === "rtl") ? "rtl" : "ltr", bold: ls.some((l) => l.fonts.some((x) => x !== null && fonts[x]?.bold)), size: ls[0]?.size ?? 0, ...(tc.cs > 1 ? { span: tc.cs } : {}), ...(tc.rs > 1 ? { vm: "restart" as const } : {}) });
    }
    // كل صفّ بخاناته: الخلية في صفّها الأول، وتحتها خانة `continue` بامتدادها نفسه حتى آخر صفوفها
    // كل خلية في صفوفها بمرور واحد، لا مرور على الخلايا لكل صفّ (الدفعة ٤)
    const byRow: TCell[][] = Array.from({ length: t.ys.length - 1 }, () => []);
    for (const tc of t.cells) for (let r = tc.r; r < tc.r + tc.rs; r++) byRow[r]?.push(tc);
    const rows: Cell[][] = byRow.map((cs, r) => cs.sort((p, q) => p.c - q.c).map((tc) => {
      const c = own.get(tc)!;
      return tc.r === r ? c : { text: "", dir: c.dir, bold: false, size: 0, ...(tc.cs > 1 ? { span: tc.cs } : {}), vm: "continue" as const };
    }));
    const flat = [...own.values()];
    const rtl = flat.filter((c) => c.dir === "rtl").length >= flat.filter((c) => c.text).length / 2;
    // ترتيب منطقي: في الجدول RTL أول خلية هي أقصى اليمين
    blocks.push({ type: "table", y: t.box[3], rtl, xs: t.xs, rows: rtl ? rows.map((r) => [...r].reverse()) : rows });
  }
  for (const l of linesOf(flow, f)) blocks.push({ type: "line", y: l.y, line: { ...l, bold: l.boldFrac(fonts) > 0.8 } });
  blocks.sort((p, q) => q.y - p.y);
  return blocks;
}

// حرفان في ترابط واحد بترتيب منطقي: الأول يتّصل بما بعده، فلا يكون من حروف الوصل يميناً وحده (ا د ذ ر ز و ة ء…)
const RIGHT_ONLY = new Set([..."اأإآٱدذرزوؤةء"]);
/** عدد المستحيلات في كل فرض لترتيب نصّ الترابط. «إعداد خطاب» مقلوب سلفاً، وChrome منطقيّ. */
export function ligVotes(glyphs: Item[]): { asIs: number; rev: number } {
  let asIs = 0, rev = 0;
  for (const g of glyphs) if (!g.mark && g.lig) {
    const L = [...g.lig.replace(/\p{M}/gu, "")].filter((c) => AR.test(c));
    for (let i = 0; i + 1 < L.length; i++) if (RIGHT_ONLY.has(L[i]!)) asIs++;
    const R = [...L].reverse();
    for (let i = 0; i + 1 < R.length; i++) if (RIGHT_ONLY.has(R[i]!)) rev++;
  }
  return { asIs, rev };
}

// ── ٥ و٦ و٧ (ب): الفقرات، والعناوين، والقوائم، واللصق عبر الصفحات ───────────────────────
const LIST = /^(?:[0-9٠-٩]+[.)\-]|[•●▪\-])\s/;
const FINAL = /[.!؟?:]$/;

export type Block =
  | { type: "table"; rows: Cell[][]; rtl: boolean; xs: number[]; page: number; pageFrom: number; endsPage?: boolean }
  | { type: "h" | "p" | "li"; level: number; bold: boolean | undefined; size: number; lines: Line[]; text: string; justify: boolean; rtl: boolean; crossPage?: boolean };
type TextBlock = Extract<Block, { lines: Line[] }>;

export function assemble(pages: PageBlock[][]): Block[] {
  const all = pages.flatMap((p) => p.flatMap((b) => (b.type === "line" ? [b.line] : [])));
  // حجم المتن: الأكثر حروفاً
  const bySize = new Map<number, number>();
  for (const l of all) { const k = Math.round(l.size * 2) / 2; bySize.set(k, (bySize.get(k) ?? 0) + l.text.length); }
  const body = [...bySize.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 12;
  const headSizes = [...bySize.keys()].filter((k) => k > body * 1.12).sort((p, q) => q - p);
  const level = (l: Line) => { const k = Math.round(l.size * 2) / 2; const i = headSizes.indexOf(k); return i < 0 ? 0 : Math.min(i + 1, 3); };
  // خطوة السطر في المتن: الأشيع بين سطرين متتاليين بالحجم نفسه
  const gaps = new Map<number, number>();
  for (const p of pages) { const ls = p.flatMap((b) => (b.type === "line" ? [b.line] : [])); for (let i = 1; i < ls.length; i++) if (Math.abs(ls[i]!.size - ls[i - 1]!.size) < 0.5) { const k = Math.round((ls[i - 1]!.y - ls[i]!.y) * 2) / 2; if (k > 0) gaps.set(k, (gaps.get(k) ?? 0) + 1); } }
  const pitch = [...gaps.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? body * 1.5;
  const bodyLines = all.filter((l) => level(l) === 0);
  const colL = Math.min(...bodyLines.map((l) => l.x0)), colR = Math.max(...bodyLines.map((l) => l.x1));
  const colW = colR - colL;

  const out: Block[] = [];
  let cur: TextBlock | null = null;
  const close = () => { if (cur) { out.push(cur); cur = null; } };
  pages.forEach((p, pi) => {
    let prevLine: Line | null = null;
    for (const b of p) {
      if (b.type === "table") {
        close();
        const last = out[out.length - 1];
        // جدول يكمل جدول الصفحة السابقة: آخر ما فيها، وأعمدته بالمواضع نفسها
        if (last?.type === "table" && last.page === pi - 1 && last.endsPage && last.xs.length === b.xs.length && last.xs.every((x, i) => Math.abs(x - b.xs[i]!) < 2) && p[0] === b) { last.rows.push(...b.rows); last.page = pi; }
        else out.push({ type: "table", rows: b.rows, rtl: b.rtl, xs: b.xs, page: pi, pageFrom: pi });
        (out[out.length - 1] as Extract<Block, { type: "table" }>).endsPage = p[p.length - 1] === b;
        prevLine = null;
        continue;
      }
      const l = b.line, lv = level(l);
      const isList = lv === 0 && LIST.test(l.text);
      const c = cur as TextBlock | null;
      let brk = !c;
      if (c && prevLine) {
        const gap = prevLine.y - l.y;
        if (lv !== c.level || l.bold !== c.bold) brk = true;
        else if (gap > pitch * 1.2 * (l.size / body > 1 ? l.size / body : 1)) brk = true;
        else if (isList) brk = true;
        else if (lv === 0 && FINAL.test(prevLine.text) && prevLine.x0 > colL + 0.12 * colW && l.dir === "rtl") brk = true; // سطر قصير منتهٍ
      }
      if (c && !brk && !prevLine) {
        // أول سطر في الصفحة: يُلصق بفقرة الصفحة السابقة إن انتهت بسطر تامّ بلا علامة نهاية وبالحجم نفسه
        const last = c.lines[c.lines.length - 1]!;
        brk = !(c.type === "p" && lv === 0 && !isList && c.level === 0 && !FINAL.test(last.text) && last.x0 < colL + 0.06 * colW && Math.abs(last.size - l.size) < 0.5);
        if (!brk) c.crossPage = true;
      }
      if (brk) { close(); cur = { type: lv > 0 ? "h" : isList ? "li" : "p", level: lv, bold: l.bold, size: l.size, lines: [], text: "", justify: false, rtl: false }; }
      cur!.lines.push(l);
      prevLine = l;
    }
  });
  close();
  // عنوان بالوزن وحده: كتلة سطر واحد كلها عريضة، والمتن غير عريض، وبحجم المتن
  const bodyBold = bodyLines.filter((l) => l.bold).length > bodyLines.length / 2;
  if (!bodyBold) for (const b of out) if (b.type === "p" && b.lines.length === 1 && b.bold && b.lines[0]!.text.length < 90 && !FINAL.test(b.lines[0]!.text)) { b.type = "h"; b.level = Math.min(headSizes.filter((k) => k > b.size).length + 1, 3); }
  for (const b of out) if (b.type !== "table") {
    b.text = b.lines.map((l) => l.text).join(" ");
    const inner = b.lines.slice(0, -1);
    b.justify = b.type === "p" && inner.length >= 2 && inner.every((l) => Math.abs(l.x0 - colL) < 2 && Math.abs(l.x1 - colR) < 2);
    b.rtl = b.lines.some((l) => l.dir === "rtl");
  }
  return out;
}
