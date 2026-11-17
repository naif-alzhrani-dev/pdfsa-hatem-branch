import { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString, PDFStream, PDFRawStream, PDFRef, decodePDFRawStream, type PDFContext, type PDFObject, type PDFPage } from "pdf-lib";
import { CATS, usedNames, type Cat } from "./pdf-content";

const n = (s: string) => PDFName.of(s);

/**
 * قائمة سماح لمفاتيح قاموس الصفحة. أي مفتاح آخر قد يحمل مرجعاً إلى صفحة أخرى
 * (`/B` خرزات المقالات، `/AA`، `/Thumb`، `/StructParents`…) فيُحذف.
 * `Parent` يبقى لأن `copyPages` يقرأ منه السمات الموروثة (Resources وMediaBox…) ثم يحذفه هو من النسخة.
 */
const PAGE_KEYS = new Set([
  "Type", "Parent", "Contents", "Resources", "MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox",
  "Rotate", "UserUnit", "Group", "Annots",
]);

const BAD_LINK_KEYS = [n("AA"), n("P"), n("Popup")];

/** مصفوفة أرقام صرفة (بطول محدد إن طُلب)، وإلا `undefined`. */
function numbers(arr: PDFArray | undefined, ctx: PDFContext, len?: number): PDFArray | undefined {
  if (!arr) return undefined;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookupMaybe(i, PDFNumber);
    if (!v) return undefined;
    out.push(v.asNumber());
  }
  if (len !== undefined && out.length !== len) return undefined;
  return ctx.obj(out);
}

/** يبني تعليق رابط نظيفاً من رابط موقع (`/URI`) بسيط، أو `undefined` إن لم يكن كذلك. */
function cleanUriLink(annot: PDFDict): PDFDict | undefined {
  if (annot.lookup(n("Subtype")) !== n("Link")) return undefined;
  if (BAD_LINK_KEYS.some((k) => annot.has(k))) return undefined;
  const action = annot.lookupMaybe(n("A"), PDFDict);
  if (!action || action.lookup(n("S")) !== n("URI") || action.has(n("Next"))) return undefined;
  const uri = action.lookup(n("URI"));
  if (!(uri instanceof PDFString) && !(uri instanceof PDFHexString)) return undefined;
  const rect = numbers(annot.lookupMaybe(n("Rect"), PDFArray), annot.context, 4);
  if (!rect) return undefined;
  const link = annot.context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, A: { Type: "Action", S: "URI", URI: uri } }) as PDFDict;
  const border = numbers(annot.lookupMaybe(n("Border"), PDFArray), annot.context);
  if (border) link.set(n("Border"), border);
  const f = annot.lookupMaybe(n("F"), PDFNumber);
  if (f) link.set(n("F"), f);
  return link;
}

/* ───────── تقليم الموارد (ملاحظة أمين ١) ───────── */
/** محتوى التدفّق مفكوكاً. فلتر لا يفكّه pdf-lib يُسقط الحفظ: لا تُنسخ صفحة لا نعرف ما ترسمه. */
function bytesOf(s: PDFStream): Uint8Array {
  return s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents();
}
export function pageContent(node: PDFDict): Uint8Array {
  const c = node.lookup(n("Contents"));
  const parts = c instanceof PDFStream ? [c] : c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i, PDFStream)) : [];
  const all = parts.map(bytesOf);
  const out = new Uint8Array(all.reduce((s, a) => s + a.length + 1, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; out[o++] = 10; }
  return out;
}
/** محتوى ما يُرسم بموارده (Form وتعبئة النقش وخطّ Type3 وقناع SMask)، أو `undefined` لما لا محتوى له. */
export function childContent(obj: PDFObject | undefined): { holder: PDFDict; content: Uint8Array } | undefined {
  if (obj instanceof PDFStream) {
    const d = obj.dict;
    if (d.lookup(n("Subtype")) === n("Form") || d.lookupMaybe(n("PatternType"), PDFNumber)?.asNumber() === 1) return { holder: d, content: bytesOf(obj) };
    return undefined;
  }
  if (obj instanceof PDFDict && obj.lookup(n("Subtype")) === n("Type3")) {
    const procs = obj.lookupMaybe(n("CharProcs"), PDFDict);
    const parts = procs ? procs.values().map((v) => bytesOf(obj.context.lookup(v, PDFStream))) : [];
    const out = new Uint8Array(parts.reduce((s, a) => s + a.length + 1, 0));
    let o = 0;
    for (const a of parts) { out.set(a, o); o += a.length; out[o++] = 10; }
    return { holder: obj, content: out };
  }
  return undefined;
}
/** ما يحمل محتوى داخل الكائن: هو نفسه، أو قناع SMask في ExtGState. */
export function contentHolders(obj: PDFObject | undefined, ctx: PDFContext): PDFObject[] {
  if (obj instanceof PDFDict && !(obj.lookup(n("Subtype")) === n("Type3"))) {
    const g = obj.lookupMaybe(n("SMask"), PDFDict)?.lookup(n("G"));
    return g ? [ctx.lookup(g)!] : [];
  }
  return obj ? [obj] : [];
}

/**
 * ما يستعمله المحتوى من أسماء `res`: ما يجده المفسّر، ويُضمّ إليه كل اسم في `res` يظهر `/الاسم` في المحتوى الخام
 * (ملاحظة أمين م٤، P1d): المفسّر قد يخطئ حدّ صورة مضمَّنة (`EI` داخل بياناتها) فيُسقط ما بعدها. والضمّ يزيد ولا ينقص.
 * ويقرؤه `drawnFonts` في font-share.ts كذلك (ملاحظة أمين ١، P1e)، فلا يرى التقليمُ ما لا يراه حساب الصفحات المحروقة.
 */
export function namesIn(content: Uint8Array, res: PDFDict | undefined): Map<Cat, Set<string>> {
  const used = usedNames(content);
  if (!res) return used;
  const raw = new Set<string>();
  const text = new TextDecoder("latin1").decode(content);
  for (const m of text.matchAll(/\/([^\s()<>[\]{}/%]*)/g)) raw.add(m[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  for (const cat of CATS) for (const k of res.lookupMaybe(n(cat), PDFDict)?.keys() ?? []) if (raw.has(k.decodeText())) used.get(cat)!.add(k.decodeText());
  return used;
}

/**
 * قاموس موارد جديد فيه ما يستعمله `content` وحده من `res`، ويُقلَّم كذلك مورد كل ما يُرسم داخله (تكراراً).
 * وما لا قاموس موارد له من Form وغيره يرث موارد أبيه، فتُضمّ أسماؤه إلى أسماء الأب.
 */
function pruneResources(ctx: PDFContext, res: PDFDict | undefined, content: Uint8Array, done: Set<PDFDict>, built: Set<PDFDict>): PDFDict {
  const used = namesIn(content, res);
  const out = ctx.obj({}) as PDFDict;
  built.add(out);
  if (!res) return out;
  const look = (cat: Cat, name: string) => res.lookupMaybe(n(cat), PDFDict)?.lookup(n(name));
  const inherited = new Set<PDFDict>();
  for (let grew = true; grew;) {
    grew = false;
    for (const cat of CATS) for (const name of [...used.get(cat)!]) for (const h of contentHolders(look(cat, name), ctx)) {
      const ch = childContent(h);
      if (!ch || ch.holder.has(n("Resources")) || inherited.has(ch.holder)) continue;
      inherited.add(ch.holder);
      for (const [c, names] of namesIn(ch.content, res)) for (const x of names) if (!used.get(c)!.has(x)) { used.get(c)!.add(x); grew = true; }
    }
  }
  for (const cat of CATS) {
    const src = res.lookupMaybe(n(cat), PDFDict);
    if (!src) continue;
    const sub = ctx.obj({}) as PDFDict;
    for (const name of used.get(cat)!) {
      const v = src.get(n(name));
      if (!v) continue;
      sub.set(n(name), v);
      for (const h of contentHolders(ctx.lookup(v), ctx)) {
        const ch = childContent(h);
        if (!ch || done.has(ch.holder) || !ch.holder.has(n("Resources"))) continue;
        done.add(ch.holder);
        ch.holder.set(n("Resources"), pruneResources(ctx, ch.holder.lookupMaybe(n("Resources"), PDFDict), ch.content, done, built));
      }
    }
    if (sub.keys().length) out.set(n(cat), sub);
  }
  const procSet = res.get(n("ProcSet"));
  if (procSet) out.set(n("ProcSet"), procSet);
  return out;
}

/**
 * بعد التقليم (ملاحظة أمين م٢، P1d): كل ما يُصل إليه من الصفحة كما ينسخه `copyPages` (كل مفتاح إلا `Parent` الصفحة نفسها)،
 * وأي `/Resources` فيه لم يبنِه التقليم يرمي، فلا يُحفظ الملف — كالفلتر الذي لا يُفكّ. فطريقٌ لا يعرفه التقليم
 * (خطّ Type3 في `ExtGState /Font` مثلاً) لا يجرّ قاموس موارد مشتركاً بما فيه من صفحة محروقة.
 */
function assertPruned(ctx: PDFContext, node: PDFDict, built: Set<PDFDict>) {
  const seen = new Set<PDFObject>();
  const stack: PDFObject[] = node.entries().filter(([k]) => k !== n("Parent")).map(([, v]) => v);
  if (node.has(n("Resources")) && !built.has(node.lookup(n("Resources")) as PDFDict)) throw new Error("unpruned resources");
  while (stack.length) {
    let o: PDFObject | undefined = stack.pop();
    if (o instanceof PDFRef) o = ctx.lookup(o);
    if (!o || seen.has(o)) continue;
    seen.add(o);
    const d = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : undefined;
    if (d) {
      if (d.has(n("Resources")) && !built.has(d.lookup(n("Resources")) as PDFDict)) throw new Error("unpruned resources");
      for (const [, v] of d.entries()) stack.push(v);
    } else if (o instanceof PDFArray) stack.push(...o.asArray());
  }
}

/**
 * ينسخ الصفحات `idx` من `from` إلى `doc`.
 * `copyPages` يتبع كل مرجع داخل الصفحة، فأي طريق يصل إلى صفحة محذوفة يجرّها بمحتواها كاملاً.
 * وتعداد الطرق (Dest وGoTo وNext وAA وP وPopup وParent وB…) لا ينتهي، فنبني من الجذر:
 * في نسخة المصدر (مفتوحة للنسخ وحده) يبقى من الصفحة المفاتيحُ المسموحة فقط،
 * ومن التعليقات روابط المواقع البسيطة فقط، تُعاد كتابتها قواميس جديدة نظيفة. وما سواها يُحذف.
 * و`prune` (مع الإخفاء): موارد كل صفحة تُقلَّم إلى ما يرسمه محتواها، فلا يدخل الناتج من قاموس موارد مشترك
 * (على `/Pages` مثلاً) صورُ صفحة محروقة ولا Form فيه نصّها. والقاموس يوضع على الصفحة نفسها فلا يُورث شيء.
 */
export async function copyPagesWithoutInternalLinks(doc: PDFDocument, from: PDFDocument, idx: number[], opts: { prune?: boolean } = {}): Promise<PDFPage[]> {
  prepareCopy(from, idx, opts);
  return doc.copyPages(from, idx);
}
/** تنظيف الصفحات `idx` في `from` (وتقليمها مع `prune`) قبل `copyPages`، كما يفعل `copyPagesWithoutInternalLinks`. */
export function prepareCopy(from: PDFDocument, idx: number[], opts: { prune?: boolean } = {}): void {
  const done = new Set<PDFDict>(), built = new Set<PDFDict>();
  for (const i of new Set(idx)) {
    const node = from.getPage(i).node;
    if (opts.prune) node.set(n("Resources"), pruneResources(from.context, node.Resources(), pageContent(node), done, built));
    const annots = node.lookupMaybe(n("Annots"), PDFArray);
    const links: PDFDict[] = [];
    if (annots) {
      for (let k = 0; k < annots.size(); k++) {
        const annot = annots.lookupMaybe(k, PDFDict);
        const link = annot && cleanUriLink(annot);
        if (link) links.push(link);
      }
    }
    for (const key of node.keys()) if (!PAGE_KEYS.has(key.decodeText())) node.delete(key);
    if (links.length) node.set(n("Annots"), from.context.obj(links.map((l) => from.context.register(l))));
    else node.delete(n("Annots"));
  }
  if (opts.prune) for (const i of new Set(idx)) assertPruned(from.context, from.getPage(i).node, built);
}
