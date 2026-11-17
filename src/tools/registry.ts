/**
 * «أدوات أخرى»: الأدوات المبنية وحدها، بترتيب ظهورها في الورقة. أداة جديدة = سطر هنا.
 * `slug` عنوان صفحة البحث (`/<slug>`، والقيمة نفسها في `data-tool` على <body>) ومفتاحها في src/tools/pages.json.
 * `openPdf` يفتح الأداة على ملف PDF مفتوح سلفاً («أدوات أخرى» بعد الحفظ، main.ts). وبلاه لا تُعرض هناك:
 * «صور إلى PDF» تأخذ صوراً، و«فك الحماية» لا عمل لها على ملف غير محمي (كدائرة السحب، src/drop-wheel.ts).
 */
import type { ICON } from "../icons";
import type { OpenedPdf, ToolHost } from "./host";
import { showPageNumbers } from "./page-numbers";
import { SPN } from "./page-numbers-strings";
import { showWatermark } from "./watermark";
import { SWM } from "./watermark-strings";
import { showCrop } from "./crop";
import { SCR } from "./crop-strings";
import { showJpgToPdf } from "./jpg-to-pdf";
import { SJP } from "./jpg-to-pdf-strings";
import { showPdfToJpg } from "./pdf-to-jpg";
import { SPJ } from "./pdf-to-jpg-strings";
import { showFillForm } from "./fill-form";
import { SFF } from "./fill-form-strings";
import { showCompress } from "./compress";
import { SCM } from "./compress-strings";
import { showProtect } from "./protect";
import { SPR } from "./protect-strings";
import { showUnlock } from "./unlock";
import { SUL } from "./unlock-strings";
import { showInspect } from "./inspect";
import { showPdfToWord } from "./pdf-to-word";
import { SPW } from "./pdf-to-word-strings";
import { SIN } from "./inspect-strings";
import { showWordToPdf } from "./word-to-pdf";
import { SWD } from "./word-to-pdf-strings";

export interface MoreTool { slug: string; label: string; icon: keyof typeof ICON; open: (host: ToolHost) => void; openPdf?: (host: ToolHost, src: OpenedPdf) => void }

export const MORE_TOOLS: readonly MoreTool[] = [
  // «فحص ملف» أولاً، والبلاطة بلا أحمر (قرار نايف، inspect-lama.md §1)، وأيقونتها مجهر (نايف ٢٠٢٦/١١/١٠)
  { slug: "inspect", label: SIN.name, icon: "microscope", open: showInspect, openPdf: (h, s) => showInspect(h, undefined, s) },
  { slug: "page-numbers", label: SPN.name, icon: "fileDigit", open: showPageNumbers, openPdf: (h, s) => showPageNumbers(h, undefined, s) },
  { slug: "watermark", label: SWM.name, icon: "droplet", open: showWatermark, openPdf: (h, s) => showWatermark(h, undefined, s) },
  { slug: "crop", label: SCR.name, icon: "crop", open: showCrop, openPdf: (h, s) => showCrop(h, undefined, s) },
  { slug: "jpg-to-pdf", label: SJP.name, icon: "fileImage", open: showJpgToPdf },
  { slug: "pdf-to-jpg", label: SPJ.name, icon: "images", open: showPdfToJpg, openPdf: (h, s) => showPdfToJpg(h, s) },
  // الأداتان متجاورتين سابعة وثامنة بعد «PDF إلى صور» (نايف ٢٠٢٦/١١/١٣ «نعم، تتجاوران»، word-to-pdf-lama-spec.md §١)
  { slug: "pdf-to-word", label: SPW.name, icon: "type", open: (h) => showPdfToWord(h), openPdf: (h, s) => showPdfToWord(h, s) },
  // بلا openPdf: تأخذ ملف Word لا PDF
  { slug: "word-to-pdf", label: SWD.name, icon: "fileType", open: (h) => showWordToPdf(h) },
  { slug: "protect", label: SPR.name, icon: "lock", open: showProtect, openPdf: (h, s) => showProtect(h, undefined, s) },
  { slug: "unlock", label: SUL.name, icon: "unlock", open: showUnlock },
  { slug: "compress", label: SCM.name, icon: "compress", open: showCompress, openPdf: (h, s) => showCompress(h, undefined, s) },
  // «تعبئة نموذج» آخر الأدوات، فتعود «حماية» و«فك» في صفّ واحد على الجوال (نايف ٢٠٢٦/١١/١٠، اقتراح لمى).
  // و«إعداد خطاب» بعدها في الورقة رابطاً لا أداة (نايف ٢٠٢٦/١١/١١، main.ts openMoreTools)
  { slug: "fill-form", label: SFF.name, icon: "textCursorInput", open: showFillForm, openPdf: (h, s) => showFillForm(h, undefined, s) },
];

export const moreTool = (slug: string | undefined) => MORE_TOOLS.find((t) => t.slug === slug);
