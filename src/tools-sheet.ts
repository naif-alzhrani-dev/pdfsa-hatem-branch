/**
 * «الأدوات» (طلب نايف ٢٠٢٦/١١/٠٨): بعد المسح أو بعد الحفظ يفتح المستخدم الملف الحالي في أداة أخرى من الذاكرة،
 * بلا تنزيله ثم رفعه من جديد. هنا الاختيار النقيّ للأدوات، والزرّ، وبلاطات الورقة. والفتح نفسه في main.ts (`startTool`).
 */
import { S, S4, SF } from "./strings";
import { h, icon } from "./dom";
import { splitIcon } from "./split-screen";
import { toolName } from "./tool-name";
import type { MoreTool } from "./tools/registry";

/** العملية التي خرج منها الملف. `tool`: أداة من «أدوات أخرى» (اسمها يُمرَّر وحده إلى `moreFor`). */
export type Op = "sign" | "edit" | "merge" | "split" | "scan" | "tool";
/** الأدوات التي تُعرض، بترتيب الرئيسية. «مسح ملف» لا يُعرض أبداً: المسح يصنع ملفاً ولا يفتحه. */
export type Tool = "sign" | "merge" | "split" | "edit";

/**
 * الأدوات المناسبة للملف (قرار نايف ٢٠٢٦/١١/٠٨ بعد المواصفة):
 * - بعد المسح (من نتيجته، أو بعد «تم» ثم الحفظ): «دمج» دائماً، و«تحرير» لصفحتين فأكثر. لا «توقيع» («تم» يفتحه أصلاً) ولا «تقسيم».
 * - بعد غيره: لا تظهر الأداة الحالية، و«تقسيم» و«تحرير» لصفحتين فأكثر.
 */
export function toolsFor(op: Op, pages: number): Tool[] {
  const multi = pages >= 2;
  const out: Tool[] = [];
  if (op !== "sign" && op !== "scan") out.push("sign");
  if (op !== "merge") out.push("merge");
  if (multi && op !== "split" && op !== "scan") out.push("split");
  if (multi && op !== "edit") out.push("edit");
  return out;
}

/** زرّ «الأدوات»: ثانويّ بأيقونة شبكة. */
export function toolsButton(onclick: () => void): HTMLButtonElement {
  return h("button", { class: "btn source tools-btn", type: "button", "data-test": "tools", onclick }, icon("grid"), h("span", {}, S4.tools)) as HTMLButtonElement;
}

const LABEL: Record<Tool, string> = { sign: S.signFile, merge: S.mergeFile, split: S4.splitFile, edit: S.editFile };

/** بلاطات الورقة، كبلاطات الرئيسية. `pick` يُعطى البلاطة الملموسة وكل البلاطات (لحالة الانشغال). */
export function toolsBody(tools: Tool[], pick: (t: Tool, tile: HTMLButtonElement, all: HTMLButtonElement[]) => void): HTMLElement {
  const all: HTMLButtonElement[] = [];
  for (const t of tools) {
    const ic = t === "split" ? splitIcon() : icon(t === "sign" ? "pen" : t === "merge" ? "merge" : "pages");
    const tile = h("button", { class: "home-tile", type: "button", "data-test": `tool-${t}`, onclick: () => pick(t, tile, all) }, ic, h("span", {}, LABEL[t])) as HTMLButtonElement;
    all.push(tile);
  }
  return h("div", { class: "home-row tools-grid", "data-test": "tools-grid" }, ...all);
}

/** أداة في ورقة «أدوات أخرى»: من السجلّ، أو أداة رئيسية نقلها المستخدم إليها (الإضافة ٢١) وأيقونتها رسمٌ خارج ICON («تقسيم»). */
export type SheetTool = Pick<MoreTool, "slug" | "label"> & { icon: MoreTool["icon"] | (() => Element) };

/** بلاطات ورقة «أدوات أخرى»: الأدوات المبنية وحدها (src/tools/registry.ts)، بشكل بلاطات «الأدوات». `pick` كما في `toolsBody`. */
export function moreToolsBody<T extends SheetTool>(tools: readonly T[], pick: (t: T, tile: HTMLButtonElement, all: HTMLButtonElement[]) => void): HTMLElement {
  const all: HTMLButtonElement[] = [];
  for (const t of tools) {
    const ic = typeof t.icon === "function" ? t.icon() : icon(t.icon);
    const tile = h("button", { class: "home-tile", type: "button", "data-test": `more-${t.slug}`, onclick: () => pick(t, tile, all) }, ic, h("span", {}, toolName(t.label))) as HTMLButtonElement;
    all.push(tile);
  }
  return h("div", { class: "home-row tools-grid more-grid", "data-test": "more-grid" }, ...all);
}

/**
 * «أدوات أخرى» للملف المحفوظ: ما يفتح ملف PDF مفتوحاً سلفاً (`openPdf`)، بلا الأداة التي خرج منها (`from`).
 * بترتيب ورقة «أدوات أخرى» في الرئيسية.
 */
export function moreFor<T extends Pick<MoreTool, "slug" | "openPdf">>(tools: readonly T[], from?: string): T[] {
  return tools.filter((t) => t.openPdf && t.slug !== from);
}

/** بلاطة «أدوات أخرى» في ورقة «الأدوات» بعد الحفظ: سطر الرئيسية نفسه (`home-more` في main.ts) بشكله ونصّه. */
export function moreToolsTile(onclick: () => void): HTMLButtonElement {
  return h("button", { class: "home-tile home-more", type: "button", "data-test": "tools-more", onclick }, h("span", {}, SF.moreTools)) as HTMLButtonElement;
}

/** البلاطة الملموسة تدور، والباقيات معطّلة، أثناء فتح الملف. */
export function busyTile(tile: HTMLButtonElement, all: HTMLButtonElement[]) {
  for (const b of all) b.disabled = true;
  tile.setAttribute("aria-busy", "true");
  tile.firstElementChild!.replaceWith(h("span", { class: "spinner", "aria-hidden": "true" }));
}
