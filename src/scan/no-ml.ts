/**
 * بديل فارغ لوحدة كاشف ML في scanic (`dist/scanic-mlDetector.js`)، يحلّ محلّها في البناء (vite.config.ts).
 * الوحدة الأصلية تجلب نموذجاً ومشغّل ONNX من jsDelivr، والمنصة لا يغادرها شيء (شرط 🕵️ أمين).
 * ونحن نمرّر `detector: "classical"` دائماً، فلا يُستدعى شيء من هنا؛ وإن استُدعي يرمي ولا يجلب.
 */
const off = () => Promise.reject(new Error("ML detector is not bundled"));
export const initializeMl = off;
export const detectDocumentMl = off;
