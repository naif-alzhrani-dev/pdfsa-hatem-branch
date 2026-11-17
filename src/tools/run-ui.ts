/**
 * أجزاء شاشات «ضغط ملف» و«حماية ملف» و«فك الحماية» المشتركة: حقل كلمة المرور بزرّ «إظهار»، والنتيجة قبل الحفظ
 * (سطرها، وتنبيه التوقيع الرقمي، وزرّ الحفظ مكان زرّ التنفيذ). العمل نفسه في عامل (`run-tool.ts`).
 */
import { S } from "../strings";
import { h } from "../dom";
import { toLatinDigits } from "../numerals";
import { SRT } from "./run-strings";
import { SPR } from "./protect-strings";

/**
 * حقل كلمة المرور: الأرقام الهندية والفارسية تصير إنجليزية وهي تُكتب (والمؤشّر في مكانه، فالتحويل حرف بحرف)،
 * وزرّ «إظهار» يبدّل نوع الحقل، ونصُّه يصير «إخفاء» والكلمة ظاهرة (بلا `aria-pressed`: الحالة في النصّ). والتحقق من الكلمة في المنطق (`normalizePassword`) لا هنا.
 */
export function passwordField(o: { id: string; label: string; show: string; autocomplete: string; notes?: Node[]; onInput: () => void }) {
  const input = h("input", {
    class: "split-input tool-input pw-input", id: o.id, type: "password", dir: "ltr", autocomplete: o.autocomplete,
    autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", "data-test": `${o.id}`,
  }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const v = toLatinDigits(input.value);
    if (v !== input.value) {
      const at = input.selectionStart;
      input.value = v;
      if (at !== null) input.setSelectionRange(at, at);
    }
    input.removeAttribute("aria-invalid");
    o.onInput();
  });
  const show = h("button", { class: "text-btn pw-show", type: "button", "aria-controls": o.id, "data-test": `${o.id}-show` }, o.show) as HTMLButtonElement;
  show.addEventListener("click", () => {
    const on = input.type === "password";
    input.type = on ? "text" : "password";
    show.textContent = on ? SPR.hide : o.show;
    show.classList.toggle("shown", on);
  });
  const field = h("div", { class: "tool-field" },
    h("label", { class: "tool-label", for: o.id }, o.label),
    h("div", { class: "pw-row" }, input, show),
    ...(o.notes ?? []));
  return { field, input, show };
}

/**
 * مكان النتيجة فوق زرّ التنفيذ. `offer` يعرض سطر النتيجة (إن وُجد)، وتنبيه التوقيع عند `signed`، وزرّ الحفظ
 * («احفظ دون التوقيع الرقمي» عند `signed`، وإلا «حفظ الملف») ويخفي زرّ التنفيذ. و`clear` يعيد زرّ التنفيذ.
 */
export function resultSlot(p: string, run: HTMLButtonElement) {
  const slot = h("div", { class: "tool-result", "data-test": `${p}-result` });
  slot.hidden = true;
  const clear = () => {
    slot.replaceChildren();
    slot.hidden = true;
    run.hidden = false;
  };
  const offer = (o: { line?: string; signed: boolean; save: () => void }) => {
    const save = h("button", { class: "btn primary block", type: "button", "data-test": `${p}-save` }, o.signed ? SRT.saveUnsigned : S.save) as HTMLButtonElement;
    save.addEventListener("click", () => o.save());
    slot.replaceChildren(
      ...(o.line ? [h("p", { class: "tool-done", role: "status", "data-test": `${p}-done` }, o.line)] : []),
      ...(o.signed ? [h("p", { class: "tool-signed", "data-test": `${p}-signed` }, SRT.signedNote)] : []),
      save);
    slot.hidden = false;
    run.hidden = true;
    save.focus();
  };
  return { slot, offer, clear };
}
