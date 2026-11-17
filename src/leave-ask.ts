/**
 * نافذة PDFsa داخل الصفحة بدل `window.confirm` و`window.alert` (قرار نايف «أ» ٢٠٢٦/١١/١٥، docs/logs/leave-dialog-lama-spec.md
 * §١ وملحق ٨، والنصوص من هدى). Safari على iOS يعيد `confirm` «لا» بلا نافذة بعد `pushState` والرجوع في السجلّ
 * (Apple Developer Forums 684407، docs/logs/back-home-fix.md)، فكان زرّ الرجوع مع العمل غير المحفوظ لا يفعل شيئاً.
 * - عنصر واحد `<dialog>` يُنشأ مرّة في `body`، وأنواعه بـ`data-kind`: `leave` (لم يُحفظ) و`delete` (حذف الصفحة) و`notice` (رسالة خطأ).
 *   لا الورقة المشتركة (مقبضها و✕ وإغلاقها يشغّل ما لا يخصّ السؤال).
 * - مفتوحاً هو طبقةٌ في السجلّ (`navLayers` في main.ts يعدّ كل `dialog[open]` بـ`:modal`): السحب الثاني يرسل إليه `cancel`.
 * - الزرّ الأساسيّ وEsc والغطاء و`cancel` كلها «primary»، ويعود التركيز إلى ما كان قبلها. والضغط الثاني بعد الاختيار يُتجاهل.
 * - ما دامت مفتوحة يُخفى شريط النصّ العائم (`.fbar`) تحت الغطاء (صقل ٤١): `body.ask-open`.
 */
import { h } from "./dom";
import { S } from "./strings";

export type AskAnswer = "primary" | "danger";
export type AskKind = "leave" | "delete" | "notice";
export interface Ask {
  title: string;
  /** سطر الرسالة: بغيابه لا `<p>` ولا `aria-describedby`. */
  line?: string;
  primary: string;
  /** الزرّ الخطِر: بغيابه رسالةٌ بزرّ واحد (`notice`). */
  danger?: string;
  /** `leave` أو `delete` (للزرّين)، وبلا `danger` هي `notice` دائماً. */
  kind?: Exclude<AskKind, "notice">;
  /** ما يعود إليه التركيز بعد «primary» (حقل الكتابة: لمسة زرّ الرجوع ركّزت الزرّ؛ وزرّ السؤال: Safari لا يركّز الزرّ بلمسه)، وإلا ما كان مركَّزاً. */
  focusTo?: HTMLElement | null;
}

const CLOSE_MS = 160; // كـ.closing في الورقة المشتركة (main.ts closeSheet)
const TESTS: Record<AskKind, [dialog: string, primary: string, danger: string]> = {
  leave: ["leave-ask", "leave-stay", "leave-exit"],
  delete: ["ask-delete", "ask-keep", "ask-remove"],
  notice: ["ask-notice", "ask-ok", ""],
};

let dlg: HTMLDialogElement | null = null;
let titleEl: HTMLElement;
let lineEl: HTMLElement;
let textEl: HTMLElement;
let row: HTMLElement;
let primaryBtn: HTMLButtonElement;
let dangerBtn: HTMLButtonElement;
let answer: ((a: AskAnswer) => void) | null = null;
let kindNow: AskKind = "leave";
/** رسائل `notice` التي وجدت نافذة مفتوحة: تنتظر إغلاقها (حدث `close`) ثم تظهر، فلا تُبتلع. */
const waiters: Array<() => void> = [];
const release = () => { for (const w of waiters.splice(0)) w(); };

function build() {
  titleEl = h("h2", { id: "ask-title" });
  lineEl = h("p", { id: "ask-line" });
  textEl = h("div", { class: "ask-text" }, titleEl);
  primaryBtn = h("button", { class: "btn primary", type: "button", autofocus: "" }) as HTMLButtonElement;
  dangerBtn = h("button", { class: "text-btn danger", type: "button" }) as HTMLButtonElement;
  row = h("div", { class: "leave-row" });
  const d = h("dialog", { class: "bottom-sheet leave-ask", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "ask-title" },
    h("div", { class: "sheet-body" }, textEl, row)) as HTMLDialogElement;
  primaryBtn.addEventListener("click", () => finish("primary"));
  dangerBtn.addEventListener("click", () => finish("danger"));
  d.addEventListener("cancel", (e) => { e.preventDefault(); finish("primary"); }); // Esc، و`cancel` من السحب الثاني (main.ts back)
  d.addEventListener("click", (e) => { if (e.target === d) finish("primary"); }); // الغطاء: الضغطة خارج الورقة تصل إلى dialog نفسه
  // أُغلقت من خارج finish (`dlg.close()`): الجواب «primary» وإلا بقي `answer` عالقاً فيُجاب كل سؤال بعدها «primary» بلا نافذة (زرّ الرجوع ميّت)
  d.addEventListener("close", () => { if (answer && !d.open) finish("primary"); release(); }); // `!d.open`: حدثٌ قديم مؤجَّل لا يُجيب سؤالاً فُتح بعده
  document.body.append(d);
  return d;
}

let back: HTMLElement | null = null; // ما كان مركَّزاً قبل النافذة
let textFocus = false;

function finish(a: AskAnswer) {
  const d = dlg, done = answer;
  if (!d || !done) return; // الضغط الثاني بعد الاختيار
  answer = null;
  const to = back;
  back = null;
  document.body.classList.remove("ask-open");
  // الخروج يُغادر الشاشة فلا يُعاد التركيز، والحذف يعيده إلى زرّه (والمستدعي ينقله إن زال)
  const refocus = a === "primary" || kindNow === "delete";
  if (!d.open) { if (refocus) to?.focus({ preventScroll: true }); done(a); return; } // أُغلقت من خارج finish: لا مهلة إغلاق (قد تُغلق بعدها نافذةً فُتحت من جديد)
  if (a === "danger" || textFocus) {
    // «الخروج»/«الحذف» فوراً ثم العمل، و«primary» إلى حقل نصّ فوراً داخل الضغطة فتعود لوحة المفاتيح في اللمسة نفسها
    d.close();
    if (refocus) to?.focus({ preventScroll: true });
  } else {
    d.classList.add("closing");
    setTimeout(() => { d.classList.remove("closing"); d.close(); to?.focus({ preventScroll: true }); }, CLOSE_MS);
  }
  done(a);
}

/**
 * يعرض السؤال أو الرسالة ويعيد جوابه. سؤالٌ مفتوح يُبقى كما هو، والثاني يُجاب «primary» بلا نافذة ثانية؛
 * أما الرسالة (`notice`) فتنتظر إغلاق المفتوحة ثم تظهر.
 */
export async function ask(o: Ask): Promise<AskAnswer> {
  dlg ??= build();
  const kind: AskKind = o.danger === undefined ? "notice" : (o.kind ?? "leave");
  // الرسالة لا تُبتلع: تنتظر إغلاق ما هو مفتوح (أو في مهلة إغلاقه) ثم تظهر. و`leave` و`delete` يبقيان على سلوكهما
  while (answer || dlg.open) {
    if (kind !== "notice") return "primary";
    await new Promise<void>((r) => waiters.push(r));
  }
  kindNow = kind;
  const f = o.focusTo ?? document.activeElement;
  back = f instanceof HTMLElement && f !== document.body ? f : null;
  textFocus = back instanceof HTMLTextAreaElement || back instanceof HTMLInputElement;
  const [dt, pt, xt] = TESTS[kind];
  dlg.dataset.kind = kind;
  dlg.dataset.test = dt;
  titleEl.textContent = o.title;
  if (o.line) { lineEl.textContent = o.line; textEl.append(lineEl); dlg.setAttribute("aria-describedby", "ask-line"); }
  else { lineEl.remove(); dlg.removeAttribute("aria-describedby"); }
  primaryBtn.textContent = o.primary;
  primaryBtn.dataset.test = pt;
  primaryBtn.classList.toggle("block", kind === "notice");
  if (kind === "notice") { dangerBtn.remove(); row.remove(); textEl.after(primaryBtn); }
  else {
    dangerBtn.textContent = o.danger!;
    dangerBtn.dataset.test = xt;
    row.replaceChildren(primaryBtn, dangerBtn);
    textEl.after(row);
  }
  const p = new Promise<AskAnswer>((r) => (answer = r));
  document.body.classList.add("ask-open");
  try { dlg.showModal(); }
  catch { answer = null; back = null; document.body.classList.remove("ask-open"); release(); return "primary"; } // لا يبقى `answer` عالقاً ولا غطاء
  primaryBtn.focus();
  return p;
}

export type LeaveAnswer = "stay" | "exit";

/** «لم يُحفظ» قبل الخروج: «البقاء» أساسيّ، و`exitLabel` الخطِر. */
export function askLeave(title: string, exitLabel: string = S.leaveDialog.exit, focusTo?: HTMLElement | null): Promise<LeaveAnswer> {
  return ask({ title, primary: S.leaveDialog.stay, danger: exitLabel, kind: "leave", focusTo }).then((a) => (a === "danger" ? "exit" : "stay"));
}

/** حذف الصفحة: «الإبقاء» أساسيّ و«الحذف» الخطِر. يعيد true إن حُذفت. */
export const askDelete = (title: string, focusTo?: HTMLElement | null) =>
  ask({ title, primary: S.dialogs.keep, danger: S.dialogs.remove, kind: "delete", focusTo }).then((a) => a === "danger");

/** رسالة خطأ بزرّ «حسناً» وحده. */
export const notice = (title: string, line: string) => ask({ title, line, primary: S.dialogs.ok }).then(() => undefined);
