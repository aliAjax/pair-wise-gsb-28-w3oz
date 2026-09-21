// 应用状态（Zustand）：编排规则引擎与持久化层，本身不实现排班规则。
// 所有写操作都经过 src/rules 的纯函数校验，拒绝时落一条冲突记录。

import { create } from "zustand";
import {
  findOrderPlacement,
  latestVersion,
  lockTask,
  planBoard,
  tryInsertTask,
  tryMoveTask,
  removeTask
} from "../rules";
import { nowISO } from "../rules/time";
import type {
  BoardVersion,
  ConflictRecord,
  Driver,
  Order,
  Shift,
  ShiftAssignment
} from "../rules/types";
import { loadState, resetState, saveState } from "./storage";
import type { PersistState } from "./seed";

let idSeq = 0;
function uid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

interface State {
  orders: Order[];
  drivers: Driver[];
  versions: BoardVersion[];
  conflicts: ConflictRecord[];
  travelMatrix: Record<string, number>;
  viewingVersion: number;

  // 订单
  addOrder: (input: Omit<Order, "id" | "delivered">) => void;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  deleteOrder: (id: string) => void;

  // 司机与班次
  addDriver: (name: string) => void;
  updateDriver: (id: string, patch: Partial<Driver>) => void;
  deleteDriver: (id: string) => void;
  addShift: (driverId: string, input: Omit<Shift, "id" | "driverId">) => void;
  updateShift: (shiftId: string, patch: Partial<Shift>) => void;
  deleteShift: (driverId: string, shiftId: string) => void;

  // 车程矩阵
  setTravel: (from: string, to: string, minutes: number | null) => void;

  // 拖拽排班（仅作用于最新版本；锁定任务不可移动）
  assignTask: (orderId: string, shiftId: string, index: number) => boolean;
  moveTask: (orderId: string, fromShiftId: string, toShiftId: string, index: number) => boolean;
  unassignTask: (orderId: string, shiftId: string) => void;

  // 配送锁定 / 调班版本 / 版本查看
  markDelivered: (orderId: string, shiftId: string) => void;
  startRevision: (reason: string) => void;
  viewVersion: (version: number) => void;
  viewLatest: () => void;

  clearConflicts: () => void;
  resetAll: () => void;
}

function persist(s: Pick<State, "orders" | "drivers" | "versions" | "conflicts" | "travelMatrix">) {
  const data: PersistState = {
    orders: s.orders,
    drivers: s.drivers,
    versions: s.versions,
    conflicts: s.conflicts,
    travelMatrix: s.travelMatrix
  };
  saveState(data);
}

function assignmentOf(version: BoardVersion, shiftId: string): ShiftAssignment {
  return version.assignments.find((a) => a.shiftId === shiftId) ?? { shiftId, tasks: [] };
}

function findShift(drivers: Driver[], shiftId: string): { driver: Driver; shift: Shift } | undefined {
  for (const driver of drivers) {
    const shift = driver.shifts.find((s) => s.id === shiftId);
    if (shift) return { driver, shift };
  }
  return undefined;
}

function mapAssignment(
  versions: BoardVersion[],
  versionNo: number,
  shiftId: string,
  fn: (a: ShiftAssignment) => ShiftAssignment
): BoardVersion[] {
  return versions.map((v) => {
    if (v.version !== versionNo) return v;
    const exists = v.assignments.some((a) => a.shiftId === shiftId);
    const base: ShiftAssignment = exists ? assignmentOf(v, shiftId) : { shiftId, tasks: [] };
    const next = fn(base);
    return {
      ...v,
      assignments: exists
        ? v.assignments.map((a) => (a.shiftId === shiftId ? next : a))
        : [...v.assignments, next]
    };
  });
}

const initial = loadState();

export const useBoard = create<State>((set, get) => {
  function recordReject(args: {
    source: ConflictRecord["source"];
    orderId: string;
    shiftId: string;
    kind: ConflictRecord["kind"];
    overtimeMinutes: number;
    overloadKg: number;
    message: string;
  }) {
    const { orders, drivers, versions } = get();
    const order = orders.find((o) => o.id === args.orderId);
    const loc = findShift(drivers, args.shiftId);
    const record: ConflictRecord = {
      id: uid("c"),
      at: nowISO(),
      version: latestVersion(versions).version,
      source: args.source,
      orderId: args.orderId,
      orderNo: order?.orderNo ?? "—",
      driverId: loc?.driver.id ?? "",
      driverName: loc?.driver.name ?? "—",
      shiftId: args.shiftId,
      kind: args.kind,
      overtimeMinutes: args.overtimeMinutes,
      overloadKg: args.overloadKg,
      message: args.message
    };
    set((s) => ({ conflicts: [record, ...s.conflicts].slice(0, 50) }));
    persist(get());
  }

  return {
    ...initial,
    viewingVersion: latestVersion(initial.versions).version,

    addOrder: (input) => {
      const order: Order = { ...input, id: uid("o"), delivered: false };
      set((s) => ({ orders: [order, ...s.orders] }));
      persist(get());
    },

    updateOrder: (id, patch) => {
      set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
      persist(get());
    },

    deleteOrder: (id) => {
      set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
      persist(get());
    },

    addDriver: (name) => {
      const driver: Driver = { id: uid("d"), name, shifts: [] };
      set((s) => ({ drivers: [...s.drivers, driver] }));
      persist(get());
    },

    updateDriver: (id, patch) => {
      set((s) => ({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
      persist(get());
    },

    deleteDriver: (id) => {
      set((s) => {
        const removedShiftIds = new Set(s.drivers.find((d) => d.id === id)?.shifts.map((sh) => sh.id));
        return {
          drivers: s.drivers.filter((d) => d.id !== id),
          versions: s.versions.map((v) => ({
            ...v,
            assignments: v.assignments.filter((a) => !removedShiftIds.has(a.shiftId))
          }))
        };
      });
      persist(get());
    },

    addShift: (driverId, input) => {
      const shift: Shift = { ...input, id: uid("s"), driverId };
      set((s) => ({
        drivers: s.drivers.map((d) => (d.id === driverId ? { ...d, shifts: [...d.shifts, shift] } : d))
      }));
      persist(get());
    },

    updateShift: (shiftId, patch) => {
      set((s) => ({
        drivers: s.drivers.map((d) => ({
          ...d,
          shifts: d.shifts.map((sh) => (sh.id === shiftId ? { ...sh, ...patch } : sh))
        }))
      }));
      persist(get());
    },

    deleteShift: (driverId, shiftId) => {
      set((s) => ({
        drivers: s.drivers.map((d) =>
          d.id === driverId ? { ...d, shifts: d.shifts.filter((sh) => sh.id !== shiftId) } : d
        ),
        versions: s.versions.map((v) => ({
          ...v,
          assignments: v.assignments.filter((a) => a.shiftId !== shiftId)
        }))
      }));
      persist(get());
    },

    setTravel: (from, to, minutes) => {
      set((s) => {
        const next = { ...s.travelMatrix };
        const key = [from, to].sort().join("|");
        if (minutes == null) delete next[key];
        else next[key] = minutes;
        return { travelMatrix: next };
      });
      persist(get());
    },

    assignTask: (orderId, shiftId, index) => {
      const s = get();
      const ver = latestVersion(s.versions);
      const loc = findShift(s.drivers, shiftId);
      const order = s.orders.find((o) => o.id === orderId);
      if (!loc || !order || order.delivered) return false;
      if (findOrderPlacement(ver, orderId)) return false;

      const res = tryInsertTask(loc.shift, assignmentOf(ver, shiftId), index, orderId, s.orders, s.travelMatrix);
      if (!res.ok) {
        recordReject({
          source: "拖入拒绝",
          orderId,
          shiftId,
          kind: res.reject.kind === "超载" ? "超载" : res.reject.kind === "休息冲突" ? "休息冲突" : "超时",
          overtimeMinutes: res.reject.overtimeMinutes,
          overloadKg: res.reject.overloadKg,
          message: res.reject.message
        });
        return false;
      }
      set((st) => ({
        versions: mapAssignment(st.versions, ver.version, shiftId, () => res.assignment)
      }));
      persist(get());
      return true;
    },

    moveTask: (orderId, fromShiftId, toShiftId, index) => {
      const s = get();
      const ver = latestVersion(s.versions);
      const from = assignmentOf(ver, fromShiftId);
      const moved = from.tasks.find((t) => t.orderId === orderId);
      const targetLoc = findShift(s.drivers, toShiftId);
      if (!moved || moved.locked || !targetLoc) return false;

      const target =
        fromShiftId === toShiftId ? from : assignmentOf(ver, toShiftId);
      const res = tryMoveTask(targetLoc.shift, target, index, moved, s.orders, s.travelMatrix);
      if (!res.ok) {
        recordReject({
          source: "移动拒绝",
          orderId,
          shiftId: toShiftId,
          kind: res.reject.kind === "超载" ? "超载" : res.reject.kind === "休息冲突" ? "休息冲突" : "超时",
          overtimeMinutes: res.reject.overtimeMinutes,
          overloadKg: res.reject.overloadKg,
          message: res.reject.message
        });
        return false;
      }

      set((st) => {
        let versions = mapAssignment(st.versions, ver.version, toShiftId, () => res.assignment);
        if (fromShiftId !== toShiftId) {
          const v = versions.find((x) => x.version === ver.version)!;
          const removed = removeTask(
            findShift(st.drivers, fromShiftId)!.shift,
            assignmentOf(v, fromShiftId),
            orderId,
            st.orders,
            st.travelMatrix
          );
          versions = mapAssignment(versions, ver.version, fromShiftId, () => removed.assignment);
        }
        return { versions };
      });
      persist(get());
      return true;
    },

    unassignTask: (orderId, shiftId) => {
      const s = get();
      const ver = latestVersion(s.versions);
      const loc = findShift(s.drivers, shiftId);
      const current = assignmentOf(ver, shiftId);
      const task = current.tasks.find((t) => t.orderId === orderId);
      if (!loc || !task || task.locked) return;
      const removed = removeTask(loc.shift, current, orderId, s.orders, s.travelMatrix);
      set((st) => ({ versions: mapAssignment(st.versions, ver.version, shiftId, () => removed.assignment) }));
      persist(get());
    },

    markDelivered: (orderId, shiftId) => {
      const s = get();
      const ver = latestVersion(s.versions);
      const loc = findShift(s.drivers, shiftId);
      if (!loc) return;
      const board = planBoard(ver, s.drivers, s.orders, s.travelMatrix);
      const ps = board.get(shiftId);
      if (!ps || !ps.plan.ok) return;
      const locked = lockTask(ps.assignment, ps.plan, orderId);
      set((st) => ({
        versions: mapAssignment(st.versions, ver.version, shiftId, () => locked),
        orders: st.orders.map((o) =>
          o.id === orderId && !o.delivered
            ? { ...o, delivered: true, deliveredAt: nowISO() }
            : o
        )
      }));
      persist(get());
    },

    startRevision: (reason) => {
      set((s) => {
        const base = latestVersion(s.versions);
        const copy: BoardVersion = {
          version: base.version + 1,
          reason: reason.trim() || "未填写调班原因",
          createdAt: nowISO(),
          parentVersion: base.version,
          assignments: base.assignments.map((a) => ({ ...a, tasks: a.tasks.map((t) => ({ ...t })) }))
        };
        return { versions: [...s.versions, copy], viewingVersion: copy.version };
      });
      persist(get());
    },

    viewVersion: (version) => set({ viewingVersion: version }),
    viewLatest: () => set((s) => ({ viewingVersion: latestVersion(s.versions).version })),

    clearConflicts: () => {
      set({ conflicts: [] });
      persist(get());
    },

    resetAll: () => {
      const seeded = resetState();
      set({ ...seeded, viewingVersion: latestVersion(seeded.versions).version });
    }
  };
});
