/**
 * بدائل خطوط Word لـ«Word إلى PDF» (جدول لمى، docs/logs/fonts-lama-spec.md؛ والسجلّ docs/logs/fonts-build-1.md).
 * المحرّك لا يقرأ `w:cs` في docx: يرسم المقطع كله، عربيه ولاتينيه، بسلسلة خطّ `w:ascii` (`parser/docx_text.rs:396`)،
 * والحرف الذي لا يغطّيه يذهب إلى أول خطّ مسجَّل يغطّيه أبجدياً. فالربط هنا قبل التحويل: يُقرأ `w:cs` و`w:ascii` كلٌّ على حدة،
 * ثم يُكتب في `ascii`/`hAnsi` اسمُ البديل الذي يرسم العربي. والملفات تبقى بأسمائها (شرط RFN): الربط بالاسم في الكود.
 * واللاتيني (Times New Roman وArial وCalibri) يربطه جدول المحرّك نفسه بـTinos وArimo وCarlito (`render/font_subst.rs:703`)،
 * فلا يُعاد كتابته: يكفي أن تُعطى ملفاته.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { checkDocx } from "./limits";
import { PLEX_FILES } from "./fonts";

const L = "fonts/letter/";
/** ملفات كل عائلة بديلة في مكتبة الخطوط (`public/fonts/letter/`). */
export const FAMILY_FILES: Record<string, string[]> = {
  "IBM Plex Sans Arabic": PLEX_FILES,
  Amiri: [`${L}amiri/Amiri-Regular.ttf`, `${L}amiri/Amiri-Bold.ttf`],
  "Noto Naskh Arabic": [`${L}noto-naskh/NotoNaskhArabic-VF.ttf`],
  "Markazi Text": [`${L}markazi/MarkaziText-VF.ttf`],
  Tinos: [`${L}tinos/Tinos-Regular.ttf`, `${L}tinos/Tinos-Bold.ttf`],
  Arimo: [`${L}arimo/Arimo-VF.ttf`],
  Carlito: [`${L}carlito/Carlito-Regular.ttf`, `${L}carlito/Carlito-Bold.ttf`],
};

/** خطوط Word العربية التصميم: بديلها العربي يرسم المقطع (ولاتينيه معه، كما في جدول لمى إلا Simplified Arabic). */
export const ARABIC_SUBS: Record<string, string> = {
  "traditional arabic": "Amiri",
  "arabic typesetting": "Amiri",
  "simplified arabic": "Noto Naskh Arabic",
  "sakkal majalla": "Markazi Text",
};
/** خطوط Word اللاتينية: بديلها يربطه المحرّك بالاسم، والمطلوب ملفه وحده. */
export const LATIN_SUBS: Record<string, string> = {
  "times new roman": "Tinos",
  arial: "Arimo",
  calibri: "Carlito",
};
/**
 * معامل حجم البديل الأعرض: عرض الأصل ÷ عرض البديل للفقرة العربية نفسها بالحجم نفسه (measurements.json، ٢٠٢٦/١١/١٣):
 * Arabic Typesetting 316.47 ÷ Amiri 488.69، وTraditional Arabic 383.97 ÷ 488.69. يُضرب فيه `w:sz` و`w:szCs` في الـrPr نفسه.
 */
export const SIZE_FACTORS: Record<string, number> = {
  "arabic typesetting": 316.47 / 488.69,
  "traditional arabic": 383.97 / 488.69,
};

const PARTS = /^word\/(styles|document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const THEME = /^word\/theme\/theme\d*\.xml$/;
const key = (s: string | undefined) => s?.trim().toLowerCase();
/** قراءة من جدول بمفتاح من نصّ الملف: مفتاحٌ كـ`constructor` أو `__proto__` لا يلتقط شيئاً من `Object.prototype`. */
const own = <T>(table: Record<string, T>, k: string | undefined): T | undefined => (k !== undefined && Object.hasOwn(table, k) ? table[k] : undefined);
/** سقف مدخل واحد في الأرشيف: الحجم المعلن في الفهرس قد يكذب، وfflate يحجز المخزن بقدر ما أُعلن. فوقه يعود الملف كما هو. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface FontMapResult { docx: Uint8Array; families: string[]; rewritten: number; resized: number }

/**
 * يعيد كتابة الملف ببدائل خطوطه، ويعيد العائلات التي يحتاجها (بلا Plex: هو الملاذ الأخير دائماً).
 * ملف يرفضه `checkDocx`، أو لا يُفكّ، أو لا يحتاج بديلاً: يعود كما هو.
 */
export function mapDocxFonts(docx: Uint8Array, sizeFactors: Record<string, number> = SIZE_FACTORS): FontMapResult {
  const same: FontMapResult = { docx, families: [], rewritten: 0, resized: 0 };
  if (checkDocx(docx)) return same;
  let parts: Record<string, Uint8Array>;
  let tooBig = false;
  try {
    parts = unzipSync(docx, { filter: (f) => (f.originalSize > MAX_ENTRY_BYTES ? ((tooBig = true), false) : true) });
  } catch { return same; }
  if (tooBig) return same;
  const families = new Set<string>();
  let rewritten = 0;
  let resized = 0;
  const changed: Record<string, Uint8Array> = {};
  const mapBody = (body: string): string | undefined => {
    const rf = /<w:rFonts\b[^>]*>/.exec(body);
    if (!rf) return undefined;
    const attrs = readAttrs(rf[0]);
    const ascii = key(attrs.ascii ?? attrs.hAnsi);
    const cs = key(attrs.cs);
    const lat = own(LATIN_SUBS, ascii);
    if (lat) families.add(lat);
    const src = own(ARABIC_SUBS, cs) ? cs : own(ARABIC_SUBS, ascii) ? ascii : undefined;
    if (!src) return undefined;
    const sub = own(ARABIC_SUBS, src)!;
    families.add(sub);
    // بالموضع لا بـ`replace(نص, نص)`: قيم الملف (`$&` ونحوها) لا تُفسَّر أنماطَ استبدال
    let b = body.slice(0, rf.index) + setAttr(setAttr(rf[0], "ascii", sub), "hAnsi", sub) + body.slice(rf.index + rf[0].length);
    rewritten++;
    const f = own(sizeFactors, src);
    if (f) {
      const b2 = b.replace(/(<w:sz(?:Cs)?\s+w:val=")(\d+)(")/g, (_m, a: string, v: string, z: string) => `${a}${Math.max(2, Math.round(Number(v) * f))}${z}`);
      if (b2 !== b) { resized++; b = b2; }
    }
    return b;
  };
  for (const name of Object.keys(parts)) {
    if (THEME.test(name)) {
      for (const m of strFromU8(parts[name]!).matchAll(/<a:latin\s[^>]*typeface="([^"]+)"/g)) {
        const lat = own(LATIN_SUBS, key(decodeXml(m[1]!)));
        if (lat) families.add(lat);
      }
      continue;
    }
    if (!PARTS.test(name)) continue;
    const xml = strFromU8(parts[name]!);
    let touched = false;
    // مسح خطّي: كل `<w:rPr>` يُبحث عن إغلاقه مرة واحدة، فملفٌّ بوسوم بلا إغلاق لا يصير تربيعياً
    let out = "";
    let pos = 0;
    for (;;) {
      const o = xml.indexOf("<w:rPr>", pos);
      if (o < 0) break;
      const bStart = o + 7;
      const c = xml.indexOf("</w:rPr>", bStart);
      if (c < 0) break;
      const body = xml.slice(bStart, c);
      const b = mapBody(body);
      out += xml.slice(pos, bStart) + (b ?? body);
      if (b !== undefined) touched = true;
      pos = c;
    }
    out += xml.slice(pos);
    if (touched) changed[name] = strToU8(out);
  }
  if (!rewritten) return { ...same, families: [...families] };
  const out = zipSync({ ...parts, ...changed });
  // إعادة الضغط قد تكبّر الملف: ما يرفضه الحدّ بعدها يُحوَّل كما هو، والعائلات معه
  if (checkDocx(out)) return { ...same, families: [...families] };
  return { docx: out, families: [...families], rewritten, resized };
}

/** ملفات الخطوط لعائلات `families`، وPlex أولاً دائماً (الملاذ الأخير). */
export function fontFilesFor(families: string[]): string[] {
  const out = [...PLEX_FILES];
  for (const f of families) for (const p of FAMILY_FILES[f] ?? []) if (!out.includes(p)) out.push(p);
  return out;
}

function readAttrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/\sw:(\w+)="([^"]*)"/g)) o[m[1]!] = decodeXml(m[2]!);
  return o;
}

/** يضع `w:<name>="<value>"` في الوسم، بدلاً من القائم أو مضافاً قبل نهايته. */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\sw:${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, (_m, a: string, z: string) => a + value + z);
  return tag.replace(/\s*(\/?>)$/, ` w:${name}="${value}"$1`);
}

function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]!);
}
