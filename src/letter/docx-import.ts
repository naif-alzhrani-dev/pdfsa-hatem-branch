/**
 * «تحرير الملف» (الدفعة ١، فحص الجدوى): محتوى ملف Word إلى مستند الخطاب (`model.ts`)، دالّة نقيّة بلا DOM.
 * السجلّ: docs/logs/edit-file-build-1.md. وهي في src/letter لا src/word-to-pdf لأن حارس الاستيراد (أمين ن٣،
 * tests/letter-doc.test.ts) يمنع أي ملف خارج src/letter من الاستيراد منها، والمحرّر الذي يستعملها في صفحة الخطاب.
 *
 * ما يُنقل: النصّ بترتيبه المنطقي (ترتيب العقد في XML هو ترتيب القراءة، فلا إعادة ترتيب)، والخط عبر `ARABIC_SUBS`،
 * والمقاس (بمعامل `SIZE_FACTORS` كما في «Word إلى PDF»، ثم أقرب مقاس في `SIZES`)، والعريض، والمحاذاة، وفاصل الصفحة،
 * والقوائم (مستوى واحد)، مع وراثة `docDefaults` والأنماط (`basedOn`) والسمة. والجدول البسيط يخرج في `tables` منفصلاً
 * (النموذج لا يدعم الجداول بعد)، والمعقّد يُفرد نصّه فقرات. وما لم يُنقل يُعدّ في `dropped`.
 *
 * شرط 🕵️ أمين: كل قراءة بمفتاح من نصّ الملف من `Map` أو بـ`Object.hasOwn`، والخط لا يدخل إلا عبر `asLetterFont`،
 * والمحلّل خطّي (`indexOf` على نهايات الرموز)، والفكّ بعد `checkDocx` وبسقف لكل جزء (`MAX_DOCUMENT_BYTES` وسقفا الرأس والتذييل)، والعمق بسقف `MAX_DEPTH`.
 */
import { unzipSync, strFromU8 } from "fflate";
import { ARABIC_SUBS, MAX_ENTRY_BYTES, SIZE_FACTORS } from "../word-to-pdf/font-map";
import { checkDocx, type DocxError } from "../word-to-pdf/limits";
import { SIZES } from "./doc";
import { DEFAULT_FONT, FONTS, FONT_KEYS, type FontKey } from "./fonts";
import { asLetterFont, charCount, DEFAULT_SIZE, MAX_BLOCKS, MAX_SIZE, MIN_SIZE, TABLE_LIMITS, tableFits, type Align, type Block, type LetterDoc, type LetterFont, type Paragraph, type Span } from "./model";

/**
 * جدول بسيط (مقترح للنموذج، لم يدخله بعد): كل صفّ بعدد أعمدة الشبكة، بلا دمج ولا جدول متداخل ولا صورة.
 * `at`: موضعه في `doc.blocks` (يُدرج قبل الكتلة ذات هذا الرقم). و`rows[r][c]` فقرات الخلية بترتيبها المنطقي:
 * الخلية الأولى في XML أول الصفّ في القراءة، وهي اليمنى حين `rtl` (`w:bidiVisual`).
 */
export interface LetterTable {
  at: number;
  cols: number;
  /** نسب عرض الأعمدة من `w:tblGrid` (مجموعها ١)، أو متساوية إن غابت */
  widths: number[];
  rtl: boolean;
  rows: Paragraph[][][];
  /** امتداد كل خلية بالأعمدة (`w:gridSpan`، الدفعة ٣): صفّ العنوان المدموج أفقياً يُقبل، ومجموع كل صفّ = `cols` */
  spans: number[][];
  /** حدود Word: `w:tblBorders` بحدٍّ غير «nil/none»، أو نمط جدول غير «TableNormal» (حدوده من النمط، ولا يُقرأ النمط نفسه) */
  borders: boolean;
}

/** الخطاب كما يُفتح في المحرّر: الجداول البسيطة كتلاً في مواضعها (`at`) من المتن */
export function letterDocOf(d: DocxLetter): LetterDoc {
  const blocks = [...d.doc.blocks];
  for (let k = d.tables.length - 1; k >= 0; k--) {
    const t = d.tables[k]!;
    blocks.splice(t.at, 0, { type: "table", widths: t.widths, rtl: t.rtl, borders: t.borders, rows: t.rows.map((r, i) => r.map((paras, j) => ({ ...((t.spans[i]?.[j] ?? 1) > 1 ? { span: t.spans[i]![j] } : {}), paras }))) });
  }
  return { ...d.doc, blocks };
}

/** ما لم يُنقل، بأعداده */
export interface Dropped {
  images: number;
  textBoxes: number;
  /** حروف نصوص المربّعات (لا تدخل المتن) */
  textBoxChars: number;
  /** كائنات مضمّنة (`w:object`) ومعادلات (`m:oMath`) */
  objects: number;
  /** جداول فيها دمج أو تداخل أو صورة: نصّها فقرات في المتن */
  complexTables: number;
  /** الرأس والتذييل: أجزاء فيها نصّ */
  headerFooter: number;
  /** إحالات الحواشي والتعليقات الختامية في المتن */
  notes: number;
  /** علامات الجدولة: صارت مسافة (والواحدة بين طرفين في فقرة صارت «يمين ويسار» فلا تُعدّ) */
  tabs: number;
  /** رموز `w:sym` لا مقابل لها (مربّعات الاختيار المعروفة تصير ☐ ☑ ☒ فلا تُعدّ) */
  symbols: number;
  /** خصائص تنسيق في المتن لا يقرؤها المحرّر: الإزاحة، والتباعد، والمائل، والتسطير، واللون، والتظليل */
  format: number;
  /** حروف مخفيّة (`w:vanish`) */
  hiddenChars: number;
  /** مقاطع خرج مقاسها عن ١١–٢٤ فحُصر */
  sizeClamped: number;
  /** فقرات قوائم في مستوى أعمق من الأول: صارت عناصر في المستوى الأول */
  listLevels: number;
  /** فقرات مرقّمة أو منقّطة داخل الجداول: صارت فقرات بلا علامة */
  tableLists: number;
  /** أسماء خطوط Word بلا بديل في الخطاب (مقصوصة إلى ٦٤)، وحروف مقاطعها: ترث خط الخطاب */
  unmappedFonts: string[];
  unmappedFontChars: number;
  /** عقد تحت `MAX_DEPTH` تُركت */
  deep: number;
}

export interface DocxLetter {
  doc: LetterDoc;
  tables: LetterTable[];
  dropped: Dropped;
  /** حروف المتن والجداول البسيطة معاً، بعدّ `charCount` (بلا فواصل الأسطر) */
  chars: number;
}

export const MAX_DEPTH = 256;

// ————— XML: محلّل متسامح خطّي، والأسماء بالبادئة كما في الملف —————
interface El { n: string; a: Map<string, string>; c: (El | string)[] }
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    if (e[0] !== "#") return Object.hasOwn(ENT, e) ? ENT[e]! : m;
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : "";
  });
}
/** الوسم وحده، بـ`y` عند موضع `<`. والتعليق وCDATA والتعليمة والإعلان بمسح `indexOf` على نهايتها (`skipTo`): بدائلها في التعبير كانت
 * تربيعية مع الرمز غير المغلق (أمين: 200 KB من `<!--` = 11.8 ث)، فكل محاولة تمسح إلى آخر النص. وغير المغلق يُنهي النص. */
const TAG = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
/** رمز يبدأ بـ`open` وينتهي بـ`close`: موضع ما بعد الإغلاق، أو طول النص إن لم يُغلق */
function skipTo(xml: string, at: number, open: string, close: string): number {
  const e = xml.indexOf(close, at + open.length);
  return e < 0 ? xml.length : e + close.length;
}
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseXml(xml: string, drop: { deep: number }): El {
  const root: El = { n: "#root", a: new Map(), c: [] };
  const stack: El[] = [root];
  let skip = 0; // عمق ما تحت السقف: يُعدّ ولا يُبنى
  let pos = 0; // بداية النصّ الذي لم يُضَف
  const text = (end: number) => { if (end > pos && !skip) stack[stack.length - 1]!.c.push(decode(xml.slice(pos, end))); };
  for (let at = xml.indexOf("<"); at >= 0; at = xml.indexOf("<", at)) {
    if (xml.startsWith("<![CDATA[", at)) {
      text(at);
      const e = xml.indexOf("]]>", at + 9);
      if (!skip && e >= 0) stack[stack.length - 1]!.c.push(xml.slice(at + 9, e));
      at = pos = e < 0 ? xml.length : e + 3;
      continue;
    }
    const end = xml.startsWith("<!--", at) ? skipTo(xml, at, "<!--", "-->") : xml.startsWith("<?", at) ? skipTo(xml, at, "<?", "?>") : xml.startsWith("<!", at) ? skipTo(xml, at, "<!", ">") : -1;
    if (end >= 0) { text(at); at = pos = end; continue; } // تعليق أو تعليمة أو إعلان
    TAG.lastIndex = at;
    const m = TAG.exec(xml);
    if (!m) { at++; continue; } // `<` لا يبدأ وسماً: نصّ
    text(at);
    at = pos = TAG.lastIndex;
    const name = m[2]!;
    if (m[1]) { // إغلاق: إلى أقرب مفتوح بالاسم نفسه، وإغلاقٌ بلا مفتوح يُترك
      if (skip) { skip--; continue; }
      for (let i = stack.length - 1; i > 0; i--) if (stack[i]!.n === name) { stack.length = i; break; }
      continue;
    }
    if (skip || stack.length > MAX_DEPTH) { drop.deep++; if (!m[4]) skip++; continue; }
    const a = new Map<string, string>();
    for (const t of (m[3] ?? "").matchAll(ATTR)) a.set(t[1]!, decode(t[2] ?? t[3] ?? ""));
    const el: El = { n: name, a, c: [] };
    stack[stack.length - 1]!.c.push(el);
    if (!m[4]) stack.push(el);
  }
  text(xml.length);
  return root;
}
const kids = (e: El | undefined, n?: string): El[] => (e ? (e.c.filter((x) => typeof x !== "string" && (!n || x.n === n)) as El[]) : []);
const kid = (e: El | undefined, n: string) => kids(e, n)[0];
/** أول عقدة تحت `e` تحقّق الشرط (بحث بالعرض، والعمق محدود بالمحلّل) */
function findBy(e: El | undefined, ok: (x: El) => boolean): El | undefined {
  const q: El[] = e ? [e] : [];
  for (let i = 0; i < q.length; i++) { const x = q[i]!; if (x !== e && ok(x)) return x; for (const k of kids(x)) q.push(k); }
  return undefined;
}
const find = (e: El | undefined, n: string) => findBy(e, (x) => x.n === n);
const textOf = (e: El): string => e.c.map((x) => (typeof x === "string" ? x : "")).join("");
const val = (e: El | undefined) => e?.a.get("w:val");
/** خاصيّة تبديل (`w:b` ونحوها): وجودها صحيح ما لم تكن قيمتها 0/false/off */
const on = (e: El | undefined): boolean | undefined => (e ? !/^(0|false|off)$/i.test(val(e) ?? "1") : undefined);

// ————— الخصائص بوراثتها —————
interface RP { ascii?: string; cs?: string; asciiTheme?: string; csTheme?: string; sz?: number; szCs?: number; b?: boolean; bCs?: boolean; rtl?: boolean; csFlag?: boolean; vanish?: boolean }
interface PP { jc?: string; bidi?: boolean; pageBreakBefore?: boolean; numId?: string; ilvl?: number }

function readRP(r: El | undefined): RP {
  if (!r) return {};
  const o: RP = {};
  const f = kid(r, "w:rFonts");
  if (f) {
    const ascii = f.a.get("w:ascii") ?? f.a.get("w:hAnsi");
    if (ascii !== undefined) o.ascii = ascii;
    if (f.a.has("w:cs")) o.cs = f.a.get("w:cs")!;
    const at = f.a.get("w:asciiTheme") ?? f.a.get("w:hAnsiTheme");
    if (at !== undefined) o.asciiTheme = at;
    if (f.a.has("w:cstheme")) o.csTheme = f.a.get("w:cstheme")!;
  }
  const num = (n: string) => { const v = Number(val(kid(r, n))); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const sz = num("w:sz"), szCs = num("w:szCs");
  if (sz !== undefined) o.sz = sz;
  if (szCs !== undefined) o.szCs = szCs;
  for (const [k, n] of [["b", "w:b"], ["bCs", "w:bCs"], ["rtl", "w:rtl"], ["csFlag", "w:cs"], ["vanish", "w:vanish"]] as const) {
    const v = on(kid(r, n));
    if (v !== undefined) o[k] = v;
  }
  return o;
}
function readPP(p: El | undefined): PP {
  if (!p) return {};
  const o: PP = {};
  const jc = val(kid(p, "w:jc"));
  if (jc) o.jc = jc;
  const bidi = on(kid(p, "w:bidi"));
  if (bidi !== undefined) o.bidi = bidi;
  const pb = on(kid(p, "w:pageBreakBefore"));
  if (pb !== undefined) o.pageBreakBefore = pb;
  const np = kid(p, "w:numPr");
  if (np) {
    const id = val(kid(np, "w:numId"));
    if (id !== undefined) o.numId = id;
    const l = Number(val(kid(np, "w:ilvl")));
    if (Number.isInteger(l)) o.ilvl = l;
  }
  return o;
}

interface Style { type: string; basedOn?: string; rp: RP; pp: PP }
interface Ctx {
  styles: Map<string, Style>;
  defPStyle?: string;
  defRP: RP;
  defPP: PP;
  theme: Map<string, string>;
  /** numId ← مرتّبة أم نقطية، أو null إن كان تنسيق المستوى «none» */
  num: Map<string, Map<number, boolean | null>>;
  drop: Dropped;
  fontChars: Map<LetterFont, number>;
  /** أسماء `drop.unmappedFonts` للفحص الثابت الزمن: `includes` على المصفوفة تربيعي مع آلاف الخطوط (أمين) */
  unmappedSeen: Set<string>;
  /** معامل مقاس آخر مقطع بخطّ مربوط (`SIZE_FACTORS`): يرثه المقطع بخطّ بلا مقابل في فقرة بلا جار مربوط */
  lastF?: number;
}

/** سلسلة `basedOn` من الأصل إلى النمط، بحارس الدوران */
function chain(ctx: Ctx, id: string | undefined): Style[] {
  const out: Style[] = [];
  const seen = new Set<string>();
  for (let s = id; s !== undefined && !seen.has(s) && out.length < 32; ) {
    seen.add(s);
    const st = ctx.styles.get(s);
    if (!st) break;
    out.unshift(st);
    s = st.basedOn;
  }
  return out;
}

function loadStyles(xml: string | undefined, drop: Dropped): Pick<Ctx, "styles" | "defPStyle" | "defRP" | "defPP"> {
  const styles = new Map<string, Style>();
  if (!xml) return { styles, defRP: {}, defPP: {} };
  const root = kid(parseXml(xml, drop), "w:styles");
  const dd = kid(root, "w:docDefaults");
  let defPStyle: string | undefined;
  for (const s of kids(root, "w:style")) {
    const id = s.a.get("w:styleId");
    if (id === undefined) continue;
    const type = s.a.get("w:type") ?? "paragraph";
    const basedOn = val(kid(s, "w:basedOn"));
    styles.set(id, { type, ...(basedOn !== undefined ? { basedOn } : {}), rp: readRP(kid(s, "w:rPr")), pp: readPP(kid(s, "w:pPr")) });
    const def = s.a.get("w:default");
    if (type === "paragraph" && def !== undefined && !/^(0|false|off)$/i.test(def)) defPStyle = id;
  }
  return {
    styles, defPStyle,
    defRP: readRP(kid(kid(dd, "w:rPrDefault"), "w:rPr")),
    defPP: readPP(kid(kid(dd, "w:pPrDefault"), "w:pPr")),
  };
}

/** خطوط السمة: major/minor ← latin وcs */
function loadTheme(xml: string | undefined, drop: Dropped): Map<string, string> {
  const t = new Map<string, string>();
  if (!xml) return t;
  const root = parseXml(xml, drop);
  for (const [w, n] of [["major", "a:majorFont"], ["minor", "a:minorFont"]] as const) {
    const f = find(root, n);
    const lat = kid(f, "a:latin")?.a.get("typeface"), cs = kid(f, "a:cs")?.a.get("typeface");
    if (lat) for (const s of ["Ascii", "HAnsi"]) t.set(w + s, lat);
    if (cs) t.set(w + "Bidi", cs);
  }
  return t;
}

function loadNumbering(xml: string | undefined, drop: Dropped): Map<string, Map<number, boolean | null>> {
  const out = new Map<string, Map<number, boolean | null>>();
  if (!xml) return out;
  const root = kid(parseXml(xml, drop), "w:numbering");
  const abs = new Map<string, Map<number, boolean | null>>();
  for (const a of kids(root, "w:abstractNum")) {
    const lv = new Map<number, boolean | null>();
    for (const l of kids(a, "w:lvl")) {
      const fmt = val(kid(l, "w:numFmt")) ?? "decimal";
      lv.set(Number(l.a.get("w:ilvl") ?? 0), fmt === "none" ? null : fmt !== "bullet");
    }
    const id = a.a.get("w:abstractNumId");
    if (id !== undefined) abs.set(id, lv);
  }
  for (const n of kids(root, "w:num")) {
    const id = n.a.get("w:numId"), a = val(kid(n, "w:abstractNumId"));
    if (id !== undefined && a !== undefined && abs.has(a)) out.set(id, abs.get(a)!);
  }
  return out;
}

// ————— الخط والمقاس —————
const key = (s: string | undefined) => s?.trim().toLowerCase();
const FAMILY_KEY = new Map<string, FontKey>(FONT_KEYS.map((k) => [FONTS[k].family, k]));
/** اسم Word ← `ARABIC_SUBS` ← العائلة ← مفتاح الخطاب ← `asLetterFont` (القائمة المسموحة) */
export function letterFontOf(word: string | undefined): LetterFont | null {
  const k = key(word);
  if (k === undefined || !Object.hasOwn(ARABIC_SUBS, k)) return null;
  const fk = FAMILY_KEY.get(ARABIC_SUBS[k]!);
  return fk ? asLetterFont(fk) : null;
}
/** أقرب مقاس في قائمة المحرّر (`SIZES`)، والمعادل يميل إلى الأصغر */
export function snapSize(pt: number): number {
  let best = SIZES[0]!;
  for (const s of SIZES) if (Math.abs(s - pt) < Math.abs(best - pt)) best = s;
  return best;
}
const ARABIC = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** علامة الجدولة داخل نصّ المقطع حتى تُحسم الفقرة (`paragraph`): «يمين ويسار» أو مسافة تُعدّ */
const TAB = "\t";
/** مقطع كله مربّعات اختيار: مقاسه مقاس جاره، ولا خطّ له ولا يُعدّ خطّه غير متاح (فهد ٥) */
const BOX_ONLY = /^[☐-☒]+$/u;
/**
 * رموز `w:sym` المعروفة: مربّعات الاختيار في Wingdings وWingdings 2 (المحرف بإزاحة F000 أو بدونها)، ومحرفها نفسه في غيرها.
 * وما سواها يسقط ويُعدّ (`symbols`). ومواضع Wingdings 2 من جدولها المعروف، ولم تُطابق على ملف Word حقيقي (السجلّ).
 */
const SYM_BOXES: Record<string, Record<number, string>> = {
  wingdings: { 0x6f: "☐", 0xa8: "☐", 0x78: "☒", 0xfd: "☒", 0xfe: "☑" },
  "wingdings 2": { 0xa3: "☐", 0x52: "☑", 0x53: "☒", 0x54: "☒" },
};
function symChar(x: El): string | null {
  let c = parseInt(x.a.get("w:char") ?? "", 16);
  if (!Number.isInteger(c)) return null;
  if (c >= 0x2610 && c <= 0x2612) return String.fromCodePoint(c);
  if (c >= 0xf000 && c <= 0xf0ff) c -= 0xf000;
  const k = key(x.a.get("w:font"));
  const t = k !== undefined && Object.hasOwn(SYM_BOXES, k) ? SYM_BOXES[k]! : undefined;
  return t && Object.hasOwn(t, c) ? t[c]! : null;
}
/** خصائص المتن التي لا يقرؤها المحرّر (فهد ٣): تُعدّ لسطر «بعض التنسيق» */
const UNREAD = new Set(["w:ind", "w:spacing", "w:i", "w:iCs", "w:u", "w:color", "w:shd", "w:highlight"]);
function unread(pr: El | undefined): boolean {
  return kids(pr).some((x) => {
    if (!UNREAD.has(x.n)) return false;
    const v = (val(x) ?? "").toLowerCase();
    if (x.n === "w:color") return v !== "" && v !== "auto" && v !== "000000";
    if (x.n === "w:shd") { const f = (x.a.get("w:fill") ?? "").toLowerCase(); return (f !== "" && f !== "auto" && f !== "ffffff") || (v !== "" && v !== "clear" && v !== "nil"); }
    if (x.n === "w:u" || x.n === "w:highlight") return v !== "none";
    if (x.n === "w:i" || x.n === "w:iCs") return on(x) === true;
    return true;
  });
}

// ————— المتن —————
interface Run { text: string; rp: RP }
type Inline = Run | { br: "page" };

/** محتوى الفقرة المضمَّن بترتيبه، مع عدّ ما لا يُنقل */
function inlines(ctx: Ctx, p: El, base: RP, out: Inline[]): void {
  const d = ctx.drop;
  const walk = (e: El, rp: RP) => {
    for (const x of kids(e)) {
      switch (x.n) {
        case "w:r": run(x, rp); break;
        case "w:hyperlink": case "w:smartTag": case "w:fldSimple": case "w:ins": case "w:moveTo": case "w:customXml": case "w:dir": case "w:bdo":
          walk(x, rp); break;
        case "w:sdt": walk(kid(x, "w:sdtContent") ?? x, rp); break;
        case "m:oMath": case "m:oMathPara": d.objects++; break;
        case "mc:AlternateContent": { const c = kid(x, "mc:Choice"); if (c) walk(c, rp); break; }
        default: break; // w:pPr، w:del، w:moveFrom، والإشارات المرجعية
      }
    }
  };
  const graphic = (x: El) => {
    const tb = find(x, "w:txbxContent");
    if (tb) { d.textBoxes++; d.textBoxChars += allText(tb).length; } else d.images++;
  };
  const run = (r: El, prp: RP) => {
    const rPr = kid(r, "w:rPr");
    const rp: RP = { ...prp, ...chain(ctx, val(kid(rPr, "w:rStyle"))).reduce((a, s) => ({ ...a, ...s.rp }), {} as RP), ...readRP(rPr) };
    if (unread(rPr)) d.format++;
    let text = "";
    const flush = () => { if (text) { out.push({ text, rp }); text = ""; } };
    for (const x of kids(r)) {
      switch (x.n) {
        case "w:t": text += textOf(x); break;
        case "w:tab": case "w:ptab": text += TAB; break; // تُحسم في `paragraph`: «يمين ويسار» أو مسافة تُعدّ
        case "w:br": if (x.a.get("w:type") === "page") { flush(); out.push({ br: "page" }); } else text += "\n"; break;
        case "w:cr": text += "\n"; break;
        case "w:noBreakHyphen": text += "-"; break;
        case "w:sym": { const ch = symChar(x); if (ch) text += ch; else d.symbols++; break; }
        case "w:drawing": case "w:pict": graphic(x); break;
        case "w:object": d.objects++; break;
        case "mc:AlternateContent": { const c = kid(x, "mc:Choice"); if (c) for (const g of kids(c)) if (g.n === "w:drawing" || g.n === "w:pict") graphic(g); break; }
        case "w:footnoteReference": case "w:endnoteReference": d.notes++; break;
        default: break; // w:rPr، w:instrText (رمز الحقل، ونتيجته في w:t)، w:delText، w:fldChar، w:softHyphen
      }
    }
    flush();
  };
  walk(p, base);
}
/** كل نصّ `w:t` تحت عقدة (لعدّ حروف مربّعات النصّ) */
function allText(e: El): string {
  return e.n === "w:t" ? textOf(e) : kids(e).map(allText).join("");
}

interface Para { pp: PP; paras: (Paragraph | "page")[] }

function paragraph(ctx: Ctx, p: El, splitOk = false): Para {
  const pPr = kid(p, "w:pPr");
  if (unread(pPr)) ctx.drop.format++;
  const sid = val(kid(pPr, "w:pStyle")) ?? ctx.defPStyle;
  const sts = chain(ctx, sid);
  const pp: PP = { ...ctx.defPP, ...sts.reduce((a, s) => ({ ...a, ...s.pp }), {} as PP), ...readPP(pPr) };
  const base: RP = { ...ctx.defRP, ...sts.reduce((a, s) => ({ ...a, ...s.rp }), {} as RP) };
  const ins: Inline[] = [];
  inlines(ctx, p, base, ins);
  const align = alignOf(pp);
  // معامل المقاس (فهد ٤): المقطع بخطّ بلا مقابل يرث معامل أقرب جارٍ بخطّ مربوط في الفقرة (السابق ثم اللاحق)، ثم آخر ما سبقها،
  // فلا يخرج الرقم بـTimes New Roman ١٤ بين نصّ Traditional Arabic بـ١١
  const runs = ins.filter((x): x is Run => !("br" in x));
  const own = runs.map((x) => factorOf(ctx, x));
  // السابق ثم اللاحق بمرورين خطّيين (فقرة بآلاف المقاطع بلا خطّ مربوط لا تصير تربيعية، شرط أمين على المحلّل)
  const prev: (number | undefined)[] = [], next: (number | undefined)[] = [];
  for (let i = 0, f: number | undefined; i < own.length; i++) { prev.push(f); if (own[i] !== undefined) f = own[i]; }
  for (let i = own.length - 1, f: number | undefined; i >= 0; i--) { next[i] = f; if (own[i] !== undefined) f = own[i]; }
  const fs = own.map((f, i) => f ?? prev[i] ?? next[i] ?? ctx.lastF ?? 1);
  for (const f of own) if (f !== undefined) ctx.lastF = f;
  const segs: (Span | "page")[] = [];
  const boxes = new Set<Span>();
  let k = 0;
  for (const x of ins) {
    if ("br" in x) { segs.push("page"); continue; }
    const sp = span(ctx, x, fs[k++]!);
    if (!sp) continue;
    if (BOX_ONLY.test(sp.text)) boxes.add(sp);
    segs.push(sp);
  }
  // مربّع الاختيار بمقاس جاره (السابق ثم اللاحق)، لا بمقاس خطّه في Word ولا بالافتراضي (فهد ٥)
  // بمرورين خطّيين كالمعامل، ولا يعبر فاصل الصفحة
  const sizeOf = (s: Span | "page") => (s === "page" ? null : boxes.has(s) ? undefined : s.size ?? DEFAULT_SIZE);
  const before: (number | undefined)[] = [];
  for (let i = 0, z: number | undefined; i < segs.length; i++) { before.push(z); const v = sizeOf(segs[i]!); if (v !== undefined) z = v ?? undefined; }
  for (let i = segs.length - 1, z: number | undefined; i >= 0; i--) {
    const s = segs[i]!;
    if (s !== "page" && boxes.has(s)) {
      const w = before[i] ?? z;
      if (w !== undefined) { if (w === DEFAULT_SIZE) delete s.size; else s.size = w; }
    }
    const v = sizeOf(s);
    if (v !== undefined) z = v ?? undefined;
  }
  const paras: (Paragraph | "page")[] = [];
  let spans: Span[] = [];
  const end = () => { paras.push(tabs(ctx, { align, spans }, splitOk && pp.bidi === true)); spans = []; };
  for (const sp of segs) {
    if (sp === "page") { end(); paras.push("page"); continue; }
    const last = spans[spans.length - 1];
    if (last && last.bold === sp.bold && last.size === sp.size && last.font === sp.font) last.text += sp.text;
    else spans.push(sp);
  }
  end();
  // «فاصل قبل» وفاصل المقطع (sectPr في الفقرة، والافتراضي «صفحة تالية»)
  if (pp.pageBreakBefore) paras.unshift("page");
  const sect = kid(pPr, "w:sectPr");
  if (sect && val(kid(sect, "w:type")) !== "continuous") paras.push("page");
  return { pp, paras };
}

/**
 * المحاذاة: في Office «left» تعني بداية السطر و«right» نهايته (كـstart/end)، فتنقلبان في الفقرة RTL (`w:bidi`).
 * غير مؤكَّد على ملف حقيقي بعد (السجلّ، «لم يُفحص»).
 */
function alignOf(pp: PP): Align {
  const rtl = pp.bidi === true;
  switch (pp.jc) {
    case "center": return "center";
    case "both": case "distribute": case "lowKashida": case "mediumKashida": case "highKashida": case "thaiDistribute": return "justify";
    case "left": case "start": return rtl ? "right" : "left";
    case "right": case "end": return rtl ? "left" : "right";
    default: return rtl ? "right" : "left";
  }
}

/**
 * علامات الجدولة (فهد ٦): واحدة بين طرفين في فقرة متن RTL بلا فاصل سطر تصير «يمين ويسار» (`split`)، فيعود «سلمه الله» إلى نهاية السطر.
 * وما سواها مسافة تُعدّ (`tabs`، سطر «علامات الجدولة»). والجدول والقائمة بلا «يمين ويسار» (`splitOk`).
 */
function tabs(ctx: Ctx, q: Paragraph, splitOk: boolean): Paragraph {
  const text = q.spans.map((s) => s.text).join("");
  const n = text.split(TAB).length - 1;
  if (!n) return q;
  const at = text.indexOf(TAB);
  if (splitOk && n === 1 && !text.includes("\n") && text.slice(0, at).trim() && text.slice(at + 1).trim()) {
    for (const s of q.spans) s.text = s.text.replace(TAB, "");
    return { align: "right", split: at, spans: q.spans.filter((s) => s.text) };
  }
  ctx.drop.tabs += n;
  for (const s of q.spans) s.text = s.text.split(TAB).join(" ");
  return q;
}

/**
 * الخط من المقطع: المعقّد (العربي) يأخذ `w:cs` وszCs وbCs وحدها كما يرسمه Word، وw:ascii وw:sz وw:b للحروف اللاتينية.
 * والسمة مقدَّمة على الاسم الصريح (ECMA-376 §17.3.2.26)
 */
function wordOf(ctx: Ctx, r: Run): { cs: boolean; word: string | undefined } {
  const cs = r.rp.rtl === true || r.rp.csFlag === true || ARABIC.test(r.text);
  const theme = (t: string | undefined) => (t !== undefined ? ctx.theme.get(t) : undefined);
  return { cs, word: cs ? theme(r.rp.csTheme) ?? r.rp.cs : theme(r.rp.asciiTheme) ?? r.rp.ascii };
}
/** معامل المقاس لمقطع بخطّ مربوط (`SIZE_FACTORS`، أو ١)، و`undefined` لخطّ بلا مقابل أو مربّع اختيار: يرث من جاره */
function factorOf(ctx: Ctx, r: Run): number | undefined {
  if (BOX_ONLY.test(r.text)) return undefined;
  const { word } = wordOf(ctx, r);
  if (!letterFontOf(word)) return undefined;
  const k = key(word);
  return k !== undefined && Object.hasOwn(SIZE_FACTORS, k) ? SIZE_FACTORS[k]! : 1;
}

function span(ctx: Ctx, r: Run, f: number): Span | null {
  const d = ctx.drop;
  if (r.rp.vanish) { d.hiddenChars += r.text.replace(/[\n\t]/g, "").length; return null; }
  const { cs, word } = wordOf(ctx, r);
  const half = cs ? r.rp.szCs : r.rp.sz;
  const bold = (cs ? r.rp.bCs : r.rp.b) === true;
  const box = BOX_ONLY.test(r.text);
  const font = box ? null : letterFontOf(word);
  const n = r.text.replace(/[\n\t]/g, "").length;
  if (!font && !box && word && n) {
    const w = word.slice(0, 64);
    if (!ctx.unmappedSeen.has(w)) { ctx.unmappedSeen.add(w); d.unmappedFonts.push(w); }
    d.unmappedFontChars += n;
  }
  if (font) ctx.fontChars.set(font, (ctx.fontChars.get(font) ?? 0) + n);
  let size = DEFAULT_SIZE;
  if (half !== undefined) {
    const pt = (half / 2) * f;
    // بمنزلتين: ١٤ × ٠٫٧٨٦ = ١٠٫٩٩٩٦ ليس دون ١١ (فهد ٣، كان يُعدّ مقصوصاً)
    const r2 = Math.round(pt * 100) / 100;
    if (r2 < MIN_SIZE || r2 > MAX_SIZE) d.sizeClamped++;
    size = snapSize(pt);
  }
  return { text: r.text, ...(bold ? { bold } : {}), ...(size !== DEFAULT_SIZE ? { size } : {}), ...(font ? { font } : {}) };
}

/** مرتّبة (true) أو نقطية (false)، أو ليست قائمة (null/undefined: بلا numId، أو 0، أو تنسيق «none») */
const listKind = (ctx: Ctx, pp: PP): boolean | null | undefined =>
  pp.numId !== undefined && pp.numId !== "0" ? ctx.num.get(pp.numId)?.get(pp.ilvl ?? 0) ?? ctx.num.get(pp.numId)?.get(0) : undefined;

// ————— الجداول —————
/** فقرات كل ما تحت العقدة بترتيبه (الخلية، والجدول المتداخل)، والقوائم فيها فقرات */
function cellParas(ctx: Ctx, e: El, depth = 0): Paragraph[] {
  const out: Paragraph[] = [];
  for (const x of kids(e)) {
    if (x.n === "w:p") {
      const p = paragraph(ctx, x);
      if (listKind(ctx, p.pp) != null) ctx.drop.tableLists++;
      for (const q of p.paras) if (q !== "page") out.push(q);
    } else if (x.n === "w:tcPr") { if (unread(x)) ctx.drop.format++; } // تظليل الخلية
    else if (depth < 16 && (x.n === "w:tbl" || x.n === "w:tr" || x.n === "w:tc" || x.n === "w:sdt" || x.n === "w:sdtContent" || x.n === "w:customXml")) out.push(...cellParas(ctx, x, depth + 1));
  }
  return out;
}
const rowsOf = (t: El) => kids(t, "w:tr");
const cellsOf = (tr: El) => kids(tr, "w:tc");

const spanOf = (tc: El) => { const n = Number(val(kid(kid(tc, "w:tcPr"), "w:gridSpan")) ?? 1); return Number.isInteger(n) && n >= 1 ? n : 0; };
/** بسيط: مجموع امتداد خلايا كل صفّ (`w:gridSpan`) = أعمدة الشبكة، بلا vMerge ولا gridBefore/After ولا جدول متداخل ولا رسم ولا فاصل صفحة */
export function isSimpleTable(t: El): boolean {
  const cols = kids(kid(t, "w:tblGrid"), "w:gridCol").length;
  const rows = rowsOf(t);
  if (!rows.length) return false;
  for (const tr of rows) {
    const trPr = kid(tr, "w:trPr");
    if (Number(val(kid(trPr, "w:gridBefore")) ?? 0) > 0 || Number(val(kid(trPr, "w:gridAfter")) ?? 0) > 0) return false;
    if (kids(tr).some((x) => x.n !== "w:tc" && x.n !== "w:trPr" && x.n !== "w:tblPrEx")) return false; // خلايا في sdt أو customXml
    const cs = cellsOf(tr);
    if (!cs.length || cs.reduce((n, tc) => n + spanOf(tc), 0) !== (cols || cellsOf(rows[0]!).length) || cs.some((tc) => !spanOf(tc))) return false;
    for (const tc of cs) {
      const tcPr = kid(tc, "w:tcPr");
      if (kid(tcPr, "w:vMerge") || kid(tcPr, "w:hMerge")) return false;
      for (const n of ["w:tbl", "w:drawing", "w:pict", "w:object", "w:txbxContent"]) if (find(tc, n)) return false;
      if (findBy(tc, (x) => x.n === "w:br" && x.a.get("w:type") === "page")) return false;
    }
  }
  return true;
}

/** البسيط في سقوف `TABLE_LIMITS` (أمين)، والزائد على أيّها `null`: يُعدّ معقّداً ويُفرد نصّه فقرات، فلا يضيع نصّ */
function table(ctx: Ctx, t: El, at: number): LetterTable | null {
  if (!isSimpleTable(t) || rowsOf(t).length > TABLE_LIMITS.rows) return null;
  const marks = ctx.drop.tableLists;
  const rows = rowsOf(t).map((tr) => cellsOf(tr).map((tc) => cellParas(ctx, tc)));
  const spans = rowsOf(t).map((tr) => cellsOf(tr).map(spanOf));
  const cols = spans[0]!.reduce((a, b) => a + b, 0);
  const grid = kids(kid(t, "w:tblGrid"), "w:gridCol").map((g) => Math.max(0, Number(g.a.get("w:w")) || 0));
  const sum = grid.reduce((a, b) => a + b, 0);
  const widths = grid.length === cols && sum > 0 ? grid.map((w) => w / sum) : Array<number>(cols).fill(1 / cols);
  if (!tableFits({ cols, widths, rows: rows.map((r, i) => r.map((c, j) => ({ span: spans[i]![j], paras: c.length }))) })) { ctx.drop.tableLists = marks; return null; }
  const tblPr = kid(t, "w:tblPr");
  const edges = kids(kid(tblPr, "w:tblBorders"));
  const style = val(kid(tblPr, "w:tblStyle"));
  const borders = edges.length ? edges.some((e) => !["nil", "none"].includes(e.a.get("w:val") ?? "nil")) : !!style && style !== "TableNormal";
  return { at, cols, widths, rtl: on(kid(tblPr, "w:bidiVisual")) === true, rows, spans, borders };
}

// ————— الأعلى —————
const NEEDED = /^word\/(document|styles|numbering|header\d*|footer\d*)\.xml$|^word\/theme\/theme1\.xml$/;
const HEADER_FOOTER = /^word\/(header|footer)\d*\.xml$/;
/** سقوف أمين للأجزاء: `document.xml` (أكبر ملفات نايف الأربعة دونه بكثير، السجلّ)، والرأس والتذييل لكلٍّ ولعددها. وما عداها `MAX_ENTRY_BYTES` */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_HEADER_FOOTER_BYTES = 1024 * 1024;
export const MAX_HEADER_FOOTER_PARTS = 6;
const capOf = (name: string) => (name === "word/document.xml" ? MAX_DOCUMENT_BYTES : HEADER_FOOTER.test(name) ? MAX_HEADER_FOOTER_BYTES : MAX_ENTRY_BYTES);

/** من بايتات الملف: `checkDocx` ثم الفكّ بسقف كل جزء (المعلن في الفهرس، ثم المفكوك نفسه لأن المعلن قد يكذب)، والأجزاء اللازمة وحدها */
export function docxToLetter(bytes: Uint8Array): DocxLetter | DocxError {
  const bad = checkDocx(bytes);
  if (bad) return bad;
  let tooBig = false;
  let hf = 0;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        if (!NEEDED.test(f.name)) return false;
        if (HEADER_FOOTER.test(f.name) && ++hf > MAX_HEADER_FOOTER_PARTS) tooBig = true;
        if (f.originalSize > capOf(f.name)) tooBig = true;
        return !tooBig;
      },
    });
  } catch { return "bad-file"; }
  if (tooBig) return "too-big";
  for (const k of Object.keys(parts)) if (parts[k]!.length > capOf(k)) return "too-big";
  const text: Record<string, string> = {};
  for (const k of Object.keys(parts)) text[k] = strFromU8(parts[k]!);
  const out = partsToLetter(text);
  return out.doc.blocks.length > MAX_BLOCKS ? "too-big" : out; // و`normalizeDoc` يرفضه أيضاً
}

/** الدالّة النقيّة: أجزاء docx نصوصاً (`word/document.xml` وما معه) ← الخطاب والجداول وما لم يُنقل */
export function partsToLetter(parts: Record<string, string>): DocxLetter {
  const part = (n: string) => (Object.hasOwn(parts, n) ? parts[n] : undefined);
  const drop: Dropped = { images: 0, textBoxes: 0, textBoxChars: 0, objects: 0, complexTables: 0, headerFooter: 0, notes: 0, tabs: 0, symbols: 0, format: 0, hiddenChars: 0, sizeClamped: 0, listLevels: 0, tableLists: 0, unmappedFonts: [], unmappedFontChars: 0, deep: 0 };
  const ctx: Ctx = {
    ...loadStyles(part("word/styles.xml"), drop),
    theme: loadTheme(part("word/theme/theme1.xml"), drop),
    num: loadNumbering(part("word/numbering.xml"), drop),
    drop,
    fontChars: new Map(),
    unmappedSeen: new Set(),
  };
  for (const n of Object.keys(parts)) if (/^word\/(header|footer)\d*\.xml$/.test(n) && allText(parseXml(parts[n]!, drop)).trim()) drop.headerFooter++;
  const body = kid(kid(parseXml(part("word/document.xml") ?? "", drop), "w:document"), "w:body");
  const blocks: Block[] = [];
  const tables: LetterTable[] = [];
  let list: { id: string; ordered: boolean; items: Paragraph[] } | null = null;
  const close = () => { if (list) { blocks.push({ type: "list", ordered: list.ordered, items: list.items }); list = null; } };
  const visit = (e: El | undefined) => {
    for (const x of kids(e)) {
      if (x.n === "w:p") {
        const p = paragraph(ctx, x, true);
        const kind = listKind(ctx, p.pp);
        if (kind === null || kind === undefined) {
          close();
          for (const q of p.paras) blocks.push(q === "page" ? { type: "pageBreak" } : { type: "paragraph", ...q });
          continue;
        }
        if ((p.pp.ilvl ?? 0) > 0) drop.listLevels++;
        for (const q of p.paras) {
          if (q === "page") { close(); blocks.push({ type: "pageBreak" }); continue; }
          const cur: { id: string; ordered: boolean; items: Paragraph[] } | null = list;
          if (!cur || cur.id !== p.pp.numId || cur.ordered !== kind) { close(); list = { id: p.pp.numId!, ordered: kind, items: [q] }; }
          else cur.items.push(q);
        }
      } else if (x.n === "w:tbl") {
        close();
        const t = tables.length < TABLE_LIMITS.tables ? table(ctx, x, blocks.length) : null;
        if (t) tables.push(t);
        else { drop.complexTables++; for (const q of cellParas(ctx, x)) blocks.push({ type: "paragraph", ...q }); }
      } else if (x.n === "w:sdt") { visit(kid(x, "w:sdtContent")); }
      else if (x.n === "w:customXml") visit(x);
    }
  };
  visit(body);
  close();
  // خط الخطاب: الأكثر حروفاً من الخطوط المربوطة، ومقاطعه بلا `font` (ترثه)
  let font: LetterFont = DEFAULT_FONT, best = -1;
  for (const [f, n] of ctx.fontChars) if (n > best) { best = n; font = f; }
  const strip = (p: Paragraph) => { for (const s of p.spans) if (s.font === font) delete s.font; };
  for (const b of blocks) (b.type === "paragraph" ? [b] : b.type === "list" ? b.items : []).forEach(strip);
  for (const t of tables) for (const r of t.rows) for (const c of r) c.forEach(strip);
  const tableChars = tables.reduce((n, t) => n + t.rows.flat(2).reduce((m, p) => m + p.spans.reduce((k, s) => k + s.text.replace(/\n/g, "").length, 0), 0), 0);
  const doc: LetterDoc = { font, blocks };
  return { doc, tables, dropped: drop, chars: charCount(doc) + tableChars };
}
