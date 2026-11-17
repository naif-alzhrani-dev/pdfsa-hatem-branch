/**
 * «خطوط الجهاز» في برنامج ويندوز (الدفعة ٢ من W14، مواصفة 👩‍🎨 لمى `docs/logs/system-fonts-list-lama-spec.md`).
 * المصدر بروتوكول البرنامج `http://pdfsafont.localhost` (عقد W14): `GET /list` ثم `GET /f/<id>`. والجلب بـ`fetch` ثم
 * `ArrayBuffer` ثم `FontFace` لا `url()`، لأن `font-src 'self'` يرفض الأصل الآخر و`connect-src` وحده فيه.
 * والدوالّ النقية هنا مختبرة في `tests/letter-system-fonts.test.ts`.
 */
import { inWindowsApp } from "../install-env";
import { DEFAULT_FONT, type FontKey } from "./fonts";
import type { Embedding } from "./shape";

export const FONT_ORIGIN = "http://pdfsafont.localhost";

/** وجه واحد كما في `/list` */
export interface SysFont { id: number; family: string; face: string; weight: number; italic: boolean; arabic: boolean; fsType: number }
/** الخط المختار كما يُحفظ في الخطاب: بالعائلة والوجه، لا بـ`id` لأنه يتغيّر بين الجلسات (لمى) */
export interface SysRef { family: string; face: string }
export interface SysFamily { family: string; arabic: boolean; faces: SysFont[] }

/**
 * إذن التضمين من `fsType` (OpenType، جدول OS/2):
 * - البتات 0–3: 0x0002 Restricted يمنع، إلا إن كان معه 0x0004 (Preview & Print) أو 0x0008 (Editable)، فالأقلّ تقييداً يغلب.
 *   والبت 0 محجوز، فوحده لا قيد (53 وجهاً على جهاز نايف بقيمة 1).
 * - 0x0200 Bitmap embedding only: لا يُضمَّن من الخط إلا صوره النقطية، والمحرّك لا يضمّن صوراً نقطية، فيُرسم أشكالاً.
 * - 0x0100 No subsetting: يُضمَّن كاملاً بلا قصّ.
 */
export function embedding(fsType: number): Embedding {
  const p = fsType & 0x000f;
  const restricted = (p & 0x0002) !== 0 && (p & 0x000c) === 0;
  if (restricted || (fsType & 0x0200) !== 0) return "shapes";
  return (fsType & 0x0100) !== 0 ? "whole" : "subset";
}

/** للبحث: بلا تفريق بين الكبيرة والصغيرة، وأ إ آ ← ا، وى = ي، وة = ه (لمى) */
export const fold = (s: string): string => s.toLocaleLowerCase("en").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

const AR = new Intl.Collator("ar");
const EN = new Intl.Collator("en");

/** صفّ لكل عائلة: ما فيه وجه عربي أولاً بترتيب `ar`، ثم الباقي بترتيب `en` */
export function groupFamilies(list: SysFont[]): SysFamily[] {
  const by = new Map<string, SysFamily>();
  for (const f of list) {
    const g = by.get(f.family) ?? by.set(f.family, { family: f.family, arabic: false, faces: [] }).get(f.family)!;
    g.faces.push(f);
    g.arabic ||= f.arabic;
  }
  const all = [...by.values()];
  return [...all.filter((g) => g.arabic).sort((a, b) => AR.compare(a.family, b.family)), ...all.filter((g) => !g.arabic).sort((a, b) => EN.compare(a.family, b.family))];
}

export function filterFamilies(fams: SysFamily[], q: string): SysFamily[] {
  const k = fold(q.trim());
  return k ? fams.filter((g) => fold(g.family).includes(k)) : fams;
}

/** الوجه: غير المائل الأقرب إلى 400 (أو 700 مع «عريض»)، والأثقل عند التعادل. والعائلة المائلة كلها: أول وجه */
export function pickFace(faces: SysFont[], bold: boolean): SysFont {
  const want = bold ? 700 : 400;
  const up = faces.filter((f) => !f.italic);
  if (!up.length) return faces[0]!;
  return up.reduce((a, f) => {
    const d = Math.abs(f.weight - want) - Math.abs(a.weight - want);
    return d < 0 || (d === 0 && f.weight > a.weight) ? f : a;
  });
}

/** الخط المحفوظ في هذه القائمة، أو null فيرجع الخطاب إلى `DEFAULT_FONT` */
export const findRef = (list: SysFont[], r: SysRef): SysFont | null => list.find((f) => f.family === r.family && f.face === r.face) ?? null;

/** يُقبل من `/list` ما طابق العقد وحده */
export function parseList(json: unknown): SysFont[] {
  const fonts = (json as { fonts?: unknown })?.fonts;
  if (!Array.isArray(fonts)) throw new Error("fonts: list");
  return fonts.filter((f): f is SysFont =>
    !!f && Number.isInteger(f.id) && f.id >= 0 && typeof f.family === "string" && f.family !== "" && typeof f.face === "string"
    && Number.isInteger(f.weight) && typeof f.italic === "boolean" && typeof f.arabic === "boolean" && Number.isInteger(f.fsType) && f.fsType >= 0 && f.fsType <= 0xffff);
}

export interface SystemFonts {
  /** `/list` مرّة في الجلسة، ويُعاد الطلب بعد فشل */
  list(): Promise<SysFont[]>;
  /** الوجه المطلوب من العائلة (العادي المحفوظ أو العريض الأقرب) وبايتاته، مخزّنة للجلسة. وعند 409: `/list` من جديد ثم إعادة واحدة */
  face(r: SysRef, bold: boolean): Promise<{ font: SysFont; bytes: Uint8Array }>;
}

export function createSystemFonts(get: (url: string) => Promise<Response> = (u) => fetch(u)): SystemFonts {
  let list: Promise<SysFont[]> | null = null;
  const bytes = new Map<string, Promise<Uint8Array>>();
  const load = () => (list ??= get(`${FONT_ORIGIN}/list`).then(async (r) => { if (!r.ok) throw new Error(`fonts: list ${r.status}`); return parseList(await r.json()); }).catch((e) => { list = null; throw e; }));
  const resolve = async (r: SysRef, bold: boolean) => {
    const all = await load();
    const base = findRef(all, r);
    if (!base) throw new Error("fonts: gone");
    return bold ? pickFace(all.filter((f) => f.family === r.family), true) : base;
  };
  async function fetchFace(r: SysRef, bold: boolean, retry: boolean): Promise<{ font: SysFont; bytes: Uint8Array }> {
    const font = await resolve(r, bold);
    const key = `${font.family}\u0000${font.face}`;
    let p = bytes.get(key);
    if (!p) {
      p = get(`${FONT_ORIGIN}/f/${font.id}`).then(async (res) => {
        if (res.status === 409) throw Object.assign(new Error("fonts: changed"), { changed: true });
        if (!res.ok) throw new Error(`fonts: face ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      });
      bytes.set(key, p);
      p.catch(() => bytes.delete(key));
    }
    try { return { font, bytes: await p }; } catch (e) {
      if (retry && (e as { changed?: boolean }).changed) { list = null; return fetchFace(r, bold, false); }
      throw e;
    }
  }
  return { list: load, face: (r, bold) => fetchFace(r, bold, true) };
}

let shared: SystemFonts | null = null;
/** عميل الجلسة الواحد، تشترك فيه القائمة والمحرّك فلا يُجلب خط مرّتين */
export const systemFonts = (): SystemFonts => (shared ??= createSystemFonts());

/** الصفحة في برنامج ويندوز (`inWindowsApp`، الكشف القائم لـTauri في install-env.ts) */
export const inApp = (): boolean => inWindowsApp(location.protocol, location.hostname, navigator.userAgent, navigator.maxTouchPoints);

/** الخط المحفوظ في الخطاب: يبقى إن وُجد بعائلته ووجهه في قائمة الجهاز، وإلا `DEFAULT_FONT` (لمى). والستّة كما هي */
export function restoreFont(saved: FontKey | SysRef, list: SysFont[] | null): FontKey | SysRef {
  if (typeof saved === "string") return saved;
  return list && findRef(list, saved) ? saved : DEFAULT_FONT;
}
