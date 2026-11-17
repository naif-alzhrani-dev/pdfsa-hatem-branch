// `Uint8Array.prototype.toHex/toBase64` و`Uint8Array.fromBase64/fromHex` جاءت في Chrome 140 وSafari 18.2 وFirefox 133
// (mdn/browser-compat-data، javascript.builtins.Uint8Array). وpdf.js 6 يستدعيها بلا فحص: `toHex` مرّتين في عامله
// (بصمة الملف `fingerprints`)، فيرمي ويُقال «ملف PDF غير صالح»؛ و`toBase64` على الخيط الرئيسي لخطّ @font-face.
// تُثبَّت هنا فقط إن غابت، بسلوك المواصفة في ما يلزم: الأبجديتان base64/base64url وomitPadding، والتجاهل لمسافات base64.
type U8Ctor = { fromBase64?: unknown; fromHex?: unknown };
type U8Proto = { toHex?: unknown; toBase64?: unknown };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toHex(this: Uint8Array): string {
  let s = "";
  for (let i = 0; i < this.length; i++) { const b = this[i]!; s += (b < 16 ? "0" : "") + b.toString(16); }
  return s;
}

function alphabetOf(options: unknown): "base64" | "base64url" {
  if (options !== undefined && (typeof options !== "object" || options === null)) throw new TypeError("options must be an object");
  const a = (options as { alphabet?: unknown } | undefined)?.alphabet;
  if (a === undefined) return "base64";
  if (a !== "base64" && a !== "base64url") throw new TypeError("invalid alphabet");
  return a;
}

export function toBase64(this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }): string {
  const alphabet = alphabetOf(options);
  const omit = Boolean(options?.omitPadding);
  let bin = "";
  for (let i = 0; i < this.length; i += 0x8000) bin += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000) as unknown as number[]);
  let out = btoa(bin);
  if (alphabet === "base64url") out = out.replace(/\+/g, "-").replace(/\//g, "_");
  return omit ? out.replace(/=+$/, "") : out;
}

export function fromBase64(str: string, options?: { alphabet?: string }): Uint8Array {
  if (typeof str !== "string") throw new TypeError("expected a string");
  const alphabet = alphabetOf(options);
  let s = str.replace(/[\t\n\f\r ]+/g, "");
  if (alphabet === "base64url") {
    if (/[+/]/.test(s)) throw new SyntaxError("invalid base64url");
    s = s.replace(/-/g, "+").replace(/_/g, "/");
  }
  const m = /^([A-Za-z0-9+/]*)(={0,2})$/.exec(s);
  if (!m || (m[2] && (m[1]!.length + m[2].length) % 4 !== 0) || m[1]!.length % 4 === 1) throw new SyntaxError("invalid base64");
  let bin: string;
  try { bin = atob(m[1]!); } catch { throw new SyntaxError("invalid base64"); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function fromHex(str: string): Uint8Array {
  if (typeof str !== "string") throw new TypeError("expected a string");
  if (str.length % 2 !== 0 || /[^0-9a-fA-F]/.test(str)) throw new SyntaxError("invalid hex");
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
}

export function installUint8Codec(): void {
  const proto = Uint8Array.prototype as unknown as U8Proto;
  const ctor = Uint8Array as unknown as U8Ctor;
  const def = (o: object, k: string, v: unknown) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
  if (typeof proto.toHex !== "function") def(proto, "toHex", toHex);
  if (typeof proto.toBase64 !== "function") def(proto, "toBase64", toBase64);
  if (typeof ctor.fromBase64 !== "function") def(Uint8Array, "fromBase64", fromBase64);
  if (typeof ctor.fromHex !== "function") def(Uint8Array, "fromHex", fromHex);
}
installUint8Codec();
