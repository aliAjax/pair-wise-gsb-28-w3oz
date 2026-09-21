// 状态层：zustand store。所有排班变更先经规则层校验，通过后写入并持久化，
// 保证刷新后排班与承诺一致。

import { create } from "zustand";
import type { Conflict, DispatchVersion, Driver, Order, PlannedStop, Plans } from "../domain/types";
import {
  computeTimeline,
  ordersById,
  snapshotPlans,
  validateInsertion,
} from "../domain/rules";
import { loadState, saveState } from "./persistence";

export interface OrderInput {
  orderNo: string;
  district: string;
  serviceMinutes: number;
  weightKg: number;
  windowStart: string;
  windowEnd: string;
  notes: string;
}

export interface DriverInput {
  name: string;
  shiftStart: string;
  shiftEnd: string;
  capacityKg: number;
}

export interface RescheduleRequest {
  orderId: string;
  fromDriverId: string;
  toDriverId: string;
  insertIndex: number;
  reason: string;
}

interface ScheduleStore {
  orders: Order[];
  drivers: Driver[];
  plans: Plans;
  versions: DispatchVersion[];
  /** 最近一次被整单拒绝的冲突列表（订单、司机、超时分钟、超出重量） */
  conflicts: Conflict[];

  addOrder: (input: OrderInput) => void;
  removeOrder: (orderId: string) => void;
  addDriver: (input: DriverInput) => void;
  /** 待分配订单拖入司机序列：重算到达时间，超时或累计超载则整单拒绝 */
  tryAssign: (orderId: string, driverId: string, insertIndex?: number) => boolean;
  /** 调班：带原因建新版本，原派单保留在历史版本中 */
  reschedule: (request: RescheduleRequest) => boolean;
  /** 退回待分配，同样属于调班，需要原因 */
  unassign: (orderId: string, driverId: string, reason: string) => void;
  /** 配送完成：锁定任务，锁定时间不可再被休息块或调班覆盖 */
  markDelivered: (driverId: string, orderId: string) => void;
  clearConflicts: () => void;
}

const initial = loadState();

function persist(state: Pick<ScheduleStore, "orders" | "drivers" | "plans" | "versions">) {
  saveState({
    orders: state.orders,
    drivers: state.drivers,
    plans: state.plans,
    versions: state.versions,
  });
}

export const useScheduleStore = create<ScheduleStore>((set, get) => {
  /** 调班前把原派单留存为历史版本，再以新排班生成新版本 */
  function commitVersions(previous: Plans, next: Plans, reason: string): DispatchVersion[] {
    const { versions, orders } = get();
    const orderMap = ordersById(orders);
    const history = [...versions];
    if (history.length === 0) {
      history.push({
        version: 1,
        reason: "初始派单（调班前留存）",
        createdAt: new Date().toISOString(),
        plans: snapshotPlans(previous, orderMap),
      });
    }
    history.push({
      version: history.length + 1,
      reason,
      createdAt: new Date().toISOString(),
      plans: snapshotPlans(next, orderMap),
    });
    return history;
  }

  return {
    orders: initial.orders,
    drivers: initial.drivers,
    plans: initial.plans,
    versions: initial.versions,
    conflicts: [],

    addOrder: (input) => {
      const order: Order = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...input,
      };
      set((state) => {
        const orders = [order, ...state.orders];
        persist({ ...state, orders });
        return { orders };
      });
    },

    removeOrder: (orderId) => {
      set((state) => {
        // 仅允许删除未排班的订单
        const assigned = Object.values(state.plans).some((stops) =>
          stops.some((stop) => stop.orderId === orderId)
        );
        if (assigned) return state;
        const orders = state.orders.filter((order) => order.id !== orderId);
        persist({ ...state, orders });
        return { orders };
      });
    },

    addDriver: (input) => {
      const driver: Driver = { id: crypto.randomUUID(), ...(input as Omit<Driver, "id">) };
      set((state) => {
        const drivers = [...state.drivers, driver];
        const plans = { ...state.plans, [driver.id]: [] as PlannedStop[] };
        persist({ ...state, drivers, plans });
        return { drivers, plans };
      });
    },

    tryAssign: (orderId, driverId, insertIndex) => {
      const { orders, drivers, plans } = get();
      const driver = drivers.find((item) => item.id === driverId);
      const order = orders.find((item) => item.id === orderId);
      if (!driver || !order) return false;
      const orderMap = ordersById(orders);
      const current = plans[driverId] ?? [];
      const { stops, conflicts } = validateInsertion(
        driver,
        current,
        order,
        insertIndex ?? current.length,
        orderMap
      );
      if (conflicts.length > 0) {
        set({ conflicts });
        return false;
      }
      set((state) => {
        const next = { ...state.plans, [driverId]: stops };
        persist({ ...state, plans: next });
        return { plans: next, conflicts: [] };
      });
      return true;
    },

    reschedule: ({ orderId, fromDriverId, toDriverId, insertIndex, reason }) => {
      const { orders, drivers, plans } = get();
      const driver = drivers.find((item) => item.id === toDriverId);
      const order = orders.find((item) => item.id === orderId);
      if (!driver || !order) return false;
      const orderMap = ordersById(orders);

      const sourceStops = (plans[fromDriverId] ?? []).filter((stop) => stop.orderId !== orderId);
      const targetBase = fromDriverId === toDriverId ? sourceStops : plans[toDriverId] ?? [];
      let index = insertIndex;
      if (fromDriverId === toDriverId) {
        const oldIndex = (plans[fromDriverId] ?? []).findIndex((stop) => stop.orderId === orderId);
        if (oldIndex >= 0 && oldIndex < insertIndex) index = insertIndex - 1;
      }
      const { stops, conflicts } = validateInsertion(driver, targetBase, order, index, orderMap);
      if (conflicts.length > 0) {
        set({ conflicts });
        return false;
      }

      set((state) => {
        const next: Plans = { ...state.plans, [toDriverId]: stops };
        if (fromDriverId !== toDriverId) {
          next[fromDriverId] = sourceStops;
        }
        const versions = commitVersions(state.plans, next, reason);
        persist({ ...state, plans: next, versions });
        return { plans: next, versions, conflicts: [] };
      });
      return true;
    },

    unassign: (orderId, driverId, reason) => {
      set((state) => {
        const stops = (state.plans[driverId] ?? []).filter((stop) => stop.orderId !== orderId);
        const next = { ...state.plans, [driverId]: stops };
        const versions = commitVersions(state.plans, next, reason);
        persist({ ...state, plans: next, versions });
        return { plans: next, versions };
      });
    },

    markDelivered: (driverId, orderId) => {
      const { orders, drivers, plans } = get();
      const driver = drivers.find((item) => item.id === driverId);
      if (!driver) return;
      const stops = plans[driverId] ?? [];
      const orderMap = ordersById(orders);
      const timeline = computeTimeline(driver, stops, orderMap);
      const entry = timeline.find((item) => item.kind === "stop" && item.orderId === orderId);
      if (!entry || entry.kind !== "stop") return;
      const arriveMin = entry.arriveMin;
      set((state) => {
        const nextStops = (state.plans[driverId] ?? []).map((stop) =>
          stop.orderId === orderId ? { ...stop, locked: true, lockedArriveMin: arriveMin } : stop
        );
        const next = { ...state.plans, [driverId]: nextStops };
        persist({ ...state, plans: next });
        return { plans: next };
      });
    },

    clearConflicts: () => set({ conflicts: [] }),
  };
});

export type { PlannedStop };
