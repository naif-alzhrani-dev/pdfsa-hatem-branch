/**
 * «PDF إلى Word»، المرحلتان ١ و٢: الرموز من قائمة عمليات pdf.js نفسها حرفاً حرفاً، بنصّ ToUnicode الخام وموضعه.
 * لا من `getTextContent`: ذاك يدمج الحروف ويقلب القطعة كلها فيقلب نصّ الترابط معها. ونزعه وحده رفع خطأ الحروف في Chrome
 * من 0.19% إلى 6.16% (جدول العزل في `docs/logs/pdf-to-word-trial.md`).
 * ومعها خطوط الحدود (للجداول)، وعدد الصور (لما لم يُنقل وكشف الممسوح).
 */
import type * as Pdfjs from "pdfjs-dist";
import type { Box, FontInfo, Item, Seg } from "./layout";
import { AR } from "./layout";

type Ops = typeof Pdfjs.OPS;
type M6 = [number, number, number, number, number, number];
const MARK = /^\p{M}+$/u;

const mul = (m: M6, n: M6): M6 => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M6, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;

/** ما يُقرأ من رمز pdf.js في `showText`. */
interface PdfGlyph { unicode?: string; width: number; isSpace?: boolean }
interface PdfFont { fontMatrix?: number[]; bold?: boolean; black?: boolean; name?: string }
interface OpList { fnArray: number[]; argsArray: unknown[] }
interface Objs { get(id: string): unknown }

export function glyphsFromOps(ops: Ops, opList: OpList, objs: Objs): Item[] {
  const M = (a: unknown): M6 => ((a as unknown[]).length === 1 ? (a as M6[])[0]! : (a as M6));
  type St = { ctm: M6; tm: M6; x: number; y: number; lx: number; ly: number; font: PdfFont | null; fid: string | null; size: number; cs: number; ws: number; hs: number; rise: number; lead: number };
  let st: St = { ctm: [1, 0, 0, 1, 0, 0], tm: [1, 0, 0, 1, 0, 0], x: 0, y: 0, lx: 0, ly: 0, font: null, fid: null, size: 0, cs: 0, ws: 0, hs: 1, rise: 0, lead: 0 };
  const stack: St[] = [];
  const out: Item[] = [];
  const show = (glyphs: (PdfGlyph | number)[]) => {
    const f = st.font; if (!f) return;
    const fm = f.fontMatrix?.[0] ?? 0.001;
    const m = mul(st.ctm, st.tm);
    const size = st.size * Math.hypot(m[0], m[1]);
    let x = 0;
    for (const g of glyphs) {
      if (typeof g === "number") { x -= (g * st.size) / 1000; continue; }
      const w = g.width * st.size * fm;
      const ox = st.x + x * st.hs, p0 = apply(m, ox, st.y + st.rise), p1 = apply(m, ox + w * st.hs, st.y + st.rise);
      const raw = (g.unicode ?? "").replace(/[\u0000-\u001F]/g, "");
      const s = raw.normalize("NFKC");
      if (s) {
        const noWs = s.replace(/\s+/g, "");
        if (noWs && MARK.test(noWs)) out.push({ mark: true, s: noWs, x: p0[0], y: p0[1], size, font: st.fid });
        else {
          // الترابط: نصّه أكثر من محرف عربي. NFKC لأشكال العرض يعطي ترتيباً منطقياً دائماً؛ وما جاء من ToUnicode مباشرةً
          // يُحسم ترتيبه للملف كله بالتصويت (`ligVotes`) لأن المنتِجين يختلفون (Chrome منطقيّ، و«إعداد خطاب» مقلوب)
          const multi = [...s].length > 1 && AR.test(s);
          const fromPres = /[ﭐ-﷿ﹰ-﻿]/.test(raw);
          out.push({ mark: false, s: multi ? [...s].reverse().join("") : s, lig: multi && !fromPres ? s : null, x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y: p0[1], size, font: st.fid });
        }
      }
      x += w + (g.isSpace ? st.ws : 0) + st.cs;
    }
    st.x += x * st.hs;
  };
  for (let i = 0; i < opList.fnArray.length; i++) {
    // معاملات كل عملية بنوعها، فلا نوع واحد يجمعها
    const fn = opList.fnArray[i], a = opList.argsArray[i] as any;
    switch (fn) {
      case ops.save: stack.push({ ...st }); break;
      case ops.restore: st = stack.pop() ?? st; break;
      case ops.transform: st.ctm = mul(st.ctm, M(a)); break;
      case ops.paintFormXObjectBegin: stack.push({ ...st }); if (a?.[0]) st.ctm = mul(st.ctm, a[0]); break;
      case ops.paintFormXObjectEnd: st = stack.pop() ?? st; break;
      case ops.beginText: st.tm = [1, 0, 0, 1, 0, 0]; st.x = st.y = st.lx = st.ly = 0; break;
      case ops.setFont: st.fid = a[0]; st.size = a[1]; try { st.font = objs.get(a[0]) as PdfFont; } catch { st.font = null; } break;
      case ops.setTextMatrix: st.tm = [...M(a)] as M6; st.x = st.y = st.lx = st.ly = 0; break;
      case ops.moveText: st.x = st.lx += a[0]; st.y = st.ly += a[1]; break;
      case ops.setLeadingMoveText: st.lead = a[1]; st.x = st.lx += a[0]; st.y = st.ly += a[1]; break;
      case ops.setLeading: st.lead = -a[0]; break;
      case ops.nextLine: st.x = st.lx; st.y = st.ly += st.lead; break;
      case ops.setCharSpacing: st.cs = a[0]; break;
      case ops.setWordSpacing: st.ws = a[0]; break;
      case ops.setHScale: st.hs = a[0] / 100; break;
      case ops.setTextRise: st.rise = a[0]; break;
      case ops.showText: case ops.showSpacedText: show(a[0]); break;
      case ops.nextLineShowText: st.x = st.lx; st.y = st.ly += st.lead; show(a[0]); break;
      case ops.nextLineSetSpacingShowText: st.ws = a[0]; st.cs = a[1]; st.x = st.lx; st.y = st.ly += st.lead; show(a[2]); break;
    }
  }
  return out;
}

/** خطوط الحدود: مستطيل رفيع مملوء أو مرسوم خطّاً، ومستطيل مرسوم خطّاً بأضلاعه الأربعة. */
export function segmentsOf(ops: Ops, opList: OpList): Seg[] {
  const stack: M6[] = []; let ctm: M6 = [1, 0, 0, 1, 0, 0];
  const segs: Seg[] = [];
  const fillOps = new Set<number>([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const strokeOps = new Set<number>([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform) ctm = mul(ctm, args as unknown as M6);
    else if (fn === ops.constructPath) {
      const [op, , mm] = args as [number, unknown, number[] | null];
      if (!mm || !(fillOps.has(op) || strokeOps.has(op))) continue;
      const pts = [apply(ctm, mm[0]!, mm[1]!), apply(ctm, mm[2]!, mm[3]!), apply(ctm, mm[0]!, mm[3]!), apply(ctm, mm[2]!, mm[1]!)];
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      // تحويلٌ ضخم (`cm`) يعطي Infinity، فيصل NaN إلى عرض الأعمدة في Word فيرفض الملف (الدفعة ٤، أمين)
      if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
      const w = x1 - x0, h = y1 - y0;
      if (w < 3 && h > 3) segs.push({ v: true, x: (x0 + x1) / 2, a: y0, b: y1 });
      else if (h < 3 && w > 3) segs.push({ v: false, y: (y0 + y1) / 2, a: x0, b: x1 });
      else if (strokeOps.has(op) && w > 3 && h > 3) {
        segs.push({ v: false, y: y0, a: x0, b: x1 }, { v: false, y: y1, a: x0, b: x1 }, { v: true, x: x0, a: y0, b: y1 }, { v: true, x: x1, a: y0, b: y1 });
      }
    }
  }
  return segs;
}

/**
 * مستطيلات القصّ والتعبئة (للجداول بلا حدود متّجهة): مسارٌ مستطيل واحد بلا منحنيات، والتحويل بلا دوران.
 * القصّ: المسار قبل `clip`/`eoClip` أو بعده. والتعبئة: مسار مملوء بعرض وارتفاع فوق 3 نقاط (الرفيع خطّ في `segmentsOf`).
 */
export function rectsOf(ops: Ops, opList: OpList): { clips: Box[]; fills: Box[] } {
  const stack: M6[] = []; let ctm: M6 = [1, 0, 0, 1, 0, 0];
  const clips: Box[] = [], fills: Box[] = [];
  const fillOps = new Set<number>([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const clipOps = new Set<number>([ops.clip, ops.eoClip]);
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]!, args = opList.argsArray[i] as any;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform) ctm = mul(ctm, args as M6);
    else if (fn === ops.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = mul(ctm, args[0]); }
    else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.constructPath) {
      const [op, data, mm] = args as [number, unknown[] | null, number[] | null];
      const isClip = op === ops.endPath && (clipOps.has(opList.fnArray[i - 1]!) || clipOps.has(opList.fnArray[i + 1]!));
      if (!mm || !(isClip || fillOps.has(op)) || Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6 || !isRect(data?.[0], mm)) continue;
      const p = apply(ctm, mm[0]!, mm[1]!), q = apply(ctm, mm[2]!, mm[3]!);
      const b: Box = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
      if (b.every(Number.isFinite) && b[2] - b[0] > 3 && b[3] - b[1] > 3) (isClip ? clips : fills).push(b);
    }
  }
  return { clips, fills };
}
/** مسار pdf.js (رموز DrawOPS: 0 moveTo، 1 lineTo، 4 closePath) مستطيلٌ واحد: نقطة بدء واحدة، وكل نقاطه في زوايا صندوقه. */
function isRect(d: unknown, mm: number[]): boolean {
  if (!d || typeof (d as ArrayLike<number>).length !== "number") return false;
  const a = d as ArrayLike<number>;
  let moves = 0, pts = 0;
  const corner = (x: number, y: number) => (Math.abs(x - mm[0]!) < 0.01 || Math.abs(x - mm[2]!) < 0.01) && (Math.abs(y - mm[1]!) < 0.01 || Math.abs(y - mm[3]!) < 0.01);
  for (let k = 0; k < a.length;) {
    const c = a[k++]!;
    if (c === 0 || c === 1) { if (c === 0 && ++moves > 1) return false; if (!corner(a[k]!, a[k + 1]!)) return false; pts++; k += 2; }
    else if (c === 4) continue;
    else return false;
  }
  return moves === 1 && pts >= 4;
}

/** عدد الصور المرسومة في الصفحة (ومنها الأقنعة والمكرّرة). */
export function imagesOf(ops: Ops, opList: OpList): number {
  const img = new Set<number>([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat, ops.paintImageMaskXObject, ops.paintImageMaskXObjectGroup, ops.paintImageMaskXObjectRepeat, ops.paintInlineImageXObjectGroup]);
  let n = 0;
  for (const fn of opList.fnArray) if (img.has(fn)) n++;
  return n;
}

/** عرض كل خطّ: من الخطّ نفسه (`bold` و`black`) أو اسمه، ولا يصل الاسم إلا بـ`fontExtraProperties`. */
export function fontsOf(items: Item[], objs: Objs, into: FontInfo): void {
  for (const g of items) if (g.font && !(g.font in into)) {
    try { const f = objs.get(g.font) as PdfFont; into[g.font] = { bold: !!(f.bold || f.black || /bold|black|heavy/i.test(f.name ?? "")), name: f.name ?? "" }; } catch { into[g.font] = { bold: false, name: "?" }; }
  }
}
