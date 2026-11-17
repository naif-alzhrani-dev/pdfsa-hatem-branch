// عامل pdf.js مسبوقاً ببوليفلاته (promise-try.ts وuint8-codec.ts وbaseline-polyfills.ts). الترتيب مقصود: البوليفل يُقيَّم أولاً.
import "./uint8-codec";
import "./promise-try";
import "./baseline-polyfills"; // Iterator وgetOrInsertComputed وsumPrecise وغيرها: ما يستدعيه عامل pdf.js بعد خطّ الأساس
import "pdfjs-dist/build/pdf.worker.min.mjs";
