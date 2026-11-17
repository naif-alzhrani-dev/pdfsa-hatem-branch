/**
 * محرّك «PDF إلى Word» على الجهاز وحده: يقرأ الملف بـpdf.js، ويعيد DOCX وتقريراً بما كُشف وما لم يُنقل.
 * لا يعرض نصاً: الواجهة تقرّر الرسالة من رموز النتيجة. ولا يستورد pdf.js بنفسه: يُمرَّر إليه (`build` في العامل،
 * و`legacy` في اختبارات Node)، فيبقى واحداً في الاثنين.
 * يُشغَّل في عامل بمهلة (`run.ts`)، وحارس `scanPdf` قبله يردّ الملف الكبير وقنابل الضغط (`../pdf-checks.ts`).
 */
import type * as Pdfjs from "pdfjs-dist";
import { scanPdf } from "../pdf-checks";
import { hasColumns, hasTextBox, isScanned, pageChrome, textLayer, type ApproxReason, type NotMoved, type TextLayer } from "./detect";
import { writeDocx } from "./docx";
import { fontsOf, glyphsFromOps, imagesOf, rectsOf, segmentsOf } from "./extract";
import { AR, LATIN, assemble, ligVotes, pageBlocks, tablesOf, type DocFlags, type FontInfo, type Item, type PageBlock, type Table } from "./layout";

/**
 * حدّ الصفحات. المحرّك يحفظ رموز الصفحات كلها حتى يلصق الفقرات عبرها، فالذاكرة تكبر مع الصفحات. المقيس
 * (`docs/logs/pdf-to-word-engine.md`، قياس واحد في Node بلا تحكّم في جمع الذاكرة، فهو تقريبي): ذروة نحو 0.45 MB لكل
 * صفحة نصّ كثيف (ملف نايف من 68 صفحة: 30 MB)، فـ300 صفحة نحو 135 MB. والجوال لم يُقس.
 */
export const MAX_PAGES = 300;
export type ConvertError = "too-big" | "bad-pdf" | "password" | "too-many-pages" | "cancelled";
export interface ConvertReport {
  pages: number;
  /** صفحات بلا نصّ وفيها صورة (1-based). كلها ممسوحة: `scannedPages.length === pages`. */
  scannedPages: number[];
  textLayer: TextLayer;
  /** صفحات بُنيت تقريباً: عمودان أو جدول بلا حدود، أو مربّع نصّ. */
  approximate: { page: number; reason: ApproxReason }[];
  /** ما لم يُنقل إلى الملف: الترويسة والتذييل وأرقام الصفحات (حُذفت من المتن)، والصور (ومعها `count`: عدد رسمها في تلك الصفحات). */
  notMoved: NotMoved[];
  /** ترتيب نصّ الترابط في ToUnicode: منطقيّ (Chrome) أو مقلوب سلفاً («إعداد خطاب»)، بالتصويت. */
  ligLogical: boolean;
  blocks: { paragraphs: number; headings: number; listItems: number; tables: number };
}
export type ConvertResult = { ok: true; docx: Uint8Array; report: ConvertReport } | { ok: false; error: ConvertError };
export interface ConvertOptions {
  pdfjs: Pick<typeof Pdfjs, "getDocument" | "OPS">;
  /** مسارات cMap والخطوط القياسية وغيرها لـ`getDocument`. */
  docParams?: Record<string, unknown>;
  maxPages?: number;
  /** بعد كل صفحة: العامل يرسلها، والمهلة لكل صفحة تُحسب منها. */
  onPage?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const PERSIAN = /[پچژگکۀ]/; // إن وُجدت فالنص فارسي، ولا يُطبَّع «ی ھ»

export async function convertPdf(bytes: Uint8Array, opts: ConvertOptions): Promise<ConvertResult> {
  const scan = scanPdf(bytes);
  if (scan.error) return { ok: false, error: scan.error };
  // كل ملف محمي يُردّ، ومنه ما يُفتح بلا كلمة (كلمة المالك وحدها): قرار نايف ٢٠٢٦/١١/١٣ «ترفض وتحيل» (ملاحظة 🕵️ أمين ٣)، والواجهة تحيل إلى «فك الحماية»
  if (scan.encrypted) return { ok: false, error: "password" };
  const { pdfjs } = opts;
  // pdf.js ينقل البايتات إلى عامله: نسخةٌ تبقى للمستدعي
  const task = pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true, ...opts.docParams });
  let doc: Pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    return { ok: false, error: (e as { name?: string })?.name === "PasswordException" ? "password" : "bad-pdf" };
  }
  try {
    if (doc.numPages > (opts.maxPages ?? MAX_PAGES)) return { ok: false, error: "too-many-pages" };
    const raw: { glyphs: Item[]; tables: Table[]; frames: Table[]; doubt: number; images: number; view: number[] }[] = [];
    const fonts: FontInfo = {};
    for (let i = 1; i <= doc.numPages; i++) {
      if (opts.signal?.aborted) return { ok: false, error: "cancelled" };
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();
      const glyphs = glyphsFromOps(pdfjs.OPS, ops, page.commonObjs);
      fontsOf(glyphs, page.commonObjs, fonts);
      const { tables, frames, doubt } = tablesOf(segmentsOf(pdfjs.OPS, ops), glyphs, rectsOf(pdfjs.OPS, ops));
      raw.push({ glyphs, tables, frames, doubt: doubt.length, images: imagesOf(pdfjs.OPS, ops), view: page.view });
      page.cleanup();
      opts.onPage?.(i, doc.numPages);
    }
    if (opts.signal?.aborted) return { ok: false, error: "cancelled" };

    const all = raw.flatMap((p) => p.glyphs);
    const base = all.filter((g) => !g.mark);
    const flags: DocFlags = {
      // المنتِج يكتب المسافة حرفاً: لا تُخترع مسافة من فجوة
      hasSpaces: base.length > 0 && base.filter((g) => /\s/.test(g.s)).length / base.length >= 0.03,
      docRtl: base.filter((g) => AR.test(g.s)).length > base.filter((g) => LATIN.test(g.s)).length,
      fixShared: !base.some((g) => PERSIAN.test(g.s)),
    };
    const votes = ligVotes(all);
    const ligLogical = votes.asIs <= votes.rev;
    const pages: PageBlock[][] = raw.map((r) => pageBlocks(r.glyphs, r.tables, fonts, ligLogical, flags));

    const chrome = pageChrome(pages, raw.map((r) => ({ y0: Math.min(r.view[1]!, r.view[3]!), y1: Math.max(r.view[1]!, r.view[3]!) })));
    const body = pages.map((p) => p.filter((b) => b.type !== "line" || !chrome.remove.has(b.line)));
    const blocks = assemble(body);

    const approximate: ConvertReport["approximate"] = [];
    raw.forEach((r, i) => {
      const area = Math.abs((r.view[2]! - r.view[0]!) * (r.view[3]! - r.view[1]!));
      if (hasColumns(body[i]!.flatMap((b) => (b.type === "line" ? [b.line] : [])))) approximate.push({ page: i + 1, reason: "columns" });
      if (hasTextBox(r.frames, r.glyphs, area)) approximate.push({ page: i + 1, reason: "text-box" });
      if (r.doubt) approximate.push({ page: i + 1, reason: "table" }); // شبكة مستطيلات رُفضت بالشكّ: الجدول خرج فقرات
    });
    const imagePages = raw.flatMap((r, i) => (r.images > 0 ? [i + 1] : []));
    const images = raw.reduce((n, r) => n + r.images, 0);
    const notMoved = [...chrome.found, ...(imagePages.length ? [{ kind: "image" as const, pages: imagePages, count: images }] : [])];
    const count = (t: string) => blocks.filter((b) => b.type === t).length;
    return {
      ok: true,
      docx: writeDocx(blocks),
      report: {
        pages: doc.numPages,
        scannedPages: raw.flatMap((r, i) => (isScanned(r.glyphs, r.images) ? [i + 1] : [])),
        textLayer: textLayer(all),
        approximate,
        notMoved,
        ligLogical,
        blocks: { paragraphs: count("p"), headings: count("h"), listItems: count("li"), tables: count("table") },
      },
    };
  } finally {
    void task.destroy();
  }
}
