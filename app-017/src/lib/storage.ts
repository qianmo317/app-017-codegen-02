/**
 * 文档持久化：IndexedDB（刷新后文档仍在，需求文档 §12）。
 */
import type { Doc } from '../types';

const DB_NAME = 'braille-studio';
const DB_VERSION = 1;
const STORE = 'docs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function listDocs(): Promise<Doc[]> {
  const docs = await withStore<Doc[]>('readonly', (s) => s.getAll() as IDBRequest<Doc[]>);
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id: string): Promise<Doc | undefined> {
  return withStore<Doc | undefined>('readonly', (s) => s.get(id) as IDBRequest<Doc | undefined>);
}

export async function saveDoc(doc: Doc): Promise<void> {
  await withStore('readwrite', (s) => s.put(doc));
}

export async function deleteDoc(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

export function newDoc(partial?: Partial<Doc>): Doc {
  return {
    id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: '未命名文档',
    raw: '',
    cells: [],
    setup: {
      cellsPerLine: 32,
      linesPerPage: 25,
      doubleSided: false,
      marginMm: { top: 20, left: 15, right: 15 },
    },
    ruleProfile: 'zh-current',
    updatedAt: Date.now(),
    overrides: {},
    confirmed: [],
    ...partial,
  };
}
