/**
 * The browser's `localStorage`, as the `StorageLike` the model expects.
 *
 * `lib/storage.ts` deliberately references no storage global, so it can be unit
 * tested against a plain Map-backed fake. The DOM's `Storage` almost satisfies
 * it — it has `getItem`, `setItem` and `removeItem` — but not a key list, which
 * `listBoardIds` needs to rebuild the index from the boards themselves. This is
 * that one missing method, in one place.
 */
import type { StorageLike } from './types';

/** Wrap a DOM `Storage` (or anything shaped like one) as a `StorageLike`. */
export function asStorageLike(storage: Storage): StorageLike {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    keys: () => {
      const all: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null) all.push(key);
      }
      return all;
    },
  };
}

/** The browser's storage as a `StorageLike`, or null when access is refused. */
export function browserStorage(): StorageLike | null {
  try {
    return asStorageLike(window.localStorage);
  } catch {
    return null;
  }
}
