/**
 * ترتيب أدوات الرئيسية (الإضافة ٢١، docs/logs/settings-21-lama-spec.md): أربع بلاطات تحت «توقيع ملف»، والباقي في «أدوات أخرى».
 * والاستبدال تبادل: الداخلة تأخذ خانة الخارجة في الرئيسية، والخارجة خانة الداخلة في «أدوات أخرى»، فيثبت العدد.
 * «توقيع ملف» و«إعداد خطاب» خارج التبادل (قرار نايف ٢٠٢٦/١١/١٤)، فلا يدخلان هنا.
 * يُحفظ على الجهاز وحده (`localStorage`)، وما يُقرأ يُتحقَّق منه بقائمة مسموحة: التالف يُتجاهل بصمت ويعود الأصل.
 * وإن تعذّرت الكتابة بقي الترتيب في الذاكرة حتى تُغلق الصفحة (نصّ هدى `SG.saveFailed`).
 */
export const LAYOUT_KEY = "pdfsa.homeTools";

/** بلاطات الرئيسية في الأصل، بترتيبها. */
export const HOME_DEFAULT = ["merge", "split", "edit", "scan"] as const;

export interface Layout { readonly home: readonly string[]; readonly more: readonly string[] }

/** الأصل: بلاطات الرئيسية، ثم «أدوات أخرى» بترتيب السجلّ (src/tools/registry.ts). */
export function defaultLayout(moreSlugs: readonly string[]): Layout {
  return { home: [...HOME_DEFAULT], more: [...moreSlugs] };
}

/**
 * القيمة المحفوظة بعد التحقّق، أو الأصل. الرئيسية أربع أدوات مختلفة من القائمة المسموحة وإلا فالأصل كله.
 * و«أدوات أخرى» ترتيبها المحفوظ لما بقي مسموحاً، ثم ما لم يُذكر بترتيب الأصل: فأداة تُضاف إلى السجلّ لاحقاً
 * تظهر آخر «أدوات أخرى» ولا يضيع اختيار المستخدم، وأداة تُحذف منه تسقط بلا أثر.
 */
export function parseLayout(raw: string | null, def: Layout): Layout {
  if (raw === null) return def;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return def; }
  if (typeof v !== "object" || v === null) return def;
  const { v: ver, home, more } = v as { v?: unknown; home?: unknown; more?: unknown };
  const allowed = new Set([...def.home, ...def.more]);
  if (ver !== 1 || !Array.isArray(home) || home.length !== def.home.length) return def;
  if (Array.isArray(more) && more.length > 64) return def; // أمين: سقف لما يُمرّ عليه، فقيمة مزروعة ضخمة لا تُقرأ
  if (!home.every((s) => typeof s === "string" && allowed.has(s)) || new Set(home).size !== home.length) return def;
  const inHome = new Set<string>(home);
  const kept: string[] = [];
  for (const s of Array.isArray(more) ? more : []) {
    if (typeof s === "string" && allowed.has(s) && !inHome.has(s) && !kept.includes(s)) kept.push(s);
  }
  const all = [...def.home, ...def.more];
  for (const s of all) if (!inHome.has(s) && !kept.includes(s)) kept.push(s);
  return { home: [...home] as string[], more: kept };
}

/** تبادل خانة الرئيسية `i` وخانة «أدوات أخرى» `j`. */
export function swapTools(l: Layout, i: number, j: number): Layout {
  if (!(i >= 0 && i < l.home.length && j >= 0 && j < l.more.length)) return l;
  const home = [...l.home], more = [...l.more];
  [home[i], more[j]] = [more[j]!, home[i]!];
  return { home, more };
}

/** نقل أداة داخل قسم واحد (`home` أو `more`) من `from` إلى `to`، وما بينهما يُفسح خانة. لا عبور بين القسمين، فالعددان ثابتان. */
export function moveWithin(l: Layout, part: "home" | "more", from: number, to: number): Layout {
  const list = l[part];
  if (!(from >= 0 && from < list.length && to >= 0 && to < list.length) || from === to) return l;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return part === "home" ? { home: next, more: l.more } : { home: l.home, more: next };
}

/** ترتيب أدوات بترتيب «أدوات أخرى» المحفوظ (`more`): ما ليس فيه يأتي بعده بترتيبه الأصلي. لـ«أدوات أخرى» بعد الحفظ (main.ts). */
export function byMoreOrder<T extends { slug: string }>(tools: readonly T[], more: readonly string[]): T[] {
  const rank = (t: T) => { const k = more.indexOf(t.slug); return k < 0 ? Infinity : k; };
  return [...tools].sort((a, b) => rank(a) - rank(b));
}

export const sameLayout = (a: Layout, b: Layout) =>
  a.home.length === b.home.length && a.more.length === b.more.length &&
  a.home.every((s, k) => s === b.home[k]) && a.more.every((s, k) => s === b.more[k]);

/** ما بقي في الذاكرة بعد فشل الكتابة: يُقرأ قبل التخزين حتى تُغلق الصفحة. */
let memo: Layout | null = null;

export function loadLayout(def: Layout): Layout {
  if (memo) return memo;
  let raw: string | null = null;
  try { raw = localStorage.getItem(LAYOUT_KEY); } catch { /* تخزين محجوب: الأصل */ }
  return parseLayout(raw, def);
}

/** يحفظ الترتيب، والأصل يُمحى مفتاحه. يُرجع false إن تعذّرت الكتابة، ويبقى الترتيب حينها في الذاكرة. */
export function saveLayout(l: Layout, def: Layout): boolean {
  try {
    if (sameLayout(l, def)) localStorage.removeItem(LAYOUT_KEY);
    else localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, home: l.home, more: l.more }));
    memo = null;
    return true;
  } catch {
    memo = l;
    return false;
  }
}

/** للاختبار وحده: يمحو ما بقي في الذاكرة. */
export function resetLayoutMemo() { memo = null; }
