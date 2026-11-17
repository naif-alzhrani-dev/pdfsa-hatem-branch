/**
 * «PDF إلى Word»، المرحلة ٨: ملف DOCX بـfflate وXML مكتوب باليد، بلا مكتبة Word.
 * - الفقرة `w:bidi`، والقطعة العربية `w:rtl`، واللاتيني قطعة LTR مستقلة.
 * - الجدول `w:bidiVisual` إن كان RTL، وأول خلية في الصف أقصى اليمين، وعرض الأعمدة من الـPDF، والدمج `gridSpan` و`vMerge`.
 * - الأنماط Heading1–3 بـ`outlineLvl` (فتظهر في جزء التنقّل)، وListParagraph، و`jc=both` للمضبوط.
 */
import { strToU8, zipSync } from "fflate";
import type { Block } from "./layout";

const LATIN = /[A-Za-z]/;
/** ما لا يجوز في XML 1.0 يُحذف (محارف التحكّم عدا الجدولة والسطر، وU+FFFE/FFFF، والنصف البديل المنفرد)، ثم الهروب. */
export const xe = (s: string) =>
  // بعلَم u لا يطابق [\uD800-\uDFFF] إلا النصف المنفرد، فالزوج حرفٌ واحد
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runs(text: string, { bold = false } = {}): string {
  // اللاتيني في قطعة LTR، وما عداه في قطعة RTL
  const parts = text.match(/[A-Za-z][A-Za-z0-9.\-_/ ]*[A-Za-z0-9]|[A-Za-z]|[^A-Za-z]+/g) ?? [];
  return parts.map((t) => {
    const rtl = !LATIN.test(t);
    const pr = `${rtl ? "<w:rtl/>" : ""}${bold ? "<w:b/><w:bCs/>" : ""}`;
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
  }).join("");
}
function para(text: string, { style, bidi = true, jc, bold }: { style?: string; bidi?: boolean; jc?: string; bold?: boolean } = {}): string {
  const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ""}${bidi ? "<w:bidi/>" : ""}${jc ? `<w:jc w:val="${jc}"/>` : ""}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs(text, { bold })}</w:p>`;
}

/** عرض سطر الصفحة بـtwip: A4 (11906) ناقص الهامشين في `sectPr` (1247 لكلٍّ). */
const TEXT_W = 11906 - 2 * 1247;

export function documentXml(blocks: Block[]): string {
  const body: string[] = [];
  for (const b of blocks) {
    if (b.type === "table") {
      // عرض الأعمدة من حوافّها في الـPDF (النقطة 20 twip)، مصغَّراً بنسبته إن زاد على عرض سطر الصفحة. وفي RTL أول عمود أقصى اليمين
      const pt = b.xs.slice(1).map((x, i) => x - b.xs[i]!);
      const k = Math.min(1, TEXT_W / (20 * pt.reduce((s, w) => s + w, 0)));
      // وكل عرض عددٌ صحيح غير سالب، فلا يخرج `w:w="NaN"` من إحداثي غير منتهٍ (الدفعة ٤)
      const grid = pt.map((w) => Math.max(0, Math.round(20 * w * k)) || 0);
      if (b.rtl) grid.reverse();
      const tw = grid.reduce((s, w) => s + w, 0);
      const bd = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join("");
      body.push(`<w:tbl><w:tblPr>${b.rtl ? "<w:bidiVisual/>" : ""}<w:tblW w:w="${tw}" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders></w:tblPr><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
        b.rows.map((r) => {
          let at = 0;
          return `<w:tr>${r.map((c) => {
            const span = c.span ?? 1, w = grid.slice(at, (at += span)).reduce((s, x) => s + x, 0);
            const pr = `<w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${c.vm ? `<w:vMerge w:val="${c.vm}"/>` : ""}`;
            return `<w:tc><w:tcPr>${pr}</w:tcPr>${para(c.text, { bidi: c.dir === "rtl", bold: c.bold })}</w:tc>`;
          }).join("")}</w:tr>`;
        }).join("") + "</w:tbl>");
    } else if (b.type === "h") body.push(para(b.text, { style: `Heading${b.level}`, bidi: b.rtl }));
    else if (b.type === "li") body.push(para(b.text, { style: "ListParagraph", bidi: b.rtl }));
    else body.push(para(b.text, { bidi: b.rtl, jc: b.justify ? "both" : undefined }));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1247" w:bottom="1134" w:left="1247" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
}

export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:bidi/></w:pPr><w:rPr><w:rtl/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:start="720"/></w:pPr></w:style>
</w:styles>`;

export const DOCX_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"] as const;

export function writeDocx(blocks: Block[]): Uint8Array {
  const files: Record<(typeof DOCX_PARTS)[number], string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "word/document.xml": documentXml(blocks),
    "word/styles.xml": STYLES,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}
