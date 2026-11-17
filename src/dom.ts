/** أدوات DOM صغيرة، مشتركة بين العارض وشاشات التصوير. */
import { ICON } from "./icons";

export type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k !== null) el.append(k);
  return el;
}
export function icon(name: keyof typeof ICON): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = ICON[name];
  return t.content.firstElementChild as SVGElement;
}
