/**
 * تقويم الصفحة من الزوايا المؤكَّدة: مقاسٌ بالنسبة الحقيقية، وتقليصٌ داخليّ صغير يُبقي الخلفية خارج الناتج.
 *
 * **لماذا لا `extractDocument` من scanic:** لا يقبل إلا `output`، ومقاسه أطول الأضلاع المتقابلة بلا تصحيح
 * للمنظور، فالورقة المصوّرة بميلٍ قويّ تخرج مضغوطة (خطأ 9% في الاختبار). فلا يمكن تمرير المقاس الصحيح إليه،
 * والتقويم بـ`warp.ts` عندنا (مقاس بـ`trueAspect`، وعيّنة ثنائية الخطّ) هو الأبسط والأدقّ.
 *
 * **لماذا التقليص الداخليّ:** الزوايا التي يرسمها الكاشف أو يضعها المستخدم تقع غالباً على حدّ الورقة تماماً
 * أو خارجه ببكسلات، فيدخل الناتجَ خيطٌ بنّي أو إسفينٌ من الخلفية على الحافّة. وتقليص ثابت من كل ضلع
 * (في إحداثيات الصفحة بعد التقويم، فالنسبة لا تتغيّر) أبسط من قصّ ما يبدو داكناً، ولا يعتمد على لون الخلفية.
 */
import type { Quad } from "./types";
import type { Img } from "./types";
import type { Corners } from "./geom";
import { MAX_SIDE, applyH, homography, outputSize, warp } from "./warp";

/** نسبة ما يُقلَّص من كل ضلع: 1% (المطلوب 0.5–1%). فيخسر الناتج 2% من عرضه وطوله، وهامش الورق يفوق ذلك. */
export const EDGE_INSET = 0.01;

export function flatten(src: Img, c: Corners, inset = EDGE_INSET): Img {
  const q: Quad = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  const { width: W, height: H } = outputSize(q, MAX_SIDE, src);
  const mx = W * inset, my = H * inset;
  const toSrc = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], q);
  const inner = [{ x: mx, y: my }, { x: W - mx, y: my }, { x: W - mx, y: H - my }, { x: mx, y: H - my }].map((p) => applyH(toSrc, p)) as Quad;
  return warp(src, inner, { width: Math.max(1, Math.round(W * (1 - 2 * inset))), height: Math.max(1, Math.round(H * (1 - 2 * inset))) });
}
