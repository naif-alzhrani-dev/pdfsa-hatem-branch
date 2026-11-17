/**
 * ١٤: التراجع والإعادة في «إعداد خطاب» (docs/logs/additions-14-17-lama-spec.md، «سجلّ واحد هو سجلّ TipTap»).
 * ما يكتبه `ui.ts` في `st` خارج المحرّر (الخط، والإطار، والخلفية، والهوامش، والترويسة، والتاريخ، ومواضع العناصر العائمة)
 * يُرفع إلى سمات عقدة المستند بـ`tr.setDocAttribute` (prosemirror-transform 1.12.5، DocAttrStep)، فيدخل `UndoRedo` بترتيبه مع الكتابة.
 * والصور (الخلفية والترويسة) خارج المستند: السمة معرّفٌ في خريطة بالذاكرة (`ui.ts`)، لا تُخزَّن في localStorage.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMDocNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * بترتيب الأولوية في اسم الفعل: العناصر أولاً، لأن إضافة عنصر أو حذفه تغيّر مواضعها (`ltPos`) معها، والهوامش آخراً، لأن الإطار والخلفية يغيّرانها معهما.
 * `ltItems` معرّفات العناصر الحرّة بترتيبها (قرار نايف ٢٠٢٦/١١/١٥ «أ» و«نعم»)، والعنصر نفسه في خريطة بالذاكرة (`ui.ts`) كالصور.
 */
export const LT_KEYS = ["ltItems", "ltFont", "ltFrame", "ltBg", "ltHeader", "ltDate", "ltPos", "ltMargins"] as const;
export type LtKey = (typeof LT_KEYS)[number];
export type LtAttrs = Record<LtKey, unknown>;

/** مواصفة السمات لعقدة `doc` (للمخطّط في الاختبار، وللامتداد) */
export const LT_ATTR_SPEC = Object.fromEntries(LT_KEYS.map((k) => [k, { default: null }])) as Record<LtKey, { default: null }>;

/** السمات على `doc` في المحرّر، بلا رسم في HTML (المستند جذرٌ لا يُرسم) */
export const LetterAttrs = Extension.create({
  name: "letterAttrs",
  addGlobalAttributes: () => [{ types: ["doc"], attributes: Object.fromEntries(LT_KEYS.map((k) => [k, { default: null, rendered: false }])) }],
});

/** المقارنة بالقيمة: السمات لقطات JSON */
export const sameVal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** لقطة لا يتسرّب إليها تعديلٌ لاحق على `st` */
export const clone = <T>(v: T): T => (v == null ? (null as T) : (JSON.parse(JSON.stringify(v)) as T));

/** ما يخالف المستندَ من `next` */
export function diffAttrs(doc: PMDocNode, next: LtAttrs): LtKey[] {
  return LT_KEYS.filter((k) => !sameVal(doc.attrs[k], next[k]));
}
/** يكتب المختلف في المعاملة، ويُرجع ما كُتب */
export function putAttrs(tr: Transaction, next: LtAttrs, only: readonly LtKey[] = LT_KEYS): LtKey[] {
  const keys = diffAttrs(tr.doc, next).filter((k) => only.includes(k));
  for (const k of keys) tr.setDocAttribute(k, clone(next[k]));
  return keys;
}
/** ما غيّرته معاملةٌ من السمات (التراجع والإعادة يغيّرانها من السجلّ) */
export function changedKeys(before: PMDocNode, after: PMDocNode): LtKey[] {
  return before.attrs === after.attrs ? [] : LT_KEYS.filter((k) => !sameVal(before.attrs[k], after.attrs[k]));
}
