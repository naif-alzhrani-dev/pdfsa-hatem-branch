/**
 * تخطيط الخطاب: من المستند المجرّد إلى صفحات A4 فيها قطع نصّ مشكَّلة بمواضعها. بلا DOM، فالنتيجة واحدة على كل جهاز.
 *
 * - **الاتجاه على مستوى الفقرة** (bidi-js، الاتجاه الأساسي RTL): تُحسب المستويات للفقرة كلها، ثم يُرتَّب كل سطر وحده
 *   (UAX #9، القاعدة L2). فيبقى «REF-2026/114» و«٢٨/٥/١٤٤٨» كما كُتبا في أي موضع من السطر.
 * - **قصّ الأسطر:** عند المسافات وحدها، بأطوال HarfBuzz نفسها التي تُرسم، والمسافات في آخر السطر معلّقة لا تُحسب
 *   (`white-space: pre-wrap` كما في محرّر ProseMirror).
 * - **ارتفاع السطر** كما في CSS: لكل قطعة صندوقٌ ارتفاعه `LINE_HEIGHT × مقاسها` حول خطّ القاعدة، ومعها «دعامة» الفقرة
 *   بالمقاس الافتراضي، والسطر يحيط بها كلها.
 * - **قصّ الصفحات:** سطراً سطراً، والفقرة الطويلة تكمل في الصفحة التالية.
 */
import bidiFactory from "bidi-js";
import type { Face, Glyph } from "./shape";
import { DEFAULT_SETUP, DEFAULT_SIZE, MARGIN_PRESETS, MAX_PAGES, marginsOf, type Align, type Block, type LetterDoc, type LetterFont, type PageSetup, type Paragraph, type Table, type TextBox } from "./model";

const MM = 72 / 25.4;
/** دفعٌ عنصراً عنصراً: النشر وسائطَ نداءٍ محدودٌ بعدد الوسائط (JavaScriptCore نحو 65,536)، والقطع قد تبلغ عدد حروف المتن */
function pushAll<T>(dst: T[], src: readonly T[]) { for (const x of src) dst.push(x); }
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 25 * MM;
export const LINE_HEIGHT = 1.85;
export const PARA_GAP = 3.2 * MM;
export const LIST_INDENT = 9 * MM;
/** حافة الرقم أو النقطة اليمنى، من حافة النصّ اليمنى */
export const MARKER_INSET = 2 * MM;
export const MMPT = MM;
/** حشوة الخلية يميناً ويساراً كما في Word (0.19 سم)، وسُمك حدّ الجدول (حدّ Word المفرد الافتراضي ½ نقطة). letter.css بالمقدارين نفسيهما */
export const CELL_PAD = 1.9 * MM;
export const BORDER_W = 0.5;

/** صندوق بالنقطة من أعلى الصفحة ويسارها */
export interface Box { x: number; y: number; w: number; h: number }

/** الترويسة: بعرض الصفحة، وداخل الإطار ١٢–١٩٨ مم، وارتفاعها ٤٥ مم على الأكثر (مواصفة لمى، البند ٨). */
export function headerRect(setup: PageSetup, page: number): Box | null {
  const hd = setup.header;
  if (!hd || (hd.on === "first" && page > 0)) return null;
  const inset = setup.frame === "none" ? 0 : 12 * MM;
  let w = PAGE_W - 2 * inset;
  let h = (w * hd.img.h) / hd.img.w;
  if (h > 45 * MM) { h = 45 * MM; w = (h * hd.img.w) / hd.img.h; }
  return { x: (PAGE_W - w) / 2, y: inset, w, h };
}

/** خطوط الإطار: مستطيلٌ على وسط كل خطّ، وسُمكه (مواصفة لمى §٥) */
export function frameLines(setup: PageSetup): { inset: number; width: number }[] {
  if (setup.frame === "thin") return [{ inset: 10.15 * MM, width: 0.3 * MM }];
  if (setup.frame === "double") return [{ inset: 10.3 * MM, width: 0.6 * MM }, { inset: 11.95 * MM, width: 0.3 * MM }];
  return [];
}

/** أعلى المتن في الصفحة الأولى مع الشعار: الشعار ١٨–٣٦ مم (ui.ts، placeItem)، والمتن بعده بـ٧ مم */
export const LOGO_TOP = 43 * MM;

/** صندوق المتن في الصفحة: «هوامش الصفحة» (v2 §١)، و٢٥ مم على الأقل مع الإطار، و٩ مم بعد الترويسة، و٤٣ مم في الأولى مع الشعار. */
export function contentBox(setup: PageSetup, page: number): Box {
  const m = marginsOf(setup.margins);
  const side = MARGIN_PRESETS[m.preset].side;
  const min = setup.frame === "none" ? 0 : 25 * MM; // الإطار على ١٠ مم، والمتن بعده بـ١٥
  let top = Math.max(m.top * MM, min);
  const right = Math.max(side * MM, min); // البداية في RTL
  const left = right;
  const bottom = Math.max(m.bottom * MM, min);
  const hd = headerRect(setup, page);
  if (hd) top = Math.max(top, hd.y + hd.h + 9 * MM);
  if (setup.logo && page === 0) top = Math.max(top, LOGO_TOP);
  return { x: left, y: top, w: PAGE_W - left - right, h: PAGE_H - bottom - top };
}

const bidi = bidiFactory();

/**
 * يختار للمحرف وجهه: خط المقطع (`font`، وغيابه خط الخطاب) إن كان المحرف فيه، وإلا البديل (اللاتينية في نوتو نسخ مثلاً).
 * و`strut` (دعامة السطر) من خط الخطاب دائماً.
 */
export interface FacePicker {
  face(cp: number, bold: boolean, font?: LetterFont): Face;
  strut: Face;
}

/** قطعة نصّ بمستوى اتجاه واحد ووجه واحد ومقاس واحد، مشكَّلة. */
export interface Run {
  face: Face;
  size: number;
  /** الحافة اليسرى وخطّ القاعدة، بالنقطة من أعلى الصفحة ويسارها */
  x: number;
  y: number;
  /** بالترتيب البصري من اليسار */
  glyphs: Glyph[];
  /** النصّ المنطقي للقطعة، و`cluster` في الحروف فهارس فيه */
  text: string;
  /** عرضها المرسوم بعد الضبط (للمسافة الممدودة في السطر المضبوط) */
  width: number;
  space: boolean;
  /** موضعها المنطقي في الفقرة */
  start: number;
  rtl: boolean;
}

export interface Page {
  runs: Run[];
  /** أسفل آخر سطر في الصفحة (بالنقطة من أعلاها)، ولصفحة بلا سطر أعلى المتن */
  bottom: number;
  /** نهاية كل كتلة في هذه الصفحة: رقمها في المستند وأسفل آخر سطر منها */
  ends: { block: number; y: number }[];
  /**
   * أول سطر في الصفحة (v2 الدفعة د، مواصفة لمى §٢): الكتلة، ورقم عنصر القائمة، وإزاحة الحرف في فقرته.
   * منه يضع المحرّر حدّ الصفحة في «الكتابة» عند انكسار المحرّك نفسه. ولا يُذكر للأولى ولا لصفحة بلا سطر.
   */
  start?: PageStart;
  /**
   * ما يُرسم فوق المتن ولا يدخل تدفّقه (v2 الدفعة و): التاريخ (`"date"`) ومربّعات النصّ (رقمها في `setup.texts`)،
   * لكلٍّ صندوقه وقطعه. فتُرسم المعاينةُ كلَّ واحد على لوحته فيُسحب بنصّه، ويكتبها PDF نصّاً حقيقياً كالمتن.
   */
  floats: Float[];
  /** خطوط حدود الجداول مستطيلاتٍ ممتلئة بالأسود (بالنقطة من أعلى الصفحة ويسارها) */
  rules: Box[];
}
export interface Float { key: "date" | number; box: Box; runs: Run[] }
/** و`row` لصفحة تبدأ بصفّ جدولٍ كاملٍ (الكتلة جدول): رقمه، فيضع المحرّر حدّ الصفحة قبله (`offset` صفر) */
export interface PageStart { block: number; item?: number; row?: number; offset: number }

interface Piece {
  text: string;
  start: number;
  level: number;
  face: Face;
  size: number;
  glyphs: Glyph[];
  width: number;
  kind: "text" | "space" | "break";
}

interface Line {
  pieces: Piece[];
  /** أعلى السطر إلى خطّ قاعدته، وارتفاعه كاملاً */
  ascent: number;
  height: number;
  last: boolean;
  /** إزاحة أول حرف في السطر من فقرته (ولسطر فارغ: ما بعد فاصل السطر قبله) */
  from: number;
  /** «يمين ويسار»: محاذاة هذا السطر بدل محاذاة الفقرة (الطرف الأيسر النازل إلى سطر وحده) */
  align?: Align;
  /** «يمين ويسار»: الطرف الأيسر على هذا السطر نفسه، على خطّ قاعدته */
  tail?: Line;
}

/** أدنى فراغ بين الطرفين في «يمين ويسار» (بالنقطة)، و`.lt-left` في letter.css بالمقدار نفسه */
export const SPLIT_GAP = 4;

const isMark = (ch: string) => /[\p{M}‌‍ـ]/u.test(ch);

function pieces(p: Paragraph, fonts: FacePicker): Piece[] {
  const text = p.spans.map((s) => s.text).join("");
  if (!text) return [];
  const { levels } = bidi.getEmbeddingLevels(text, "rtl");
  const spanAt: number[] = [];
  p.spans.forEach((s, k) => { for (let i = 0; i < s.text.length; i++) spanAt.push(k); });
  const out: Piece[] = [];
  let prevFace: Face | null = null;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const span = p.spans[spanAt[i]!]!;
    const size = span.size ?? DEFAULT_SIZE;
    const face: Face = isMark(ch) && prevFace ? prevFace : fonts.face(cp, span.bold === true, span.font);
    prevFace = face;
    const kind = ch === "\n" ? "break" : ch === " " ? "space" : "text";
    const last = out.at(-1);
    if (kind === "text" && last && last.kind === "text" && last.level === levels[i] && last.face === face && last.size === size && spanAt[last.start] === spanAt[i]) last.text += ch;
    else out.push({ text: ch, start: i, level: levels[i]!, face, size, glyphs: [], width: 0, kind });
    i += ch.length;
  }
  for (const pc of out) {
    if (pc.kind === "break") continue;
    pc.glyphs = pc.face.shape(pc.text, pc.level % 2 === 1);
    pc.width = (pc.glyphs.reduce((a, g) => a + g.ax, 0) * pc.size) / pc.face.upem;
  }
  return out;
}

/** صندوق CSS السطري لقطعة: ما فوق خطّ القاعدة وما تحته، مع نصف الفراغ بين الأسطر. */
function box(face: Face, size: number, lh = LINE_HEIGHT): [number, number] {
  const a = (face.ascender * size) / face.upem;
  const d = (face.descender * size) / face.upem;
  const half = (lh * size - (a + d)) / 2;
  return [a + half, d + half];
}

function lines(p: Paragraph, width: number, fonts: FacePicker, lh = LINE_HEIGHT, strut = DEFAULT_SIZE): Line[] {
  const all = pieces(p, fonts);
  const out: Line[] = [];
  let cur: Piece[] = [];
  let curW = 0; // بلا المسافات المعلّقة في آخره
  let pending: Piece[] = []; // مسافات بعد آخر كلمة
  let from = 0;
  const finish = (last: boolean) => {
    const [st, sb] = box(fonts.strut, strut, lh);
    let top = st, bottom = sb;
    for (const pc of cur) { const [t, b] = box(pc.face, pc.size, lh); top = Math.max(top, t); bottom = Math.max(bottom, b); }
    out.push({ pieces: cur, ascent: top, height: top + bottom, last, from: cur[0]?.start ?? from });
    cur = []; curW = 0; pending = [];
  };
  for (let i = 0; i < all.length; ) {
    const pc = all[i]!;
    if (pc.kind === "break") { finish(true); from = pc.start + 1; i++; continue; }
    if (pc.kind === "space") { pending.push(pc); i++; continue; }
    let j = i; // الكلمة: قطع نصّ متتالية بلا مسافة
    let w = 0;
    while (j < all.length && all[j]!.kind === "text") w += all[j++]!.width;
    const gap = pending.reduce((a, s) => a + s.width, 0);
    const hasWord = cur.some((c) => c.kind === "text");
    if (hasWord && curW + gap + w > width + 0.01) { finish(false); }
    else { pushAll(cur, pending); curW += gap; }
    pending = [];
    for (let k = i; k < j; k++) cur.push(all[k]!);
    curW += w;
    i = j;
  }
  if (cur.length || pending.length || !out.length || all.at(-1)?.kind === "break") finish(true);
  return out;
}

/** عرض السطر المرسوم: بلا المسافات المعلّقة في آخره (كما في `place`) */
const naturalWidth = (l: Line) => {
  const ps = [...l.pieces];
  while (ps.length && ps.at(-1)!.kind === "space") ps.pop();
  return ps.reduce((a, p) => a + p.width, 0);
};

/** مقاطع الفقرة بين موضعين من نصّها */
function sliceSpans(p: Paragraph, from: number, to: number): Paragraph {
  const spans: Paragraph["spans"] = [];
  let at = 0;
  for (const s of p.spans) {
    const a = Math.max(from, at), b = Math.min(to, at + s.text.length);
    if (b > a) spans.push({ ...s, text: s.text.slice(a - at, b - at) });
    at += s.text.length;
  }
  return { spans };
}

/**
 * أسطر الفقرة. ومع «يمين ويسار» (مواصفة لمى §٧): ما قبل الانقسام فقرةٌ يمينية، وما بعده يُوضع عند يسار آخر سطر منها
 * إن اتّسع له مع `SPLIT_GAP`، وإلا نزل إلى سطر وحده (أو أسطر) من اليسار. ولكلٍّ اتجاهه وحده، كالعنصر العائم في المحرّر.
 */
function paraLines(p: Paragraph, width: number, fonts: FacePicker): Line[] {
  const text = p.spans.map((s) => s.text).join("");
  if (p.split === undefined || p.split <= 0 || p.split > text.length) return lines(p, width, fonts);
  const head = lines(sliceSpans(p, 0, p.split), width, fonts);
  if (p.split === text.length) return head;
  const tail = lines(sliceSpans(p, p.split, text.length), width, fonts).map((l): Line => ({ ...l, last: true, align: "left", from: l.from + p.split! }));
  for (const l of tail) for (const pc of l.pieces) pc.start += p.split; // موضعها في الفقرة كلها
  const last = head.at(-1)!;
  const t = tail[0]!;
  if (tail.length === 1 && naturalWidth(last) + SPLIT_GAP + naturalWidth(t) <= width + 0.01) {
    const ascent = Math.max(last.ascent, t.ascent);
    const below = Math.max(last.height - last.ascent, t.height - t.ascent);
    head[head.length - 1] = { ...last, ascent, height: ascent + below, tail: t };
    return head;
  }
  return [...head, ...tail];
}

/** UAX #9 L2: يقلب كل تتابع مستواه ≥ م، من أعلى مستوى إلى أدنى مستوى فردي. */
function visual(ps: Piece[]): Piece[] {
  const out = [...ps];
  if (!out.length) return out;
  const max = out.reduce((m, p) => Math.max(m, p.level), 0);
  const minOdd = out.reduce((m, p) => (p.level % 2 === 1 ? Math.min(m, p.level) : m), max + 1);
  for (let lv = max; lv >= Math.max(1, minOdd); lv--) {
    for (let i = 0; i < out.length; ) {
      if (out[i]!.level < lv) { i++; continue; }
      let j = i;
      while (j < out.length && out[j]!.level >= lv) j++;
      for (let a = i, b = j - 1; a < b; a++, b--) { const t = out[a]!; out[a] = out[b]!; out[b] = t; }
      i = j;
    }
  }
  return out;
}

/** يضع السطر أفقياً: الحافة اليمنى للمحتوى `right`، والعرض `width`. */
function place(line: Line, align: Align, right: number, width: number, y: number): Run[] {
  const ps = [...line.pieces];
  while (ps.length && ps.at(-1)!.kind === "space") ps.pop(); // المسافات المعلّقة (UAX #9 L1: مستوى الفقرة، ولا تُرسم)
  const vis = visual(ps);
  const natural = vis.reduce((a, p) => a + p.width, 0);
  const spaces = vis.filter((p) => p.kind === "space").length;
  const justify = align === "justify" && !line.last && spaces > 0 && natural < width;
  const extra = justify ? (width - natural) / spaces : 0;
  const total = justify ? width : natural;
  let x = align === "center" ? right - width + (width - total) / 2 : align === "left" ? right - width : right - total;
  const runs = vis.map((p) => {
    const w = p.width + (p.kind === "space" ? extra : 0);
    const run: Run = { face: p.face, size: p.size, x, y, glyphs: p.glyphs, text: p.text, width: w, space: p.kind === "space", start: p.start, rtl: p.level % 2 === 1 };
    x += w;
    return run;
  });
  return runs;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const markerText = (ordered: boolean, n: number) => (ordered ? `${String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]!)}.` : "•");

/**
 * التاريخ (مواصفة لمى v2 §٥، قرار نايف ٢٠٢٦/١١/١٢): 11pt، وبعده 8 مم، في أي نمط.
 * «كلاهما» بـ«سطر واحد»: «التاريخ: الهجري» يميناً و«الموافق: الميلادي» يساراً. وبـ«يمين» أو «يسار»: سطران بلا تسميات في جهتهما.
 * وتقويم واحد: «التاريخ: …» في جهته («سطر واحد» معه يُعدّ يميناً). وبلا هجري (خارج جدول أم القرى) يُرسم الميلادي وحده،
 * فلا يبقى «التاريخ: » فارغاً. يعيد ارتفاعه مع الفراغ بعده.
 * و`box` موضعه: أول المتن، أو حيث حُرِّك (`date.at`) بعرض المتن نفسه.
 */
export const DATE_SIZE = 11;
export const DATE_GAP = 8 * MM;
function dateRuns(setup: PageSetup, box: Box, fonts: FacePicker, out: Run[]): number {
  const d = setup.date!;
  const right = box.x + box.w;
  const cal = !d.hijri ? "gregorian" : d.cal ?? "both";
  const form = d.form ?? "line";
  const line = (t: string) => lines({ spans: [{ text: t, size: DATE_SIZE }] }, box.w, fonts)[0]!;
  if (cal === "both" && form === "line") {
    const a = line(`التاريخ: ${d.hijri}`);
    const b = line(`الموافق: ${d.gregorian}`);
    const asc = Math.max(a.ascent, b.ascent);
    pushAll(out, place({ ...a, last: true }, "right", right, box.w, box.y + asc));
    pushAll(out, place({ ...b, last: true }, "left", right, box.w, box.y + asc));
    return Math.max(a.height, b.height) + DATE_GAP;
  }
  const texts = cal === "both" ? [d.hijri, d.gregorian] : [`التاريخ: ${cal === "hijri" ? d.hijri : d.gregorian}`];
  const side = form === "left" ? "left" : "right";
  let y = 0;
  for (const t of texts) {
    const l = line(t);
    pushAll(out, place({ ...l, last: true }, side, right, box.w, box.y + y + l.ascent));
    y += l.height;
  }
  return y + DATE_GAP;
}

/**
 * مربّع النصّ (v2 الدفعة و): كتله أسطراً بعرضه من أعلاه، كالمتن (المحاذاة والقوائم و«يمين ويسار» وفراغ الفقرات) بلا قصّ صفحات.
 * وارتفاعه أسفل آخر سطر فيه.
 */
function textFloat(t: TextBox, key: number, fonts: FacePicker): Float {
  const box: Box = { x: t.fx * PAGE_W, y: t.fy * PAGE_H, w: t.fw * PAGE_W, h: 0 };
  const runs: Run[] = [];
  const right = box.x + box.w;
  let y = 0;
  const put = (ls: Line[], align: Align, r: number, w: number, marker?: string) => ls.forEach((l, k) => {
    const base = box.y + y + l.ascent;
    if (marker && k === 0) pushAll(runs, place(lines({ align: "right", spans: [{ text: marker }] }, box.w, fonts)[0]!, "right", right - MARKER_INSET, box.w, base));
    pushAll(runs, place(l, l.align ?? align, right - r, w, base));
    if (l.tail) pushAll(runs, place(l.tail, "left", right - r, w, base));
    y += l.height;
  });
  t.blocks.forEach((b, i) => {
    if (i > 0) y += PARA_GAP;
    if (b.type === "paragraph") put(paraLines(b, box.w, fonts), b.align ?? "right", 0, box.w);
    else if (b.type === "list") b.items.forEach((it, k) => put(paraLines(it, box.w - LIST_INDENT, fonts), it.align ?? "right", LIST_INDENT, box.w - LIST_INDENT, markerText(b.ordered, k + 1)));
  });
  return { key, box: { ...box, h: y }, runs };
}

export function layout(doc: LetterDoc, fonts: FacePicker): Page[] {
  const setup = doc.page ?? DEFAULT_SETUP;
  const pages: Page[] = [];
  let y = 0; // من أعلى صندوق المتن في الصفحة الحالية
  let used = false; // في الصفحة الحالية سطرٌ واحد على الأقل
  let bx = contentBox(setup, 0);
  const newPage = () => {
    if (pages.length >= MAX_PAGES) throw new Error(`letter: over ${MAX_PAGES} pages`);
    bx = contentBox(setup, pages.length);
    pages.push({ runs: [], bottom: bx.y, ends: [], floats: [], rules: [] });
    y = 0; used = false;
  };
  newPage();
  if (setup.date) {
    // في موضعه الأصلي يأخذ مكانه من المتن، ومحرَّكاً لا يأخذ شيئاً فيصعد المتن (الدفعة و)
    const at = setup.date.at;
    const db: Box = at ? { x: at.fx * PAGE_W, y: at.fy * PAGE_H, w: bx.w, h: 0 } : { ...bx };
    const runs: Run[] = [];
    const dh = dateRuns(setup, db, fonts, runs);
    pages[0]!.floats.push({ key: "date", box: { ...db, h: dh - DATE_GAP }, runs });
    if (!at) { y = dh; pages[0]!.bottom = bx.y + y - DATE_GAP; }
  }
  const cw = bx.w;
  const put = (ls: Line[], align: Align, r: number, w: number, at: Omit<PageStart, "offset">, marker?: string) => {
    ls.forEach((l, k) => {
      if (used && y + l.height > bx.h + 0.01) newPage();
      const base = bx.y + y + l.ascent;
      const page = pages.at(-1)!;
      if (!used && pages.length > 1) page.start = { ...at, offset: l.from };
      if (marker && k === 0) { // الرقم أو النقطة قبل السطر في PDF: يُقرأ أولاً وإن فصله العارض عن السطر
        const m = lines({ align: "right", spans: [{ text: marker }] }, cw, fonts)[0]!;
        pushAll(page.runs, place(m, "right", bx.x + cw - MARKER_INSET, cw, base));
      }
      pushAll(page.runs, place(l, l.align ?? align, bx.x + cw - r, w, base));
      if (l.tail) pushAll(page.runs, place(l.tail, "left", bx.x + cw - r, w, base));
      y += l.height;
      used = true;
      page.bottom = bx.y + y;
    });
  };
  /**
   * الجدول («تحرير الملف»، مواصفة لمى §٣): الأعمدة من `widths` بعرض المتن، والخلية الأولى يميناً مع `rtl`. والصفّ لا يُقسم بين
   * صفحتين: ما لا يتّسع له الباقي من الصفحة يبدأ في التالية. وصفٌّ أطول من صفحة كاملة يكمل كلُّ خليةٍ منه أسطرَها في التالية
   * (قرار سامي، الدفعة ٣: لا يُقصّ نصّ). والحدود مستطيلات `rules` حول كل خلية في كل صفحة يقع فيها الصفّ.
   */
  const tableAt = (t: Table, block: number) => {
    const edges = [0];
    for (const w of t.widths) edges.push(edges.at(-1)! + w * cw);
    for (const [ri, row] of t.rows.entries()) {
      let col = 0;
      const cells = row.map((cell) => {
        const a = col, z = (col += cell.span ?? 1);
        const w = edges[z]! - edges[a]!;
        const left = t.rtl ? bx.x + cw - edges[z]! : bx.x + edges[a]!;
        const inner = Math.max(1, w - 2 * CELL_PAD - BORDER_W);
        const items: { l: Line; dy: number; align: Align }[] = [];
        let h = 0;
        cell.paras.forEach((p, k) => {
          if (k > 0) h += PARA_GAP;
          for (const l of paraLines(p, inner, fonts)) { items.push({ l, dy: h, align: p.align ?? "right" }); h += l.height; }
        });
        return { left, w, inner, items, h };
      });
      const rowH = cells.reduce((m, c) => Math.max(m, c.h), -Infinity) + BORDER_W;
      if (used && y + rowH > bx.h + 0.01 && rowH <= bx.h + 0.01) newPage();
      const shift = cells.map(() => 0);
      let begun = false; // وُضع من الصفّ سطر
      for (;;) {
        const page = pages.at(-1)!;
        if (!begun && !used && pages.length > 1) page.start = { block, row: ri, offset: 0 }; // صفٌّ يبدأ الصفحة: حدّها قبله في «الكتابة»
        const room = bx.h - y - BORDER_W;
        let segH = 0, left = false, any = false;
        cells.forEach((c, ci) => {
          const from = shift[ci]!;
          let n = 0;
          while (n < c.items.length && (c.items[n]!.dy - from + c.items[n]!.l.height <= room + 0.01 || (n === 0 && !used && c.items[0]!.dy >= from))) n++;
          const now = c.items.splice(0, n);
          for (const it of now) {
            const base = bx.y + y + BORDER_W / 2 + it.dy - from + it.l.ascent;
            const right = c.left + c.w - CELL_PAD - BORDER_W / 2;
            pushAll(page.runs, place(it.l, it.l.align ?? it.align, right, c.inner, base));
            if (it.l.tail) pushAll(page.runs, place(it.l.tail, "left", right, c.inner, base));
            any = true;
          }
          if (c.items.length) { left = true; segH = Math.max(segH, now.length ? now.at(-1)!.dy - from + now.at(-1)!.l.height : 0); shift[ci] = c.items[0]!.dy; }
          else segH = Math.max(segH, c.h - from);
        });
        if (any) begun = true;
        if (!any && used) { newPage(); continue; } // لم يتّسع الباقي لسطر واحد من أي خلية
        const top = bx.y + y, hh = segH + BORDER_W, bw = BORDER_W;
        if (t.borders) for (const c of cells) page.rules.push(
          { x: c.left - bw / 2, y: top - bw / 2, w: c.w + bw, h: bw }, { x: c.left - bw / 2, y: top + hh - bw / 2, w: c.w + bw, h: bw },
          { x: c.left - bw / 2, y: top - bw / 2, w: bw, h: hh + bw }, { x: c.left + c.w - bw / 2, y: top - bw / 2, w: bw, h: hh + bw });
        y += hh;
        used = true;
        page.bottom = bx.y + y;
        if (!left) break;
        newPage();
      }
    }
  };
  (doc.blocks as Block[]).forEach((b, i) => {
    if (b.type === "pageBreak") { if (used) newPage(); return; }
    if (b.type === "table") tableAt(b, i);
    else if (b.type === "paragraph") put(paraLines(b, cw, fonts), b.align ?? "right", 0, cw, { block: i });
    else b.items.forEach((it, k) => put(paraLines(it, cw - LIST_INDENT, fonts), it.align ?? "right", LIST_INDENT, cw - LIST_INDENT, { block: i, item: k }, markerText(b.ordered, k + 1)));
    const pg = pages.at(-1)!;
    pg.ends.push({ block: i, y: pg.bottom });
    y += PARA_GAP;
  });
  // المربّعات فوق المتن في صفحاتها، وما اختفت صفحته إلى آخر صفحة بكسوره نفسها (كالعناصر الحرّة، البند ١٣)
  (setup.texts ?? []).forEach((t, i) => pages[Math.min(t.page, pages.length - 1)]!.floats.push(textFloat(t, i, fonts)));
  return pages;
}
