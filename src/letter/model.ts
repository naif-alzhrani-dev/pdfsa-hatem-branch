/**
 * المستند المجرّد للخطاب: ما يحوّله المحرّك (`engine.ts`) إلى PDF. بنيته قريبة من JSON الذي يُخرجه TipTap
 * (فقرة فيها مقاطع نصّ بعلامات، وقوائم عناصرها فقرات، وفاصل صفحة)، فيكون التحويل منه في الدفعة L2 دالّة صغيرة.
 */
import { FONT_KEYS, type FontKey } from "./fonts";
import type { SysRef } from "./system-fonts";

/** خط الخطاب: من الستّة، أو من خطوط الجهاز في برنامج ويندوز بعائلته ووجهه (الدفعة ٢ من W14) */
export type LetterFont = FontKey | SysRef;
export const isSysFont = (f: LetterFont): f is SysRef => typeof f === "object";
/**
 * خطٌّ من القائمة المسموحة أو null (شرط 🕵️ أمين): مفتاح من `FONT_KEYS`، أو خط جهاز بعائلة غير فارغة،
 * واسما العائلة والوجه مقصوصان إلى ١٢٨. ويقرأ به `normalizeDoc` و`toLetterDoc` (src/letter/doc.ts).
 */
export function asLetterFont(v: unknown): LetterFont | null {
  if (typeof v === "string") return FONT_KEYS.includes(v as FontKey) ? (v as FontKey) : null;
  if (typeof v !== "object" || v === null) return null;
  const r = v as Partial<SysRef>;
  if (typeof r.family !== "string" || typeof r.face !== "string") return null;
  const family = r.family.slice(0, 128);
  return family ? { family, face: r.face.slice(0, 128) } : null;
}
/** مفتاحٌ نصّي للخط (للمقارنة والذاكرة) */
export const fontId = (f: LetterFont): string => (isSysFont(f) ? `sys:${f.family}\u0000${f.face}` : f);

export type Align = "right" | "center" | "left" | "justify";
export const ALIGNS: Align[] = ["right", "center", "left", "justify"];

/** مقطع نصّ بتنسيق واحد. `\n` داخل النصّ سطر جديد في الفقرة نفسها (hardBreak في TipTap). */
export interface Span {
  text: string;
  bold?: boolean;
  /** بالنقطة (pt)، من ١١ إلى ٢٤. الافتراضي `DEFAULT_SIZE`. */
  size?: number;
  /** خط المقطع (الدفعة ٣، قرار نايف ٢٠٢٦/١١/١٣ «العنوان بخط والنص بخط»). غيابه = يرث `LetterDoc.font`. */
  font?: LetterFont;
}

export interface Paragraph {
  align?: Align;
  /**
   * «يمين ويسار» (مواصفة لمى §٧): موضع الانقسام في نصّ الفقرة (بوحدات النصّ المجموع من المقاطع). ما قبله يميناً،
   * وما بعده عند يسار آخر سطر منه، أو في سطر وحده من اليسار إن لم يتّسع. والمحاذاة معه «right» دائماً.
   */
  split?: number;
  spans: Span[];
}

/** خلية جدول: امتدادها أفقياً بالأعمدة (الافتراضي ١، وصفّ العنوان المدموج هو الغالب في ملفات Word)، وفقراتها */
export interface TableCell { span?: number; paras: Paragraph[] }
/**
 * جدول بسيط («تحرير الملف»، الدفعة ٣، مواصفة لمى §٣): أعمدته نسب من عرض المتن (`widths`، مجموعها ١)، و`rtl` الخلية الأولى
 * يميناً (`w:bidiVisual`)، و`borders` حدود Word أو بلا حدود. بلا دمج رأسي ولا جدول داخل جدول ولا صورة، وفي سقوف `tableFits`.
 */
export interface Table { widths: number[]; rtl: boolean; borders: boolean; rows: TableCell[][] }

export type Block =
  | ({ type: "paragraph" } & Paragraph)
  | { type: "list"; ordered: boolean; items: Paragraph[] }
  | ({ type: "table" } & Table)
  | { type: "pageBreak" };

/** فقرات الكتلة كلها (المتن، وعناصر القائمة، وخلايا الجدول)، للعدّ والخطوط */
export const blockParas = (b: Block): Paragraph[] =>
  b.type === "paragraph" ? [b] : b.type === "list" ? b.items : b.type === "table" ? b.rows.flatMap((r) => r.flatMap((c) => c.paras)) : [];

/** درجة «هوامش الصفحة» (قرار نايف ٢٠٢٦/١١/١٢، مواصفة لمى v2 §١): تحلّ محلّ «النمط» (رسمي/معاصر). */
export type MarginPreset = "normal" | "narrow" | "wide";
/** الدرجات بالمليمتر: «عادية» هوامش «رسمي» القديمة، و«ضيّقة» و«واسعة» كـ«ضيق» و«عريض» في Word */
export const MARGIN_PRESETS: Record<MarginPreset, { top: number; bottom: number; side: number }> = {
  normal: { top: 25, bottom: 25, side: 25 },
  narrow: { top: 12.7, bottom: 12.7, side: 12.7 },
  wide: { top: 25, bottom: 25, side: 50.8 },
};
export const MARGIN_PRESET_KEYS: MarginPreset[] = ["normal", "narrow", "wide"];
/** مدى الأعلى والأسفل المخصّصين بالمليمتر، ومجموعهما يُبقي للمتن ٨٠ مم على الأقل (٢٩٧ − ٢١٧) */
export const MARGIN_RANGE = { top: [10, 150], bottom: [10, 100], sum: 217 } as const;
/** الجانبان من الدرجة دائماً، والأعلى والأسفل منها أو مخصّصان (لتبدأ الكتابة تحت رسم الترويسة في صورة الخلفية) */
export interface Margins { preset: MarginPreset; top: number; bottom: number }
/** تقويم التاريخ: «كلاهما» و«هجري» و«ميلادي» */
export type DateCal = "both" | "hijri" | "gregorian";
/** شكل التاريخ: «سطر واحد» (الهجري يميناً والميلادي يساراً بالتسميتين)، أو سطران يميناً أو يساراً */
export type DateForm = "line" | "right" | "left";
export type FrameKind = "none" | "thin" | "double";

/** صورة PNG أو JPEG يرسمها المحرّك كما هي (توقيع، ختم، شعار، صورة، ترويسة). */
export interface LetterImage {
  bytes: Uint8Array;
  type: "png" | "jpg";
  /** أبعادها بالبكسل (للنسبة وحدها) */
  w: number;
  h: number;
}

/** عنصر حرّ على صفحة: كسور من عرض الصفحة وارتفاعها من الأعلى والأيسر، كـ`ItemData` في «تحرير ملف». */
export interface FreeItem {
  /** رقم الصفحة من الصفر. وإن لم تبقَ الصفحة نُقل إلى آخر صفحة بكسوره نفسها (مواصفة لمى، البند ١٣) */
  page: number;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  img: LetterImage;
}

/**
 * مربّع نصّ (v2 الدفعة و، طلب نايف «يستطيع تحديد نص وتحريكه في الصفحه كما يريد»): عنصر حرّ نصّه حقيقي بخطّ الخطاب،
 * يُلفّ داخل عرضه `fw`، وارتفاعه من نصّه. يُكتب في «الكتابة»، ويُسحب ويُغيَّر عرضه في «معاينة الصفحة».
 * ونصّه كتل المتن نفسها بلا فاصل صفحة.
 */
export interface TextBox {
  page: number;
  fx: number;
  fy: number;
  fw: number;
  blocks: Block[];
}
/** حدّ المربّعات في الخطاب، ولكلٍّ حدّ نصّه `TEXT_BOX_MAX_CHARS` (يُرفض ما فوقهما في المحرّك) */
export const MAX_TEXT_BOXES = 20;

/** شكل الصفحة (مواصفة لمى §٥ والملحق): النمط والإطار والتاريخ والترويسة والعناصر الحرّة. */
export interface PageSetup {
  /** الافتراضي «عادية». والخطاب القديم بـ`style` («رسمي» أو «معاصر») يُقرأ «عادية» (`normalizeDoc`) */
  margins?: Margins;
  frame: FrameKind;
  /** صورة الخلفية: تملأ كل صفحة بالتغطية والقصّ في الوسط، تحت الترويسة والإطار والنصّ، وتُضمَّن مرّة واحدة */
  background?: LetterImage;
  /**
   * التاريخ في أول الصفحة الأولى (اختياري، قرار نايف ٢٠٢٦/١١/١٢)، نصّاه جاهزان: «٢٨ جمادى الأولى ١٤٤٨هـ» و«٨ نوفمبر ٢٠٢٦م».
   * `cal` التقويم (الافتراضي «كلاهما»)، و`form` الشكل (الافتراضي «سطر واحد»، ومع تقويم واحد يُعدّ «يميناً»).
   */
  date?: { hijri: string; gregorian: string; cal?: DateCal; form?: DateForm; at?: DateAt };
  header?: { img: LetterImage; on: "first" | "all" };
  /** في الخطاب شعار (يُدرج أعلى الصفحة الأولى، ١٨–٣٦ مم)، فيبدأ المتن فيها من ٤٣ مم لا ٢٥ (موافقة نايف على عيّنة L2) */
  logo?: boolean;
  items: FreeItem[];
  /** مربّعات النصّ، بترتيب إضافتها */
  texts?: TextBox[];
}
/**
 * التاريخ المحرَّك في «معاينة الصفحة» (v2 الدفعة و): حافّته اليسرى وأعلاه كسوراً من الصفحة الأولى، وعرضه عرض متنها.
 * فيخرج من التدفّق ويصعد المتن. وبلا `at` يبقى في موضعه الأصلي أول المتن.
 */
export interface DateAt { fx: number; fy: number }

export interface LetterDoc {
  /** خط الخطاب كله، من الثمانية أو من خطوط الجهاز. وللمقطع خطّه إن خُصّ (`Span.font`). */
  font: LetterFont;
  blocks: Block[];
  page?: PageSetup;
}

/**
 * حدّ النصّ (مواصفة لمى البند ١٢، وملاحظة 🕵️ أمين ن٢): يُرفض ما فوقه في المحرّك نفسه لا في الواجهة وحدها.
 * 12000 بقرار نايف (٢٠٢٦/١١/١٤) لـ«تحرير الملف» (كان 3000)، بشروط أمين: المربّع بحدّه، و`MAX_PAGES` باقٍ. docs/logs/edit-file-build-2.md
 * ثم 50000 بقرار نايف (٢٠٢٦/١١/١٦، «ارفع حد الأحرف إلى ٥٠ الف») لاتفاقية من ١٠ صفحات رُفضت بـ16046 حرفاً، والسقوف الأخرى باقية. docs/logs/letter-limit-50k.md
 */
export const MAX_CHARS = 50000;
export const MAX_PAGES = 20;
/** حدّ نصّ المربّع، منفصلاً عن حدّ المتن (شرط 🕵️ أمين لرفع `MAX_CHARS`، docs/logs/edit-file-build-2.md). والمحرّر يأخذه لمحرّر المربّع */
export const TEXT_BOX_MAX_CHARS = 3000;
export const DEFAULT_SETUP: PageSetup = { frame: "none", items: [] };

/** سقوف 🕵️ أمين على «تحرير الملف» (docs/logs/edit-file-build-2.md): كتل المتن، والجداول. والمحوّل يُفرد نصّ الجدول الزائد فقرات */
export const MAX_BLOCKS = 2000;
/** `cells` = `cols` × `rows`، فلا يبلغه جدول صحيح الـ`span` دون أن يتجاوز أحدهما؛ يبقى كما اشترطه أمين */
export const TABLE_LIMITS = { cols: 8, rows: 50, tables: 12, cells: 400, cellParas: 20 } as const;
/** شكل جدول للفحص: لكل خلية امتدادها (الافتراضي ١) وعدد فقراتها */
export interface TableShape { cols: number; widths: readonly number[]; rows: readonly (readonly { span?: number; paras: number }[])[] }
/**
 * جدول في سقوفه: الأعمدة والصفوف والخلايا وفقرات الخلية، و`widths` بعدد الأعمدة وكلٌّ في (0، 1] ومجموعها ١،
 * و`span` عدد صحيح موجب ومجموعه في كل صفّ = الأعمدة. للمحوّل اليوم، ولكتلة الجدول في `normalizeDoc` حين تدخل النموذج.
 */
export function tableFits(t: TableShape): boolean {
  const L = TABLE_LIMITS;
  if (!Number.isInteger(t.cols) || t.cols < 1 || t.cols > L.cols) return false;
  if (t.rows.length < 1 || t.rows.length > L.rows) return false;
  if (t.widths.length !== t.cols || t.widths.some((w) => !(Number.isFinite(w) && w > 0 && w <= 1))) return false;
  if (Math.abs(t.widths.reduce((a, w) => a + w, 0) - 1) > 1e-9) return false;
  let cells = 0;
  for (const r of t.rows) {
    let sum = 0;
    for (const c of r) {
      const span = c.span ?? 1;
      if (!Number.isInteger(span) || span < 1 || !Number.isInteger(c.paras) || c.paras < 0 || c.paras > L.cellParas) return false;
      sum += span;
    }
    if (sum !== t.cols) return false;
    cells += r.length;
  }
  return cells <= L.cells;
}

/** خطأ حدٍّ من المحرّك (الحروف، والصفحات، والكتل، والمربّعات)، لا عطل: فتعرض الواجهة «تجاوز الحدّ» (`SL.overLimit`) */
export const isLimitError = (e: unknown): boolean => e instanceof Error && /^letter: (?:text (?:box )?)?over \d+/.test(e.message);

/** عدد حروف النصّ بلا فواصل الأسطر، والمحرّر يعدّ بالدالّة نفسها (`src/letter/doc.ts`) */
export const charCount = (doc: Pick<LetterDoc, "blocks">): number =>
  doc.blocks.reduce((n, b) => n + blockParas(b).reduce((m, p) => m + p.spans.reduce((k, s) => k + String(s.text).replace(/\n/g, "").length, 0), 0), 0);

export const MIN_SIZE = 11;
export const MAX_SIZE = 24;
export const DEFAULT_SIZE = 13;

/** الأعلى والأسفل في مداهما (المجموع ≤ ٢١٧ يُنقص الأسفل)، وما ليس رقماً من الدرجة. */
export function marginsOf(m?: Margins): Margins {
  const preset = m?.preset ?? "normal";
  const P = MARGIN_PRESETS[preset];
  const clamp = (v: unknown, d: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : d));
  const top = clamp(m?.top, P.top, MARGIN_RANGE.top);
  const bottom = Math.min(clamp(m?.bottom, P.bottom, MARGIN_RANGE.bottom), MARGIN_RANGE.sum - top);
  return { preset, top, bottom };
}

/** يرفض ما ليس في القوائم المسموحة (الخط والمحاذاة)، ويحصر المقاس في ١١–٢٤. */
export function normalizeDoc(doc: LetterDoc): LetterDoc {
  const checked = (v: unknown): LetterFont => {
    const f = asLetterFont(v);
    if (!f) throw new Error(`letter: unknown font ${String(v)}`);
    return f;
  };
  const font = checked(doc.font);
  const para = (p: Paragraph): Paragraph => {
    if (p.align !== undefined && !ALIGNS.includes(p.align)) throw new Error(`letter: unknown align ${String(p.align)}`);
    const len = p.spans.reduce((n, s) => n + String(s.text).length, 0);
    const split = p.split !== undefined && Number.isInteger(p.split) && p.split > 0 && p.split <= len ? p.split : undefined;
    return {
      align: split !== undefined ? "right" : p.align ?? "right",
      ...(split !== undefined ? { split } : {}),
      spans: p.spans.map((s) => ({
        text: String(s.text),
        bold: s.bold === true,
        size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number.isFinite(s.size) ? Number(s.size) : DEFAULT_SIZE)),
        ...(s.font !== undefined ? { font: checked(s.font) } : {}),
      })),
    };
  };
  if (charCount(doc) > MAX_CHARS) throw new Error(`letter: text over ${MAX_CHARS}`);
  if (doc.blocks.length > MAX_BLOCKS) throw new Error(`letter: over ${MAX_BLOCKS} blocks`);
  const setup = doc.page ?? DEFAULT_SETUP;
  // «النمط» زال (v2 الدفعة ج): `style` في خطاب قديم لا يُرفض ولا يُقرأ، وهوامشه «عادية» ما لم تكن فيه `margins`
  const mg = setup.margins;
  if (mg && !MARGIN_PRESET_KEYS.includes(mg.preset)) throw new Error(`letter: unknown margins ${String(mg.preset)}`);
  if (!["none", "thin", "double"].includes(setup.frame)) throw new Error(`letter: unknown frame ${String(setup.frame)}`);
  const img = (i: LetterImage): LetterImage => {
    if (i.type !== "png" && i.type !== "jpg") throw new Error("letter: image type");
    return i;
  };
  const f = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const texts = setup.texts ?? [];
  if (texts.length > MAX_TEXT_BOXES) throw new Error(`letter: over ${MAX_TEXT_BOXES} text boxes`);
  for (const t of texts) if (charCount(t) > TEXT_BOX_MAX_CHARS) throw new Error(`letter: text box over ${TEXT_BOX_MAX_CHARS}`);
  if (doc.blocks.filter((b) => b.type === "table").length > TABLE_LIMITS.tables) throw new Error(`letter: over ${TABLE_LIMITS.tables} tables`);
  /** الجدول في سقوف `tableFits` (أمين، docs/logs/edit-file-build-2.md)، وما خالفها يُرفض لا يُقصّ */
  const table = (t: Table): Block => {
    const rows = Array.isArray(t.rows) ? t.rows : [];
    const widths = Array.isArray(t.widths) ? t.widths.map(Number) : [];
    const shape = rows.map((r) => (Array.isArray(r) ? r : []).map((c) => ({ span: c.span, paras: Array.isArray(c.paras) ? c.paras.length : -1 })));
    if (!tableFits({ cols: widths.length, widths, rows: shape })) throw new Error("letter: table shape");
    return { type: "table", widths, rtl: t.rtl === true, borders: t.borders === true, rows: rows.map((r) => r.map((c) => ({ ...((c.span ?? 1) > 1 ? { span: c.span } : {}), paras: c.paras.length ? c.paras.map(para) : [{ align: "right", spans: [] }] }))) };
  };
  const block = (b: Block): Block => {
    if (b.type === "pageBreak") return { type: "pageBreak" };
    if (b.type === "table") return table(b);
    if (b.type === "list") return { type: "list", ordered: b.ordered === true, items: b.items.map(para) };
    if (b.type === "paragraph") return { type: "paragraph", ...para(b) };
    throw new Error(`letter: unknown block ${String((b as { type: unknown }).type)}`);
  };
  return {
    font,
    page: {
      margins: marginsOf(mg),
      frame: setup.frame,
      background: setup.background ? img(setup.background) : undefined,
      date: setup.date ? {
        hijri: String(setup.date.hijri), gregorian: String(setup.date.gregorian),
        cal: setup.date.cal === "hijri" || setup.date.cal === "gregorian" ? setup.date.cal : "both",
        form: setup.date.form === "right" || setup.date.form === "left" ? setup.date.form : "line",
        ...(setup.date.at ? { at: { fx: f(setup.date.at.fx), fy: f(setup.date.at.fy) } } : {}),
      } : undefined,
      header: setup.header ? { img: img(setup.header.img), on: setup.header.on === "all" ? "all" : "first" } : undefined,
      logo: setup.logo === true ? true : undefined,
      items: setup.items.map((it) => ({ page: Math.max(0, Math.floor(it.page) || 0), fx: f(it.fx), fy: f(it.fy), fw: f(it.fw), fh: f(it.fh), img: img(it.img) })),
      texts: texts.map((t) => ({ page: Math.max(0, Math.floor(t.page) || 0), fx: f(t.fx), fy: f(t.fy), fw: f(t.fw), blocks: t.blocks.filter((b) => b.type !== "table").map(block).filter((b) => b.type !== "pageBreak") })),
    },
    blocks: doc.blocks.map(block),
  };
}

/** الخطوط المستعملة في الخطاب بلا تكرار: خطّه أولاً، ثم خطوط المقاطع في المتن والمربّعات */
export function usedFonts(doc: LetterDoc): LetterFont[] {
  const out = new Map<string, LetterFont>([[fontId(doc.font), doc.font]]);
  const paras = (bs: Block[]) => bs.flatMap(blockParas);
  for (const p of [...paras(doc.blocks), ...(doc.page?.texts ?? []).flatMap((t) => paras(t.blocks))])
    for (const s of p.spans) if (s.font && !out.has(fontId(s.font))) out.set(fontId(s.font), s.font);
  return [...out.values()];
}

/** النصّ المنطقي للمستند كما كُتب (للاختبارات: يُقارن به النصّ المستخرج من PDF). */
export function plainText(doc: LetterDoc): string {
  return doc.blocks
    .map((b) => (b.type === "pageBreak" ? "" : blockParas(b).map((p) => p.spans.map((s) => s.text).join("")).join("\n")))
    .join("\n");
}
