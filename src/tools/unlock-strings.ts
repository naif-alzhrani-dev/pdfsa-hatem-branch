/** نصوص «فك الحماية»، حرفاً من docs/logs/phase1/copy-huda.md وcopy-huda-tools2.md (👩‍🏫 هدى). */
import { S } from "../strings";
import type { UnlockError } from "./unlock-core";
import type { RunError } from "./run-tool";
import { RUN_ERRORS, SRT } from "./run-strings";
import { SPN } from "./page-numbers-strings";
import { SPR } from "./protect-strings";

export const SUL = {
  name: "فتح قفل الملف",
  lead: "أزل قفل كلمة المرور أو قيود الطباعة والنسخ من ملفك",
  passwordLabel: "كلمة المرور",
  show: SPR.show,
  run: "أزل القفل",
  /** ملف عليه قيود فقط بلا كلمة فتح: الصيغة (أ)، و(ب) بالإقرار حين `UNLOCK_CONSENT` في unlock.ts. */
  restricted: "هذا الملف يُفتح دون كلمة مرور، لكن عليه قيود مثل الطباعة والنسخ.",
  runRestricted: "أزل القيود",
  runningRestricted: "جارٍ إزالة القيود…",
  doneRestricted: "تمت إزالة القيود. احفظ الملف.",
  consent: "أقرّ أن هذا الملف ملكي أو أنني مأذون لي بتعديله.",
  pick: SPN.pick,
};

export const UNLOCK_ERRORS: Record<UnlockError | RunError, string> = {
  "wrong-password": "كلمة المرور غير صحيحة.",
  "not-encrypted": "الملف غير مقفل بكلمة مرور.",
  "password-required": "الملف يحتاج كلمة مرور لفتحه. اكتبها ثم اضغط «أزل القفل».",
  "unsupported-encryption": "تعذّر فتح قفل هذا الملف، فنوع تشفيره غير مدعوم.",
  "too-big": SRT.tooBig,
  "bad-pdf": S.badPdf,
  ...RUN_ERRORS,
};
