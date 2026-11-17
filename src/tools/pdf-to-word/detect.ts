/**
 * «PDF إلى Word»: ما يكشفه المحرّك ويعيده نتيجةً، والواجهة تقرّر الرسالة.
 * - الصفحة الممسوحة: بلا نصّ وفيها صورة.
 * - طبقة النص الفاسدة: الحروف النادرة U+063B–063F لكل ألف حرف عربي.
 * - الصفحة التقريبية: عمودان (أو جدول بلا حدود)، أو مربّع نصّ.
 * - ما لم يُنقل: الترويسة والتذييل وأرقام الصفحات (تُحذف من المتن)، والصور.
 */
import type { Item, Line, PageBlock, Table } from "./layout";
import { itemInBox } from "./layout";

// ── طبقة النص الفاسدة ────────────────────────────────────────────────────────────────
const RARE = /[ػ-ؿ]/g;
const ARABIC_LETTER = /[ؠ-يٮ-ۓ]/g;
/**
 * العتبة: 5 في الألف. المقيس (ملحق `docs/logs/pdf-to-word-trial.md`، ٢٠٢٦/١١/١٣): 0.0 في الملفات الـ13 كلها وفي ملف حقيقي
 * سليم، و28.9 في ملف حقيقي فاسد الطبقة (ToUnicode فيه خاطئ). فالعتبة أبعد عن السليم
 * منها عن الفاسد بنحو ستة أضعاف، وهذه الحروف لا تكاد تقع في نصّ عربي صحيح. وتحت `MIN_LETTERS` حرف لا حكم: حرفٌ نادر
 * واحد في سطرين يبلغ العتبة وحده.
 */
export const CORRUPT_PER_1000 = 5;
export const MIN_LETTERS = 200;
export interface TextLayer { arabic: number; rare: number; per1000: number; corrupt: boolean }

export function textLayer(items: Item[]): TextLayer {
  let arabic = 0, rare = 0;
  for (const g of items) if (!g.mark) { arabic += g.s.match(ARABIC_LETTER)?.length ?? 0; rare += g.s.match(RARE)?.length ?? 0; }
  const per1000 = arabic ? (rare * 1000) / arabic : 0;
  return { arabic, rare, per1000, corrupt: arabic >= MIN_LETTERS && per1000 >= CORRUPT_PER_1000 };
}

/** صفحة بلا حرف مرسوم (عدا المسافات) وفيها صورة. */
export const isScanned = (items: Item[], images: number) => images > 0 && !items.some((g) => !g.mark && g.s.trim());

// ── الصفحات التقريبية ────────────────────────────────────────────────────────────────
export type ApproxReason = "columns" | "text-box" | "table";
/** فجوة داخل السطر بوحدة حجمه: أوسع من أوسع مسافة كلمة في سطر مضبوط. */
export const COLUMN_GAP = 2.5;

/**
 * عمودان: أسطر كثيرة فيها فجوة واسعة عند الموضع نفسه (±12 نقطة)، خمسة على الأقل وثلث أسطر الصفحة.
 * والجدول بلا حدود يكشفه هذا أيضاً، وكلاهما لا يُبنى صحيحاً اليوم.
 */
export function hasColumns(lines: Line[]): boolean {
  const xs = lines.filter((l) => l.gap.w > COLUMN_GAP).map((l) => l.gap.x).sort((p, q) => p - q);
  let best = 0;
  for (let i = 0, j = 0; j < xs.length; j++) { while (xs[j]! - xs[i]! > 24) i++; best = Math.max(best, j - i + 1); }
  return best >= 5 && best >= lines.length / 3;
}

/** مربّع نصّ: إطار بعمود واحد فيه نصّ، أصغر من نصف الصفحة (إطار الصفحة نفسها في Word ليس مربّعاً). */
export function hasTextBox(frames: Table[], items: Item[], pageArea: number): boolean {
  return frames.some((t) => (t.box[2] - t.box[0]) * (t.box[3] - t.box[1]) < pageArea / 2 && items.some((g) => !g.mark && g.s.trim() && itemInBox(g, t.box)));
}

// ── الترويسة والتذييل وأرقام الصفحات ─────────────────────────────────────────────────
export type NotMovedKind = "header" | "footer" | "page-number" | "image";
/** `count` للصور وحدها: كم صورةً رُسمت في `pages` (الصورة المكرّرة في كل صفحة تُعدّ في كلٍّ). */
export interface NotMoved { kind: NotMovedKind; pages: number[]; count?: number }
/** حدّ الهامش: عُشر الصفحة من أعلاها أو أسفلها. */
const BAND = 0.1;
const PAGE_NO = /^[\s\-–—(]*(?:صفحة|ص|page)?\s*[0-9٠-٩۰-۹]+(?:\s*(?:من|\/|of)\s*[0-9٠-٩۰-۹]+)?[\s\-–—)]*$/i;
const key = (t: string) => t.replace(/[0-9٠-٩۰-۹]+/g, "#").replace(/\s+/g, " ").trim();

/**
 * سطر في هامش الصفحة يتكرّر بنصّه (والأرقام سواء) وبموضعه (±4 نقاط) في صفحتين على الأقل ونصف الصفحات.
 * يُحذف من المتن، ويُعاد في «ما لم يُنقل»: لا ترويسة ولا تذييل في ملف Word الناتج.
 */
export function pageChrome(pages: PageBlock[][], geo: { y0: number; y1: number }[]): { remove: Set<Line>; found: NotMoved[] } {
  const remove = new Set<Line>();
  const found: NotMoved[] = [];
  if (pages.length < 2) return { remove, found };
  const groups = new Map<string, { band: "top" | "bottom"; y: number; hits: Map<number, Line> }[]>();
  pages.forEach((p, pi) => {
    const { y0, y1 } = geo[pi]!, h = y1 - y0;
    for (const b of p) {
      if (b.type !== "line") continue;
      const band = b.y > y1 - BAND * h ? "top" : b.y < y0 + BAND * h ? "bottom" : null;
      if (!band) continue;
      const k = `${band}|${key(b.line.text)}`;
      const list = groups.get(k) ?? groups.set(k, []).get(k)!;
      const g = list.find((g) => Math.abs(g.y - b.y) <= 4) ?? (list.push({ band, y: b.y, hits: new Map() }), list[list.length - 1]!);
      if (!g.hits.has(pi)) g.hits.set(pi, b.line);
    }
  });
  const need = Math.max(2, Math.ceil(pages.length / 2));
  const byKind = new Map<NotMovedKind, Set<number>>();
  for (const list of groups.values()) for (const g of list) {
    if (g.hits.size < need) continue;
    const kind: NotMovedKind = [...g.hits.values()].every((l) => PAGE_NO.test(l.text)) ? "page-number" : g.band === "top" ? "header" : "footer";
    for (const [pi, l] of g.hits) { remove.add(l); (byKind.get(kind) ?? byKind.set(kind, new Set()).get(kind)!).add(pi + 1); }
  }
  for (const [kind, ps] of byKind) found.push({ kind, pages: [...ps].sort((a, b) => a - b) });
  return { remove, found };
}
