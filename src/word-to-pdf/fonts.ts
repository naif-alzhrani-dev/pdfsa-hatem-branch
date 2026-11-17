/**
 * خطوط «Word إلى PDF». المحرّك بلا خطوط مضمّنة (docs/logs/word-to-pdf-engine.md)، فما يُرسم به هو ما يُعطى هنا بالبايتات:
 * - الموقع والجوال: خط المشروع IBM Plex Sans Arabic (عادي وعريض) من `public/fonts/letter/plex/`، وهو الملاذ الأخير لكل خط غائب.
 * - برنامج ويندوز: خطوط الجهاز بأسمائها التي يطلبها الملف، من بروتوكول pdfsafont (W14، فرع feat-desktop-app):
 *   `/list` قائمتها، و`/f/<id>` الوجه ملفاً. وPlex معها ملاذاً أخيراً.
 */
import { unzipSync, strFromU8 } from "fflate";
import { checkDocx } from "./limits";

export const PLEX_FILES = ["fonts/letter/plex/IBMPlexSansArabic-Regular.ttf", "fonts/letter/plex/IBMPlexSansArabic-Bold.ttf"];

export async function fetchFonts(paths: string[], base = import.meta.env.BASE_URL): Promise<Uint8Array[]> {
  return Promise.all(paths.map(async (p) => {
    const r = await fetch(new URL(`${base}${p}`, location.href));
    if (!r.ok) throw new Error(p);
    return new Uint8Array(await r.arrayBuffer());
  }));
}

/** أجزاء الملف التي تُسمّي خطوطاً: جدول الخطوط، والأنماط، والمتن، والترويسات والتذييلات. */
const FONT_PARTS = /^word\/(fontTable|styles|document|header\d*|footer\d*)\.xml$/;
/**
 * أسماء الخطوط التي يذكرها الملف، بلا تكرار: `w:font w:name` في جدول الخطوط، و`w:rFonts` (ascii/hAnsi/cs/eastAsia) في الباقي.
 * وخطوط السمة (`asciiTheme`…) لا تُقرأ: أسماؤها في theme1.xml.
 * ولا يُفكّ شيء قبل `checkDocx`: هذه القراءة على الخيط الرئيسي، والملف الذي يرفضه الحدّ (قنبلة، أو عدد مدخلات) لا يُقرأ.
 */
export function docxFontNames(docx: Uint8Array): string[] {
  if (checkDocx(docx)) return [];
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(docx, { filter: (e) => FONT_PARTS.test(e.name) });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const k of Object.keys(parts).sort()) {
    const xml = strFromU8(parts[k]!);
    for (const m of xml.matchAll(/<w:font\s[^>]*w:name="([^"]+)"|\sw:(?:ascii|hAnsi|cs|eastAsia)="([^"]+)"/g)) names.push(decodeXml((m[1] ?? m[2])!));
  }
  return [...new Set(names)];
}

function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]!);
}

/** عنصر من جواب pdfsafont `/list` (عقده في docs/logs/desktop/W14-system-fonts.md). */
export interface SystemFont { id: number; family: string; face: string; weight: number; italic: boolean; arabic: boolean; fsType: number }

/** سقف الوجوه المحمَّلة لملف واحد: كل وجه يُنسخ إلى العامل ويُحلَّل فيه. */
export const MAX_SYSTEM_FACES = 24;
/** fsType: البت 1 (0x0002) «ترخيص مقيَّد»: لا يُضمَّن في ملف. والمحرّك يضمّن ما يرسم به، فلا يُعطى. */
const RESTRICTED = 0x0002;

/**
 * معرّفات وجوه الجهاز التي يُرسم بها الملف: كل وجه عائلته اسمٌ في `names` (بلا اعتبار لحالة الحروف)، بترتيب `names`،
 * ما لم يكن مقيَّد الترخيص، حتى `MAX_SYSTEM_FACES`. و`skipped` المقيَّد منها، فيُعرف لماذا لم يُرسم بخطّه.
 */
export function pickSystemFonts(names: string[], list: SystemFont[]): { ids: number[]; skipped: string[] } {
  const ids: number[] = [];
  const skipped = new Set<string>();
  for (const n of names) {
    const key = n.trim().toLowerCase();
    for (const f of list) {
      if (f.family.trim().toLowerCase() !== key) continue;
      if (f.fsType & RESTRICTED) { skipped.add(f.family); continue; }
      if (ids.length < MAX_SYSTEM_FACES && !ids.includes(f.id)) ids.push(f.id);
    }
  }
  return { ids, skipped: [...skipped] };
}
