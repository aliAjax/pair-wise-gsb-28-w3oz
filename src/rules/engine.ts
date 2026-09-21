// 核心规则引擎（纯函数，不依赖 React / localStorage）：
// 1. 拖入时按顺序重算到达时间：从班次起点出发，逐段累加 行驶 + 装卸；
// 2. 连续执行满 4 小时自动插入 30 分钟休息，休息不得覆盖已锁定任务；
// 3. 超时（到达晚于可送达时段止，或超出班次结束）或累计超载，整单拒绝；
// 4. 已配送/锁定任务时间固定，后续任务围绕它们重算；
// 5. 锁定时把承诺的到达/完成分钟固化，保证刷新后排班与承诺一致。

import { RULES } from "./constants";
import { toMin } from "./time";
import { travelMinutes, type TravelMatrix } from "./travel";
import type {
  Driver,
  Order,
  Shift,
  ShiftAssignment,
  TaskPlacement
} from "./types";

export interface PlannedTask {
  orderId: string;
  /** 到达商圈分钟 */
  arriveMin: number;
  /** 离开（装卸完成）分钟 */
  endMin: number;
  /** 完成该单时累计在途重量 */
  cumulativeKg: number;
  /** 之前是否插入了休息 */
  breakBefore: boolean;
  /** 休息区间（若有） */
  breakStart?: number;
  breakEnd?: number;
  locked: boolean;
}

export interface PlanResult {
  ok: boolean;
  tasks: PlannedTask[];
  /** ok=false 时：首个违反规则的任务下标 */
  rejectIndex: number;
  rejectOrderId?: string;
  rejectKind?: "超时" | "超载" | "休息冲突" | "班次容量";
  overtimeMinutes: number;
  overloadKg: number;
  message?: string;
}

interface Ctx {
  orders: Map<string, Order>;
  matrix: TravelMatrix;
}

/**
 * 顺序重算一个班次的执行序列。
 * 规则细节：
 * - 起点为场站，出发时间 = 班次开始；
 * - locked 任务使用 fixedArriveMin/fixedEndMin，中间空隙可被行驶/休息利用，
 *   但任何计算出的行驶、装卸、休息区间都不得与锁定区间重叠（休息不得覆盖已锁定任务）；
 * - 连续工作累计 >= 240 分钟，则在下一段行驶前插入 30 分钟休息；
 *   若插入休息会压到后面的锁定任务，则拒绝（休息冲突）。
 */
export function planShift(
  shift: Shift,
  assignment: ShiftAssignment,
  orders: Order[],
  matrix: TravelMatrix
): PlanResult {
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  return planShiftWithMap(shift, assignment, { orders: orderMap, matrix });
}

function planShiftWithMap(shift: Shift, assignment: ShiftAssignment, ctx: Ctx): PlanResult {
  const shiftStart = toMin(shift.start);
  const shiftEnd = toMin(shift.end);
  const planned: PlannedTask[] = [];

  let cursor = shiftStart; // 当前可用时间（已完成上一任务/休息）
  let location: string = RULES.depot;
  let cumulativeKg = 0;
  let workedSinceBreak = 0; // 距上次休息的连续工作分钟

  for (let i = 0; i < assignment.tasks.length; i++) {
    const task = assignment.tasks[i];
    const order = ctx.orders.get(task.orderId);
    if (!order) {
      return fail(i, task.orderId, "超时", 0, 0, `订单数据缺失：${task.orderId}`);
    }

    const winStart = toMin(order.windowStart);
    const winEnd = toMin(order.windowEnd);
    const leg = travelMinutes(location, order.district, ctx.matrix);

    if (task.locked && task.fixedArriveMin != null && task.fixedEndMin != null) {
      // —— 已锁定任务：承诺时间固定，不得被任何东西覆盖 ——
      const lockStart = task.fixedArriveMin;
      const lockEnd = task.fixedEndMin;

      if (cursor > lockStart) {
        // 前面的任务/休息已经压到了锁定任务
        return fail(
          i, task.orderId, "休息冲突",
          cursor - lockStart, 0,
          `休息/前序任务覆盖已锁定任务 ${order.orderNo}`
        );
      }
      // 最早可达时间（含可能需要的休息：休息只能落在空档）
      let earliest = cursor + needBreakBeforeLeg(workedSinceBreak, leg) + leg;
      if (earliest > lockStart) {
        // 空档不足以同时容纳休息+车程；尝试把休息插在更早的位置等价于 cursor 后移，仍冲突
        return fail(
          i, task.orderId, "休息冲突",
          earliest - lockStart, 0,
          `无法在不覆盖锁定任务 ${order.orderNo} 的情况下完成休息与行驶`
        );
      }

      const breaks = insertBreakInGap(cursor, lockStart - leg, workedSinceBreak, leg);
      if (breaks.overload) {
        return fail(i, task.orderId, "休息冲突", 0, 0, `休息会覆盖已锁定任务 ${order.orderNo}`);
      }

      // 承诺时间若被班次调整推出班次边界，属于存量超时冲突
      if (lockEnd > shiftEnd || lockStart < shiftStart) {
        return fail(
          i, task.orderId, "超时",
          Math.max(lockEnd - shiftEnd, shiftStart - lockStart, 0), 0,
          `已锁定任务 ${order.orderNo} 的承诺超出班次 ${shift.start}-${shift.end}`
        );
      }

      cumulativeKg += order.weightKg;
      if (cumulativeKg > shift.capacityKg) {
        return fail(i, task.orderId, "超载", 0, cumulativeKg - shift.capacityKg,
          `已锁定任务 ${order.orderNo} 使累计 ${cumulativeKg}kg 超出班次载重 ${shift.capacityKg}kg`);
      }
      planned.push({
        orderId: order.id,
        arriveMin: lockStart,
        endMin: lockEnd,
        cumulativeKg,
        breakBefore: breaks.took,
        breakStart: breaks.range?.[0],
        breakEnd: breaks.range?.[1],
        locked: true
      });

      // 到达锁定任务的车程与承诺装卸区间都计入连续工时（早到等待不计）
      workedSinceBreak = breaks.took ? 0 : workedSinceBreak;
      workedSinceBreak += leg + order.serviceMinutes;
      cursor = lockEnd;
      location = order.district;
      continue;
    }

    // —— 普通任务 ——
    // 到达本段起点时若连续工时已满 4 小时（含作业跨线累积），先休息再行驶；
    // 作业期间跨过 4 小时线时不打断作业，在本单完成后、下一单行驶前补休。
    let breakBefore = false;
    let breakRange: [number, number] | undefined;
    if (workedSinceBreak + leg >= RULES.breakAfterMinutes) {
      const bStart = cursor;
      const bEnd = cursor + RULES.breakMinutes;
      breakBefore = true;
      breakRange = [bStart, bEnd];
      cursor = bEnd;
      workedSinceBreak = 0;
    }

    let arrive = cursor + leg;
    // 到达早于班次开始或窗口开始则等待（等待不计入连续工时）
    const earliestAllowed = Math.max(shiftStart, winStart);
    if (arrive < earliestAllowed) arrive = earliestAllowed;

    const end = arrive + order.serviceMinutes;
    cumulativeKg += order.weightKg;

    // —— 校验：超时（到达超出窗口止，或作业完成超出班次结束）——
    let overtime = 0;
    if (arrive > winEnd) overtime = Math.max(overtime, arrive - winEnd);
    if (end > shiftEnd) overtime = Math.max(overtime, end - shiftEnd);
    if (overtime > 0) {
      return fail(i, order.id, "超时", overtime, 0,
        `${order.orderNo} 到达 ${fmt(arrive)} 超出可送达时段/班次 ${overtime} 分钟，整单拒绝`);
    }

    // —— 校验：累计超载 ——
    if (cumulativeKg > shift.capacityKg) {
      return fail(i, order.id, "超载", 0, cumulativeKg - shift.capacityKg,
        `${order.orderNo} 装入后累计 ${cumulativeKg}kg 超出班次载重 ${shift.capacityKg}kg，整单拒绝`);
    }

    workedSinceBreak += leg + order.serviceMinutes;
    planned.push({
      orderId: order.id,
      arriveMin: arrive,
      endMin: end,
      cumulativeKg,
      breakBefore,
      breakStart: breakRange?.[0],
      breakEnd: breakRange?.[1],
      locked: false
    });
    cursor = end;
    location = order.district;
  }

  return { ok: true, tasks: planned, rejectIndex: -1, overtimeMinutes: 0, overloadKg: 0 };
}

function needBreakBeforeLeg(worked: number, leg: number): number {
  return worked + leg >= RULES.breakAfterMinutes ? RULES.breakMinutes : 0;
}

/** 在 [gapStart, deadline] 的空档内尝试安排休息；返回是否安排了休息及区间 */
function insertBreakInGap(
  gapStart: number,
  deadline: number,
  worked: number,
  leg: number
): { took: boolean; range?: [number, number]; overload: boolean } {
  if (worked + leg < RULES.breakAfterMinutes) return { took: false, overload: false };
  const bEnd = gapStart + RULES.breakMinutes;
  if (bEnd > deadline) return { took: false, overload: true };
  return { took: true, range: [gapStart, bEnd], overload: false };
}

function fail(
  rejectIndex: number,
  orderId: string,
  kind: PlanResult["rejectKind"],
  overtimeMinutes: number,
  overloadKg: number,
  message: string
): PlanResult {
  return {
    ok: false,
    tasks: [],
    rejectIndex,
    rejectOrderId: orderId,
    rejectKind: kind,
    overtimeMinutes,
    overloadKg,
    message
  };
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 班次级操作：拖入（整单拒绝语义）、重排、固化承诺
// ---------------------------------------------------------------------------

export type RejectReason = NonNullable<PlanResult["rejectKind"]>;

export interface RejectInfo {
  kind: RejectReason;
  overtimeMinutes: number;
  overloadKg: number;
  message: string;
}

/** 尝试把订单放入某班次指定位置；失败则返回拒绝原因，原序列不变 */
export function tryInsertTask(
  shift: Shift,
  assignment: ShiftAssignment,
  index: number,
  orderId: string,
  orders: Order[],
  matrix: TravelMatrix
): { ok: true; assignment: ShiftAssignment; plan: PlanResult } | { ok: false; reject: RejectInfo } {
  const tasks = [...assignment.tasks];
  tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, { orderId });
  const candidate: ShiftAssignment = { shiftId: shift.id, tasks };
  const plan = planShift(shift, candidate, orders, matrix);
  if (!plan.ok) {
    return {
      ok: false,
      reject: {
        kind: plan.rejectKind ?? "超时",
        overtimeMinutes: plan.overtimeMinutes,
        overloadKg: plan.overloadKg,
        message: plan.message ?? "排班冲突"
      }
    };
  }
  return { ok: true, assignment: candidate, plan };
}

/** 移除任务并重算 */
export function removeTask(
  shift: Shift,
  assignment: ShiftAssignment,
  orderId: string,
  orders: Order[],
  matrix: TravelMatrix
): { assignment: ShiftAssignment; plan: PlanResult } {
  const tasks = assignment.tasks.filter((t) => t.orderId !== orderId);
  const next = { shiftId: shift.id, tasks };
  return { assignment: next, plan: planShift(shift, next, orders, matrix) };
}

/** 班次内/跨班次移动（拖拽排序）；目标不合法时整单拒绝 */
export function tryMoveTask(
  targetShift: Shift,
  target: ShiftAssignment,
  index: number,
  moved: TaskPlacement,
  orders: Order[],
  matrix: TravelMatrix
): { ok: true; assignment: ShiftAssignment; plan: PlanResult } | { ok: false; reject: RejectInfo } {
  const tasks = target.tasks.filter((t) => t.orderId !== moved.orderId);
  tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, moved);
  const candidate: ShiftAssignment = { shiftId: targetShift.id, tasks };
  const plan = planShift(targetShift, candidate, orders, matrix);
  if (!plan.ok) {
    return {
      ok: false,
      reject: {
        kind: plan.rejectKind ?? "超时",
        overtimeMinutes: plan.overtimeMinutes,
        overloadKg: plan.overloadKg,
        message: plan.message ?? "排班冲突"
      }
    };
  }
  return { ok: true, assignment: candidate, plan };
}

/**
 * 配送锁定：把引擎推算的到达/完成分钟固化到任务上。
 * 锁定后的任务在后续重算中承诺不变。
 */
export function lockTask(
  assignment: ShiftAssignment,
  plan: PlanResult,
  orderId: string
): ShiftAssignment {
  const planned = plan.tasks.find((t) => t.orderId === orderId);
  if (!planned) return assignment;
  return {
    shiftId: assignment.shiftId,
    tasks: assignment.tasks.map((t) =>
      t.orderId === orderId
        ? { ...t, locked: true, fixedArriveMin: planned.arriveMin, fixedEndMin: planned.endMin }
        : t
    )
  };
}

/** 查找订单被排到哪个班次 */
export function findAssignment(
  assignments: ShiftAssignment[],
  orderId: string
): ShiftAssignment | undefined {
  return assignments.find((a) => a.tasks.some((t) => t.orderId === orderId));
}

export function findShiftOfDriver(driver: Driver, shiftId: string): Shift | undefined {
  return driver.shifts.find((s) => s.id === shiftId);
}
