/**
 * سجلّ التراجع والإعادة لـ«تحرير ملف» (الإضافة ١٤، docs/logs/additions-14-17-lama-spec.md §١٤): مدخلات مرتّبة، والحدّ يُسقط الأقدم.
 * لا DOM هنا: كل مدخل يعرف كيف يتراجع وكيف يعيد. والتنفيذ مصفوف: الضغطات السريعة تُنفَّذ بترتيبها ولا تُهمل،
 * والحال المنطقيّ (ما يُتراجع عنه وما يُعاد) يتقدّم فوراً فلا يتأخّر الزرّان عن الضغطة.
 */
export interface Entry {
  label: string;
  /** "pen": من الأقلام، فيعمل في وضع القلم. */
  scope?: "pen";
  /** مفتاح الدمج: مدخلان متتاليان بالمفتاح نفسه في `mergeMs` مدخلٌ واحد (النقل بالأسهم). */
  key?: string;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}
export type HistoryEvent = "push" | "undo" | "redo" | "clear";
export interface History {
  push(e: Entry): void;
  undo(scope?: "pen"): Promise<Entry | null>;
  redo(scope?: "pen"): Promise<Entry | null>;
  canUndo(scope?: "pen"): boolean;
  canRedo(scope?: "pen"): boolean;
  /** عدد ما يُتراجع عنه: حدّ وضع القلم يُقرأ منه عند الدخول. */
  depth(): number;
  clear(): void;
  markClean(): void;
  isClean(): boolean;
  /** يُنتظر حتى ينتهي كل ما صُفّ. */
  idle(): Promise<void>;
}

interface Slot { e: Entry; at: number }

export function createHistory(o: { limit?: number; mergeMs?: number; now?: () => number; onChange?: (ev: HistoryEvent, e: Entry | null) => void } = {}): History {
  const limit = o.limit ?? 100, mergeMs = o.mergeMs ?? 600, now = o.now ?? (() => Date.now());
  let past: Slot[] = [], future: Entry[] = [];
  /** طول `past` عند آخر حفظ (أو الفتح)، و-1 إن لم تعد العودة إليه ممكنة. */
  let cleanAt = 0;
  let queue: Promise<void> = Promise.resolve();
  const run = (f: () => void | Promise<void>) => {
    queue = queue.then(f).catch((err) => { console.error(err); });
    return queue;
  };
  const changed = (ev: HistoryEvent, e: Entry | null) => o.onChange?.(ev, e);
  const scoped = (e: Entry | undefined, scope?: "pen") => !!e && (!scope || e.scope === scope);

  return {
    push(e) {
      const top = past[past.length - 1];
      if (cleanAt > past.length) cleanAt = -1; // تُراجع عن نقطة الحفظ ثم جاء فعل جديد: لا عودة إليها
      future = [];
      const t = now();
      // الدمج لا يعبر نقطة الحفظ: المدخل الأعلى فيها جزء من الحال المحفوظ
      if (e.key && top && top.e.key === e.key && t - top.at <= mergeMs && cleanAt !== past.length) {
        const first = top.e;
        top.e = { ...e, undo: first.undo };
        top.at = t;
      } else {
        past.push({ e, at: t });
        if (past.length > limit) {
          past.shift();
          cleanAt = cleanAt > 0 ? cleanAt - 1 : -1;
        }
      }
      changed("push", e);
    },
    async undo(scope) {
      const top = past[past.length - 1];
      if (!scoped(top?.e, scope)) return null;
      past.pop();
      future.push(top!.e);
      changed("undo", top!.e);
      await run(() => top!.e.undo());
      return top!.e;
    },
    async redo(scope) {
      const e = future[future.length - 1];
      if (!scoped(e, scope)) return null;
      future.pop();
      past.push({ e: e!, at: -Infinity }); // المعاد لا يُدمج فيه ما بعده
      changed("redo", e!);
      await run(() => e!.redo());
      return e!;
    },
    canUndo: (scope) => scoped(past[past.length - 1]?.e, scope),
    canRedo: (scope) => scoped(future[future.length - 1], scope),
    depth: () => past.length,
    clear() {
      past = [];
      future = [];
      cleanAt = 0;
      changed("clear", null);
    },
    markClean() { cleanAt = past.length; },
    isClean: () => cleanAt === past.length,
    idle: () => queue,
  };
}
