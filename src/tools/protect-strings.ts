/** نصوص «حماية ملف»، حرفاً من docs/logs/phase1/copy-huda.md وcopy-huda-tools2.md (👩‍🏫 هدى). */
import { S } from "../strings";
import type { ProtectError } from "./protect-core";
import type { RunError } from "./run-tool";
import { RUN_ERRORS, SRT } from "./run-strings";
import { SPN } from "./page-numbers-strings";

export const SPR = {
  name: "قفل الملف",
  lead: "لا يُفتح الملف إلا بكلمة المرور التي تضعها",
  passwordLabel: "كلمة المرور",
  hint: "أحرف وأرقام إنجليزية فقط، ست خانات على الأقل.",
  warning: "إن نسيتها فلا يمكن استرجاعها.",
  show: "إظهار", // زرّ إظهار كلمة المرور (ملاحظات هدى للبناء)
  hide: "إخفاء", // نصّه وكلمة المرور ظاهرة (copy-huda-polish.md)
  run: "اقفل الملف",
  alreadyEncrypted: "الملف مقفل بكلمة مرور بالفعل.",
  /** لاحقة الملف الناتج (out-name.ts): اعتمدتها 👩‍🏫 هدى (copy-huda-polish.md). */
  suffix: "مقفل",
  pick: SPN.pick,
};

export const PROTECT_ERRORS: Record<ProtectError | RunError, string> = {
  "too-short": "اكتب كلمة مرور من ست خانات على الأقل.",
  "bad-chars": "استعمل أحرفاً وأرقاماً إنجليزية فقط.",
  "already-encrypted": SPR.alreadyEncrypted,
  pdfa: "لا يمكن قفل هذا الملف، فهو ملف أرشيفي (PDF/A). اختر ملفاً آخر.",
  "too-big": SRT.tooBig,
  "bad-pdf": S.badPdf,
  ...RUN_ERRORS,
};
