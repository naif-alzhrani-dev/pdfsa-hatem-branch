// بوليفلات خطّ الأساس (Safari/iOS 16.4، وChrome 110، وFirefox ESR 153): ما يستدعيه pdf.js 6 بلا فحص وجاء بعد خطّ الأساس.
// القائمة من مسح dist/assets بـmdn/browser-compat-data 8.1.8 (docs/logs/fix-old-browsers-2.md)، والإصدار بعد كلٍّ: Chrome / Safari / Firefox.
// كلٌّ يُثبَّت فقط إن غاب، غير قابل للعدّ، قبل pdf.js على الخيط الرئيسي وفي عامله. والحارس e2e/old-baseline.spec.ts.
// (و`Promise.try` في promise-try.ts، وأسرة `Uint8Array.toHex/toBase64` في uint8-codec.ts.)
type Fn = (...a: never[]) => unknown;
const def = (o: object | undefined, k: PropertyKey, v: unknown) => {
  if (o && typeof (o as Record<PropertyKey, unknown>)[k] !== "function") Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
};

// Promise.withResolvers — 119 / 17.4 / 121
def(Promise, "withResolvers", function withResolvers<T>() {
  let resolve!: (v: T | PromiseLike<T>) => void, reject!: (e?: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
});

// Map/WeakMap.prototype.getOrInsert/getOrInsertComputed — 145 / 26.2 / 144
for (const C of [Map, WeakMap] as unknown as { prototype: { has(k: unknown): boolean; get(k: unknown): unknown; set(k: unknown, v: unknown): unknown } }[]) {
  def(C.prototype, "getOrInsert", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  def(C.prototype, "getOrInsertComputed", function (this: Map<unknown, unknown>, key: unknown, fn: (k: unknown) => unknown) {
    if (typeof fn !== "function") throw new TypeError("callback is not a function");
    if (this.has(key)) return this.get(key);
    const value = fn(key);
    this.set(key, value);
    return value;
  });
}

// Math.sumPrecise — 147 / 26.2 / 137. جمعٌ دقيق بخوارزمية Shewchuk (fsum): المجاميع الجزئية بلا خطأ تقريب، ثم تقريب واحد.
export function sumPrecise(items: Iterable<number>): number {
  const partials: number[] = [];
  let posInf = false, negInf = false, nan = false, allNegZero = true;
  for (const x of items) {
    if (typeof x !== "number") throw new TypeError("sumPrecise: expected numbers");
    if (Number.isNaN(x)) { nan = true; continue; }
    if (x === Infinity) { posInf = true; continue; }
    if (x === -Infinity) { negInf = true; continue; }
    if (!(x === 0 && Object.is(x, -0))) allNegZero = false;
    let v = x, i = 0;
    for (let p of partials) {
      if (Math.abs(v) < Math.abs(p)) [v, p] = [p, v];
      const hi = v + p, lo = p - (hi - v);
      if (lo !== 0) partials[i++] = lo;
      v = hi;
    }
    partials.length = i;
    if (!Number.isFinite(v)) { // فاض المجموع الجزئي: المواصفة تعطي ±Infinity إن فاض المجموع الحقيقي
      if (v === Infinity) posInf = true; else negInf = true;
      partials.length = 0;
      continue;
    }
    partials.push(v);
  }
  if (nan || (posInf && negInf)) return NaN;
  if (posInf) return Infinity;
  if (negInf) return -Infinity;
  if (allNegZero) return -0;
  // من الأكبر: جمعٌ مع تصحيح نصف المسافة (كما في math.fsum)
  let n = partials.length, hi = 0, lo = 0;
  if (n > 0) {
    hi = partials[--n]!;
    while (n > 0) {
      const x = hi, y = partials[--n]!;
      hi = x + y;
      lo = y - (hi - x);
      if (lo !== 0) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))) {
      const y = lo * 2, x = hi + y;
      if (y === x - hi) hi = x;
    }
  }
  return hi;
}
def(Math, "sumPrecise", sumPrecise);

// URL.parse — 126 / 18 / 126
def(URL, "parse", (url: string | URL, base?: string | URL) => { try { return new URL(url, base); } catch { return null; } });

// AbortSignal.any — 116 / 17.4 / 124
if (typeof AbortSignal !== "undefined") def(AbortSignal, "any", (signals: Iterable<AbortSignal>) => {
  const c = new AbortController();
  const list = [...signals];
  const done = list.find((s) => s.aborted);
  if (done) { c.abort(done.reason); return c.signal; }
  const off = () => { for (const s of list) s.removeEventListener("abort", on); };
  function on(this: AbortSignal) { off(); c.abort(this.reason); }
  for (const s of list) s.addEventListener("abort", on);
  return c.signal;
});

// Set.prototype.union/intersection/... — 122 / 17 / 127. `other` يُقرأ كما في المواصفة: has وkeys وsize.
type SetLike = { size: number; has(v: unknown): boolean; keys(): Iterator<unknown> };
const setLike = (o: unknown): SetLike => {
  const r = o as SetLike;
  if (r === null || typeof r !== "object" || typeof r.has !== "function" || typeof r.keys !== "function" || Number.isNaN(Number(r.size))) throw new TypeError("expected a set-like object");
  return r;
};
const keysOf = (o: SetLike) => { const it = o.keys(), out: unknown[] = []; for (let n = it.next(); !n.done; n = it.next()) out.push(n.value); return out; };
const SP = Set.prototype as unknown as Record<string, unknown>;
def(SP, "union", function (this: Set<unknown>, o: unknown) { const r = new Set(this); for (const v of keysOf(setLike(o))) r.add(v); return r; });
def(SP, "intersection", function (this: Set<unknown>, o: unknown) { const s = setLike(o), r = new Set(); for (const v of this) if (s.has(v)) r.add(v); return r; });
def(SP, "difference", function (this: Set<unknown>, o: unknown) { const s = setLike(o), r = new Set(this); for (const v of this) if (s.has(v)) r.delete(v); return r; });
def(SP, "symmetricDifference", function (this: Set<unknown>, o: unknown) { const r = new Set(this); for (const v of keysOf(setLike(o))) { if (this.has(v)) r.delete(v); else r.add(v); } return r; });
def(SP, "isSubsetOf", function (this: Set<unknown>, o: unknown) { const s = setLike(o); for (const v of this) if (!s.has(v)) return false; return true; });
def(SP, "isSupersetOf", function (this: Set<unknown>, o: unknown) { for (const v of keysOf(setLike(o))) if (!this.has(v)) return false; return true; });
def(SP, "isDisjointFrom", function (this: Set<unknown>, o: unknown) { const s = setLike(o); for (const v of this) if (s.has(v)) return false; return true; });

// ArrayBuffer.prototype.transfer/transferToFixedLength — 114 / 17.4 / 122. النقل بـstructuredClone يفصل الأصل كما في المواصفة.
function transfer(this: ArrayBuffer, newLength?: number): ArrayBuffer {
  const len = newLength === undefined ? this.byteLength : Math.max(0, Math.trunc(Number(newLength)) || 0);
  const moved = structuredClone(this, { transfer: [this] });
  if (len === moved.byteLength) return moved;
  const out = new ArrayBuffer(len);
  new Uint8Array(out).set(new Uint8Array(moved, 0, Math.min(len, moved.byteLength)));
  return out;
}
def(ArrayBuffer.prototype, "transfer", transfer);
def(ArrayBuffer.prototype, "transferToFixedLength", transfer);

// Response/Blob.prototype.bytes — 132 / 18 / 128، و144 / 18 / 128
async function bytes(this: { arrayBuffer(): Promise<ArrayBuffer> }) { return new Uint8Array(await this.arrayBuffer()); }
if (typeof Response !== "undefined") def(Response.prototype, "bytes", bytes);
if (typeof Blob !== "undefined") def(Blob.prototype, "bytes", bytes);

// Iterator ومساعداته — 122 / 18.4 / 131. pdf.js يقرأ `Iterator.prototype` عند تقييمه، فبلا الاسم العامّ يرمي ReferenceError ولا يعمل شيء.
const IP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as Record<PropertyKey, unknown>;
const G = globalThis as unknown as { Iterator?: unknown };
if (typeof G.Iterator !== "function") {
  const Iterator = function Iterator(this: unknown) {
    if (new.target === undefined || new.target === Iterator) throw new TypeError("Iterator is an abstract class");
  } as unknown as { prototype: unknown; from?: unknown };
  Object.defineProperty(Iterator, "prototype", { value: IP, writable: false, enumerable: false, configurable: false });
  Object.defineProperty(G, "Iterator", { value: Iterator, writable: true, configurable: true, enumerable: false });
}
type It = Iterator<unknown>;
const fnArg = (fn: unknown) => { if (typeof fn !== "function") throw new TypeError("callback is not a function"); return fn as Fn as (v: unknown, i: number) => unknown; };
const count = (n: unknown) => { const v = Number(n); if (Number.isNaN(v) || v < 0) throw new RangeError("invalid count"); return Math.trunc(v); };
function* steps(it: It): Generator<unknown, void, undefined> { for (let n = it.next(); !n.done; n = it.next()) yield n.value; }
def(IP, "map", function (this: It, fn: unknown) { const f = fnArg(fn), it = this; return (function* () { let i = 0; for (const v of steps(it)) yield f(v, i++); })(); });
def(IP, "filter", function (this: It, fn: unknown) { const f = fnArg(fn), it = this; return (function* () { let i = 0; for (const v of steps(it)) if (f(v, i++)) yield v; })(); });
def(IP, "take", function (this: It, n: unknown) { const lim = count(n), it = this; return (function* () { if (lim === 0) { it.return?.(); return; } let i = 0; for (const v of steps(it)) { yield v; if (++i >= lim) { it.return?.(); return; } } })(); });
def(IP, "drop", function (this: It, n: unknown) { const lim = count(n), it = this; return (function* () { let i = 0; for (const v of steps(it)) if (i++ >= lim) yield v; })(); });
def(IP, "flatMap", function (this: It, fn: unknown) { const f = fnArg(fn), it = this; return (function* () { let i = 0; for (const v of steps(it)) yield* f(v, i++) as Iterable<unknown>; })(); });
def(IP, "reduce", function (this: It, fn: unknown, ...init: unknown[]) {
  const f = fnArg(fn) as unknown as (a: unknown, v: unknown, i: number) => unknown;
  let i = 0, acc: unknown, first = init.length === 0;
  if (!first) acc = init[0];
  for (const v of steps(this)) { if (first) { acc = v; first = false; } else acc = f(acc, v, i); i++; }
  if (first) throw new TypeError("reduce of empty iterator with no initial value");
  return acc;
});
def(IP, "toArray", function (this: It) { return [...steps(this)]; });
def(IP, "forEach", function (this: It, fn: unknown) { const f = fnArg(fn); let i = 0; for (const v of steps(this)) f(v, i++); });
def(IP, "some", function (this: It, fn: unknown) { const f = fnArg(fn); let i = 0; for (let n = this.next(); !n.done; n = this.next()) if (f(n.value, i++)) { this.return?.(); return true; } return false; });
def(IP, "every", function (this: It, fn: unknown) { const f = fnArg(fn); let i = 0; for (let n = this.next(); !n.done; n = this.next()) if (!f(n.value, i++)) { this.return?.(); return false; } return true; });
def(IP, "find", function (this: It, fn: unknown) { const f = fnArg(fn); let i = 0; for (let n = this.next(); !n.done; n = this.next()) if (f(n.value, i++)) { this.return?.(); return n.value; } return undefined; });
def((G as { Iterator: object }).Iterator, "from", (o: unknown) => {
  const get = (o as Record<PropertyKey, unknown>)?.[Symbol.iterator];
  const it = (typeof get === "function" ? (get as () => It).call(o) : o) as It;
  if (it !== null && typeof it === "object" && Object.prototype.isPrototypeOf.call(IP, it)) return it;
  return steps(it);
});
export {};
