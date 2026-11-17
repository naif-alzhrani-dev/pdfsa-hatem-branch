/**
 * محرّر الخطاب: TipTap 3.33.1 بشروط 🕵️ أمين (docs/logs/letter-deps-amin.md):
 * - `injectCSS: false`، فلا `<style>` تمنعه السياسة. وأسلوب المحرّر في `letter.css`.
 * - المحاذاة والمقاس بأسماء class لا `style` (`al-center`، `fs-16`)، والخط على الجذر (`lf-naskh`)، وخط المقطع علامة `letterFont`
 *   بصنف `lfm lf-<المفتاح>`، أو `lfm lfs-<رقم>` لخط الجهاز وقاعدته في ورقة أنماط بـCSSOM (src/letter/ui.ts، `sysRule`).
 * - اللصق والإفلات نصّاً عادياً (`text/plain`) مقسوماً على الأسطر، ولا يُقرأ `text/html` أبداً.
 * - حدّ الحروف (`MAX_CHARS` للمتن، و`attrs.limit` للمربّع) بالعدّ نفسه الذي يرفض به المحرّك (`charCount`).
 */
import { Editor, Extension, Mark, Node } from "@tiptap/core";
// الامتدادات المطلوبة وحدها لا StarterKit (ملاحظة 🕵️ أمين ن٤ على L2): StarterKit يستورد Link ومعه linkifyjs ولو عُطِّل
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { HardBreak } from "@tiptap/extension-hard-break";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import { UndoRedo } from "@tiptap/extensions";
import { Fragment, Slice, type Node as PMDocNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { SL } from "../strings";
import { ALIGNS, asLetterFont, fontId, isSysFont, MAX_CHARS, type Align, type LetterFont } from "./model";
import type { SysRef } from "./system-fonts";
import { pastedLines, SIZES, type PMNode } from "./doc";
import type { PageStart } from "./layout";
import { LetterAttrs } from "./history";

const AlignAttr = Extension.create({
  name: "letterAlign",
  addGlobalAttributes() {
    return [{
      types: ["paragraph"],
      attributes: {
        align: {
          default: "right",
          parseHTML: (el: HTMLElement) => ALIGNS.find((a) => a !== "right" && el.classList.contains(`al-${a}`)) ?? "right",
          renderHTML: (a: { align?: Align }) => (a.align && a.align !== "right" ? { class: `al-${a.align}` } : {}),
        },
      },
    }];
  },
});

const FontSize = Mark.create({
  name: "fontSize",
  addAttributes() {
    return {
      size: {
        default: 13,
        parseHTML: (el: HTMLElement) => { const n = Number(/fs-(\d+)/.exec(el.className)?.[1]); return SIZES.includes(n) ? n : 13; },
        renderHTML: (a: { size: number }) => ({ class: `fs-${SIZES.includes(a.size) ? a.size : 13}` }),
      },
    };
  },
  parseHTML: () => [{ tag: "span[class*=fs-]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

/** صنف خط الجهاز في المحرّر: رقمٌ ثابت لكل (عائلة، وجه) في الجلسة، فلا يدخل اسمه في صنف ولا في style */
const sysIds = new Map<string, number>();
export function sysFontClass(r: SysRef): string {
  const k = fontId(r);
  let n = sysIds.get(k);
  if (n === undefined) sysIds.set(k, (n = sysIds.size + 1));
  return `lfs-${n}`;
}

/**
 * خط المقطع (الدفعة ٣): علامة شاملة كالعريض، والقيمة من القائمة المسموحة (`asLetterFont`) في القراءة والرسم.
 * والمحرّك يقرؤها في `toLetterDoc` بالقائمة نفسها.
 */
const LetterFontMark = Mark.create({
  name: "letterFont",
  addAttributes() {
    return {
      font: {
        default: null,
        parseHTML: (el: HTMLElement) => asLetterFont(el.dataset.lf ?? (el.dataset.fam !== undefined ? { family: el.dataset.fam, face: el.dataset.face ?? "" } : null)),
        renderHTML: (a: { font: unknown }) => {
          const f = asLetterFont(a.font);
          if (!f) return {};
          return isSysFont(f) ? { class: `lfm ${sysFontClass(f)}`, "data-fam": f.family, "data-face": f.face } : { class: `lfm lf-${f}`, "data-lf": f };
        },
      },
    };
  },
  parseHTML: () => [{ tag: "span[data-lf]" }, { tag: "span[data-fam]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

/**
 * التحديد المحفوظ ما دامت لوحة الخط مفتوحة (مواصفة لمى): حدوده تُنقل مع التعديلات أثناء تنزيل الخط وتُطبَّق بعده،
 * و`show` يرسمه بزخرفة `.lt-held` على الجوال، لأن فتح اللوحة يزيل التركيز فيختفي تظليل المتصفح.
 */
type Held = { from: number; to: number; show: boolean } | null;
const holdKey = new PluginKey<Held>("letterSelHold");
const SelHold = Extension.create({
  name: "letterSelHold",
  addProseMirrorPlugins() {
    return [new Plugin<Held>({
      key: holdKey,
      state: {
        init: () => null,
        apply(tr, v) {
          const m = tr.getMeta(holdKey) as Held | undefined;
          if (m !== undefined) return m;
          if (!v || !tr.docChanged) return v;
          return { ...v, from: tr.mapping.map(v.from, 1), to: tr.mapping.map(v.to, -1) }; // ما يُكتب على الحافّتين خارجه
        },
      },
      props: {
        decorations(state) {
          const v = holdKey.getState(state);
          return v?.show && v.to > v.from ? DecorationSet.create(state.doc, [Decoration.inline(v.from, v.to, { class: "lt-held" })]) : null;
        },
      },
    })];
  },
});

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-pb]" }],
  renderHTML: () => ["div", { class: "lt-pb", "data-pb": "", contenteditable: "false" }, ["span", {}, SL.newPage]],
});

/**
 * «يمين ويسار» (مواصفة لمى §٧): عقدة سطرية ذرّية في موضع الانقسام، تُرسم علامة رأسية منقّطة ولا تُطبع (`toLetterDoc` يقرؤها
 * موضعاً لا نصّاً). وما بعدها في الفقرة يُلفّ بـ`.lt-left` فيعوم إلى يسار آخر سطر، أو ينزل إلى سطر وحده إن لم يتّسع، كالمحرّك.
 * وتزول بحذفها (Backspace في أول الطرف الأيسر)، أو بحذف كل ما قبلها، أو بمحاذاة أخرى.
 */
const LineSplit = Node.create({
  name: "lineSplit",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: "span[data-split]" }],
  renderHTML: () => ["span", { class: "lt-split", "data-split": "", contenteditable: "false", "aria-hidden": "true" }],
  // الحذف قبل الطرف الأيسر أو بعد الأيمن يُزيل العلامة نفسها، ولا يُترك للمتصفح (العنصر غير القابل للتحرير)
  addKeyboardShortcuts() {
    const del = (back: boolean) => () => {
      const { $from, empty, from } = this.editor.state.selection;
      const n = back ? $from.nodeBefore : $from.nodeAfter;
      if (!empty || n?.type !== this.type) return false;
      return this.editor.commands.deleteRange(back ? { from: from - 1, to: from } : { from, to: from + 1 });
    };
    return { Backspace: del(true), Delete: del(false) };
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((n, pos) => {
            if (n.type.name !== "paragraph") return true;
            n.forEach((c, off) => {
              const at = pos + 1 + off + c.nodeSize;
              if (c.type === type && at < pos + 1 + n.content.size) decos.push(Decoration.inline(at, pos + 1 + n.content.size, { class: "lt-left" }));
            });
            return false;
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
      // واحدة في الفقرة، وبعد نصّ، وفي فقرة يمينية
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged)) return null;
        const tr = state.tr;
        dropSplits(state.doc, tr, type.name, (para, offset, first) => !first || offset === 0 || (para.attrs.align ?? "right") !== "right");
        return tr.docChanged ? tr : null;
      },
    })];
  },
});

/** يحذف عقد الانقسام التي يقبلها `drop` (في الفقرة، وموضعها فيها، وأهي الأولى)، من آخر المستند إلى أوله فلا تتزحزح المواضع */
function dropSplits(doc: PMDocNode, tr: Transaction, name: string, drop: (para: PMDocNode, offset: number, first: boolean, pos: number) => boolean) {
  const del: number[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== "paragraph") return true;
    let first = true;
    n.forEach((c, off) => {
      if (c.type.name !== name) return;
      if (drop(n, off, first, pos)) del.push(pos + 1 + off);
      first = false;
    });
    return false;
  });
  for (const at of del.reverse()) tr.delete(tr.mapping.map(at), tr.mapping.map(at + 1));
}

/**
 * الجدول البسيط («تحرير الملف»، الدفعة ٣، مواصفة لمى §٣): ثلاث عقد بلا امتداد جداول (`@tiptap/extension-table` غير مثبّت،
 * و`prosemirror-tables` في `@tiptap/pm/tables` لم يُستعمل: لا دمج ولا إضافة صفوف ولا تحديد خلايا، فلا حاجة إليه).
 * عرض الأعمدة بـ`col.style.width` من CSSOM في عرض العقدة، لا خاصية `style` (السياسة `style-src 'self'`).
 * النصّ وحده يُحرَّر: شكل الجدول (الصفوف والخلايا وامتدادها) لا يتغيّر بتعديل المستخدم (`tableGuard`)، وTab بين الخلايا.
 */
const TableCellNode = Node.create({
  name: "tableCell",
  content: "paragraph+",
  isolating: true,
  addAttributes: () => ({
    span: {
      default: 1,
      parseHTML: (el: HTMLElement) => Math.min(8, Math.max(1, Math.floor(Number(el.getAttribute("colspan"))) || 1)),
      renderHTML: (a: { span: number }) => (a.span > 1 ? { colspan: String(a.span) } : {}),
    },
  }),
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ HTMLAttributes }) => ["td", HTMLAttributes, 0],
});
const TableRowNode = Node.create({ name: "tableRow", content: "tableCell+", parseHTML: () => [{ tag: "tr" }], renderHTML: () => ["tr", 0] });
export const TABLE = "letterTable";
const TableNode = Node.create({
  name: TABLE,
  group: "block",
  content: "tableRow+",
  isolating: true,
  defining: true,
  addAttributes: () => ({ widths: { default: [] as number[], rendered: false }, rtl: { default: true, rendered: false }, borders: { default: false, rendered: false } }),
  parseHTML: () => [{ tag: "table.lt-table" }],
  renderHTML: () => ["table", { class: "lt-table" }, ["tbody", 0]],
  addNodeView: () => ({ node }) => {
    const dom = document.createElement("table");
    dom.className = `lt-table${node.attrs.borders ? " bd" : ""}`;
    dom.dir = node.attrs.rtl ? "rtl" : "ltr";
    dom.dataset.test = "lt-table";
    const cols = document.createElement("colgroup");
    for (const w of node.attrs.widths as number[]) { const c = document.createElement("col"); c.style.width = `${(Number(w) * 100).toFixed(3)}%`; cols.append(c); }
    const body = document.createElement("tbody");
    dom.append(cols, body);
    return {
      dom, contentDOM: body,
      update: (n) => n.type === node.type && JSON.stringify(n.attrs) === JSON.stringify(node.attrs),
      ignoreMutation: (m) => m.type !== "selection" && !body.contains(m.target),
    };
  },
});
/** شكل جداول المستند: لكل جدول امتداد خلايا كل صفّ */
const tableShapes = (doc: PMDocNode) => {
  const out: number[][][] = [];
  doc.descendants((n) => {
    if (n.type.name !== TABLE) return true;
    const rows: number[][] = [];
    n.forEach((r) => { const cs: number[] = []; r.forEach((c) => cs.push(Number(c.attrs.span) || 1)); rows.push(cs); });
    out.push(rows);
    return false;
  });
  return JSON.stringify(out);
};
/** يُقبل تغيير شكل الجداول بهذه العلامة وحدها (فتح ملف أو قالب)، وما سواه يُرفض كله: فلا يُضاف صفّ ولا تُدمج خلية ولا يُحذف جدول */
export const TABLES_OK = new PluginKey("letterTablesOk");
const tableGuard = new Plugin({
  filterTransaction: (tr, state) => !tr.docChanged || tr.getMeta(TABLES_OK) === true || tableShapes(tr.doc) === tableShapes(state.doc),
});
/** الخلية التي فيها المؤشّر: موضعها ومدى الجدول، أو null */
function cellAt(state: { selection: { $from: import("@tiptap/pm/model").ResolvedPos } }) {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "tableCell") {
    const tableDepth = d - 2;
    return { cell: $f.before(d), table: $f.before(tableDepth), tableEnd: $f.after(tableDepth) };
  }
  return null;
}
const Tables = Extension.create({
  name: "letterTables",
  addProseMirrorPlugins: () => [tableGuard],
  // Tab إلى الخلية التالية بترتيب القراءة (الأولى يميناً في الجدول RTL)، وShift+Tab إلى السابقة، وTab في الأخيرة يخرج بعد الجدول ولا يضيف صفّاً
  addKeyboardShortcuts() {
    const go = (back: boolean) => () => {
      const { state } = this.editor;
      const at = cellAt(state);
      if (!at) return false;
      const starts: number[] = [];
      state.doc.nodesBetween(at.table, at.tableEnd, (n, pos) => { if (n.type.name === "tableCell") { starts.push(pos); return false; } return true; });
      const k = starts.indexOf(at.cell) + (back ? -1 : 1);
      const tr = state.tr;
      if (k >= 0 && k < starts.length) {
        const cell = state.doc.nodeAt(starts[k]!)!;
        tr.setSelection(TextSelection.create(tr.doc, starts[k]! + 1 + cell.child(0).nodeSize - 1));
      } else if (!back) {
        if (tr.doc.nodeAt(at.tableEnd)?.type.name !== "paragraph") tr.insert(at.tableEnd, state.schema.nodes.paragraph!.create());
        tr.setSelection(TextSelection.create(tr.doc, at.tableEnd + 1));
      } else return true; // Shift+Tab في الأولى: يبقى
      this.editor.view.dispatch(tr.scrollIntoView());
      return true;
    };
    return { Tab: go(false), "Shift-Tab": go(true) };
  },
});

/** الحدّ: لا يُقبل تعديلٌ يزيد النصّ فوق `max` (ويُقبل ما ينقصه وإن بقي فوقه) */
export const limitPlugin = (max: number) => new Plugin({
  filterTransaction: (tr, state) => !tr.docChanged || tr.doc.textContent.length <= max || tr.doc.textContent.length <= state.doc.textContent.length,
});
const limitExt = (max: number) => Extension.create({ name: "letterLimit", addProseMirrorPlugins: () => [limitPlugin(max)] });

/**
 * حدّ الصفحات في «الكتابة» (v2 الدفعة د، مواصفة لمى §٢): زخرفة widget عند أول سطر في كل صفحة كما قصّها المحرّك
 * (`Page.start`). فارغةٌ لا تُطبع، وارتفاعها يضبطه `ui.ts` (`fitGaps`) فيبدأ ما بعدها عند الهامش العلوي للصفحة التالية.
 * و`display: block` فيها يكسر السطر عندها، فيبدأ أول سطر في الصفحة وينتهي آخر سطر قبلها حيث كسرهما المحرّك.
 */
const breaksKey = new PluginKey<DecorationSet>("letterBreaks");

/** موضع الحرف `start.offset` من الفقرة التي يبدأ بها السطر، في مستند المحرّر (الكتلة = العقدة العليا كما في `toLetterDoc`) */
export function breakPos(doc: PMDocNode, start: PageStart): number | null {
  if (start.block >= doc.childCount) return null;
  let at = 0;
  for (let i = 0; i < start.block; i++) at += doc.child(i).nodeSize;
  const top = doc.child(start.block);
  if (top.type.name === TABLE) { // قبل الصفّ `row`: الحدّ صفٌّ فاصل في الجدول نفسه (`gapRow`)
    if (start.row === undefined || start.row < 1 || start.row >= top.childCount) return null;
    let p = at + 1;
    for (let r = 0; r < start.row; r++) p += top.child(r).nodeSize;
    return p;
  }
  let para: PMDocNode | null = null, paraAt = -1;
  if (top.type.name === "paragraph") { para = top; paraAt = at; }
  else if (top.type.name === "bulletList" || top.type.name === "orderedList") {
    let k = 0; // العناصر بترتيب `items()` في doc.ts: كل فقرة في عنصر، والقوائم المتداخلة بعدها
    top.descendants((n, pos) => {
      if (para) return false;
      if (n.type.name !== "paragraph") return true;
      if (k++ === start.item) { para = n; paraAt = at + 1 + pos; }
      return false;
    });
  }
  if (!para) return null;
  const p: PMDocNode = para;
  let chars = 0, off = 0;
  for (let i = 0; i < p.childCount; i++) {
    const c = p.child(i);
    const len = c.isText ? c.text!.length : c.type.name === "hardBreak" ? 1 : 0;
    if (chars === start.offset && len > 0) break; // قبل هذه العقدة، وبعد علامة «يمين ويسار» إن كانت عند الموضع نفسه
    if (chars + len > start.offset) { off += start.offset - chars; break; }
    chars += len; off += c.nodeSize;
  }
  return paraAt + 1 + Math.min(off, p.content.size);
}

/**
 * حدّ الصفحة قبل صفّ جدولٍ يبدأ صفحته في المحرّك (`PageStart.row`): صفٌّ فارغ بخلية واحدة بعرض الجدول وبلا حدود، فيقف الصفّ
 * السابق عند آخر صفحته ويبدأ التالي بعد الفاصل كما في المحرّك. و`.lt-gap` فيه يضبط ارتفاعه `fitGaps` كحدّ الفقرة.
 */
function gapRow(row: PMDocNode, page: number): HTMLElement {
  const tr = document.createElement("tr");
  tr.className = "lt-gap lt-gaprow";
  tr.dataset.page = String(page);
  tr.setAttribute("aria-hidden", "true");
  tr.contentEditable = "false";
  const td = document.createElement("td");
  let span = 0;
  row.forEach((c) => { span += Number(c.attrs.span) || 1; });
  td.colSpan = Math.max(1, span);
  tr.append(td);
  return tr;
}

const PageBreaks = Extension.create<{ onRender: () => void }>({
  name: "letterBreaks",
  addOptions: () => ({ onRender: () => {} }),
  addProseMirrorPlugins() {
    const onRender = this.options.onRender;
    return [new Plugin<DecorationSet>({
      key: breaksKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const starts = tr.getMeta(breaksKey) as (PageStart | undefined)[] | undefined;
          if (!starts) return set.map(tr.mapping, tr.doc);
          const decos: Decoration[] = [];
          starts.forEach((s, page) => {
            const pos = s ? breakPos(tr.doc, s) : null;
            if (pos === null) return;
            const row = s!.row !== undefined;
            decos.push(Decoration.widget(pos, row ? () => gapRow(tr.doc.child(s!.block).child(s!.row!), page) : () => {
              const el = document.createElement("span");
              el.className = "lt-gap";
              el.dataset.page = String(page);
              el.setAttribute("aria-hidden", "true");
              el.contentEditable = "false";
              return el;
            }, { side: -1, key: `pg${page}`, ignoreSelection: true, marks: [] }));
          });
          return DecorationSet.create(tr.doc, decos);
        },
      },
      props: { decorations: (state) => breaksKey.getState(state) },
      view: () => ({ update: () => onRender() }),
    })];
  },
});

/** عدد الحروف كما يعدّها المحرّك: النصّ بلا فواصل الأسطر */
export const editorChars = (ed: Editor) => ed.state.doc.textContent.length;

export interface LetterEditor {
  ed: Editor;
  json(): PMNode;
  setAlign(a: Align): void;
  align(): Align;
  /** «يمين ويسار» عند المؤشّر: ما قبله يميناً وما بعده يساراً (مواصفة لمى §٧) */
  setSplit(): void;
  /** في فقرة المؤشّر انقسام «يمين ويسار» */
  isSplit(): boolean;
  /** قبل المؤشّر في فقرته شيء، فيصحّ الانقسام عنده */
  canSplit(): boolean;
  setSize(n: number): void;
  size(): number;
  /** أصغر مقاس (نقاط) لنصّ في المدى، أو في الخطاب كله بلا مدى. 13 لما بلا علامة مقاس */
  minSize(r?: { from: number; to: number } | null): number;
  toggleBold(): void;
  toggleList(ordered: boolean): void;
  insertPageBreak(): void;
  /** في التحديد نصّ (فاصل صفحة وحده أو تحديد فارغ = مؤشّر، مواصفة لمى) */
  hasTextSel(): boolean;
  /** يحفظ التحديد للوحة الخط إن كان فيه نصّ (`show`: يُرسم ظاهراً)، ويُرجع هل حُفظ */
  hold(show: boolean): boolean;
  /** حدود التحديد المحفوظ بعد التعديلات، أو null إن لم يُحفظ أو حُذف ما فيه */
  held(): { from: number; to: number } | null;
  /** يُنهي الحفظ ويعيد التحديد إلى حدوده */
  release(): void;
  /** خط المقاطع في المدى (أو التحديد): كل خط مرّة، و`null` لما بلا علامة (خط الخطاب) */
  fontsIn(r?: { from: number; to: number }): (LetterFont | null)[];
  /** يضع خط المقطع على المدى، أو يزيله (`null`) فيرث خط الخطاب. خطوة واحدة في التراجع */
  setFont(f: LetterFont | null, r: { from: number; to: number }): void;
  /** يزيل علامة كل خط يقبله `gone` (خط جهاز حُذف)، خارج سجلّ التراجع */
  dropFonts(gone: (f: LetterFont) => boolean): void;
  /** المؤشّر في أول الخطاب (فتتعطّل «صفحة جديدة») */
  atStart(): boolean;
  /** رقم الكتلة العليا التي فيها المؤشّر (لموضع الصورة) */
  cursorBlock(): number;
  /** حدود الصفحات من المحرّك: أول سطر في كل صفحة (`Page.start`) */
  setBreaks(starts: (PageStart | undefined)[]): void;
  /** يضع المستند كله (فتح ملف Word)، والجداول فيه مقبولة، وخارج سجلّ التراجع فلا يُتراجع إلى خطاب فارغ */
  load(json: PMNode): void;
}

/** `attrs`: الاسم المسموع ومقبض الاختبار (مربّع النصّ في الدفعة و محرّرٌ ثانٍ بهما) */
/** هامش تتبّع المؤشّر (مواصفة لمى §٢، و٥-٩ في letter-rail-float-lama-spec.md): 16 بعد أعلى ما يطفو في الأسفل وأسفل ما يطفو في الأعلى، وجانبان 16.
 *  الأسفل اليوم حبّة الدرجة: 12 من الحافّة وارتفاعها 44 فأعلاها 56، فالهامش 72. وProseMirror يقرأ الهامش عند كل تمرير (view.someProp)، فيُغيَّر بعد الإنشاء بـed.view.setProps({ scrollMargin })،
 *  أو بـsetOptions({ editorProps: { ...ed.options.editorProps, scrollMargin } }) مدموجاً بالقائم. لا بـsetOptions({ editorProps }) وحده:
 *  يستبدل editorProps كلها فيُسقط handlePaste وhandleDrop وفيهما تنقية اللصق والإسقاط (ملاحظة 🕵️ أمين على 664d8fb) */
export function caretMargin(floatBottom = 12 + 44, floatTop = 0) {
  return { top: floatTop + 16, bottom: floatBottom + 16, left: 16, right: 16 };
}

export function createEditor(mount: HTMLElement, onChange: () => void, onCut: () => void, onRender: () => void = () => {}, attrs: { label: string; test: string; limit?: number } = { label: SL.body, test: "letter-editor" }): LetterEditor {
  const max = attrs.limit ?? MAX_CHARS;
  const ed = new Editor({
    element: mount,
    injectCSS: false,
    extensions: [
      // ما كان يبقى من StarterKit بعد التعطيل، بترتيبه فيه
      Bold, BulletList, Document, HardBreak, UndoRedo, ListItem, ListKeymap, OrderedList, Paragraph, Text,
      AlignAttr, FontSize, LetterFontMark, SelHold, PageBreak, LineSplit, limitExt(max), PageBreaks.configure({ onRender }),
      TableCellNode, TableRowNode, TableNode, Tables,
      LetterAttrs, // ١٤: قيم «شكل الصفحة» والعناصر سماتٌ على المستند فتدخل سجلّ التراجع (history.ts)
    ],
    editorProps: {
      // تتبّع المؤشّر من دالّة واحدة (caretMargin)
      scrollThreshold: caretMargin(),
      scrollMargin: caretMargin(),
      attributes: { class: "lt-text", role: "textbox", "aria-multiline": "true", "aria-label": attrs.label, "data-test": attrs.test },
      // النصّ وحده، ومقصوصاً عند الحدّ
      handlePaste(view, e) {
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const { from, to } = view.state.selection;
        const room = max - (view.state.doc.textContent.length - view.state.doc.textBetween(from, to, "").length);
        const { lines, cut } = pastedLines(text, room);
        const schema = view.state.schema;
        if (lines.length === 1) view.dispatch(view.state.tr.insertText(lines[0]!));
        else if (lines.length > 1) {
          const nodes = lines.map((l) => schema.nodes.paragraph!.create(null, l ? schema.text(l) : null));
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 1, 1)).scrollIntoView());
        }
        if (cut) onCut();
        return true;
      },
      handleDrop(view, e, _slice, moved) {
        if (moved) return false; // نقل داخل المحرّر نفسه
        const text = e.dataTransfer?.getData("text/plain") ?? "";
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
        const room = max - view.state.doc.textContent.length;
        const { lines } = pastedLines(text.replace(/\n+/g, " "), room);
        if (pos && lines[0]) view.dispatch(view.state.tr.insertText(lines[0], pos.pos));
        return true;
      },
    },
    onUpdate: onChange,
    onSelectionUpdate: onChange,
  });
  const paraAttr = (): Align => {
    const a = ed.getAttributes("paragraph").align as Align | undefined;
    return a && ALIGNS.includes(a) ? a : "right";
  };
  const SPLIT = "lineSplit";
  const hasTextSel = () => { const { from, to, empty } = ed.state.selection; return !empty && ed.state.doc.textBetween(from, to, "", "").length > 0; };
  /** فقرة المؤشّر وموضعها، أو null خارج الفقرات */
  const curPara = () => { const $f = ed.state.selection.$from; return $f.parent.type.name === "paragraph" ? { node: $f.parent, start: $f.start(), offset: $f.parentOffset } : null; };
  /** عقد الانقسام في الفقرات التي يمسّها التحديد */
  const inSelection = (tr: Transaction) => {
    const { from, to } = tr.selection;
    return (para: PMDocNode, _o: number, _f: boolean, pos: number) => pos + para.nodeSize > from && pos < to + 1;
  };
  return {
    ed,
    // سمات المستند (١٤) للسجلّ وحده، لا تدخل JSON الخطاب
    json: () => { const j = ed.getJSON() as PMNode & { attrs?: unknown }; delete j.attrs; return j; },
    // كل محاذاة تُزيل «يمين ويسار» من فقراتها، ومنها «يمين»
    setAlign: (a) => void ed.chain().focus().updateAttributes("paragraph", { align: a }).command(({ tr }) => { dropSplits(tr.doc, tr, SPLIT, inSelection(tr)); return true; }).run(),
    align: paraAttr,
    setSplit: () => void ed.chain().focus().command(({ tr, dispatch }) => {
      const $f = tr.selection.$from;
      if ($f.parent.type.name !== "paragraph" || $f.parentOffset === 0 || !dispatch) return false;
      const start = $f.before();
      tr.setNodeAttribute(start, "align", "right");
      tr.deleteSelection();
      const at = tr.selection.from;
      const steps = tr.steps.length;
      // الانقسام السابق في الفقرة نفسها يُزال، فيبقى واحد عند المؤشّر
      const para = tr.mapping.map(start);
      dropSplits(tr.doc, tr, SPLIT, (_p, _o, _f, pos) => pos === para);
      const here = tr.mapping.slice(steps).map(at);
      tr.insert(here, tr.doc.type.schema.nodes[SPLIT]!.create());
      tr.setSelection(TextSelection.create(tr.doc, here + 1));
      return true;
    }).run(),
    isSplit: () => { const p = curPara(); let has = false; p?.node.forEach((c) => { if (c.type.name === SPLIT) has = true; }); return has; },
    canSplit: () => { const p = curPara(); return !!p && p.offset > 0; },
    setSize: (n) => void (n === 13 ? ed.chain().focus().unsetMark("fontSize").run() : ed.chain().focus().setMark("fontSize", { size: n }).run()),
    size: () => { const n = Number(ed.getAttributes("fontSize").size); return SIZES.includes(n) ? n : 13; },
    minSize: (r) => {
      const { from, to } = r ?? { from: 0, to: ed.state.doc.content.size };
      let min = Infinity;
      ed.state.doc.nodesBetween(from, to, (n) => {
        if (!n.isText) return;
        const v = Number(n.marks.find((m) => m.type.name === "fontSize")?.attrs.size);
        min = Math.min(min, SIZES.includes(v) ? v : 13);
      });
      return min === Infinity ? 13 : min;
    },
    toggleBold: () => void ed.chain().focus().toggleBold().run(),
    toggleList: (ordered) => void (ordered ? ed.chain().focus().toggleOrderedList().run() : ed.chain().focus().toggleBulletList().run()),
    insertPageBreak: () => void ed.chain().focus().insertContent({ type: "pageBreak" }).command(({ tr, dispatch }) => {
      // الفاصل عقدةٌ ذرّية: يبقى محدَّداً أو يلتصق المؤشّر بما قبله، فيُنقل المؤشّر إلى فقرةٍ بعده (الموجودة، أو تُضاف) في المعاملة نفسها فيتراجع الاثنان بخطوة
      const at = tr.selection.from;
      let end = -1;
      tr.doc.forEach((n, off) => { if (n.type.name === "pageBreak" && (end < 0 || Math.abs(off - at) < Math.abs(end - n.nodeSize - at))) end = off + n.nodeSize; });
      if (end < 0 || !dispatch) return end >= 0;
      if (tr.doc.nodeAt(end)?.type.name !== "paragraph") tr.insert(end, tr.doc.type.schema.nodes.paragraph!.create());
      tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView();
      return true;
    }).run(),
    hasTextSel,
    hold: (show) => {
      if (!hasTextSel()) return false;
      const { from, to } = ed.state.selection;
      ed.view.dispatch(ed.state.tr.setMeta(holdKey, { from, to, show }).setMeta("addToHistory", false));
      return true;
    },
    held: () => {
      const v = holdKey.getState(ed.state);
      return v && v.to > v.from && ed.state.doc.textBetween(v.from, v.to, "", "") ? { from: v.from, to: v.to } : null;
    },
    release: () => {
      const v = holdKey.getState(ed.state);
      if (!v) return;
      const tr = ed.state.tr.setMeta(holdKey, null).setMeta("addToHistory", false);
      if (v.to > v.from) tr.setSelection(TextSelection.create(tr.doc, v.from, v.to));
      ed.view.dispatch(tr);
    },
    fontsIn: (r) => {
      const { from, to } = r ?? ed.state.selection;
      const out = new Map<string, LetterFont | null>();
      ed.state.doc.nodesBetween(from, to, (n) => {
        if (!n.isText) return;
        const f = asLetterFont(n.marks.find((m) => m.type.name === "letterFont")?.attrs.font);
        out.set(f ? fontId(f) : "", f);
      });
      return [...out.values()];
    },
    setFont: (f, r) => {
      const type = ed.schema.marks.letterFont!;
      ed.view.dispatch(f ? ed.state.tr.addMark(r.from, r.to, type.create({ font: f })) : ed.state.tr.removeMark(r.from, r.to, type));
    },
    dropFonts: (gone) => {
      const type = ed.schema.marks.letterFont!;
      const tr = ed.state.tr;
      ed.state.doc.descendants((n, pos) => {
        const f = n.isText ? asLetterFont(n.marks.find((m) => m.type === type)?.attrs.font) : null;
        if (f && gone(f)) tr.removeMark(pos, pos + n.nodeSize, type);
      });
      if (tr.docChanged) ed.view.dispatch(tr.setMeta("addToHistory", false));
    },
    atStart: () => ed.state.selection.from <= 1 && ed.state.selection.empty,
    cursorBlock: () => ed.state.selection.$from.index(0),
    setBreaks: (starts) => { ed.view.dispatch(ed.state.tr.setMeta(breaksKey, starts).setMeta("addToHistory", false)); },
    load: (json) => {
      const doc = ed.schema.nodeFromJSON(json);
      ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, doc.content).setMeta(TABLES_OK, true).setMeta("addToHistory", false));
    },
  };
}
