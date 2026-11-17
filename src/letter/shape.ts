/**
 * HarfBuzz للخطاب: تشكيل الحروف (harfbuzzjs، و`harfbuzz.wasm` يجلبه من نطاق الموقع نفسه) وقصّ الخط (`harfbuzz-subset.wasm`).
 * الخط المتغيّر يُثبَّت محوره `wght` (400 أو 700) في التشكيل وفي القصّ معاً، فيطابق المرسومُ المقيس.
 */
import * as hb from "harfbuzzjs";

export interface Glyph {
  gid: number;
  cluster: number;
  ax: number;
  dx: number;
  dy: number;
}

/** كيف يُكتب الخط في PDF (`embedding()` في system-fonts.ts): مقصوصاً، أو كاملاً (fsType 0x0100)، أو أشكالاً بلا تضمين ولا نصّ */
export type Embedding = "subset" | "whole" | "shapes";

export interface Face {
  /** ملف الخط ووزنه: مفتاح التضمين في PDF */
  id: string;
  /** الافتراضي «subset» (الخطوط الستّة) */
  embed?: Embedding;
  bytes: Uint8Array;
  /** 0 لخطّ غير متغيّر */
  wght: number;
  upem: number;
  ascender: number;
  descender: number;
  has(cp: number): boolean;
  /** الحرف الاسمي للمحرف في cmap (لمطابقة التشكيل بحرفه بعد التشكيل) */
  nominal(cp: number): number | undefined;
  shape(text: string, rtl: boolean): Glyph[];
  path(gid: number): string;
  extents(gid: number): { x0: number; y0: number; x1: number; y1: number };
}

export function makeFace(id: string, bytes: Uint8Array, wght: number): Face {
  const face = new hb.Face(new hb.Blob(bytes.slice().buffer));
  const font = new hb.Font(face);
  if (wght) font.setVariations([new hb.Variation("wght", wght)]);
  const ext = font.hExtents();
  const has = new Set(face.collectUnicodes());
  return {
    id,
    bytes,
    wght,
    upem: face.upem,
    ascender: ext.ascender,
    descender: -ext.descender,
    has: (cp) => has.has(cp),
    nominal: (cp) => font.nominalGlyph(cp),
    shape(text, rtl) {
      const buf = new hb.Buffer();
      buf.addText(text);
      buf.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
      // المحرف وعلاماته (التشكيل والنقط المنفصلة) عنقود واحد: يحمل نصّه الحرفُ الأعرض، فلا ينتقل التشكيل في النصّ المنسوخ
      buf.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
      buf.guessSegmentProperties();
      hb.shape(font, buf);
      const info = buf.getGlyphInfos();
      const pos = buf.getGlyphPositions();
      return info.map((g, i) => ({ gid: g.codepoint, cluster: g.cluster, ax: pos[i]!.xAdvance, dx: pos[i]!.xOffset, dy: pos[i]!.yOffset }));
    },
    path: (gid) => font.glyphToPath(gid),
    extents(gid) {
      const e = font.glyphExtents(gid);
      if (!e) return { x0: 0, y0: 0, x1: 0, y1: 0 };
      return { x0: e.xBearing, y0: e.yBearing + e.height, x1: e.xBearing + e.width, y1: e.yBearing };
    },
  };
}

type SubsetExports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory; _initialize?: () => void };

/** hb-subset بلا JavaScript وسيط (الملف بلا imports): يُبقي الحروف المستعملة بأرقامها (RETAIN_GIDS)، ويثبّت `wght`. */
export async function makeSubsetter(wasm: ArrayBuffer | Uint8Array): Promise<(bytes: Uint8Array, gids: Iterable<number>, wght: number) => Uint8Array> {
  const { instance } = (await WebAssembly.instantiate(wasm as BufferSource, {})) as WebAssembly.WebAssemblyInstantiatedSource;
  const X = instance.exports as unknown as SubsetExports;
  X._initialize?.();
  return (u8, gids, wght) => {
    const p = X.malloc!(u8.length);
    new Uint8Array(X.memory.buffer).set(u8, p);
    const blob = X.hb_blob_create!(p, u8.length, 1, 0, 0);
    const face = X.hb_face_create!(blob, 0);
    const inp = X.hb_subset_input_create_or_fail!();
    const gs = X.hb_subset_input_glyph_set!(inp);
    for (const g of gids) X.hb_set_add!(gs, g);
    X.hb_subset_input_set_flags!(inp, 0x2 | 0x1); // RETAIN_GIDS | NO_HINTING
    if (wght) X.hb_subset_input_pin_axis_location!(inp, face, 0x77676874, wght);
    const sub = X.hb_subset_or_fail!(face, inp);
    if (!sub) throw new Error("letter: hb_subset failed");
    const ob = X.hb_face_reference_blob!(sub);
    const lenP = X.malloc!(4);
    const dp = X.hb_blob_get_data!(ob, lenP);
    const len = new Uint32Array(X.memory.buffer, lenP, 1)[0]!;
    const out = new Uint8Array(X.memory.buffer, dp, len).slice();
    X.hb_blob_destroy!(ob);
    X.hb_face_destroy!(sub);
    X.hb_subset_input_destroy!(inp);
    X.hb_face_destroy!(face);
    X.hb_blob_destroy!(blob);
    X.free!(p);
    X.free!(lenP);
    return out;
  };
}
