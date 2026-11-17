/**
 * «فحص ملف» على قالب `.tool` (docs/logs/phase2/inspect-lama.md): الحالة الفارغة، ثم الانتظار على الزرّ نفسه («جارٍ الفحص…»)،
 * ثم بطاقة الحكم (رأسها الحكم وسطره ورابط «ما الذي نفحصه؟»، وجسمها البنود ثم المعلومات) و«افحص ملفاً آخر».
 * الفحص في عامل (`runTool("inspect")`)، ومعه فتح pdf.js في المضيف (`host.open`): إن فشل فالملف «غير صالح» (قرار المدير).
 * ولا ناتج للفحص، فلا ورقة حفظ ولا «الأدوات» بعده.
 */
import { h, icon } from "../dom";
import type { ICON } from "../icons";
import type { InfoKind, InspectItem, ItemLevel, Verdict } from "./inspect-core";
import { INFO, SIN, VERDICTS, itemLine } from "./inspect-strings";
import type { OpenedPdf, ToolHost } from "./host";
import type { RunResult } from "./run-tool";
import { showEmpty, topbar } from "./tool-ui";

const VERDICT_ICON: Record<Verdict, keyof typeof ICON> = { unsafe: "octagonAlert", caution: "triangleAlert", clear: "searchCheck", invalid: "fileX" };
const LEVEL_ICON: Record<ItemLevel, keyof typeof ICON> = { unsafe: "octagonAlert", caution: "triangleAlert" };

export interface Report { verdict: Verdict; items: InspectItem[]; info: InfoKind[] }

/** أسطر البطاقة بترتيبها: «غير آمن» ثم «يحتاج انتباهاً» (كلٌّ بترتيب جدول النصّ كما تعيده النواة)، ثم المعلومات. «غير صالح» بلا قائمة. */
export function reportLines(r: Report) {
  if (r.verdict === "invalid") return { items: [], info: [] };
  const rank = (l: ItemLevel) => (l === "unsafe" ? 0 : 1);
  return {
    items: r.items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.level) - rank(b.it.level) || a.i - b.i)
      .map(({ it }) => ({ level: it.level, text: itemLine(it.kind, it.count) })),
    info: r.info.map((k) => INFO[k]),
  };
}

async function inspect(bytes: Uint8Array): Promise<RunResult<"inspect">> {
  try {
    const { runTool } = await import("./run-tool");
    return await runTool("inspect", bytes, {});
  } catch {
    return { ok: false, error: "failed" }; // لم تصل قطعة العامل
  }
}

export function showInspect(host: ToolHost, error?: string, src?: OpenedPdf) {
  const start = showStart(host, error, src);
  if (src) start(new File([src.bytes as BlobPart], src.name, { type: "application/pdf" })); // «أدوات أخرى» بعد الحفظ: الملف مفتوح سلفاً
}

/** الحالة الفارغة، ويُرجع بدء الفحص لملف مختار. `given`: ملف فتحه المضيف سلفاً، فلا يُفتح مرة ثانية. */
function showStart(host: ToolHost, error?: string, given?: OpenedPdf) {
  const open = async (file: File) => {
    let bytes: Uint8Array;
    try { bytes = given ? given.bytes : new Uint8Array(await file.arrayBuffer()); } catch { bytes = new Uint8Array(0); }
    const [opened, r] = await Promise.all([given ?? host.open(file), inspect(bytes)]);
    given = undefined;
    if (typeof opened !== "string") void opened.doc.loadingTask?.destroy(); // pdf.js للحكم بالفتح وحده، ولا معاينة
    const bad = typeof opened === "string" ? opened === "bad" : opened.doc.numPages < 1;
    if (bad) { showReport(host, file.name, { verdict: "invalid", items: [], info: [] }); return null; }
    if (!r.ok) return SIN.failed;
    showReport(host, file.name, r);
    return null;
  };
  return showEmpty(host, { slug: "inspect", p: "in", name: SIN.name, lead: SIN.lead, busy: SIN.busy, open }, async () => {}, error);
}

function showReport(host: ToolHost, name: string, r: Report) {
  const lines = reportLines(r);
  const title = h("h2", { class: "iv-title", id: "iv-title", tabindex: "-1", "data-test": "iv-title" }, VERDICTS[r.verdict].title);
  const head = h("div", { class: "iv-head" },
    h("span", { class: "iv-icon" }, icon(VERDICT_ICON[r.verdict])), title,
    h("p", { class: "iv-line", "data-test": "iv-line" }, VERDICTS[r.verdict].line),
    r.verdict === "invalid" ? null : h("a", { class: "iv-more", href: "/privacy#inspect", target: "_blank", rel: "noopener", "data-test": "iv-more" }, SIN.whatWeCheck));
  const list = (cls: string, rows: Node[]) => (rows.length ? h("ul", { class: cls, "data-test": cls === "iv-list" ? "iv-items" : "iv-info" }, ...rows) : null);
  const report = h("section", { class: "inspect-report", "data-verdict": r.verdict, "aria-labelledby": "iv-title", "data-test": "iv-report" }, head,
    list("iv-list", lines.items.map((l) => h("li", { class: "iv-item", "data-level": l.level }, icon(LEVEL_ICON[l.level]), h("span", {}, l.text)))),
    list("iv-list info", lines.info.map((t) => h("li", { class: "iv-item" }, icon("info"), h("span", {}, t)))));

  const again = h("button", { class: "btn wash block inspect-again", type: "button", "data-test": "in-again" }, SIN.again) as HTMLButtonElement;
  // المنتقي مباشرة: إن أُلغي بقيت النتيجة، وإن اختير ملف عادت الحالة الفارغة منتظرةً
  again.addEventListener("click", () => host.pickPdf((f) => showStart(host)(f)));
  const context = h("p", { class: "tool-context", dir: "rtl", "data-test": "in-context" }, h("bdi", {}, name));
  const rail = h("aside", { class: "tool-rail" }, h("div", { class: "tool-context-box" }, context), h("div", { class: "tool-save" }, again));
  host.app.replaceChildren(topbar(host, SIN.name), h("main", { class: "tool inspect", "data-test": "tool-inspect" }, h("section", { class: "tool-work" }, report), rail));
  window.scrollTo(0, 0);
  title.focus();
}
