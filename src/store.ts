/** المحفوظ: توقيعات وأختام، وخلفيات الخطاب (الدفعة ز)، في IndexedDB على هذا الجهاز وحده. */
import type { Kind } from "./place";

/** «background»: صورة خلفية الخطاب كما أُعدّت (JPEG في `png`، background.ts)، لصفحة «إعداد خطاب» وحدها */
export type AssetKind = Kind | "background";

// PNG يُخزَّن ArrayBuffer لا Blob: WebKit في التصفّح الخاص لا يقبل Blob في IndexedDB.
export interface Asset<K extends AssetKind = Kind> { id: string; kind: K; png: ArrayBuffer; w: number; h: number; created: number }

const DB = "pdf-sign", STORE = "assets";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

export async function listAssets<K extends AssetKind>(kind: K): Promise<Asset<K>[]> {
  const all = await tx<Asset<AssetKind>[]>("readonly", (s) => s.getAll() as IDBRequest<Asset<AssetKind>[]>);
  return all.filter((a): a is Asset<K> => a.kind === kind).sort((a, b) => b.created - a.created);
}
export async function getAsset(id: string): Promise<Asset | undefined> {
  return tx<Asset | undefined>("readonly", (s) => s.get(id) as IDBRequest<Asset | undefined>);
}
export async function addAsset(a: Asset<AssetKind>): Promise<void> {
  await tx("readwrite", (s) => s.put(a));
  // يطلب من المتصفح ألّا يمسح المحفوظ عند ضيق المساحة (لا نافذة تظهر للمستخدم)
  try { await navigator.storage?.persist?.(); } catch { /* غير مدعوم */ }
}
export async function deleteAsset(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
