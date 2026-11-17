/**
 * أسماء الأدوات بالسهم («صور ← PDF»، ملاحظة نايف ٢ في 1.0.2، نصوص هدى ومواصفة لمى §٢).
 * السهم نصّاً أو SVG داخل السطر محايدٌ في bidi، فينعكس بين كلمتين لاتينيتين («PDF ← Word» تُقرأ Word إلى PDF).
 * فيُرسم الاسم بـflex لا بالسطر: المصدر أول ابن (يمين في RTL)، ثم السهم، ثم الناتج (يسار)، ورأس السهم يساراً نحو الناتج.
 * والمرئيّ `aria-hidden`، ويقرأ القارئ الاسم بكلمة «إلى» من `span.sr-only`. ويبقى RLM في النصّ احتياطاً لما لا يمرّ من هنا.
 */
import { h, icon } from "./dom";

const RLM = /‏/g;
const LATIN = /^[A-Za-z0-9 ]+$/;

/** الاسم مقروءاً بكلمة «إلى» بدل السهم (للقارئ وللنصوص العادية). وما لا سهم فيه يرجع كما هو. */
export function toolNameText(name: string): string {
  const i = name.indexOf("←");
  if (i < 0) return name;
  return `${name.slice(0, i).replace(RLM, "").trim()} إلى ${name.slice(i + 1).replace(RLM, "").trim()}`;
}

/** عنصر الاسم: `span.tname` > `span.tname-vis[aria-hidden]` (bdi المصدر، السهم، bdi الناتج) + `span.sr-only`. وبلا سهم نصّاً عادياً. */
export function toolName(name: string): Node {
  const i = name.indexOf("←");
  if (i < 0) return document.createTextNode(name);
  const part = (s: string) => {
    const t = s.replace(RLM, "").trim();
    return h("bdi", LATIN.test(t) ? { lang: "en" } : {}, t);
  };
  return h("span", { class: "tname" },
    h("span", { class: "tname-vis", "aria-hidden": "true" }, part(name.slice(0, i)), icon("arrowLeft"), part(name.slice(i + 1))),
    h("span", { class: "sr-only" }, toolNameText(name)));
}
