/**
 * ما يستعمله تدفّق محتوى PDF من أسماء الموارد، بفئاتها (ملاحظة أمين ١، docs/logs/pen-p1.md «P1b»).
 * يُقرأ به محتوى الصفحة وكل Form XObject ونقشٍ وخطّ Type3، فتُنسخ الصفحة بما ترسمه وحده،
 * لا بقاموس موارد مشترك يحمل صور صفحة أخرى ونصّها. ويقرؤه سكربت الفحص أيضاً (scripts/redact-check.mjs).
 */
export type Cat = "XObject" | "Font" | "ExtGState" | "Shading" | "ColorSpace" | "Pattern" | "Properties";
export const CATS: Cat[] = ["XObject", "Font", "ExtGState", "Shading", "ColorSpace", "Pattern", "Properties"];

type Tok = { k: "name"; v: string } | { k: "other" };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);

/** الاسم بعد فكّ `#xx`. */
function nameAt(b: Uint8Array, i: number): [string, number] {
  let j = i, s = "";
  while (j < b.length && isRegular(b[j]!)) {
    if (b[j] === 35 && j + 2 < b.length) { s += String.fromCharCode(parseInt(String.fromCharCode(b[j + 1]!, b[j + 2]!), 16)); j += 3; }
    else s += String.fromCharCode(b[j++]!);
  }
  return [s, j];
}
/** نهاية السلسلة الحرفية `( … )` بأقواسها المتداخلة ومحارف الهروب. */
function skipString(b: Uint8Array, i: number): number {
  let depth = 0;
  for (let j = i; j < b.length; j++) {
    const c = b[j]!;
    if (c === 92) { j++; continue; }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return j + 1;
  }
  return b.length;
}
/** بعد `ID`: بيانات الصورة المضمَّنة حتى `EI` محاطاً بفراغ. */
function skipInline(b: Uint8Array, i: number): number {
  for (let j = i + 1; j + 1 < b.length; j++) {
    if (b[j] === 69 && b[j + 1] === 73 && WS.has(b[j - 1]!) && (j + 2 >= b.length || WS.has(b[j + 2]!) || DELIM.has(b[j + 2]!))) return j + 2;
  }
  return b.length;
}

/** بايتات [i, j) نصّاً، على قطع: النشر وسائطَ يتجاوز المكدّس في رمز طويل من ملف المستخدم (Maximum call stack) */
function chars(b: Uint8Array, i: number, j: number): string {
  let s = "";
  for (let k = i; k < j; k += 8192) s += String.fromCharCode(...b.subarray(k, Math.min(j, k + 8192)));
  return s;
}

/** أسماء الموارد التي يستعملها المحتوى، لكل فئة. */
export function usedNames(b: Uint8Array): Map<Cat, Set<string>> {
  const used = new Map<Cat, Set<string>>(CATS.map((c) => [c, new Set<string>()]));
  const add = (c: Cat, t: Tok | undefined) => { if (t?.k === "name") used.get(c)!.add(t.v); };
  let ops: Tok[] = [];
  let depth = 0; // داخل مصفوفة أو قاموس: يُعدّ الكل معامِلاً واحداً
  let i = 0;
  while (i < b.length) {
    const c = b[i]!;
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }
    if (c === 40) { i = skipString(b, i); if (!depth) ops.push({ k: "other" }); continue; }
    if (c === 60 && b[i + 1] === 60) { depth++; i += 2; continue; }
    if (c === 62 && b[i + 1] === 62) { depth = Math.max(0, depth - 1); i += 2; if (!depth) ops.push({ k: "other" }); continue; }
    if (c === 60) { while (i < b.length && b[i] !== 62) i++; i++; if (!depth) ops.push({ k: "other" }); continue; }
    if (c === 91) { depth++; i++; continue; }
    if (c === 93) { depth = Math.max(0, depth - 1); i++; if (!depth) ops.push({ k: "other" }); continue; }
    if (c === 47) { const [v, j] = nameAt(b, i + 1); i = j; if (!depth) ops.push({ k: "name", v }); continue; }
    if (!isRegular(c)) { i++; continue; }
    let j = i;
    while (j < b.length && isRegular(b[j]!)) j++;
    const word = chars(b, i, j);
    i = j;
    if (depth) continue;
    if (/^[+\-.\d]/.test(word) || word === "true" || word === "false" || word === "null") { ops.push({ k: "other" }); continue; }
    switch (word) {
      case "Do": add("XObject", ops.at(-1)); break;
      case "Tf": add("Font", ops[0]); break;
      case "gs": add("ExtGState", ops.at(-1)); break;
      case "sh": add("Shading", ops.at(-1)); break;
      case "cs": case "CS": add("ColorSpace", ops.at(-1)); break;
      case "scn": case "SCN": add("Pattern", ops.at(-1)); break;
      case "BDC": case "DP": add("Properties", ops[1]); break;
      case "BI": {
        // قاموس الصورة المضمَّنة حتى ID: فضاء لونها قد يكون اسم مورد
        const dict: Tok[] = [];
        while (i < b.length) {
          while (i < b.length && WS.has(b[i]!)) i++;
          if (b[i] === 47) { const [v, k] = nameAt(b, i + 1); i = k; dict.push({ k: "name", v }); continue; }
          let k = i;
          while (k < b.length && isRegular(b[k]!)) k++;
          const w = chars(b, i, k);
          if (w === "ID") { i = skipInline(b, k); break; }
          if (k === i) k++; // محرف فاصل داخل القاموس ([ ] مثلاً)
          dict.push({ k: "other" });
          i = k;
        }
        dict.forEach((t, n) => { if (t.k === "name" && (t.v === "CS" || t.v === "ColorSpace")) add("ColorSpace", dict[n + 1]); });
        break;
      }
    }
    ops = [];
  }
  return used;
}
