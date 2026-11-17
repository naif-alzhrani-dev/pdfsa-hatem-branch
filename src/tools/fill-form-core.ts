/**
 * تسطيح النموذج بلا DOM: كل حقل ملأه المستخدم يصير صورة PNG في مستطيله (يرسمها المتصل بـcanvas بخطّ المنصة،
 * src/tools/fill-form.ts، لأن pdf-lib لا يشكّل العربية)، وكل حقل لم يُعطَ قيمة (للقراءة فقط، توقيع، زرّ) يُرسم مظهره
 * المحفوظ في الملف (/AP /N) كما هو. ثم تُحذف مداخل /Widget من الصفحات و/AcroForm من الفهرس، وكل كائن لم يعد يُبلَغ
 * من الذيل (`pruneUnreachable`)، فلا يبقى في الملف حقل ولا قيمته القديمة، ولا أوامر خفية (`stripActions`).
 * ويعمل في العامل (`runTool("fill-form")`).
 * `PDFForm.removeField` في pdf-lib 1.17.1 لا يُستعمل: يحذف من /Annots مرجع المظهر لا مرجع الحقل، فيبقى الحقل.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFInvalidObject, PDFName, PDFNumber, PDFRef, PDFStream,
  concatTransformationMatrix, degrees, drawImage, drawObject, popGraphicsState, pushGraphicsState, type PDFObject, type PDFPage,
} from "pdf-lib";
import { normRotation, placement, type PageGeom, type Rect } from "../coords";
import { checkInput, hasSignature } from "./pdf-checks";
import { safeAction, structElems } from "./pdf-actions";

export type FillError = "too-big" | "bad-pdf" | "failed";
/** `signed`: في الملف توقيع رقمي، والتسطيح يعيد كتابته ويحذف حقله فيبطل التوقيع. */
export type FillResult = { ok: true; bytes: Uint8Array; signed: boolean } | { ok: false; error: FillError };

/** معرّف التعليق كما يعطيه pdf.js (`Ref.toString()`): «12R»، و«12R1» للجيل غير الصفر. */
export const refKey = (num: number, gen: number) => (gen === 0 ? `${num}R` : `${num}R${gen}`);

/**
 * سقف الحقول (مداخل /Widget بعد حذف المكرّر) في الملف كله، وما فوقه bad-pdf. نماذج الجهات الكثيفة بضع مئات،
 * والشاشة تضع لكل حقل عنصر HTML. والسقف يحدّ عمل الحلقة قبل أن تبدأ.
 */
export const MAX_WIDGETS = 2000;

/** عكس `viewportToPdf` في coords.ts عند المقياس 1: نقطة من فضاء الصفحة إلى موضعها على الصفحة كما تُعرض. */
export function pdfToViewport(g: PageGeom, x: number, y: number): [number, number] {
  const [x0, y0, x1, y1] = g.view;
  switch (g.rotate) {
    case 0: return [x - x0, y1 - y];
    case 90: return [y - y0, x - x0];
    case 180: return [x1 - x, y - y0];
    case 270: return [y1 - y, x1 - x];
  }
}

/** مستطيل الحقل (/Rect بالنقاط) كما يراه القارئ على الصفحة المعروضة عند المقياس 1. */
export function readerRect(g: PageGeom, r: readonly [number, number, number, number]): Rect {
  const a = pdfToViewport(g, r[0], r[1]), b = pdfToViewport(g, r[2], r[3]);
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

const N = (s: string) => PDFName.of(s);
const nums = (a: unknown): number[] | null => {
  if (!(a instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < a.size(); i++) {
    const v = a.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
};

/** الصفحة المعروضة: CropBox ∩ MediaBox كما يعرضها pdf.js، و/Rotate. */
function geomOf(page: PDFPage): PageGeom {
  const m = page.getMediaBox(), c = page.getCropBox();
  const view: PageGeom["view"] = [Math.max(m.x, c.x), Math.max(m.y, c.y), Math.min(m.x + m.width, c.x + c.width), Math.min(m.y + m.height, c.y + c.height)];
  return { view, rotate: normRotation(page.getRotation().angle) };
}

/** مرجع المظهر العادي للحقل (/AP /N، أو حالته /AS في الخانات والراديو)، أو undefined إن لم يكن له مظهر. */
function appearanceRef(doc: PDFDocument, w: PDFDict): PDFRef | undefined {
  const ap = w.lookup(N("AP"));
  if (!(ap instanceof PDFDict)) return undefined;
  let n: unknown = ap.get(N("N"));
  const obj = n instanceof PDFRef ? doc.context.lookup(n) : n;
  if (obj instanceof PDFDict) {
    const as = w.lookup(N("AS"));
    n = as instanceof PDFName ? obj.get(as) : undefined;
  }
  return n instanceof PDFRef && doc.context.lookup(n) instanceof PDFStream ? n : undefined;
}

/**
 * يضيف XObject إلى موارد الصفحة باسم من عدّاد الصفحة. لا `newXObject` من pdf-lib: `PDFDict.uniqueKey` يبني قائمة المفاتيح
 * كلها في كل استدعاء، فتتضاعف كلفة الصفحة مع مربّع عدد حقولها.
 */
type AddXObject = (tag: string, ref: PDFRef) => PDFName;
function xobjects(page: PDFPage): AddXObject {
  const { XObject } = page.node.normalizedEntries();
  let n = 0;
  return (tag, ref) => {
    let name: PDFName;
    do name = N(`${tag}${n++}`); while (XObject.has(name));
    XObject.set(name, ref);
    return name;
  };
}

/** يرسم المظهر المحفوظ في مستطيل الحقل: صندوقه (/BBox بعد /Matrix) يُمدّ على /Rect، كما في المعيار (12.5.5). */
function drawAppearance(doc: PDFDocument, page: PDFPage, add: AddXObject, w: PDFDict, rect: number[]) {
  const ref = appearanceRef(doc, w);
  if (!ref) return;
  const dict = (doc.context.lookup(ref) as PDFStream).dict;
  const bbox = nums(dict.lookup(N("BBox")));
  const [a, b, c, d, e, f] = nums(dict.lookup(N("Matrix"))) ?? [1, 0, 0, 1, 0, 0];
  if (!bbox || bbox.length !== 4 || [a, b, c, d, e, f].some((v) => v === undefined)) return;
  const pts = [[bbox[0]!, bbox[1]!], [bbox[2]!, bbox[1]!], [bbox[0]!, bbox[3]!], [bbox[2]!, bbox[3]!]].map(([x, y]) => [a! * x! + c! * y! + e!, b! * x! + d! * y! + f!] as const);
  const tx0 = Math.min(...pts.map((p) => p[0])), tx1 = Math.max(...pts.map((p) => p[0]));
  const ty0 = Math.min(...pts.map((p) => p[1])), ty1 = Math.max(...pts.map((p) => p[1]));
  if (tx1 - tx0 <= 0 || ty1 - ty0 <= 0) return;
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0]!, rect[2]!), Math.min(rect[1]!, rect[3]!), Math.max(rect[0]!, rect[2]!), Math.max(rect[1]!, rect[3]!)];
  const sx = (rx1 - rx0) / (tx1 - tx0), sy = (ry1 - ry0) / (ty1 - ty0);
  const key = add("FlatWidget", ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy), drawObject(key), popGraphicsState());
}

/**
 * `marks`: لكل حقل في الشاشة (بمعرّف pdf.js) صورته في اتجاه القارئ، أو null إن تُرك فارغاً.
 * والحقل الذي ليس فيها يُرسم مظهره المحفوظ، إلا المخفيّ (/F: Hidden أو NoView).
 */
export async function flattenForm(bytes: Uint8Array, marks: ReadonlyMap<string, Uint8Array | null>): Promise<FillResult> {
  const input = checkInput(bytes);
  if (input) return { ok: false, error: input };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.getPageCount() < 1) return { ok: false, error: "bad-pdf" }; // pdf-lib يقبل ما لا فهرس فيه
  } catch {
    return { ok: false, error: "bad-pdf" };
  }
  const signed = hasSignature(doc.context.enumerateIndirectObjects(), (o): o is PDFDict => o instanceof PDFDict, (s) => PDFName.of(s));
  try {
    // مداخل كل صفحة بلا تكرار (المرجع نفسه مرة واحدة)، وعدّ الحقول قبل أي رسم
    const pages = doc.getPages();
    const plan: { page: PDFPage; entries: unknown[] }[] = [];
    let widgets = 0;
    for (const page of pages) {
      const annots = page.node.Annots();
      if (!annots) continue;
      const seen = new Set<string>();
      const entries: unknown[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const entry = annots.get(i);
        if (entry instanceof PDFRef) {
          const k = refKey(entry.objectNumber, entry.generationNumber);
          if (seen.has(k)) continue;
          seen.add(k);
        }
        entries.push(entry);
        const w = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
        if (w instanceof PDFDict && w.lookup(N("Subtype")) === N("Widget") && ++widgets > MAX_WIDGETS) return { ok: false, error: "bad-pdf" };
      }
      plan.push({ page, entries });
    }
    const drop = formObjects(doc); // مراجع الحقول تُحذف من الملف لا من الصفحات وحدها
    for (const { page, entries } of plan) {
      const geom = geomOf(page);
      const add = xobjects(page);
      const keep: unknown[] = [];
      for (const entry of entries) {
        const w = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
        if (!(w instanceof PDFDict) || w.lookup(N("Subtype")) !== N("Widget")) { keep.push(entry); continue; }
        if (entry instanceof PDFRef) drop.add(entry);
        const rect = nums(w.lookup(N("Rect")));
        if (!rect || rect.length !== 4) continue;
        // الحقل المكتوب مباشرة في /Annots لا مفتاح له: الشاشة لا تعرضه للكتابة، فيُرسم مظهره المحفوظ
        const key = entry instanceof PDFRef ? refKey(entry.objectNumber, entry.generationNumber) : null;
        if (key !== null && marks.has(key)) {
          const png = marks.get(key);
          if (!png) continue;
          const at = placement(geom, 1, readerRect(geom, rect as [number, number, number, number]));
          const name = add("FlatField", (await doc.embedPng(png)).ref);
          page.pushOperators(...drawImage(name, { x: at.x, y: at.y, width: at.width, height: at.height, rotate: degrees(at.rotate), xSkew: degrees(0), ySkew: degrees(0) }));
          continue;
        }
        const flags = (w.lookup(N("F")) as PDFNumber | undefined)?.asNumber?.() ?? 0;
        if (!(flags & 2) && !(flags & 32)) drawAppearance(doc, page, add, w, rect);
      }
      if (keep.length) page.node.set(N("Annots"), doc.context.obj(keep as never));
      else page.node.delete(N("Annots"));
    }
    doc.catalog.delete(N("AcroForm"));
    stripActions(doc, dropInvalid(doc));
    for (const page of pages) drop.delete(page.ref);
    pruneUnreachable(doc, drop);
    return { ok: true, bytes: await doc.save({ updateFieldAppearances: false }), signed };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** كل كائن في شجرة الحقول (/AcroForm /Fields و/Kids)، يُقرأ قبل حذف /AcroForm. */
function formObjects(doc: PDFDocument): Set<PDFRef> {
  const out = new Set<PDFRef>();
  const form = doc.catalog.lookup(N("AcroForm"));
  const stack: unknown[] = form instanceof PDFDict ? [form.get(N("Fields"))] : [];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (out.has(o)) continue;
      out.add(o);
      stack.push(doc.context.lookup(o));
    } else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v); // لا `push(...)`: انظر stripActions
    else if (o instanceof PDFDict) stack.push(o.get(N("Kids")));
  }
  return out;
}

/** تعليقات وسائط تُحذف من /Annots: أداة النماذج لا تحتاجها، وقد تحمل سكربتاً يعمل عند فتح الصفحة. */
const MEDIA_ANNOTS = new Set(["3D", "RichMedia", "Screen", "Movie", "Sound"]);

/**
 * هل يبقى /A في القاموس `d`؟ الحكم بالقاموس الحاوي لا بشكل القيمة: /A في عنصر بنية (`elems`، أو /Type /StructElem)
 * سماتٌ تبقى بأي شكل، وفي غيره لا يبقى إلا قاموس فعل مسموح، فالمصفوفة والتيار وقاموس /O بلا /S تُحذف.
 */
function keepA(doc: PDFDocument, d: PDFDict, elems: ReadonlySet<PDFDict>): boolean {
  if (elems.has(d) || d.lookup(N("Type")) === N("StructElem")) return true;
  const v = d.lookup(N("A"));
  return v instanceof PDFDict && safeAction(doc, d.get(N("A")));
}

/**
 * الكائن الذي لا يقرؤه pdf-lib (`PDFInvalidObject`) يُكتب كما قُرئ، فيقرؤه غيره فعلاً (مراجعة 🕵️ أمين الثالثة).
 * فيُحذف كل كائن معيب يُبلَغ إليه وكل مرجع إليه في قاموس أو مصفوفة، إلا ما كانت مراجعه كلها /Contents صفحة
 * (مفرداً أو في مصفوفته): تيار المحتوى رسمٌ لا فعل، والقارئ يعرضه اليوم. يُستدعى قبل `stripActions`.
 */
export function dropInvalid(doc: PDFDocument): Set<PDFDict> {
  const ctx = doc.context;
  const pages = new Set<PDFDict>(), contentArrays = new Set<PDFArray>();
  for (const page of doc.getPages()) {
    pages.add(page.node);
    const c = page.node.lookup(N("Contents"));
    if (c instanceof PDFArray) contentArrays.add(c);
  }
  type Use = { drop: () => void; content: boolean };
  const uses = new Map<PDFRef, Use[]>();
  const lostA = new Set<PDFDict>(); // قواميس حُذف /A منها، فيعاملها `stripActions` كالرابط الذي فقد فعله
  const use = (r: PDFRef, u: Use) => { const l = uses.get(r); if (l) l.push(u); else uses.set(r, [u]); };
  const seen = new Set<PDFRef>();
  const walked = new Set<unknown>();
  const stack: (PDFObject | undefined)[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      stack.push(ctx.lookup(o));
    } else if (o instanceof PDFDict || o instanceof PDFStream) {
      const d = o instanceof PDFStream ? o.dict : o;
      if (walked.has(d)) continue;
      walked.add(d);
      for (const [k, v] of d.entries()) {
        if (v instanceof PDFRef && ctx.lookup(v) instanceof PDFInvalidObject) use(v, { drop: () => { d.delete(k); if (k === N("A")) lostA.add(d); }, content: pages.has(d) && k === N("Contents") });
        else stack.push(v);
      }
    } else if (o instanceof PDFArray) {
      if (walked.has(o)) continue;
      walked.add(o);
      for (const v of o.asArray()) {
        if (v instanceof PDFRef && ctx.lookup(v) instanceof PDFInvalidObject) use(v, { drop: () => { const i = o.indexOf(v); if (i !== undefined) o.remove(i); }, content: contentArrays.has(o) });
        else stack.push(v);
      }
    }
  }
  for (const [ref, list] of uses) {
    if (list.every((u) => u.content)) continue;
    for (const u of list) u.drop();
    ctx.delete(ref);
  }
  return lostA;
}

/**
 * الأوامر الخفية لا تبقى في الناتج (قرار نايف ٢٠٢٦/١١/١٠)، بقائمة سماح على كل قاموس يُبلَغ من الذيل:
 * /AA يُحذف أينما كان، و/A يُحكم عليه بقاموسه (`keepA`)، وتعليق الرابط الذي فقد /A ولا /Dest له يُحذف من /Annots،
 * وكذلك تعليقات MEDIA_ANNOTS. ويبقى /OpenAction إن كان وجهة (مصفوفة أو سلسلة /GoTo)، وتُحذف شجرة /JavaScript من
 * /Names، وتبقى /EmbeddedFiles. والإشارات المرجعية تبقى بعناوينها و/Dest. يُستدعى بعد التسطيح وقبل `pruneUnreachable`.
 */
export function stripActions(doc: PDFDocument, lostA: ReadonlySet<PDFDict> = new Set()): void {
  const ctx = doc.context;
  const open = doc.catalog.lookup(N("OpenAction"));
  if (!(open instanceof PDFArray) && !safeAction(doc, doc.catalog.get(N("OpenAction")), new Set(["GoTo"]))) doc.catalog.delete(N("OpenAction"));
  const names = doc.catalog.lookup(N("Names"));
  if (names instanceof PDFDict) names.delete(N("JavaScript"));
  const lost = new Set<PDFDict>([...lostA].filter((d) => d.lookup(N("Subtype")) === N("Link"))); // روابط حُذف /A منها
  const elems = structElems(doc);
  const seen = new Set<PDFRef>();
  const dicts = new Set<PDFDict>();
  const stack: (PDFObject | undefined)[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      stack.push(ctx.lookup(o));
    } else if (o instanceof PDFDict || o instanceof PDFStream) {
      const d = o instanceof PDFStream ? o.dict : o;
      if (dicts.has(d)) continue;
      dicts.add(d);
      d.delete(N("AA"));
      if (d.has(N("A")) && !keepA(doc, d, elems)) {
        d.delete(N("A"));
        if (d.lookup(N("Subtype")) === N("Link")) lost.add(d);
      }
      for (const [, v] of d.entries()) stack.push(v);
    } else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v); // لا `push(...)`: مصفوفة من مئات الآلاف تتجاوز حدّ وسائط الدالة
  }
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep = annots.asArray().filter((e) => {
      const a = e instanceof PDFRef ? ctx.lookup(e) : e;
      if (!(a instanceof PDFDict)) return true;
      const st = a.lookup(N("Subtype"));
      if (st instanceof PDFName && MEDIA_ANNOTS.has(st.decodeText())) return false;
      return !(lost.has(a) && !a.has(N("Dest")));
    });
    if (keep.length === annots.size()) continue;
    if (keep.length) page.node.set(N("Annots"), ctx.obj(keep as never));
    else page.node.delete(N("Annots"));
  }
}

/**
 * التنظيف بعد التسطيح: `doc.save` يكتب كل كائن في السياق ولو لم يرتبط بشيء، فقيمة الحقل (/V) وأفعاله ومظهره القديم
 * تبقى في الملف بعد حذف مراجعها. فيُمرّ على الكائنات من الذيل (/Root و/Info و/Encrypt)، ولا يُعبر من كائنات `drop`
 * (الحقول، فمرجعٌ إليها من شجرة البنية مثلاً لا يُبقيها)، ويُحذف كل ما لم يُبلَغ إليه وما في `drop` (الفهرس لا يُحذف).
 * لا `copyPages` إلى ملف جديد: يُسقط الفهرس والإشارات المرجعية.
 */
export function pruneUnreachable(doc: PDFDocument, drop: ReadonlySet<PDFRef> = new Set()): number {
  const ctx = doc.context;
  const root = ctx.trailerInfo.Root;
  const seen = new Set<PDFRef>();
  const stack: (PDFObject | undefined)[] = [root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o) || (drop.has(o) && o !== root)) continue;
      seen.add(o);
      stack.push(ctx.lookup(o));
    } else if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v); // لا `push(...)`: انظر stripActions
    else if (o instanceof PDFStream) stack.push(o.dict);
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) { ctx.delete(ref); removed++; }
  return removed;
}
