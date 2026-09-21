// 持久化层：仅负责 localStorage 的读写、校验与重置，不含任何业务规则。

import { seedState, storageKey, type PersistState } from "./seed";

export function loadState(): PersistState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    if (!parsed.orders || !parsed.drivers || !parsed.versions) {
      return seedState();
    }
    return {
      orders: parsed.orders,
      drivers: parsed.drivers,
      versions: parsed.versions,
      conflicts: parsed.conflicts ?? [],
      travelMatrix: parsed.travelMatrix ?? {}
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: PersistState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // 存储空间不足等情况静默处理，不影响内存态
  }
}

export function resetState(): PersistState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
