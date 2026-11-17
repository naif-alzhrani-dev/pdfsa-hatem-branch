/** نصوص «ضغط ملف»، حرفاً من docs/logs/phase1/copy-huda.md وcopy-huda-tools2.md (👩‍🏫 هدى). */
import { S, SF } from "../strings";
import type { CompressError } from "./compress-core";
import type { RunError } from "./run-tool";
import { RUN_ERRORS, SRT, megabytes } from "./run-strings";
import { SPN } from "./page-numbers-strings";

export const SCM = {
  name: "ضغط ملف",
  lead: "صغّر حجم ملف يحتوي على صور",
  levelLabel: "قوة الضغط",
  light: "خفيفة",
  strong: "قوية",
  run: "اضغط الملف",
  /** «صار الملف ٢٫١ ميغابايت بدل ٨٫٤ ميغابايت.» بالحجمين الفعليين. */
  result: (before: number, after: number) => {
    const [a, b] = megabytes(after, before);
    return `صار الملف ${a} ميغابايت بدل ${b} ميغابايت.`;
  },
  pick: SPN.pick,
};

export const COMPRESS_ERRORS: Record<CompressError | RunError, string> = {
  // رسالتان محايدتان (قرار نايف ٢٠٢٦/١١/١٠، docs/logs/phase2/compress-message.md): تقولان السبب ولا تُعرضان بالأحمر
  "no-images": "لا صور في هذا الملف يمكن تصغيرها. الضغط يفيد الملفات الممسوحة والمصوّرة.",
  "already-small": "صور هذا الملف مضغوطة أصلاً، فلم يصغر بالضغط.",
  encrypted: SF.encryptedTool,
  "too-big": SRT.tooBig,
  "bad-pdf": S.badPdf,
  ...RUN_ERRORS,
};
