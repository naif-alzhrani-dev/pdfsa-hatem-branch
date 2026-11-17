/**
 * الصفحات التي تُحرق مع الإخفاء (قرار نايف ٢٠٢٦/١١/١١ «نعم كل صفحه تشارك صوره»، docs/logs/pen-raed.md):
 * الخطّ المشترك بين صفحة محروقة وصفحة باقية يحمل إلى الناتج حروف الكلمة المخفية (ToUnicode وأشكال الحروف وعروضها).
 * فكل صفحة تشارك صفحةً محروقة خطّاً تُحرق كذلك، تكراراً: الصفحة التي صارت محروقة تُحرق ما يشاركها.
 *
 * «تشارك خطّاً»: ترسم الصفحتان (في محتواهما، أو داخل Form أو نقش أو خطّ Type3 أو قناع SMask ترسمه، تكراراً)
 * كائنَ الخطّ نفسه، أو خطّاً فرعياً نفسه (DescendantFonts)، أو ملفّ الخطّ نفسه (FontFile وFontFile2 وFontFile3)،
 * أو ToUnicode نفسه. والمقارنة بهوية الكائن في الملف المصدر لا بمحتواه.
 * ولا يُعدّ مشاركةً خطٌّ من الخطوط الأربعة عشر القياسية بلا ملفّ ولا ToUnicode ولا عروض ولا Differences،
 * لأنه لا يحمل شيئاً عن الحروف المستعملة (pdf-lib يكتب Helvetica هكذا).
 * والصفحة التي لا يُقرأ محتواها (فلتر لا يفكّه pdf-lib) تُحرق إن كان في ملفّها صفحة محروقة: لا نعرف ما تشاركه.
 */
import { PDFDict, PDFName, PDFArray, PDFStream, type PDFContext, type PDFDocument, type PDFObject } from "pdf-lib";
import { CATS } from "./pdf-content";
import { childContent, contentHolders, namesIn, pageContent, prepareCopy } from "./copy-clean";

const n = (s: string) => PDFName.of(s);
const STD14 = new Set([
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Helvetica", "Helvetica-Bold", "Helvetica-Oblique",
  "Helvetica-BoldOblique", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Symbol", "ZapfDingbats",
]);

/** مفاتيح الخطّ القياسي العاري، ولا غيرها (ملاحظة أمين ٥، P1e): أي مفتاح آخر قد يحمل شيئاً عن الحروف. */
const BARE_KEYS = new Set(["Type", "Subtype", "BaseFont", "Encoding", "Name"]);
/** خطّ قياسي عارٍ: لا يحمل شيئاً عن الحروف المستعملة. */
function bare(ctx: PDFContext, font: PDFDict): boolean {
  const st = font.lookup(n("Subtype"));
  if (st !== n("Type1") && st !== n("TrueType")) return false;
  const base = font.lookupMaybe(n("BaseFont"), PDFName)?.decodeText();
  if (!base || !STD14.has(base)) return false;
  if (font.keys().some((k) => !BARE_KEYS.has(k.decodeText()))) return false;
  const enc = font.get(n("Encoding"));
  return !enc || ctx.lookup(enc) instanceof PDFName;
}

/** هويات ما يحمل الحروف في الخطّ: الخطّ نفسه، وخطوطه الفرعية، وملفّاته، وToUnicode. */
function fontParts(ctx: PDFContext, font: PDFObject | undefined, out: Set<object>) {
  if (!(font instanceof PDFDict) || bare(ctx, font)) return;
  out.add(font);
  const files = (d: PDFDict | undefined) => {
    for (const k of ["FontFile", "FontFile2", "FontFile3"]) { const f = d?.lookup(n(k)); if (f) out.add(f); }
  };
  files(font.lookupMaybe(n("FontDescriptor"), PDFDict));
  const tu = font.lookup(n("ToUnicode"));
  if (tu) out.add(tu);
  const desc = font.lookupMaybe(n("DescendantFonts"), PDFArray);
  for (let i = 0; desc && i < desc.size(); i++) {
    const df = desc.lookup(i);
    if (df instanceof PDFDict) { out.add(df); files(df.lookupMaybe(n("FontDescriptor"), PDFDict)); }
  }
}

/**
 * ما يرسمه `content` بموارد `res` من الخطوط، وما يرسمه كل Form ونقش وخطّ Type3 وقناع داخله (تكراراً).
 * والأسماء من `namesIn` كالتقليم (ملاحظة أمين ١، P1e)، والخطّ في `ExtGState /Font` يُعدّ (ملاحظة أمين ٢).
 */
function drawnFonts(ctx: PDFContext, res: PDFDict | undefined, content: Uint8Array, out: Set<object>, seen: Set<PDFDict>) {
  const visit = (obj: PDFObject | undefined, font: boolean) => {
    if (font) fontParts(ctx, obj, out);
    for (const h of contentHolders(obj, ctx)) {
      const ch = childContent(h);
      if (!ch || seen.has(ch.holder)) continue;
      seen.add(ch.holder);
      // ما لا موارد له يرث موارد أبيه
      drawnFonts(ctx, ch.holder.lookupMaybe(n("Resources"), PDFDict) ?? res, ch.content, out, seen);
    }
  };
  const used = namesIn(content, res);
  for (const cat of CATS) for (const name of used.get(cat)!) {
    const raw = res?.lookupMaybe(n(cat), PDFDict)?.get(n(name));
    if (!raw) continue;
    const obj = ctx.lookup(raw);
    visit(obj, cat === "Font");
    if (cat === "ExtGState" && obj instanceof PDFDict) {
      const gf = obj.lookupMaybe(n("Font"), PDFArray)?.get(0);
      if (gf) visit(ctx.lookup(gf), true);
    }
  }
}

/**
 * صفحات `from` (من `present`، وهي صفحاته الباقية في الناتج) التي تُحرق: `covered` (عليها غطاء)،
 * وكل صفحة تشارك صفحةً تُحرق خطّاً، حتى لا يزيد شيء.
 */
export function fontLinked(from: PDFDocument, present: number[], covered: number[]): Set<number> {
  const burn = new Set(covered);
  if (!burn.size) return burn;
  const fonts = new Map<number, Set<object> | null>();
  for (const i of new Set([...present, ...covered])) {
    try {
      const node = from.getPage(i).node, out = new Set<object>();
      drawnFonts(from.context, node.Resources(), pageContent(node), out, new Set());
      fonts.set(i, out);
    } catch {
      fonts.set(i, null);
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    const hot = new Set<object>();
    for (const i of burn) {
      const fs = fonts.get(i);
      if (fs === null) return new Set(fonts.keys()); // صفحة محروقة لا نعرف خطوطها: يُحرق الملف كله
      for (const f of fs ?? []) hot.add(f);
    }
    for (const [i, fs] of fonts) {
      if (burn.has(i) || !(fs === null || [...fs].some((f) => hot.has(f)))) continue;
      burn.add(i);
      grew = true;
    }
  }
  return burn;
}

/** خطوط الصفحات `idx` من `from` كما يحسبها `fontLinked` (قبل التقليم). يرمي إن لم يُقرأ محتوى صفحة. */
export function burnedFonts(from: PDFDocument, idx: number[]): Set<object> {
  const out = new Set<object>();
  for (const i of new Set(idx)) {
    const node = from.getPage(i).node;
    drawnFonts(from.context, node.Resources(), pageContent(node), out, new Set());
  }
  return out;
}

/**
 * حارس وقت الحفظ (ملاحظة أمين ١، P1e): بعد التقليم، كل ما يُصل إليه من الصفحة كما ينسخه `copyPages`
 * (كل مفتاح إلا `Parent` الصفحة نفسها، كـ`assertPruned`). والصفحات من `idx` التي تصل إلى كائن من `hot`
 * (أجزاء خطوط الصفحات المحروقة، `burnedFonts`: الخطّ وخطوطه الفرعية وملفّاته وToUnicode) بأي طريق تُعاد لتُحرق:
 * طريقٌ لم يره `fontLinked` لا يحمل إلى الناتج خطّاً من صفحة محروقة.
 */
export function leakedPages(from: PDFDocument, idx: number[], hot: Set<object>): number[] {
  if (!hot.size) return [];
  const ctx = from.context;
  return [...new Set(idx)].filter((i) => {
    const node = from.getPage(i).node, seen = new Set<PDFObject>();
    const stack: PDFObject[] = node.entries().filter(([k]) => k !== n("Parent")).map(([, v]) => v);
    while (stack.length) {
      const o = ctx.lookup(stack.pop()!);
      if (!o || seen.has(o)) continue;
      if (hot.has(o)) return true;
      seen.add(o);
      const d = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : undefined;
      if (d) for (const [, v] of d.entries()) stack.push(v);
      else if (o instanceof PDFArray) stack.push(...o.asArray());
    }
    return false;
  });
}

/**
 * الصفحات التي ستُحرق فعلاً (ملاحظة أمين ١ على P1e، دفعة P1g): `fontLinked` ثم الحلقة نفسها التي يجريها حارس `buildOutput`
 * (خطوط المحروقة قبل التقليم ← تقليم النسخة ← `leakedPages`) على نسخة جديدة من `load()` في كل دورة، حتى لا تزيد صفحة.
 * فالإشعار يعدّ ما يحرقه الحفظ، لا ما حسبه `fontLinked` وحده. ويرمي إن لم يُقرأ المصدر نفسه (على المستدعي أن يحرق الملف كله)؛ وفشل الحلقة (تقليم أو قراءة) لا يرمي: يُعاد ما بلغته، والحارس في الحفظ يمتنع.
 */
export async function burnClosure(load: () => Promise<PDFDocument>, present: number[], covered: number[]): Promise<Set<number>> {
  const burn = fontLinked(await load(), present, covered);
  try {
    for (;;) {
      const idx = present.filter((i) => !burn.has(i));
      if (!idx.length || !burn.size) return burn;
      const from = await load();
      const hot = burnedFonts(from, [...burn]);
      prepareCopy(from, idx, { prune: true });
      const leak = leakedPages(from, idx, hot);
      if (!leak.length) return burn;
      for (const i of leak) burn.add(i);
    }
  } catch {
    // موارد لا يقلّمها التقليم (assertPruned) أو محتوى لا يُقرأ: لا يُحرق الملف كله ليُحفَظ، بل يبقى الحكم لحارس الحفظ فيمتنع الحفظ
    return burn;
  }
}
