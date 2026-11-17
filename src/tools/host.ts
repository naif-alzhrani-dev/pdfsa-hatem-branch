/**
 * ما تحتاجه شاشة أداة من «أدوات أخرى» من التطبيق (main.ts)، فتبقى الأداة في ملفها بلا استيراد من main.ts.
 * الفتح بمسار التطبيق نفسه (`openSource`: المهلة وكشف الحماية)، والحفظ والمشاركة بورقة «حُفظ الملف» نفسها.
 */
import type * as pdfjs from "pdfjs-dist";

export interface OpenedPdf { name: string; bytes: Uint8Array; doc: pdfjs.PDFDocumentProxy }

/**
 * (٢٤) «PDF إلى صور» على الجوال: صور الصفحات منفصلة (أكثر من صفحة وحتى ٢٠) فتظهر «حفظ كصور»،
 * أو `over-limit` لأكثر من ٢٠ فيظهر سطر الحدّ تحت «حفظ كملف مضغوط (ZIP)».
 */
export type SavedImages = File[] | "over-limit";

export interface ToolHost {
  app: HTMLElement;
  /** منتقي ملف PDF واحد. لا يُستدعى `onFile` إن أُلغي. */
  pickPdf: (onFile: (file: File) => void) => void;
  open: (file: File) => Promise<OpenedPdf | "bad" | "encrypted">;
  /** الرجوع إلى الرئيسية (يغلق الملفات المفتوحة). */
  exit: () => void;
  /**
   * الملف الناتج: تنزيله أو مشاركته، وورقة «حُفظ الملف». `from` اسم الأداة (`slug`) حين يكون الناتج ملف PDF واحداً سليماً:
   * فيظهر «الأدوات» ويُفتح الملف في أداة أخرى من الذاكرة، بلا هذه الأداة. وبلاه لا زرّ (صور، أو ملف مشفّر).
   */
  saved: (file: File, pages: number, from?: string, images?: SavedImages) => void;
  announce: (msg: string) => void;
  /** عبارة الخصوصية وتذييل مَحالة كما في الرئيسية. `from` قيمة `data-wa-from` لعدّ ضغطات واتساب. */
  footer: (from: string) => Node[];
}
