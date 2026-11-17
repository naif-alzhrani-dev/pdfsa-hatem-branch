/**
 * عمليات الصفحات (أو الملفات في الدمج): دوالّ نقية لا تعرف الواجهة.
 * كلها تُرجع قائمة جديدة ولا تغيّر ما أُعطيت، والمواضع من الصفر.
 * وما لا يصحّ (موضع خارج القائمة، أو حذف آخر عنصر) يُرجع القائمة كما هي.
 */
export type PageOp =
  | { type: "move"; from: number; to: number }
  | { type: "delete"; index: number };

const inRange = (i: number, n: number) => Number.isInteger(i) && i >= 0 && i < n;

/** ينقل العنصر من `from` إلى `to`، ويُزاح ما بينهما. */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (!inRange(from, list.length) || !inRange(to, list.length) || from === to) return list.slice();
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** يحذف العنصر عند `index`. ولا يُحذف الأخير الباقي: الملف لا يكون بلا صفحة. */
export function remove<T>(list: readonly T[], index: number): T[] {
  if (!inRange(index, list.length) || list.length <= 1) return list.slice();
  return list.filter((_, i) => i !== index);
}

export function apply<T>(list: readonly T[], op: PageOp): T[] {
  return op.type === "move" ? move(list, op.from, op.to) : remove(list, op.index);
}

/** يطبّق قائمة عمليات بالترتيب. */
export function applyAll<T>(list: readonly T[], ops: readonly PageOp[]): T[] {
  return ops.reduce<T[]>((acc, op) => apply(acc, op), list.slice());
}

/** ما يجوز على العنصر عند `index` في قائمة طولها `n` (لتعطيل الأزرار). */
export function can(index: number, n: number) {
  return { before: index > 0, after: index < n - 1, remove: n > 1, position: n > 1 };
}

/** أسهم الصفحة المختارة في الشبكة المصغّرة (ج-٣): ↑ و↓ صفّ، و→ السابقة و← التالية. */
export type GridDir = "up" | "down" | "prev" | "next";

/**
 * الموضع الهدف لسهم في شبكة من `cols` أعمدة بترتيب القراءة، أو `null` إن كان السهم معطّلاً.
 * ↑ معطّل في الصفّ الأول، و↓ في الصفّ الأخير وحده: من الصفّ قبل الأخير، إن كان الأخير ناقصاً، ينقل إلى آخر موضع.
 * ← في آخر الصفّ ينقل إلى أول الصفّ التالي (وهو التالي في الترتيب).
 */
export function gridTarget(index: number, n: number, dir: GridDir, cols = 3): number | null {
  if (!inRange(index, n) || n < 2) return null;
  const row = Math.floor(index / cols), lastRow = Math.floor((n - 1) / cols);
  switch (dir) {
    case "up": return row > 0 ? index - cols : null;
    case "down": return row < lastRow ? Math.min(index + cols, n - 1) : null;
    case "prev": return index > 0 ? index - 1 : null;
    case "next": return index < n - 1 ? index + 1 : null;
  }
}
