/**
 * كتابة صفحات الخطاب في PDF (pdf-lib مع `@pdf-lib/fontkit`): نصّ حقيقي يُنسخ ويُبحث فيه، والخط مقصوص بـHarfBuzz ومضمَّن.
 *
 * نموذج النصّ: **النصّ بترتيبه البصري** في كل سطر، من اليسار إلى اليمين، متّصلاً في مصفوفة TJ واحدة ما أمكن. فيقرؤه
 * العارض (pdf.js وغيره) كما يقرأ PDF من Word: يجمع السطر ثم يعيده إلى الترتيب المنطقي بخوارزمية الاتجاه.
 *
 * - **العنقود** (حرف وعلاماته، أو ترابط مثل «لا»): الحرف الأعرض يحمل حروفه الأساسية، وكل علامة تشكيل يحملها حرفها
 *   (`glyphTexts`). وما لا نصّ له (النقط المنفصلة في نوتو نسخ وكوفي) يُرسم مساراً متّجهاً (XObject لكل حرف)، فلا يدخل
 *   النصَّ المنسوخ ما لم يُكتب (كانت التجربة تعطيه U+034F).
 * - **الحرف المزاح عن خطّ القاعدة** (الوصل في نوتو نسخ): يُرسم مساراً بموضعه، ونصّه خفيّ (Tr 3) على خطّ القاعدة،
 *   فلا يظنّه العارض سطراً آخر.
 * - **الحرف الواحد بنصّين** (بتشكيل وبلا تشكيل): رمزان (CID) لحرف واحد في `CIDToGIDMap`، لكلٍّ نصّه في ToUnicode،
 *   فيبقى لكل وجه قاموس خطّ واحد، ولا يتبدّل الخط وسط الكلمة.
 * - **خط الجهاز الذي يمنع ملفُه التضمين** (`Face.embed` «shapes»، قرار نايف ٢٠٢٦/١١/١٢): حروفه كلها مسارات، فلا قاموس خطّ
 *   له ولا نصّ، كما يفعل Word وAcrobat. و«whole» (fsType 0x0100) يُضمَّن كاملاً بلا قصّ.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFRef, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { frameLines, headerRect, PAGE_H, PAGE_W, type Box, type Page, type Run } from "./layout";
import { DEFAULT_SETUP, type LetterImage, type PageSetup } from "./model";
import type { Face } from "./shape";

type Subset = (bytes: Uint8Array, gids: Iterable<number>, wght: number) => Uint8Array;

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const u16 = (c: number) => (c > 0xffff ? hex4(0xd800 + ((c - 0x10000) >> 10)) + hex4(0xdc00 + ((c - 0x10000) & 0x3ff)) : hex4(c));
function chunks<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
const toUnicode = (entries: [number, string][]) =>
  [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000><ffff>", "endcodespacerange",
    ...chunks(entries, 100).flatMap((c) => [`${c.length} beginbfchar`, ...c.map(([cid, t]) => `<${hex4(cid)}> <${[...t].map((ch) => u16(ch.codePointAt(0)!)).join("")}>`), "endbfchar"]),
    "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
  ].join("\n");

const MARK = /\p{Mn}/u;

/**
 * نصّ كل حرف في القطعة لـToUnicode، أو null فيُرسم مساراً بلا نصّ (النقط المنفصلة).
 * - الحرف الأعرض في العنقود يحمل حروفه الأساسية، مقلوبةً في القطعة RTL إن كانت أكثر من محرف (الترابط «لا» و«في»)،
 *   لأن العارض يقلب السطر كله محرفاً محرفاً.
 * - وكل علامة تشكيل (Mn) يحملها حرفها نفسه في العنقود (بمطابقة الحرف الاسمي)، فيقرؤها pdf.js علامةً بلا عرض بعد حرفها.
 *   ولو حملها الحرف الأساسي لعدّه pdf.js كله علامة بلا عرض، فتنفصل الكلمة بمسافة. وما لم يُطابَق منها يلحق بأقرب علامة.
 */
export function glyphTexts(run: Run): (string | null)[] {
  const g = run.glyphs;
  const starts = [...new Set(g.map((x) => x.cluster))].sort((a, b) => a - b);
  const out: (string | null)[] = g.map(() => null);
  for (const c of starts) {
    const idx = g.flatMap((x, i) => (x.cluster === c ? [i] : []));
    const chars = [...run.text.slice(c, starts.find((k) => k > c) ?? run.text.length)];
    const carrier = idx.reduce((a, i) => (g[i]!.ax > g[a]!.ax ? i : a), idx[0]!);
    const base = chars.filter((ch) => !MARK.test(ch));
    const marks = chars.filter((ch) => MARK.test(ch));
    const free = new Set(idx.filter((i) => i !== carrier));
    const left: string[] = [];
    for (const m of marks) {
      const want = run.face.nominal(m.codePointAt(0)!);
      const hit = [...free].find((i) => g[i]!.gid === want);
      if (hit === undefined) { left.push(m); continue; }
      out[hit] = m;
      free.delete(hit);
    }
    const marked = idx.filter((i) => i !== carrier && out[i] !== null);
    if (left.length) {
      const into = marked[0] ?? [...free][0];
      if (into === undefined) base.push(...left);
      else out[into] = (out[into] ?? "") + left.join("");
    }
    // الترابط في القطعة RTL («لا»، «في»): مقلوباً، لأن pdf.js يقلب السطر محرفاً محرفاً بعد جمعه
    const t = run.rtl && base.length > 1 ? [...base].reverse().join("") : base.join("");
    out[carrier] = t || (out[carrier] ?? "");
  }
  return out;
}

const O = (name: string, args?: Parameters<typeof PDFOperator.of>[1]) => PDFOperator.of(name as never, args);
const num = (v: number) => PDFNumber.of(Math.round(v * 1000) / 1000);
const op = (name: string, ...args: number[]) => O(name, args.map(num));
/** عوامل لكل نداء pushOperators: النشر وسائطَ يتجاوز المكدّس فوق نحو مئة ألف عامل */
const OPS_BATCH = 1000;

function pathOps(d: string): PDFOperator[] {
  const ops: PDFOperator[] = [];
  const t = d.match(/[MLQCZ]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  let i = 0, cx = 0, cy = 0;
  const n = () => parseFloat(t[i++]!);
  while (i < t.length) {
    const c = t[i++];
    if (c === "M") { cx = n(); cy = n(); ops.push(op("m", cx, cy)); }
    else if (c === "L") { cx = n(); cy = n(); ops.push(op("l", cx, cy)); }
    else if (c === "Q") { const qx = n(), qy = n(), ex = n(), ey = n(); ops.push(op("c", cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey)); cx = ex; cy = ey; }
    else if (c === "C") { const a = [n(), n(), n(), n(), n(), n()]; ops.push(op("c", ...a)); cx = a[4]!; cy = a[5]!; }
    else if (c === "Z") ops.push(O("h"));
  }
  if (ops.length) ops.push(O("f"));
  return ops;
}

interface Used { face: Face; cids: Map<string, { cid: number; gid: number; text: string; w: number }>; paths: Set<number> }
interface Embedded { ref: PDFRef | null; widths: Map<number, number>; paths: Map<number, PDFRef> }
/** علامة التشكيل نصّاً: عرضها في W صفر، فيوافق pdf.js الذي يعدّها بلا عرض (`isZeroWidthDiacritic`) */
const markOnly = (t: string) => [...t].every((ch) => MARK.test(ch));

/** الصورة محتواةً في صندوقها ومتوسّطةً فيه (مواصفة لمى ٠-٤) */
export function containIn(b: Box, img: Pick<LetterImage, "w" | "h">): Box {
  const k = Math.min(b.w / img.w, b.h / img.h);
  const w = img.w * k, h = img.h * k;
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}

/** الخلفية تغطّي الصفحة كلها ومتوسّطةً فيها (مواصفة لمى v2 §٦)، وما زاد عن الصفحة يقصّه صندوقها */
export function coverPage(img: Pick<LetterImage, "w" | "h">): Box {
  const k = Math.max(PAGE_W / img.w, PAGE_H / img.h);
  const w = img.w * k, h = img.h * k;
  return { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h };
}

/** رسالة الخطأ حين تتعذّر صورة الخلفية في التصدير */
export const BACKGROUND_ERROR = "letter: background image";

export async function writePdf(pages: Page[], subset: Subset, setup: PageSetup = DEFAULT_SETUP): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setProducer("PDFsa");
  doc.setCreator("PDFsa");
  // الجولة الأولى: رمز لكل (حرف، نصّ) في كل وجه، والحروف التي تُرسم مسارات
  const used = new Map<string, Used>();
  // التاريخ أولاً ثم المتن ثم المربّعات (الدفعة و): ترتيب القراءة في النصّ المستخرج كما كان قبل أن يصير التاريخ عنصراً
  const order = (pg: Page) => [...pg.floats.filter((f) => f.key === "date"), { runs: pg.runs }, ...pg.floats.filter((f) => f.key !== "date")].flatMap((f) => f.runs);
  const plan = pages.map((pg) => order(pg).map((run) => {
    const u = used.get(run.face.id) ?? used.set(run.face.id, { face: run.face, cids: new Map(), paths: new Set() }).get(run.face.id)!;
    const ts = run.face.embed === "shapes" ? run.glyphs.map(() => null) : glyphTexts(run);
    const s = run.size / run.face.upem;
    const extra = run.space && run.glyphs.length ? (run.width - run.glyphs.reduce((a, g) => a + g.ax, 0) * s) / run.glyphs.length : 0;
    const cids = run.glyphs.map((g, i) => {
      const t = ts[i] ?? null;
      if (t === null || g.dx || g.dy) u.paths.add(g.gid);
      if (t === null || t === "") return -1;
      // رمز لكل (حرف، نصّ، تقدّم): عرضه في W هو تقدّمه المرسوم، فلا تصحيح في TJ يقرؤه pdf.js قفزةً تقطع السطر
      const w = markOnly(t) ? 0 : Math.round(((g.ax * s + extra) * 1000) / run.size);
      const k = `${g.gid}\u0000${t}\u0000${w}`;
      if (!u.cids.has(k) && u.cids.size + 1 > 0xffff) throw new Error("letter: over 0xFFFF codes in one face"); // ملاحظة أمين ن٢: الرمز بأربع خانات ست عشرية
      return (u.cids.get(k) ?? u.cids.set(k, { cid: u.cids.size + 1, gid: g.gid, text: t, w }).get(k)!).cid;
    });
    return { run, cids };
  }));
  // الجولة الثانية: القصّ والتضمين. يكتب pdf-lib قاموس الخط، ثم تُستبدل فيه W وCIDToGIDMap وToUnicode بالرموز
  const fonts = new Map<string, Embedded>();
  for (const [id, u] of used) {
    const entries = [...u.cids.values()];
    const paths = new Map<number, PDFRef>();
    for (const g of u.paths) {
      const e = u.face.extents(g);
      paths.set(g, doc.context.register(doc.context.formXObject(pathOps(u.face.path(g)), { BBox: [e.x0 - 1, e.y0 - 1, e.x1 + 1, e.y1 + 1] })));
    }
    if (u.face.embed === "shapes") { fonts.set(id, { ref: null, widths: new Map(), paths }); continue; } // لا رمز له (ts كلها null)
    const bytes = u.face.embed === "whole" ? u.face.bytes : subset(u.face.bytes, new Set([0, ...entries.map((e) => e.gid), ...u.paths]), u.face.wght);
    const font: PDFFont = await doc.embedFont(bytes, { subset: false });
    const E = (font as unknown as { embedder: { font: { unitsPerEm: number; getGlyph(id: number): { id: number; advanceWidth: number } }; glyphCache: unknown; embedUnicodeCmap: () => PDFRef } }).embedder;
    const widths = new Map(entries.map((e) => [e.cid, e.w])); // لكل رمز: تقدّمه المرسوم (HarfBuzz) لا عرضه في hmtx
    E.glyphCache = { access: () => [E.font.getGlyph(0)], invalidate() {} };
    E.embedUnicodeCmap = () => doc.context.register(doc.context.flateStream(toUnicode(entries.map((e) => [e.cid, e.text]))));
    await (font as unknown as { embed(): Promise<void> }).embed();
    const type0 = doc.context.lookup(font.ref, PDFDict);
    const cidFont = (type0.lookup(PDFName.of("DescendantFonts"), PDFArray)).lookup(0, PDFDict);
    const map = new Uint8Array((entries.length + 1) * 2);
    for (const e of entries) { map[e.cid * 2] = e.gid >> 8; map[e.cid * 2 + 1] = e.gid & 0xff; }
    cidFont.set(PDFName.of("CIDToGIDMap"), doc.context.register(doc.context.flateStream(map)));
    cidFont.set(PDFName.of("W"), doc.context.obj([1, entries.map((e) => widths.get(e.cid)!)]));
    fonts.set(id, { ref: font.ref, widths, paths });
  }
  // الصور: كل صورة تُضمَّن مرة واحدة
  const images = new Map<LetterImage, Promise<PDFImage>>();
  const image = (i: LetterImage) => images.get(i) ?? images.set(i, i.type === "png" ? doc.embedPng(i.bytes) : doc.embedJpg(i.bytes)).get(i)!;
  const drawImg = async (page: ReturnType<typeof doc.addPage>, i: LetterImage, b: Box) => {
    const r = containIn(b, i);
    page.drawImage(await image(i), { x: r.x, y: PAGE_H - r.y - r.h, width: r.w, height: r.h });
  };
  // الجولة الثالثة: الرسم بالترتيب البصري، وتحته الخلفية ثم الترويسة والإطار، وفوقه العناصر الحرّة
  const pdfPages = plan.map(() => doc.addPage([PAGE_W, PAGE_H]));
  for (let i = 0; i < pdfPages.length; i++) {
    if (setup.background) {
      const r = coverPage(setup.background);
      // خلفية لا يفكّها pdf-lib (سجلّ محفوظ معطوب، ملاحظة 🕵️ أمين م٦): خطأ باسمه، فتعرف الواجهة أن العلّة في الصورة
      let bg: PDFImage;
      try { bg = await image(setup.background); } catch { throw new Error(BACKGROUND_ERROR); }
      pdfPages[i]!.drawImage(bg, { x: r.x, y: PAGE_H - r.y - r.h, width: r.w, height: r.h });
    }
    const hd = headerRect(setup, i);
    if (hd) await drawImg(pdfPages[i]!, setup.header!.img, hd);
    for (const f of frameLines(setup)) pdfPages[i]!.drawRectangle({ x: f.inset, y: f.inset, width: PAGE_W - 2 * f.inset, height: PAGE_H - 2 * f.inset, borderWidth: f.width, borderColor: rgb(0, 0, 0) });
    for (const r of pages[i]!.rules ?? []) pdfPages[i]!.drawRectangle({ x: r.x, y: PAGE_H - r.y - r.h, width: r.w, height: r.h, color: rgb(0, 0, 0) }); // حدود الجداول
  }
  plan.forEach((runs, pi) => {
    const page = pdfPages[pi]!;
    const fname = new Map<string, PDFName>();
    const xname = new Map<string, PDFName>();
    const shapes: PDFOperator[] = [];
    const text: PDFOperator[] = [O("BT")];
    let tx = NaN, ty = NaN; // أين تقف مصفوفة النصّ بعد آخر حرف، فلا Tm جديدة ما دام السطر متّصلاً
    let invisible = false;
    let font = "";
    let arr: (PDFHexString | PDFNumber)[] = [];
    let deferred: PDFHexString[] = [];
    const flush = () => { if (arr.length) text.push(O("TJ", [doc.context.obj(arr as never) as unknown as PDFArray])); arr = []; };
    for (const { run, cids } of runs) {
      const f = fonts.get(run.face.id)!;
      const s = run.size / run.face.upem;
      const k1000 = 1000 / run.size; // من النقطة إلى وحدات TJ
      const extra = run.space && run.glyphs.length ? (run.width - run.glyphs.reduce((a, g) => a + g.ax, 0) * s) / run.glyphs.length : 0;
      const y = PAGE_H - run.y;
      let pen = run.x;
      const fkey = `${run.face.id}@${run.size}`;
      run.glyphs.forEach((g, i) => {
        const adv = g.ax * s + extra;
        const cid = cids[i]!;
        const offset = g.dx !== 0 || g.dy !== 0;
        if (cid < 0 || offset) {
          const k = `${run.face.id}#${g.gid}`;
          const name = xname.get(k) ?? xname.set(k, page.node.newXObject("G", f.paths.get(g.gid)!)).get(k)!;
          shapes.push(O("q"), op("cm", s, 0, 0, s, pen + g.dx * s, y + g.dy * s), O("Do", [name]), O("Q"));
        }
        if (cid < 0) {
          if (adv && ty === y && Math.abs(tx - pen) < 0.01) { arr.push(num(-adv * k1000)); tx += adv; }
        } else if (f.widths.get(cid) === 0 && ty !== y) {
          // علامة في أول السطر: يضمّها pdf.js إلى السطر السابق لأنه لا يقارن موضع العلامات، فتُكتب بعد حرفها
          deferred.push(PDFHexString.of(hex4(cid)));
        } else {
          if (font !== fkey) {
            flush();
            const name = fname.get(run.face.id) ?? fname.set(run.face.id, page.node.newFontDictionary("F", f.ref!)).get(run.face.id)!;
            text.push(O("Tf", [name, num(run.size)]));
            font = fkey;
          }
          if (ty !== y || Math.abs(tx - pen) > 0.01) { flush(); text.push(op("Tm", 1, 0, 0, 1, pen, y)); }
          if (offset !== invisible) { flush(); invisible = offset; text.push(op("Tr", offset ? 3 : 0)); }
          arr.push(PDFHexString.of(hex4(cid)));
          if (deferred.length) { arr.push(...deferred); deferred = []; }
          const fix = ((f.widths.get(cid)! * run.size) / 1000 - adv) * k1000; // W يقدّم العارض بعرض الحرف، والمرسوم بتقدّم HarfBuzz
          if (Math.abs(fix) > 0.001) arr.push(num(fix));
          tx = pen + adv;
          ty = y;
        }
        pen += adv;
      });
    }
    flush();
    text.push(O("ET"));
    // على دفعات: نشر كل العوامل وسائطَ نداءٍ واحد يتجاوز المكدّس في النصّ المتناوب الطويل (Maximum call stack)، والترتيب نفسه
    const all = [O("q"), op("g", 0), ...shapes, ...text, O("Q")];
    for (let i = 0; i < all.length; i += OPS_BATCH) page.pushOperators(...all.slice(i, i + OPS_BATCH));
  });
  for (const it of setup.items) {
    const pi = Math.min(it.page, pdfPages.length - 1); // صفحة اختفت: إلى آخر صفحة باقية بكسوره نفسها (البند ١٣)
    await drawImg(pdfPages[pi]!, it.img, { x: it.fx * PAGE_W, y: it.fy * PAGE_H, w: it.fw * PAGE_W, h: it.fh * PAGE_H });
  }
  return doc.save();
}
