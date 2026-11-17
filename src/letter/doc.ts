/**
 * من JSON محرّر TipTap إلى المستند المجرّد (`model.ts`) الذي يرسمه المحرّك، والقالب، وسطر التاريخ بأسماء الشهور.
 * بلا DOM ولا TipTap، فيُختبر في vitest (tests/letter-doc.test.ts).
 *
 * - المقاس على المقطع (علامة `fontSize`)، والخط على الخطاب كله وعلى المقطع إن خُصّ (علامة `letterFont`، الدفعة ٣)، والمحاذاة على الفقرة، وفاصل الصفحة عقدة `pageBreak`.
 * - `hardBreak` سطرٌ داخل الفقرة (`\n`)، وعنصر القائمة فقرة (وما في العنصر من فقرات وقوائم متداخلة يصير عناصر متتالية).
 */
import { gregorianOf, hijriOf, inHijriRange } from "../date-fmt";
import { ar, SL } from "../strings";
import { ALIGNS, asLetterFont, blockParas, DEFAULT_SIZE, type Align, type Block, type LetterDoc, type Paragraph, type Span } from "./model";
import type { LetterFont } from "./model";

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export const SIZES = [11, 12, 13, 14, 16, 18, 20, 24];

function paragraph(n: PMNode): Paragraph {
  const align = ALIGNS.includes(n.attrs?.align as Align) ? (n.attrs!.align as Align) : "right";
  const spans: Span[] = [];
  let len = 0, split: number | undefined;
  for (const c of n.content ?? []) {
    if (c.type === "lineSplit") { split ??= len; continue; } // «يمين ويسار» (editor.ts): الأولى وحدها
    if (c.type === "hardBreak") { spans.push({ text: "\n" }); len++; continue; }
    if (c.type !== "text" || !c.text) continue;
    const bold = !!c.marks?.some((m) => m.type === "bold");
    const fs = Number(c.marks?.find((m) => m.type === "fontSize")?.attrs?.size);
    const size = SIZES.includes(fs) ? fs : DEFAULT_SIZE; // قائمة مسموحة (شرط 🕵️ أمين)
    const font = asLetterFont(c.marks?.find((m) => m.type === "letterFont")?.attrs?.font); // قائمة مسموحة كذلك
    spans.push({ text: c.text, ...(bold ? { bold } : {}), ...(size !== DEFAULT_SIZE ? { size } : {}), ...(font ? { font } : {}) });
    len += c.text.length;
  }
  return split ? { align: "right", split, spans } : { align, spans };
}

function items(n: PMNode): Paragraph[] {
  const out: Paragraph[] = [];
  for (const li of n.content ?? []) for (const c of li.content ?? []) {
    if (c.type === "paragraph") out.push(paragraph(c));
    else if (c.type === "bulletList" || c.type === "orderedList") out.push(...items(c));
  }
  return out;
}

export function toLetterDoc(json: PMNode, font: LetterFont): LetterDoc {
  const blocks: Block[] = [];
  for (const n of json.content ?? []) {
    if (n.type === "paragraph") blocks.push({ type: "paragraph", ...paragraph(n) });
    else if (n.type === "bulletList" || n.type === "orderedList") blocks.push({ type: "list", ordered: n.type === "orderedList", items: items(n) });
    else if (n.type === "pageBreak") blocks.push({ type: "pageBreak" });
    else if (n.type === "letterTable") {
      // الشكل يفحصه `normalizeDoc` في المحرّك (`tableFits`)، فلا يُعاد هنا
      const widths = Array.isArray(n.attrs?.widths) ? (n.attrs!.widths as unknown[]).map(Number) : [];
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => {
        const span = Number(c.attrs?.span) || 1;
        return { ...(span > 1 ? { span } : {}), paras: (c.content ?? []).filter((x) => x.type === "paragraph").map(paragraph) };
      }));
      blocks.push({ type: "table", widths, rtl: n.attrs?.rtl !== false, borders: n.attrs?.borders === true, rows });
    }
  }
  return { font, blocks };
}

/** فقرة الخطاب إلى عقدة المحرّر: المقاطع نصوصاً بعلاماتها، و`\n` hardBreak، وموضع «يمين ويسار» عقدة lineSplit */
function pmPara(p: Paragraph): PMNode {
  const content: PMNode[] = [];
  let at = 0;
  const text = (t: string, s: Span) => {
    const marks = [...(s.bold ? [{ type: "bold" }] : []), ...(s.size && s.size !== DEFAULT_SIZE && SIZES.includes(s.size) ? [{ type: "fontSize", attrs: { size: s.size } }] : []), ...(s.font ? [{ type: "letterFont", attrs: { font: s.font } }] : [])];
    t.split("\n").forEach((part, k) => {
      if (k > 0) content.push({ type: "hardBreak" });
      if (part) content.push({ type: "text", text: part, ...(marks.length ? { marks } : {}) });
    });
  };
  for (const s of p.spans) {
    const t = String(s.text);
    if (p.split !== undefined && p.split > at && p.split <= at + t.length) {
      text(t.slice(0, p.split - at), s);
      content.push({ type: "lineSplit" });
      text(t.slice(p.split - at), s);
    } else text(t, s);
    at += t.length;
  }
  return { type: "paragraph", attrs: { align: p.split !== undefined ? "right" : p.align ?? "right" }, ...(content.length ? { content } : {}) };
}

/** الخطاب إلى JSON المحرّر («تحرير الملف»): عكس `toLetterDoc`، والجدول عقدة letterTable */
export function toPMDoc(d: LetterDoc): PMNode {
  const content = d.blocks.map((b): PMNode => {
    if (b.type === "pageBreak") return { type: "pageBreak" };
    if (b.type === "list") return { type: b.ordered ? "orderedList" : "bulletList", content: b.items.map((p) => ({ type: "listItem", content: [pmPara(p)] })) };
    if (b.type === "table") return {
      type: "letterTable", attrs: { widths: b.widths, rtl: b.rtl, borders: b.borders },
      content: b.rows.map((r) => ({ type: "tableRow", content: r.map((c) => ({ type: "tableCell", attrs: { span: c.span ?? 1 }, content: (c.paras.length ? c.paras : [{ spans: [] }]).map(pmPara) })) })),
    };
    return pmPara(b);
  });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** الخطاب فارغ: لا حرف فيه (الفقرات الفارغة وفواصل الصفحات لا تُحسب) */
export const isEmptyDoc = (d: LetterDoc) => !d.blocks.some((b) => blockParas(b).some((p) => p.spans.some((s) => s.text.trim())));

/** النصّ العادي الملصوق: سطرٌ لكل فقرة (شرط أمين: `text/plain` وحده، فتبقى أسطر واتساب)، ومقصوصاً عند `room` حرفاً */
export function pastedLines(text: string, room: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let left = Math.max(0, room), cut = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const l = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\t/g, " ");
    if (l.length > left) { if (left > 0) lines.push(l.slice(0, left)); cut = true; break; }
    lines.push(l);
    left -= l.length;
  }
  return { lines, cut };
}

const p = (text: string, align: Align, bold = false, size?: number): PMNode => ({
  type: "paragraph", attrs: { align },
  content: text ? [{ type: "text", text, marks: [...(bold ? [{ type: "bold" }] : []), ...(size ? [{ type: "fontSize", attrs: { size } }] : [])] }] : undefined,
});

/**
 * «خطاب رسمي عام» (docs/logs/letter-template-v1.md بعد تدقيق هدى): المخاطَب أولاً ثم «الموضوع:» (قرار نايف)،
 * وسطر فارغ بين كل كتلة، والاسم والصفة سطران متتاليان. والموضوع «كبير» = ١٦ نقطة.
 */
export function templateDoc(): PMNode {
  const blank = p("", "right");
  return {
    type: "doc",
    content: [
      p("السادة/ [اسم الجهة المرسَل إليها] المحترمين", "right", true), blank,
      p("الموضوع: [موضوع الخطاب]", "center", true, 16), blank,
      p("السلام عليكم ورحمة الله وبركاته، وبعد:", "right"), blank,
      p("[نص الخطاب: الغرض منه، ثم التفاصيل والطلب]", "justify"), blank,
      p("وتفضلوا بقبول خالص التحية والتقدير.", "right"), blank,
      { type: "paragraph", attrs: { align: "center" }, content: [{ type: "text", text: "[الاسم]", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "[الصفة]" }] },
    ],
  };
}

/** «٢٨ جمادى الأولى ١٤٤٨هـ» و«٨ نوفمبر ٢٠٢٦م» (ل١): أسماء الشهور، فلا تنعكس الأرقام. وخارج جدول أم القرى لا هجري. */
export function letterDate(day: number): { hijri: string; gregorian: string } {
  const g = gregorianOf(day);
  const gregorian = `${ar(g.d)} ${SL.gregorianMonths[g.m - 1]} ${ar(g.y)}م`;
  if (!inHijriRange(day)) return { hijri: "", gregorian };
  const hj = hijriOf(day);
  return { hijri: `${ar(hj.d)} ${SL.hijriMonths[hj.m - 1]} ${ar(hj.y)}هـ`, gregorian };
}
