/**
 * «لم يُنقل كما في Word:» من تحذيرات المحرّك وحدها (مواصفة لمى §٤): كل بند من تحذير أرسله المحرّك لـDOCX، وما لم يبلّغ عنه لا يُعرض.
 * المطابقة بنوع التحذير ونصّه في المصدر المثبَّت office2pdf 0.10.0-ar2 (المسارات تحت src/ فيه):
 * - `fallback-used`، `to` = ".notdef": حروف بلا خط (font_subst.rs:2271، lib_pipeline.rs:274).
 * - `parse-skipped` «upstream panic caught»: جزء لم يُقرأ (parser/docx.rs:739).
 * - altChunk: أسباب parser/docx_alt_chunk.rs (:172 :180 :183 :208-216 :353) وparser/docx_html_import.rs:620-627.
 * - SmartArt: parser/docx_smartart.rs:93 و:319، و`fallback-used` من «SmartArt diagram» (parser/pptx.rs:558).
 * - صورة تالفة استُنقذ منها شيء: `partial-element` «image» وتفصيله «retained decoded samples» (parser/docx_image_assets.rs:34).
 *   والعنصر الأسود («black placeholder») فئة منفصلة `imagesBlack`: رُسم مستطيل بمقاس الصورة (نص هدى).
 * - الرسوم البيانية (parser/docx_sections.rs:462): فئة `charts` «قد يختلف شكلها» (نص هدى، قرار المدير ٢٠٢٦/١١/١٣).
 * - الترويسة الزوجية (:489)، وفاصل العمود (:474)، والمحاذاة الرأسية (parser/docx.rs:492 و:871).
 * - وما بقي من `fallback-used`: خط استُبدل (lib_pipeline.rs:274)، ويُجمع بالخط البديل.
 * - وغيره ← «أخرى» بعدده.
 */
import type { W2pWarning } from "../word-to-pdf/warning";
import { SWD } from "./word-to-pdf-strings";

export interface NotMovedItem { key: string; text: string; count: number }

const ALT_CHUNK = /altChunk|^(invalid )?import (part|content type)|^MHTML|^HTML (charset|text decoding)/;
const V_ALIGN = /^(Section vertical justification|Mixed continuous section alignment)/;
const uniq = (xs: string[]) => [...new Set(xs)];

type Cat = "glyphs" | "skipped" | "altChunk" | "smartart" | "images" | "imagesBlack" | "charts" | "evenHeader" | "columnBreak" | "vAlign" | "font" | "other";

/** الفئة بالأولوية: الحروف، ثم غير المقروء، ثم SmartArt، ثم الصور، ثم التخطيط، ثم الخطوط، ثم «أخرى». */
export function category(w: W2pWarning): Cat {
  const reason = w.reason ?? "";
  if (w.kind === "fallback-used") {
    const from = w.from ?? "";
    if (w.to === ".notdef") return "glyphs";
    if (/SmartArt/.test(from)) return "smartart";
    if (from === "even-page header/footer") return "evenHeader";
    if (from === "next-column section break") return "columnBreak";
    if (/^chart \(/.test(from) || w.to === "data table") return "charts";
    return from && w.to ? "font" : "other";
  }
  if (w.kind === "parse-skipped") {
    if (reason.startsWith("upstream panic caught")) return "skipped";
    if (/SmartArt/.test(reason)) return "smartart";
    if (ALT_CHUNK.test(reason)) return "altChunk";
    if (V_ALIGN.test(reason)) return "vAlign";
    return "other";
  }
  if (w.kind === "partial-element" && w.element === "image") {
    const d = w.detail ?? "";
    if (d.includes("retained decoded samples")) return "images";
    if (d.includes("black placeholder")) return "imagesBlack";
  }
  return "other";
}

/** البنود كلها بترتيب العرض، ولكلٍّ عدد التحذيرات التي يحملها. `licence`: خطوط الجهاز التي تركها `pickSystemFonts` لرخصتها. */
export function notMovedItems(warnings: W2pWarning[], licence: string[] = []): NotMovedItem[] {
  const by = new Map<Cat, W2pWarning[]>();
  for (const w of warnings) {
    const c = category(w);
    by.set(c, [...(by.get(c) ?? []), w]);
  }
  const of = (c: Cat) => by.get(c) ?? [];
  const out: NotMovedItem[] = [];
  const add = (key: string, text: string, count: number) => { if (count) out.push({ key, text, count }); };
  const glyphs = of("glyphs");
  add("glyphs", SWD.missingGlyphs(uniq(glyphs.map((w) => w.from!))), glyphs.length);
  add("skipped", SWD.skipped(of("skipped").length), of("skipped").length);
  add("altChunk", SWD.altChunk, of("altChunk").length);
  add("smartart", SWD.smartart(of("smartart").length), of("smartart").length);
  add("images", SWD.images(of("images").length), of("images").length);
  add("imagesBlack", SWD.imagesBlack(of("imagesBlack").length), of("imagesBlack").length);
  add("charts", SWD.charts(of("charts").length), of("charts").length);
  add("evenHeader", SWD.evenHeader, of("evenHeader").length);
  add("columnBreak", SWD.columnBreak, of("columnBreak").length);
  add("vAlign", SWD.vAlign, of("vAlign").length);
  const byTo = new Map<string, W2pWarning[]>();
  for (const w of of("font")) byTo.set(w.to!, [...(byTo.get(w.to!) ?? []), w]);
  for (const [to, ws] of byTo) add("fonts", SWD.fonts(uniq(ws.map((w) => w.from!)), to), ws.length);
  const lic = uniq(licence);
  add("licence", SWD.licence(lic), lic.length);
  add("other", SWD.other(of("other").length), of("other").length);
  return out;
}

/** المعروض: أربعة أسطر على الأكثر، ومنها سطر `more(k)` إن لزم، و`k` عدد البنود غير المعروضة (قرار المدير). */
export function notMovedLines(items: NotMovedItem[]): string[] {
  if (items.length <= 4) return items.map((i) => i.text);
  return [...items.slice(0, 3).map((i) => i.text), SWD.more(items.length - 3)];
}
