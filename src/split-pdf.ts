/**
 * إخراج ملفات «تقسيم ملف»: لكل ملف صفحاته بالترتيب، منسوخةً بتنظيف `copy-clean` نفسه
 * (فلا يجرّ رابطٌ داخلي صفحةً لم تُختر). وثلاثة ملفات فأكثر تُحزم في ZIP يُكتب هنا بلا مكتبة.
 */
import { PDFDocument } from "pdf-lib";
import { copyPagesWithoutInternalLinks } from "./copy-clean";
import type { Files } from "./split-ranges";

export interface OutFile { name: string; bytes: Uint8Array }

/** «‹الاسم›-1.pdf»… بأرقام لاتينية، وتُملأ بالأصفار بعرض أكبر رقم (`-01`…`-12`). */
export function splitNames(fileName: string, count: number): string[] {
  const base = baseName(fileName);
  const width = String(count).length;
  return Array.from({ length: count }, (_, i) => `${base}-${String(i + 1).padStart(width, "0")}.pdf`);
}

export const baseName = (fileName: string) => safeEntryName(fileName.replace(/\.pdf$/i, ""));

const UNSAFE = /[/\\:*?"<>|\x00-\x1f\x7f‎‏‪-‮⁦-⁩]/g;
const EDGES = /^[.\s]+|[.\s]+$/g;
export const NAME_MAX = 100;
/**
 * اسم آمن لملف ناتج أو مدخل ZIP (ملاحظة 🕵️ أمين): لا فواصل مسار ولا محارف ممنوعة في ويندوز،
 * ولا محارف تحكّم، ولا محارف اتجاه تقلب عرض الاسم (`a‮fdp.exe`). كلها تُستبدل بـ«_»،
 * ثم تُزال النقاط والمسافات من الطرفين، ويُقصّ إلى ١٠٠ محرف، والفارغ «ملف».
 */
export function safeEntryName(name: string): string {
  const s = name.replace(UNSAFE, "_").replace(EDGES, "");
  const cut = Array.from(s).slice(0, NAME_MAX).join("").replace(EDGES, "");
  return cut || "ملف";
}

/** ملف PDF لكل قائمة صفحات (من ١). والملف الفارغ يُترك. */
export async function buildSplit(src: Uint8Array, files: Files, fileName: string): Promise<OutFile[]> {
  const parts = files.filter((f) => f.length);
  const names = splitNames(fileName, parts.length);
  const from = await PDFDocument.load(src, { updateMetadata: false });
  const out: OutFile[] = [];
  for (const [k, pages] of parts.entries()) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const copied = await copyPagesWithoutInternalLinks(doc, from, pages.map((p) => p - 1));
    for (const p of copied) doc.addPage(p);
    out.push({ name: names[k]!, bytes: await doc.save() });
  }
  return out;
}

/** ملفّان أو أقلّ: تُعطى كما هي (مشاركة دفعة واحدة). ثلاثة فأكثر: ZIP واحد «‹الاسم›.zip». */
export function packSplit(files: OutFile[], fileName: string, now = new Date()): OutFile[] {
  if (files.length < 3) return files;
  return [{ name: `${baseName(fileName)}.zip`, bytes: zipStore(files, now) }];
}

/* ─── ZIP بطريقة store (بلا ضغط: PDF مضغوط أصلاً)، مع CRC32، والأسماء UTF-8 (العلم 0x0800) ─── */

let crcTable: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8 = 0x0800;

export function zipStore(files: OutFile[], now = new Date()): Uint8Array {
  if (files.length > 0xffff) throw new RangeError("too many entries");
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;
    if (size > 0xfffffffe || offset > 0xfffffffe) throw new RangeError("zip64 not supported");
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // الإصدار المطلوب 2.0
    lh.setUint16(6, UTF8, true);
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, f.bytes);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, UTF8, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    // 30 extra، 32 comment، 34 disk، 36 internal، 38 external: أصفار
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
