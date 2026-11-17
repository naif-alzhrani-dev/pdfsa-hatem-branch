import { S } from "./strings";
import { baseName } from "./split-pdf";
import { SPR } from "./tools/protect-strings";
import { sharesText } from "./redact-text";

export type OutMode = "sign" | "edit" | "merged" | "scan" | "numbered" | "protected" | "unlocked";

/**
 * اسم الملف الناتج. وُضع توقيع أو ختم (ولو معه تاريخ): «‹الاسم›-موقّع». وإلا فبحسب ما جرى:
 * تحرير ← «-معدّل»، ودمج ← «-مدموج» (والاسم اسم أول ملف في الترتيب)، وترقيم الصفحات ← «-مرقّم»، وحماية بكلمة مرور ← «-مقفل»، وفتح القفل ← «-بلا-قفل»،
 * وتصوير ← الاسم كما هو («مستند-مصوّر»).
 * و`hidden` (مع الإخفاء): النصّ تحت الأغطية، أو null إن لم يُقرأ. إن اشترك معه الاسم صار «ملف» (`baseName` للفارغ)، فلا يحمل الاسمُ الكلمة المخفية (ملاحظة أمين ٧).
 * ومع الطمس تُضاف «-بطمس» آخراً دائماً (P1f، والكلمة من هدى ٢٠٢٦/١١/١٤)، بعد لاحقة المسار، و«-معدّل» لا تُضاف معها: «خطاب-بطمس»، و«خطاب-موقّع-بطمس».
 */
export function outputName(mode: OutMode, fileName: string, hasMarks: boolean, dateOnly = false, hidden?: string[] | null): string {
  let base = baseName(fileName);
  if (hidden !== undefined && sharesText(base, hidden)) base = baseName(""); // null: لم يُقرأ المغطّى، فيُعدّ مشتركاً
  // الفتح: «a-مقفل» ← «a-بلا-قفل». تُحذف «-مقفل» من آخر الاسم فقط، لا من وسطه
  if (mode === "unlocked" && base.endsWith(`-${SPR.suffix}`) && base.length > SPR.suffix.length + 1) base = base.slice(0, -(SPR.suffix.length + 1));
  const redacted = hidden !== undefined;
  if (mode === "scan" && !hasMarks) return redacted && !trailingSuffixes(base).includes(S.suffixRedacted) ? `${base}-${S.suffixRedacted}.pdf` : `${base}.pdf`;
  // تاريخ أو نصّ وحدهما لا يجعلان الملف «موقّعاً»: يبقى «معدّلاً» (وفي الدمج والتصوير كذلك). `dateOnly` من `writtenOnly`
  const suffix = hasMarks && dateOnly ? S.suffixEdited : hasMarks || mode === "sign" ? S.suffixSigned : mode === "edit" ? S.suffixEdited : mode === "numbered" ? S.suffixNumbered : mode === "protected" ? SPR.suffix : mode === "unlocked" ? S.suffixUnlocked : S.suffixMerged;
  // سلسلة الأدوات (tools-sheet.ts): الملف الناتج يُفتح في أداة أخرى باسمه، فلا تُضاف لاحقةٌ هي في آخره أصلاً
  // («خطاب-موقّع» يُوقَّع ثانيةً فيبقى «خطاب-موقّع»، و«خطاب-موقّع-معدّل» يُوقَّع فيبقى كما هو). المقارنة بآخر الاسم لا بحدّ كلمة
  const tail = trailingSuffixes(base), add: string[] = [];
  if (!tail.includes(suffix) && !(redacted && suffix === S.suffixEdited)) add.push(suffix);
  if (redacted && !tail.includes(S.suffixRedacted)) add.push(S.suffixRedacted);
  return `${[base, ...add].join("-")}.pdf`;
}

/** لواحق المنصة المتتالية في آخر الاسم، من الأخيرة إلى الأولى: «a-موقّع-معدّل» ← [معدّل، موقّع]. */
function trailingSuffixes(base: string): string[] {
  const all = [S.suffixSigned, S.suffixEdited, S.suffixMerged, S.suffixNumbered, SPR.suffix, S.suffixUnlocked, S.suffixRedacted], out: string[] = [];
  let rest = base;
  for (;;) {
    const hit = all.find((x) => rest.endsWith(`-${x}`) && rest.length > x.length + 1);
    if (!hit) return out;
    out.push(hit);
    rest = rest.slice(0, -(hit.length + 1));
  }
}

/** ما وُضع كتابةٌ وحدها (تاريخ أو نصّ، ولو معاً): لا توقيع ولا ختم، فالملف «معدّل» لا «موقّع». */
export function writtenOnly(kinds: readonly string[]): boolean {
  return kinds.length > 0 && kinds.every((k) => k === "date" || k === "text");
}
