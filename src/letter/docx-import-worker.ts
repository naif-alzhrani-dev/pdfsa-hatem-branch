/**
 * عامل «تحرير الملف»: الفكّ والتحويل (`docxToLetter`) خارج الخيط الرئيسي، شرط 🕵️ أمين. لا يُستدعى مباشرة:
 * الواجهة `importDocx` في `import-docx.ts`، وهي تنهيه بعد الجواب أو عند المهلة. والسجلّ: docs/logs/edit-file-build-2.md.
 */
import { docxToLetter, letterDocOf } from "./docx-import";
import type { ImportMessage, ImportRequest } from "./import-docx";

const post = (m: ImportMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<ImportRequest>) => {
  try {
    // الجداول كتلٌ في المتن هنا (letterDocOf، الدفعة ٣)، فلا يحتاج الخيط الرئيسي المحوّل ولا يُعاد ترتيب
    const r = docxToLetter(e.data.bytes);
    post({ type: "done", result: typeof r === "string" ? r : { ...r, doc: letterDocOf(r), tables: [] } });
  } catch {
    post({ type: "error" });
  }
};
