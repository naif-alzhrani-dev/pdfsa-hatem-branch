/**
 * النصّ تحت الأغطية، وهل يشترك معه نصٌّ آخر (ملاحظتا أمين ٥ و٧، docs/logs/pen-p1.md «P1c»):
 * عنوان الملف واسمه قد يحملان الكلمة المخفية نفسها، فلا يُعرض العنوان ولا يُبقى، ولا يُبنى عليه الاسم.
 * والتقدير إلى الأوسع: كل قطعة نصّ يمسّ صندوقُها غطاءً تُعدّ مغطّاة كلها، ولو غطّى بعضها.
 */
import type { PdfRect } from "./redact-save";

/** قطعة نصّ من pdf.js (`getTextContent`): مصفوفتها في فضاء الصفحة الأصلي (نقاط PDF، قبل أي تدوير). */
export interface TItem { str: string; transform: number[]; width: number; height: number }

/**
 * نصوص القطع التي يمسّ صندوقها أحد الأغطية، ومعها قطع كل سطر موصولةً بترتيبها على السطر وبعكسه:
 * Chrome يكتب العربي حرفاً حرفاً بترتيب العرض، فالكلمة لا تظهر إلا بوصل حروفها من اليمين.
 */
export function coveredText(items: TItem[], rects: PdfRect[]): string[] {
  const out: string[] = [];
  const lines = new Map<string, { at: number; str: string }[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number];
    const la = Math.hypot(a, b) || 1, lc = Math.hypot(c, d) || 1, h = it.height || lc;
    const ux = a / la, uy = b / la, vx = c / lc, vy = d / lc;
    // من تحت خطّ القاعدة بربع الارتفاع (ما ينزل من الحروف) إلى أعلاها، وعلى طول القطعة
    const xs: number[] = [], ys: number[] = [];
    for (const s of [0, it.width]) for (const t of [-0.25 * h, h]) { xs.push(e + ux * s + vx * t); ys.push(f + uy * s + vy * t); }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (!rects.some(([rx0, ry0, rx1, ry1]) => Math.min(x1, rx1) > Math.max(x0, rx0) && Math.min(y1, ry1) > Math.max(y0, ry0))) continue;
    out.push(it.str);
    // السطر: اتجاهه وبُعد خطّ قاعدته عن الأصل، والموضع على السطر
    const key = `${Math.round(Math.atan2(uy, ux) * 100)}:${Math.round(-uy * e + ux * f)}`;
    lines.set(key, [...(lines.get(key) ?? []), { at: ux * e + uy * f, str: it.str }]);
  }
  for (const line of lines.values()) {
    if (line.length < 2) continue;
    const s = line.sort((p, q) => p.at - q.at).map((p) => p.str);
    out.push(s.join(""), [...s].reverse().join(""));
  }
  return out;
}

/**
 * للمقارنة: NFKC وحروف صغيرة، وبلا تشكيل ولا تطويل ولا علامات (NFD ثم حذف \p{M}: «José» = «Jose»)،
 * والأرقام العربية الهندية والفارسية لاتينية، والألف والياء والتاء المربوطة بصورة واحدة، و«ؤ ئ» بصورتين (ملاحظة أمين ٣، P1e).
 */
function words(s: string): string[] {
  const t = s.normalize("NFKC").toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[آأإٱ]/g, "ا");
  // صورتان لكل كلمة: «ؤ ئ» واواً وياءً («مسؤول» = «مسوول»)، وهمزةً («مسؤول» = «مسئول»). والمقارنة بأيّهما
  const forms = [t.replace(/ؤ/g, "و").replace(/ئ/g, "ي"), t.replace(/[ؤئ]/g, "ء")]
    .map((f) => f.normalize("NFD").replace(/[\p{M}ـ]/gu, "").replace(/ى/g, "ي").replace(/ة/g, "ه"));
  return [...new Set(forms.flatMap((f) => (f.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => [...w].length >= 2)))];
}

/**
 * يشترك `value` مع النصّ المغطّى: كلمة منه (حرفان فأكثر) داخل كلمة مغطّاة أو كلمة مغطّاة داخلها.
 * فـ«الكتاب» في الاسم يشترك مع «والكتاب» تحت الغطاء، و«محمد» تحت الغطاء مع «عقدمحمد» في الاسم.
 * و`covered` = null: النصّ المغطّى لم يُقرأ، فيُعدّ مشتركاً (يفشل مغلقاً، ملاحظة أمين ٤، P1e).
 */
export function sharesText(value: string, covered: string[] | null): boolean {
  if (covered === null) return true;
  const vs = words(value), cs = covered.flatMap(words);
  return vs.some((v) => cs.some((c) => v.includes(c) || c.includes(v)));
}

/**
 * النصّ تحت أغطية الصفحات (`coveredText` لكل صفحة بأغطيتها)، للمقارنة بالعنوان واسم الملف.
 * وnull إن تعذّرت قراءة نصّ صفحة: يُعدّ مشتركاً، فلا يُعرض العنوان والاسم «ملف» (يفشل مغلقاً، ملاحظة أمين ٤، P1e).
 */
export async function hiddenOf(pages: { text: () => Promise<{ items: unknown[] }>; rects: PdfRect[] }[]): Promise<string[] | null> {
  try {
    const parts = await Promise.all(pages.map(async (p) => {
      const tc = await p.text();
      return coveredText(tc.items.filter((it) => !!it && typeof it === "object" && "str" in it) as TItem[], p.rects);
    }));
    return parts.flat();
  } catch {
    return null;
  }
}
