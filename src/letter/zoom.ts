/**
 * درجات «الكتابة» على الصفحة (v2 الدفعة د، مواصفة لمى §٠ و§٢): `--k = 1.3333px × --z`، فالدرجة `z` نسبة المقاس على الشاشة
 * إلى مقاس الورقة بالبكسل CSS (96 في البوصة). وبلا DOM، فتُختبر في vitest (tests/letter-zoom.test.ts).
 */
import { PAGE_W } from "./layout";

/** بكسل CSS لكل نقطة */
export const PX = 96 / 72;
/** أعلى درجة: ٢٠٠٪ «مثل Word» (قرار المدير ٢٠٢٦/١١/١٢ بعد ملاحظة 🕵️ أمين، وكانت ١٢٥٪)، والإصبعان وحدّ «+» يتبعانها */
export const ZOOM_MAX = 2;
export type ZoomKey = "page" | "line" | "z75" | "z100" | "z125" | "z150" | "z200";
/** الدرجة التي تُفتح بها «الكتابة» على الجوال (قرار نايف: «عرض السطر»، ويُغيَّر هنا إلى "z100" إن أراد) */
export const DEFAULT_ZOOM: ZoomKey = "line";
/** وعلى الكمبيوتر «الصفحة كاملة» محصورةً بـ١٠٠٪ (§٣ آخره) */
export const DEFAULT_ZOOM_WIDE: ZoomKey = "page";
export interface ZoomLevel { key: ZoomKey; z: number }

/**
 * الدرجات تصاعدياً لعرض المسرح `stageW` وحاشيته `gutter` من كل جهة، وعرض عمود المتن `contentW` بالنقطة.
 * «الصفحة كاملة» أدناها (وعلى الكمبيوتر لا تتجاوز ١٠٠٪)، و٢٠٠٪ أعلاها، وتُدمج درجتان بينهما أقلّ من ٣٪ فتبقى الأولى المسمّاة.
 */
export function zoomLevels(stageW: number, gutter: number, contentW: number, wide: boolean): ZoomLevel[] {
  const room = Math.max(1, stageW - 2 * gutter);
  let page = room / (PAGE_W * PX);
  if (wide) page = Math.min(1, page);
  page = Math.min(page, ZOOM_MAX);
  const all: ZoomLevel[] = [
    { key: "page", z: page },
    { key: "line", z: room / (contentW * PX) },
    { key: "z75", z: 0.75 }, { key: "z100", z: 1 }, { key: "z125", z: 1.25 }, { key: "z150", z: 1.5 }, { key: "z200", z: ZOOM_MAX },
  ];
  const named = (k: ZoomKey) => k === "page" || k === "line";
  const sorted = all.filter((l) => l.z >= page - 1e-9 && l.z <= ZOOM_MAX + 1e-9).sort((a, b) => a.z - b.z || (named(a.key) ? -1 : 1));
  const out: ZoomLevel[] = [];
  for (const l of sorted) {
    const prev = out.at(-1);
    if (prev && (l.z - prev.z) / prev.z < 0.03) { if (named(l.key) && !named(prev.key)) out[out.length - 1] = l; continue; }
    out.push(l);
  }
  return out;
}

/** قيمة الدرجة `key` في القائمة، أو أقرب ما فيها إن دُمجت (عرض السطر في ١٠٠٪ مثلاً) */
export function zoomOf(levels: ZoomLevel[], key: ZoomKey): number {
  const hit = levels.find((l) => l.key === key);
  if (hit) return hit.z;
  // «عرض السطر» فوق ٢٠٠٪ (هوامش واسعة على شاشة عريضة) تصير ٢٠٠٪
  const want = ({ z75: 0.75, z100: 1, z125: 1.25, z150: 1.5 } as Partial<Record<ZoomKey, number>>)[key] ?? ZOOM_MAX;
  return levels.reduce((a, l) => (Math.abs(l.z - want) < Math.abs(a.z - want) ? l : a), levels[0]!).z;
}

/** الدرجة التالية فوق `z` أو تحتها (حبّة «+» و«−»)، أو null عند الحدّ */
export function zoomStep(levels: ZoomLevel[], z: number, dir: 1 | -1): ZoomLevel | null {
  if (dir > 0) return levels.find((l) => l.z > z + 0.005) ?? null;
  return [...levels].reverse().find((l) => l.z < z - 0.005) ?? null;
}

/** حدود التقريب بالإصبعين: «الصفحة كاملة» و٢٠٠٪ */
export const clampZoom = (levels: ZoomLevel[], z: number) => Math.min(ZOOM_MAX, Math.max(levels[0]!.z, z));

/** النسبة المكتوبة على الحبّة */
export const zoomPercent = (z: number) => Math.round(z * 100);

/* ١٥ و١٨ (docs/logs/additions-12-15-18-lama-spec.md) */
/** درجة الفتح (١٥ «الحجم الأصلي»): «عرض السطر» على الجوال، و«الصفحة كاملة» محصورةً بـ١٠٠٪ على العريض. لا ١٠٠٪ */
export const openZoom = (levels: ZoomLevel[], wide: boolean) => zoomOf(levels, wide ? DEFAULT_ZOOM_WIDE : DEFAULT_ZOOM);
/** الدرجة `z` هي درجة الفتح (فرق أقلّ من 0.005 كحدّي «+» و«−»)، فزرّ «الحجم الأصلي» معطّل */
export const atOpenZoom = (levels: ZoomLevel[], z: number, wide: boolean) => Math.abs(z - openZoom(levels, wide)) < 0.005;

/** هامش القرص حول العنصر المحدَّد بالبكسل (١٨) */
export const PINCH_MARGIN = 24;
/**
 * قاعدة القرص (١٨): للعنصر المحدَّد إن كان أحد الإصبعين عليه أو في هامش `margin` حوله **عند نزول الإصبع الثاني**،
 * وإلا للصفحة كما كان. `box` صندوق العنصر على الشاشة، أو null بلا عنصر محدَّد
 */
export function pinchOnItem(box: { left: number; top: number; right: number; bottom: number } | null, fingers: { x: number; y: number }[], margin = PINCH_MARGIN): boolean {
  if (!box) return false;
  return fingers.some((p) => p.x >= box.left - margin && p.x <= box.right + margin && p.y >= box.top - margin && p.y <= box.bottom + margin);
}
