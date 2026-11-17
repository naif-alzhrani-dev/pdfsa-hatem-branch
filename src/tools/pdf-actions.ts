/**
 * منطق الأفعال المشترك بين تسطيح النموذج (`fill-form-core.ts`، يحذف ما ليس في قائمة السماح) وفحص الملف
 * (`inspect-core.ts`، يكشف ولا يحذف). نُقل من `fill-form-core.ts` كما هو بلا تغيير في سلوكه (راجعه 🕵️ أمين ثلاث مرات).
 * و`…In` تأخذ دالة حلّ المرجع: للمستند نسخة واحدة لكل كائن، وللمرور الخام (`inspect-raw.ts`) كل نسخه.
 * ولا `push(...)` بمصفوفة: مصفوفة من مئات الآلاف تتجاوز حدّ وسائط الدالة فترمي (مراجعة 🕵️ أمين، D1 وE1).
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument } from "pdf-lib";

const N = (s: string) => PDFName.of(s);

/** كل ما يُحلّ إليه المرجع. */
export type Resolve = (ref: PDFRef) => readonly unknown[];
const inDoc = (doc: PDFDocument): Resolve => (r) => [doc.context.lookup(r)];

/** الأفعال المسموحة في `/A` وسلسلة `/Next` بعده (قرار نايف ٢٠٢٦/١١/١٠): قائمة سماح، فكل نوع غيرها يُحذف. */
export const SAFE_ACTIONS = new Set(["GoTo", "Named", "URI"]);
/** روابط /URI المسموحة: بلا حساسية للحالة، وبعد المسافات في أولها. */
export const SAFE_URI = /^(https?|mailto):/i;
/** أسماء /Named المسموحة: التنقّل بين الصفحات وحده (مراجعة 🕵️ أمين الثالثة)، فـ/Print و/SaveAs وغيرهما تُحذف. */
export const SAFE_NAMED = new Set(["NextPage", "PrevPage", "FirstPage", "LastPage"]);

/** هل الفعل وكل ما في سلسلة /Next بعده (قاموس أو مصفوفة) من `allowed`، وروابط /URI فيها من SAFE_URI. */
export function safeAction(doc: PDFDocument, a: unknown, allowed: ReadonlySet<string> = SAFE_ACTIONS): boolean {
  return safeActionIn(inDoc(doc), a, allowed);
}

/** `safeAction` بدالة حلّ: إن حُلّ المرجع إلى أكثر من نسخة فكلها يجب أن تكون آمنة. */
export function safeActionIn(resolve: Resolve, a: unknown, allowed: ReadonlySet<string> = SAFE_ACTIONS): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [a];
  const values = (o: PDFDict, k: string): readonly unknown[] => { const v = o.get(N(k)); return v instanceof PDFRef ? resolve(v) : [v]; };
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      for (const x of resolve(o)) stack.push(x);
      continue;
    }
    if (o === undefined || o === null) continue;
    if (o instanceof PDFArray) { for (const x of o.asArray()) stack.push(x); continue; }
    if (!(o instanceof PDFDict)) return false;
    const kinds = values(o, "S");
    if (!kinds.length) return false;
    for (const s of kinds) {
      if (!(s instanceof PDFName) || !allowed.has(s.decodeText())) return false;
      if (s.decodeText() === "URI") {
        const uris = values(o, "URI");
        if (!uris.length || !uris.every((u) => (u instanceof PDFString || u instanceof PDFHexString) && SAFE_URI.test(u.decodeText().trimStart()))) return false;
      }
      if (s.decodeText() === "Named") {
        const ns = values(o, "N");
        if (!ns.length || !ns.every((n) => n instanceof PDFName && SAFE_NAMED.has(n.decodeText()))) return false;
      }
    }
    stack.push(o.get(N("Next")));
  }
  return true;
}

/** عناصر البنية: كل قاموس يُبلَغ من /StructTreeRoot عبر سلسلة /K، إلا مراجع المحتوى (/MCR) والكائنات (/OBJR). */
export function structElems(doc: PDFDocument): Set<PDFDict> {
  const root = doc.catalog.lookup(N("StructTreeRoot"));
  return structElemsIn(inDoc(doc), root instanceof PDFDict ? [root.get(N("K"))] : []);
}

/** `structElems` بدالة حلّ، من قيم /K في `starts`. */
export function structElemsIn(resolve: Resolve, starts: readonly unknown[]): Set<PDFDict> {
  const out = new Set<PDFDict>();
  const seen = new Set<PDFRef>();
  const stack: unknown[] = [];
  for (const s of starts) stack.push(s);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      for (const x of resolve(o)) stack.push(x);
    } else if (o instanceof PDFArray) {
      for (const x of o.asArray()) stack.push(x);
    } else if (o instanceof PDFDict && !out.has(o)) {
      const t = o.get(N("Type"));
      const types = t instanceof PDFRef ? resolve(t) : [t];
      if (types.some((x) => x === N("MCR") || x === N("OBJR"))) continue;
      out.add(o);
      stack.push(o.get(N("K")));
    }
  }
  return out;
}
