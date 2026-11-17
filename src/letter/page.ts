/**
 * مدخل صفحة «إعداد خطاب» (`/letter`). في الدفعة L1 لا واجهة: المحرّك يُحمَّل بـ`import()` عند أول طلب، فلا تدخل حزمه
 * (harfbuzzjs وbidi-js وfontkit) الصفحة الرئيسية ولا تُجلب قبل الحاجة. والملفات كلها من نطاق الموقع نفسه:
 * الخطوط من `/fonts/letter/`، و`harfbuzz.wasm` يجلبه harfbuzzjs بـ`new URL(…, import.meta.url)`، و`harfbuzz-subset.wasm` هنا.
 * `window.pdfsaLetter` لاختبارات e2e وحدها (`__pdfsaTest`، ui.ts). والواجهة (L2) في `ui.ts`، وTipTap في هذه الصفحة وحدها.
 */
import subsetUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import type { Engine } from "./engine";
import type { LetterDoc } from "./model";
import "../style.css";
import "../font-pick.css";
import "./letter.css";
import { E2E, bootLetter } from "./ui";
import { inApp, systemFonts, type SysRef } from "./system-fonts";

let engine: Promise<Engine> | null = null;

function load(): Promise<Engine> {
  engine ??= import("./engine").then(({ createEngine, SUBSET_WASM }) =>
    createEngine({
      async load(path) {
        const res = await fetch(path === SUBSET_WASM ? subsetUrl : `/fonts/letter/${path}`);
        if (!res.ok) throw new Error(`letter: ${path} ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      // خطوط الجهاز في برنامج ويندوز وحده (W14)، من عميل الجلسة الذي تملؤه القائمة فلا يُجلب الخط مرّتين
      ...(inApp() ? { system: (r: SysRef, bold: boolean) => systemFonts().face(r, bold) } : {}),
    }),
  );
  return engine;
}

const api = {
  render: async (doc: LetterDoc) => (await load()).render(doc),
  layout: async (doc: LetterDoc) => (await load()).layout(doc),
};
if (E2E) (window as unknown as { pdfsaLetter: typeof api }).pdfsaLetter = api; // مقبض e2e وحده (ui.ts، E2E)

bootLetter(document.getElementById("letter")!, load);
