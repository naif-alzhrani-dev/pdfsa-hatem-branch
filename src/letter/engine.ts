/**
 * محرّك «إعداد خطاب»: `renderLetter(doc, env)` يحوّل المستند المجرّد إلى PDF بمقاس A4، على الجهاز وحده.
 * يُحمَّل بـ`import()` ديناميكي في صفحة الخطاب وحدها (`src/letter/page.ts`)، لأن harfbuzzjs يجلب الـwasm لحظة استيراده.
 *
 * `env.load(path)` يجلب ملفاً من الثابت في المحرّك وحده: خطاً من `fonts.ts` تحت `/fonts/letter/`، أو `harfbuzz-subset.wasm`.
 * ولا يقبل المحرّك بايتات خطّ من خارجه (شرط 🕵️ أمين على fontkit)، إلا خطوط الجهاز في برنامج ويندوز من `env.system`
 * (قرار نايف ٢٠٢٦/١١/١٢ «ب»، وشرطه مراجعة أمين): بروتوكول البرنامج يقرؤها من مجلّدَي الخطوط وحدهما (W14).
 */
import { boxFace, isBox } from "./box-face";
import { FALLBACK_FONT, FONTS, fontPath, type FontKey } from "./fonts";
import { layout, type FacePicker, type Page } from "./layout";
import { fontId, normalizeDoc, usedFonts, type LetterDoc, type LetterFont } from "./model";
import { writePdf } from "./pdf";
import { makeFace, makeSubsetter, type Face } from "./shape";
import { embedding, type SysFont, type SysRef } from "./system-fonts";

export const SUBSET_WASM = "harfbuzz-subset.wasm";

export interface LetterEnv {
  /** `path` واحد من: `SUBSET_WASM`، أو مسار خطّ من `fontPath()` */
  load(path: string): Promise<Uint8Array>;
  /** خط الجهاز (برنامج ويندوز وحده): الوجه العادي المحفوظ أو العريض الأقرب من عائلته، وبايتاته */
  system?(r: SysRef, bold: boolean): Promise<{ font: SysFont; bytes: Uint8Array }>;
}

export interface Engine {
  render(doc: LetterDoc): Promise<Uint8Array>;
  /** التخطيط وحده (للاختبارات وللمعاينة في L2) */
  layout(doc: LetterDoc): Promise<Page[]>;
}

export function createEngine(env: LetterEnv): Engine {
  const files = new Map<string, Promise<Uint8Array>>();
  const faces = new Map<string, Promise<Face>>();
  const file = (p: string) => files.get(p) ?? files.set(p, env.load(p)).get(p)!;
  let subset: Promise<(b: Uint8Array, g: Iterable<number>, w: number) => Uint8Array> | null = null;
  const face = (k: FontKey, bold: boolean): Promise<Face> => {
    const path = fontPath(k, bold);
    const wght = FONTS[k].bold ? 0 : bold ? 700 : 400; // الخط المتغيّر: المحور مثبّت في التشكيل والقصّ
    const id = `${path}@${wght}`;
    return faces.get(id) ?? faces.set(id, file(path).then((b) => makeFace(id, b, wght))).get(id)!;
  };
  // خط الجهاز: مفتاحه عائلته ووجهه بعد الاختيار، فالعائلة بوجه واحد يُضمَّن وجهها مرّة للعادي والعريض. ومتغيّره وجهٌ واحد بلا تثبيت محور
  const sysFaces = new Map<string, Face>();
  const sysFace = async (r: SysRef, bold: boolean): Promise<Face> => {
    if (!env.system) throw new Error("letter: system fonts unavailable");
    const { font, bytes } = await env.system(r, bold);
    const id = `sys:${font.family}\u0000${font.face}`;
    return sysFaces.get(id) ?? sysFaces.set(id, { ...makeFace(id, bytes, 0), embed: embedding(font.fsType) }).get(id)!;
  };
  const anyFace = (k: LetterFont, bold: boolean) => (typeof k === "string" ? face(k, bold) : sysFace(k, bold));
  /** وجوه كل خط مستعمل (خط الخطاب وخطوط المقاطع، `usedFonts`)، وكلٌّ يُحمَّل مرّة بذاكرة `faces` */
  async function picker(d: LetterDoc): Promise<FacePicker> {
    const fonts = usedFonts(d);
    const [sets, fr, fb] = await Promise.all([
      Promise.all(fonts.map((f) => Promise.all([anyFace(f, false), anyFace(f, true)]))),
      face(FALLBACK_FONT, false), face(FALLBACK_FONT, true),
    ]);
    const byId = new Map(fonts.map((f, i) => [fontId(f), sets[i]!]));
    const letter = byId.get(fontId(d.font))!;
    return {
      strut: letter[0],
      face(cp, bold, f) {
        const [r, b] = (f && byId.get(fontId(f))) || letter;
        const main = bold ? b : r;
        if (main.has(cp)) return main;
        const fall = bold ? fb : fr;
        return fall.has(cp) ? fall : isBox(cp) ? boxFace : main; // ☐ ☑ ☒ مرسومة لا notdef (box-face.ts)
      },
    };
  }
  const lay = async (doc: LetterDoc) => { const d = normalizeDoc(doc); return layout(d, await picker(d)); };
  return {
    layout: lay,
    async render(doc) {
      subset ??= file(SUBSET_WASM).then((w) => makeSubsetter(w));
      const pages = await lay(doc);
      return writePdf(pages, await subset, normalizeDoc(doc).page);
    },
  };
}
