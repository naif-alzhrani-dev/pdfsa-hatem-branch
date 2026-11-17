/** نصوص «تعبئة نموذج»، حرفاً من docs/logs/phase1/copy-huda.md (👩‍🏫 هدى). */
import { S } from "../strings";
import type { FillError } from "./fill-form-core";
import type { RunError } from "./run-tool";
import { RUN_ERRORS, SRT } from "./run-strings";
import { SPN } from "./page-numbers-strings";

export const SFF = {
  name: "تعبئة نموذج",
  lead: "املأ حقول النموذج واحفظه",
  run: "احفظ الملف",
  noFields: "لا توجد حقول للتعبئة في هذا الملف. يمكنك إضافة نص بنفسك من «توقيع ملف».",
  pick: SPN.pick,
};

export const FILL_ERRORS: Record<FillError | RunError, string> = {
  "too-big": SRT.tooBig,
  "bad-pdf": S.badPdf,
  failed: S.saveFailed,
  timeout: RUN_ERRORS.timeout,
  unsupported: RUN_ERRORS.unsupported,
};
