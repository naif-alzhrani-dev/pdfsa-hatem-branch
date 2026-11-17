/**
 * «تحرير الملف»: `importDocx(bytes)` يحوّل ملف .docx إلى مستند الخطاب في عامل جديد يُنهى بـ`terminate()` عند المهلة،
 * كـ`convertDocx` (`../word-to-pdf/convert.ts`)، فلا يتجمّد الخيط الرئيسي (شرط 🕵️ أمين). والفحص الأول (`checkDocx`) هنا
 * قبل العامل لأنه لا يفكّ شيئاً. والأنواع وحدها تُستورد من المحوّل، فلا يدخل المحوّل حزمة الصفحة.
 */
import { checkDocx, type DocxError } from "../word-to-pdf/limits";
import type { DocxLetter, Dropped } from "./docx-import";
import { charCount, isLimitError, MAX_CHARS, normalizeDoc, type LetterDoc } from "./model";
import { SE } from "../strings";

/** `timeout`: تجاوز مهلته فأُنهي العامل. `failed`: تعطّل العامل أو رمى. `unsupported`: لا عامل. `cancelled`: أُلغي بـ`signal`. */
export type ImportError = DocxError | "timeout" | "unsupported" | "failed" | "cancelled";
export type ImportResult = { ok: true; letter: DocxLetter } | { ok: false; error: ImportError };

export interface ImportRequest { bytes: Uint8Array }
export type ImportMessage = { type: "done"; result: DocxLetter | DocxError } | { type: "error" };

/** مهلة الفكّ والتحويل. ملف `document.xml` بـ7.5 MB يُحوَّل في 774 ms على جهاز التطوير (المعالج 34%، السجلّ)، فالمهلة سعة للجوال البطيء لا تقدير. */
export const IMPORT_TIMEOUT_MS = 20_000;

export interface ImportOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** للاختبارات وحدها. */
  createWorker?: () => Worker;
}

export function importDocx(bytes: Uint8Array, o: ImportOptions = {}): Promise<ImportResult> {
  const bad = checkDocx(bytes);
  if (bad) return Promise.resolve({ ok: false, error: bad });
  if (!o.createWorker && typeof Worker === "undefined") return Promise.resolve({ ok: false, error: "unsupported" });
  if (o.signal?.aborted) return Promise.resolve({ ok: false, error: "cancelled" });
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = o.createWorker ? o.createWorker() : new Worker(new URL("./docx-import-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve({ ok: false, error: "unsupported" });
      return;
    }
    let done = false;
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), o.timeoutMs ?? IMPORT_TIMEOUT_MS);
    const abort = () => finish({ ok: false, error: "cancelled" });
    o.signal?.addEventListener("abort", abort, { once: true });
    function finish(out: ImportResult) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(out);
    }
    worker.onmessage = (e: MessageEvent<ImportMessage>) => {
      const m = e.data;
      if (m.type === "done") finish(typeof m.result === "string" ? { ok: false, error: m.result } : { ok: true, letter: m.result });
      else finish({ ok: false, error: "failed" });
    };
    const crashed = () => finish({ ok: false, error: "failed" });
    worker.onerror = (e) => { e.preventDefault?.(); crashed(); };
    worker.onmessageerror = crashed;
    const req: ImportRequest = { bytes };
    worker.postMessage(req);
  });
}

/**
 * «تحرير الملف» على شاشة النتيجة (مواصفة لمى §١، الدفعة ٣): يُجهَّز في الخلفية، و`over` فوق حدّ المحرّر بالرقمين، ولا قصّ أبداً.
 * والمستند يمرّ على `normalizeDoc` هنا أيضاً (فوق ١٢ جدولاً أو بشكل مرفوض: `failed`)، فلا يصل إلى المحرّر ما يرفضه.
 */
export type EditPrep =
  | { kind: "ready"; doc: LetterDoc; chars: number; notMoved: string[] }
  | { kind: "over"; chars: number; max: number }
  | { kind: "failed" };

/** الأداة التي فُتح منها «تحرير الملف»: تختار صيغة ما لا ينتقل (هدى، docs/logs/pdf2word-edit-raed.md) */
export type EditSource = "word-to-pdf" | "pdf-to-word";

export async function prepareEdit(bytes: Uint8Array, o: ImportOptions = {}, from: EditSource = "word-to-pdf"): Promise<EditPrep> {
  const r = await importDocx(bytes, o);
  if (!r.ok) return { kind: "failed" };
  if (r.letter.chars > MAX_CHARS) return { kind: "over", chars: r.letter.chars, max: MAX_CHARS };
  try {
    return { kind: "ready", doc: normalizeDoc(r.letter.doc), chars: r.letter.chars, notMoved: editNotMoved(r.letter.dropped, from) };
  } catch (e) {
    return isLimitError(e) && charCount(r.letter.doc) > MAX_CHARS ? { kind: "over", chars: r.letter.chars, max: MAX_CHARS } : { kind: "failed" };
  }
}

/** ما يختلف في المحرّر، سطراً لكل نوع بعدده (`SE`، نصوص هدى)، والخطوط بعددها لا بأسمائها */
export function editNotMoved(d: Dropped, from: EditSource = "word-to-pdf"): string[] {
  return [
    d.images ? SE.nmImages(d.images) : "",
    d.textBoxes ? SE.nmTextBoxes(d.textBoxes) : "",
    d.objects ? SE.nmObjects(d.objects) : "",
    d.complexTables ? (from === "pdf-to-word" ? SE.nmTablesFlat : SE.nmTables)(d.complexTables) : "",
    d.headerFooter ? SE.nmHeaderFooter : "",
    d.notes ? SE.nmNotes(d.notes) : "",
    d.tabs ? SE.nmTabs(d.tabs) : "",
    d.symbols ? SE.nmSymbols(d.symbols) : "",
    // من «PDF إلى Word» خطّ الملف (Arial) اختيار كاتبنا لا صاحب الملف (pdf-to-word/docx.ts)، فلا يُذكر، ويبقى الجدول البسيط بلا سطر
    d.unmappedFonts.length && from !== "pdf-to-word" ? SE.nmFonts(d.unmappedFonts.length) : "",
    d.format ? SE.nmFormat : "",
  ].filter(Boolean);
}
