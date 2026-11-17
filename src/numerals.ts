/** الحقول الرقمية تقبل العربية الهندية (٠–٩) والفارسية (۰–۹) واللاتينية (0–9). */
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** رقم موضع من ١ إلى `total`، أو null إن لم يكن رقماً صحيحاً في المدى. */
export function parsePosition(raw: string, total: number): number | null {
  const s = toLatinDigits(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= total ? n : null;
}
