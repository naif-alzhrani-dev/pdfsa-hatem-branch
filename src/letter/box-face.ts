/**
 * مربّعات الاختيار ☐ ☑ ☒ (U+2610–2612) وجهاً مرسوماً (فهد ٥): لا خطّ من خطوط الخطاب ولا بديلها (Amiri) فيه هذه الحروف،
 * فكانت تُرسم notdef في المعاينة والملف. فيرسمها المحرّك مسارات (`embed: "shapes"`، كخط الجهاز الممنوع تضمينه)، بلا ملف خطّ:
 * فالمعاينة (`preview.ts`) والملف (`pdf.ts`) يرسمانها بالمسار نفسه، ولا نصّ لها في الملف المستخرج.
 */
import type { Face, Glyph } from "./shape";

const FIRST = 0x2610;
const ADVANCE = 820;
/** الإطار: مربّع خارجي عكس عقارب الساعة وداخلي معها، فيبقى داخله فارغاً بقاعدة nonzero */
const RING = "M90 -20L730 -20L730 620L90 620ZM150 40L150 560L670 560L670 40Z";
const PATHS = [
  RING, // ☐
  `${RING}M210 300L290 370L390 250L600 500L670 430L390 110Z`, // ☑
  `${RING}M240 100L620 480L580 520L200 140ZM580 100L620 140L240 520L200 480Z`, // ☒
];

export const isBox = (cp: number) => cp >= FIRST && cp < FIRST + PATHS.length;

export const boxFace: Face = {
  id: "pdfsa:boxes",
  embed: "shapes",
  bytes: new Uint8Array(0),
  wght: 0,
  upem: 1000,
  ascender: 800,
  descender: 200,
  has: isBox,
  nominal: (cp) => (isBox(cp) ? cp - FIRST + 1 : undefined),
  shape(text, rtl) {
    const out: Glyph[] = [];
    for (let i = 0; i < text.length; ) {
      const cp = text.codePointAt(i)!;
      out.push({ gid: isBox(cp) ? cp - FIRST + 1 : 0, cluster: i, ax: ADVANCE, dx: 0, dy: 0 });
      i += cp > 0xffff ? 2 : 1;
    }
    return rtl ? out.reverse() : out;
  },
  path: (gid) => PATHS[gid - 1] ?? "",
  extents: (gid) => (gid >= 1 && gid <= PATHS.length ? { x0: 90, y0: -20, x1: 730, y1: 620 } : { x0: 0, y0: 0, x1: 0, y1: 0 }),
};
