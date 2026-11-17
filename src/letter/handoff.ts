/**
 * تسليم «تحرير الملف» من شاشة نتيجة «Word إلى PDF» إلى `/letter` (مواصفة لمى §٢): في IndexedDB على هذا الجهاز، لا في الرابط.
 * المفتاح عشوائي في `sessionStorage` (التبويب نفسه)، والسجلّ يُقرأ مرّة ويُحذف في المعاملة نفسها. فتحديث الصفحة بعده يجد المفتاح
 * بلا سجلّ: «انتهت جلسة الملف» (`expired`). وما يُقرأ يمرّ على `normalizeDoc` وخطوط الخطاب الستّة وحدها (شرط 🕵️ أمين)، والاسم نصّ.
 */
import { normalizeDoc, usedFonts, type LetterDoc } from "./model";
import { FONT_KEYS, type FontKey } from "./fonts";

export interface Handoff {
  /** اسم ملف Word كما اختاره المستخدم (يُعرض نصّاً لا HTML)، واسم ملف الـPDF عند الحفظ (`pdfNameFor`) */
  name: string;
  pdfName: string;
  doc: LetterDoc;
  /** «لم ينتقل إلى المحرّر»: سطر لكل بند */
  notMoved: string[];
}

const DB = "pdfsa-edit", STORE = "handoff";
/** عمر السجلّ الأقصى: ما أقدم منه يُمسح عند كل وضع وأخذ (ملاحظة 🕵️ أمين)، فلا يبقى ملف مستخدم في المتصفح بعد إغلاق تبويبه */
export const HANDOFF_TTL_MS = 10 * 60_000;

/** يمسح السجلّات التي `created` فيها أقدم من العمر الأقصى (وما لا `created` صالحة فيه). يُستدعى داخل معاملة الكتابة نفسها */
export function purgeStale(s: Pick<IDBObjectStore, "openCursor">, now = Date.now()) {
  const q = s.openCursor();
  q.onsuccess = () => {
    const c = q.result;
    if (!c) return;
    const at = (c.value as { created?: unknown } | null)?.created;
    if (typeof at !== "number" || !(0 <= now - at && now - at <= HANDOFF_TTL_MS)) c.delete();
    c.continue();
  };
}

/** محارف الاتجاه (U+061C، U+200E/F، U+202A–E، U+2066–9) تُحذف من اسم الملف المعروض، فلا تقلب ما حوله */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** مفتاح التبويب في `sessionStorage` */
export const SESSION_KEY = "pdfsa.editFile";

/** هل السجلّ حديث؟ `created` رقم والعمر ≤ الأقصى (وإلا فهو من جنس ما يمسحه `purgeStale`) */
export function isFresh(v: unknown, now = Date.now()): boolean {
  const at = (v as { created?: unknown } | null)?.created;
  return typeof at === "number" && 0 <= now - at && now - at <= HANDOFF_TTL_MS;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** يحفظ التسليم (ويحذف أي سابق)، ويضع مفتاحه في التبويب */
export async function putHandoff(h: Handoff): Promise<void> {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const db = await open();
  await new Promise<void>((res, rej) => {
    const t = db.transaction(STORE, "readwrite");
    const s = t.objectStore(STORE);
    s.clear(); // يشمل كل قديم، فلا حاجة هنا إلى purgeStale
    s.put({ ...h, created: Date.now() }, id);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  db.close();
  sessionStorage.setItem(SESSION_KEY, id);
}

/** يمسح القديم من القاعدة بلا حاجة إلى مفتاح جلسة: يُستدعى عند كل فتح لـ/letter ولأداة «Word ← PDF». فشله صامت، فلا يعطّل فتحاً عاديّاً */
export async function purgeStaleHandoffs(): Promise<void> {
  try {
    const db = await open();
    try {
      await new Promise<void>((res, rej) => {
        const t = db.transaction(STORE, "readwrite");
        purgeStale(t.objectStore(STORE));
        t.oncomplete = () => res();
        t.onerror = t.onabort = () => rej(t.error);
      });
    } finally { db.close(); }
  } catch { /* التخزين ممنوع أو غير متاح */ }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** يتحقّق ممّا قُرئ: الاسمان نصّان مقصوصان، والسطور نصوص، والمستند في قوائمه وحدوده بخطوط الخطاب وحدها. وغير ذلك null */
export function checkHandoff(v: unknown): Handoff | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Partial<Handoff>;
  let doc: LetterDoc;
  try { doc = normalizeDoc(o.doc as LetterDoc); } catch { return null; }
  if (usedFonts(doc).some((f) => typeof f !== "string" || !FONT_KEYS.includes(f as FontKey))) return null;
  const notMoved = Array.isArray(o.notMoved) ? o.notMoved.slice(0, 20).map((l) => str(l, 300)).filter(Boolean) : [];
  return { name: str(o.name, 255).replace(BIDI, ""), pdfName: str(o.pdfName, 255).replace(BIDI, "") || "ملف.pdf", doc, notMoved };
}

/**
 * التسليم المنتظر في هذا التبويب: `none` لا مفتاح (فتح عاديّ لـ/letter)، و`expired` مفتاح بلا سجلّ (تحديث بعد الفتح، أو تعذّر القراءة)،
 * و`ready` معه. والسجلّ يُحذف في معاملة القراءة نفسها، والمفتاح يبقى ليعرف التحديثُ أن الجلسة انتهت.
 */
export async function takeHandoff(): Promise<{ kind: "none" } | { kind: "expired" } | { kind: "ready"; h: Handoff }> {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) { void purgeStaleHandoffs(); return { kind: "none" }; } // لا مفتاح هنا، وقد يبقى سجلّ تبويبٍ أُغلق قبل /letter
  try {
    const db = await open();
    const got = await new Promise<unknown>((res, rej) => {
      const t = db.transaction(STORE, "readwrite");
      const s = t.objectStore(STORE);
      const r = s.get(id);
      r.onsuccess = () => s.delete(id);
      purgeStale(s);
      t.oncomplete = () => res(r.result);
      t.onerror = () => rej(t.error);
    });
    db.close();
    const h = isFresh(got) ? checkHandoff(got) : null; // أقدم من العمر الأقصى: منتهٍ ولو سبق `get` المسحَ
    return h ? { kind: "ready", h } : { kind: "expired" };
  } catch {
    return { kind: "expired" };
  }
}

/** ينهي جلسة التبويب (الإغلاق أو العودة إلى الرئيسية)، فلا يقول الفتح العاديّ بعدها «انتهت جلسة الملف» */
export function endHandoff() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* التخزين ممنوع */ }
}
