// 规则引擎：纯函数实现排班承诺规则，不依赖界面与持久化。
// 规则一览：
// 1. 拖入订单后按停靠顺序重算每个停靠点的到达时间（承诺时间）。
// 2. 到达时间超出订单可送达时段，或司机累计载重超出载重上限 → 整单拒绝。
// 3. 连续执行（行驶 + 装卸）满 4 小时必须插入 30 分钟休息。
// 4. 已锁定（已配送）任务的时间不可改动，休息块不得覆盖已锁定任务。
// 5. 同一商圈行驶 10 分钟，跨商圈 30 分钟，车场首程 30 分钟；早于可送达时段到达则等待。

import type {
  Conflict,
  Driver,
  Order,
  PlannedStop,
  TimelineEntry,
  TimelineStop,
} from "./types";

export const REST_AFTER_MINUTES = 4 * 60; // 连续执行满四小时
export const REST_MINUTES = 30; // 休息时长
export const DEPOT_TRAVEL_MINUTES = 30; // 车场首程
export const SAME_DISTRICT_TRAVEL_MINUTES = 10; // 同商圈
export const CROSS_DISTRICT_TRAVEL_MINUTES = 30; // 跨商圈

export const DISTRICTS = ["浦东", "浦西", "嘉定", "松江", "青浦", "闵行"] as const;

/** "HH:mm" -> 当天分钟数 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 当天分钟数 -> "HH:mm" */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 相邻停靠点之间的行驶分钟 */
export function travelMinutes(fromDistrict: string | null, toDistrict: string): number {
  if (fromDistrict === null) return DEPOT_TRAVEL_MINUTES;
  return fromDistrict === toDistrict ? SAME_DISTRICT_TRAVEL_MINUTES : CROSS_DISTRICT_TRAVEL_MINUTES;
}

export function ordersById(orders: Order[]): Map<string, Order> {
  return new Map(orders.map((order) => [order.id, order]));
}

/**
 * 按停靠顺序重算时间线。
 * - 已锁定停靠点使用锁定时记录的到达时间，作为不可移动的时间锚点；
 *   游标 cursor 不会早于任何已锁定任务的离开时间，因此后续插入的休息块
 *   永远不会覆盖已锁定任务。
 * - 未锁定停靠点：若连续工作加上本单（行驶 + 装卸）将超过 4 小时，
 *   先在该停靠点前插入 30 分钟休息。
 */
export function computeTimeline(
  driver: Driver,
  stops: PlannedStop[],
  orderMap: Map<string, Order>
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const shiftEndMin = toMinutes(driver.shiftEnd);
  let cursor = toMinutes(driver.shiftStart);
  let continuous = 0; // 连续执行分钟（行驶 + 装卸）
  let prevDistrict: string | null = null;

  for (const stop of stops) {
    const order = orderMap.get(stop.orderId);
    if (!order) continue;
    const travel = travelMinutes(prevDistrict, order.district);

    if (stop.locked && typeof stop.lockedArriveMin === "number") {
      const arriveMin = stop.lockedArriveMin;
      const departMin = arriveMin + order.serviceMinutes;
      entries.push(buildStopEntry(order, stop.locked, arriveMin, departMin, shiftEndMin));
      cursor = Math.max(cursor, departMin);
      continuous += travel + order.serviceMinutes;
      prevDistrict = order.district;
      continue;
    }

    const workNeeded = travel + order.serviceMinutes;
    if (continuous > 0 && continuous + workNeeded > REST_AFTER_MINUTES) {
      entries.push({ kind: "rest", startMin: cursor, endMin: cursor + REST_MINUTES });
      cursor += REST_MINUTES;
      continuous = 0;
    }

    let arriveMin = cursor + travel;
    const windowStartMin = toMinutes(order.windowStart);
    if (arriveMin < windowStartMin) arriveMin = windowStartMin; // 早到等待至时段开始
    const departMin = arriveMin + order.serviceMinutes;

    entries.push(buildStopEntry(order, stop.locked, arriveMin, departMin, shiftEndMin));
    continuous += workNeeded;
    cursor = departMin;
    prevDistrict = order.district;
  }

  return entries;
}

function buildStopEntry(
  order: Order,
  locked: boolean,
  arriveMin: number,
  departMin: number,
  shiftEndMin: number
): TimelineStop {
  return {
    kind: "stop",
    orderId: order.id,
    arriveMin,
    departMin,
    locked,
    lateMinutes: Math.max(0, arriveMin - toMinutes(order.windowEnd)),
    shiftOverMinutes: Math.max(0, departMin - shiftEndMin),
  };
}

export interface PlanEvaluation {
  timeline: TimelineEntry[];
  conflicts: Conflict[];
  totalWeightKg: number;
}

/**
 * 评估一名司机的一整条停靠序列：
 * 累计载重超过载重上限、到达超出可送达时段、离开超出班次，都记为冲突。
 * 冲突中列出订单、司机、超时分钟与超出重量。
 */
export function evaluatePlan(
  driver: Driver,
  stops: PlannedStop[],
  orderMap: Map<string, Order>
): PlanEvaluation {
  const timeline = computeTimeline(driver, stops, orderMap);
  const conflicts: Conflict[] = [];
  let cumulativeKg = 0;

  for (const entry of timeline) {
    if (entry.kind !== "stop") continue;
    const order = orderMap.get(entry.orderId);
    if (!order) continue;
    cumulativeKg += order.weightKg;

    if (cumulativeKg > driver.capacityKg) {
      conflicts.push(
        buildConflict(order, driver, "weight", 0, cumulativeKg - driver.capacityKg)
      );
    }
    if (entry.lateMinutes > 0) {
      conflicts.push(buildConflict(order, driver, "window", entry.lateMinutes, 0));
    }
    if (entry.shiftOverMinutes > 0) {
      conflicts.push(buildConflict(order, driver, "shift", entry.shiftOverMinutes, 0));
    }
  }

  return { timeline, conflicts, totalWeightKg: cumulativeKg };
}

function buildConflict(
  order: Order,
  driver: Driver,
  kind: Conflict["kind"],
  overtimeMinutes: number,
  excessWeightKg: number
): Conflict {
  const kindText = kind === "weight" ? "累计超载" : kind === "window" ? "超出可送达时段" : "超出班次时段";
  const detail =
    kind === "weight"
      ? `累计 ${excessWeightKg}kg 超出载重`
      : `超时 ${overtimeMinutes} 分钟`;
  return {
    id: crypto.randomUUID(),
    orderId: order.id,
    orderNo: order.orderNo,
    driverId: driver.id,
    driverName: driver.name,
    kind,
    overtimeMinutes,
    excessWeightKg,
    message: `${order.orderNo} → ${driver.name}：${kindText}，${detail}，整单拒绝`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 校验把订单插入某司机序列的候选方案。
 * 新停靠点不允许插到已锁定任务之前（已锁定任务是已发生的历史）。
 * 返回 null 表示可承诺；否则返回冲突列表，调用方应整单拒绝。
 */
export function validateInsertion(
  driver: Driver,
  currentStops: PlannedStop[],
  order: Order,
  insertIndex: number,
  orderMap: Map<string, Order>
): { stops: PlannedStop[]; conflicts: Conflict[] } {
  const lockedCount = currentStops.filter((stop) => stop.locked).length;
  const index = Math.min(Math.max(insertIndex, lockedCount), currentStops.length);
  const candidate: PlannedStop[] = [
    ...currentStops.slice(0, index),
    { orderId: order.id, locked: false },
    ...currentStops.slice(index),
  ];
  const { conflicts } = evaluatePlan(driver, candidate, orderMap);
  return { stops: candidate, conflicts };
}

/** 派单快照：司机 -> 订单号序列，用于版本留存 */
export function snapshotPlans(
  plans: Record<string, PlannedStop[]>,
  orderMap: Map<string, Order>
): Record<string, string[]> {
  const snapshot: Record<string, string[]> = {};
  for (const [driverId, stops] of Object.entries(plans)) {
    snapshot[driverId] = stops.map((stop) => orderMap.get(stop.orderId)?.orderNo ?? stop.orderId);
  }
  return snapshot;
}

/** 订单状态：未出现在任何序列为待承诺；在序列中且锁定为已配送；否则为已承诺 */
export function orderStatusOf(orderId: string, plans: Record<string, PlannedStop[]>): "pending" | "assigned" | "delivered" {
  for (const stops of Object.values(plans)) {
    const hit = stops.find((stop) => stop.orderId === orderId);
    if (hit) return hit.locked ? "delivered" : "assigned";
  }
  return "pending";
}
