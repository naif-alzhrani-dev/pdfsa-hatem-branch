/**
 * فحص ملف Word قبل التحويل (شرط أمين، docs/logs/word-to-pdf-amin.md): حجم الملف، ثم الفهرس المركزي لأرشيف ZIP
 * دون فكّ شيء: عدد المدخلات ومجموع ما تُعلن أنها تتمدّد إليه، ووجود `word/document.xml`.
 *
 * طبقة أولى لا الحماية كلها: الأحجام المعلنة في الفهرس قد تكذب. والحماية الحقيقية عامل يُنهى بمهلة (`convert.ts`).
 */
import { MAX_INPUT_BYTES } from "../tools/pdf-checks";

export { MAX_INPUT_BYTES };
/** مجموع المفكوك المعلن. ملف Word بصور تمدّده قريب من حجمه (الصور مضغوطة أصلاً)، والنص XML يتمدّد ١٠–٢٠ ضعفاً. */
export const MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;

/** `old-format`: ملف OLE2 بلا `EncryptedPackage` (‎.doc القديم وأخواته). `encrypted`: OLE2 فيه `EncryptedPackage` (ملف OOXML محميّ بكلمة مرور). */
export type DocxError = "too-big" | "bad-file" | "old-format" | "encrypted";

/** توقيع الملف المركّب OLE2 (CFB). والمحرّك يسمّي كل OLE2 مشفّراً (lib_pipeline.rs:193)، فيُفرَّق هنا قبل العامل. */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** اسم الدفق الذي يضع فيه Office الملف المحميّ، بـUTF-16LE كما تُكتب أسماء مدخلات الدليل في CFB. */
const ENCRYPTED_PACKAGE = new Uint8Array([..."EncryptedPackage"].flatMap((c) => [c.charCodeAt(0), 0]));

export function ole2Kind(bytes: Uint8Array): "old-format" | "encrypted" | null {
  if (bytes.byteLength < OLE2.length || OLE2.some((b, i) => bytes[i] !== b)) return null;
  const k = ENCRYPTED_PACKAGE, first = k[0]!;
  for (let i = bytes.indexOf(first); i >= 0 && i + k.length <= bytes.byteLength; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < k.length && bytes[i + j] === k[j]) j++;
    if (j === k.length) return "encrypted";
  }
  return "old-format";
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
/** الجزء الرئيسي لكل صيغة: بغيابه ليس الملف من صيغته. */
export const MAIN_PART = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" } as const;
export type OfficeFormat = keyof typeof MAIN_PART;

/**
 * `null`: يُحوَّل. `too-big`: الملف أو مفكوكه أو عدد مدخلاته فوق الحدّ، أو ZIP64. `bad-file`: ليس أرشيفاً من صيغة `format`.
 * و`old-format`/`encrypted`: ملف OLE2 (`ole2Kind`).
 */
export function checkOffice(bytes: Uint8Array, format: OfficeFormat): DocxError | null {
  const main = MAIN_PART[format];
  if (bytes.byteLength > MAX_INPUT_BYTES) return "too-big";
  const ole = ole2Kind(bytes);
  if (ole) return ole;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // سجلّ نهاية الفهرس: 22 بايتاً وتعليق حتى 65535
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) { end = i; break; }
  }
  if (end < 0) return "bad-file";
  const count = v.getUint16(end + 10, true);
  const size = v.getUint32(end + 12, true);
  const start = v.getUint32(end + 16, true);
  // ZIP64 (قيم مشبَّعة): ملف Word تحت 100 MB لا يحتاجه
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) return "too-big";
  if (count > MAX_ENTRIES) return "too-big";
  if (start + size > end) return "bad-file";
  let at = start;
  let total = 0;
  let hasMain = false;
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || v.getUint32(at, true) !== CEN) return "bad-file";
    const unzipped = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    total += unzipped;
    if (total > MAX_UNZIPPED_BYTES) return "too-big";
    if (at + 46 + nameLen > end) return "bad-file";
    if (dec.decode(bytes.subarray(at + 46, at + 46 + nameLen)) === main) hasMain = true;
    at += 46 + nameLen + extraLen + commentLen;
  }
  return hasMain ? null : "bad-file";
}

export const checkDocx = (bytes: Uint8Array) => checkOffice(bytes, "docx");
