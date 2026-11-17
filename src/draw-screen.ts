/**
 * شاشة «ارسم توقيعك» (docs/design-spec-batch4.md §٣)، واحدة للرئيسية (main.ts) و«إعداد خطاب» (letter/ui.ts، L4).
 * الناتج PNG شفاف أصلاً، فلا تفريغ: يُحفظ مع التوقيعات في المخزن القائم (store.ts) فيظهر في «المحفوظ»، ثم يضعه المضيف.
 * ولا تستورد شيئاً من src/letter ولا من الرئيسية: حارس الاستيراد في tests/letter-doc.test.ts.
 */
import { h, icon } from "./dom";
import { S, S4 } from "./strings";
import { DrawPad } from "./draw-pad";
import { inkColor, inkPicker } from "./ink";
import { addAsset, type Asset } from "./store";

export interface DrawHost {
  /** «رجوع» أو Escape: الشاشة أُغلقت، فيعيد المضيف لوحة التوقيع. */
  back(): void;
  /** بعد «ضعه على الصفحة»: الشاشة أُغلقت، و`saved` خطأ إن تعذّر الحفظ في المخزن (فالتوقيع في `asset` وحده). */
  done(asset: Asset, saved: boolean): Promise<void>;
}

export function openDrawScreen(host: DrawHost): void {
  const canvas = h("canvas", { class: "draw-canvas", role: "img", "aria-label": S4.drawPadLabel, "data-test": "draw-pad" }) as HTMLCanvasElement;
  const backBtn = h("button", { class: "icon-btn", type: "button", "aria-label": S.back, "data-test": "draw-back" }, icon("back"));
  const clearBtn = h("button", { class: "text-btn", type: "button", "data-test": "draw-clear", disabled: true }, S4.clearDrawing) as HTMLButtonElement;
  const doneBtn = h("button", { class: "btn primary", type: "button", "data-test": "draw-done", disabled: true }, S.placeOnPage) as HTMLButtonElement;
  // الحبر: آخر لون اختير على الجهاز (ومنه دائرة الألوان، قرار نايف ٢٠٢٦/١١/١٤ «تضاف لها دائرة الألوان»)، وتغييره يلوّن ما رُسم ولا يمسحه
  const ink = inkPicker({ testId: "draw-ink", custom: true, compact: true, onChange: (n) => pad.setColor(inkColor(n)) });
  const screen = h("dialog", { class: "draw-screen", "aria-label": S4.drawSignature, "data-test": "draw-screen" },
    h("header", { class: "draw-head" }, backBtn),
    h("div", { class: "draw-area" }, h("span", { class: "draw-base", "aria-hidden": "true" }), canvas),
    ink.note,
    h("div", { class: "draw-actions" }, clearBtn, ink.el, doneBtn)) as HTMLDialogElement;
  document.body.append(screen);
  screen.showModal();
  let busy = false;
  const sync = () => { clearBtn.disabled = doneBtn.disabled = busy || pad.isEmpty(); };
  const pad = new DrawPad(canvas, () => sync(), inkColor(ink.value()));
  const ro = new ResizeObserver(() => pad.resize()); // المقاس والاتجاه: يُعاد الرسم ولا يُمسح
  ro.observe(canvas);
  const close = () => { ro.disconnect(); pad.destroy(); screen.close(); screen.remove(); };
  const back = () => { close(); host.back(); };
  backBtn.addEventListener("click", back);
  screen.addEventListener("cancel", (e) => { e.preventDefault(); back(); });
  clearBtn.addEventListener("click", () => pad.clear());
  doneBtn.addEventListener("click", async () => {
    if (busy || pad.isEmpty()) return;
    busy = true; sync();
    doneBtn.setAttribute("aria-busy", "true");
    try {
      const blob = await pad.toPng();
      if (!blob) return;
      const bmp = await createImageBitmap(blob);
      const asset: Asset = { id: crypto.randomUUID(), kind: "signature", png: await blob.arrayBuffer(), w: bmp.width, h: bmp.height, created: Date.now() };
      bmp.close();
      let saved = true;
      try { await addAsset(asset); } catch { saved = false; }
      close();
      await host.done(asset, saved);
    } finally {
      busy = false;
      doneBtn.removeAttribute("aria-busy");
      if (screen.isConnected) sync();
    }
  });
}
