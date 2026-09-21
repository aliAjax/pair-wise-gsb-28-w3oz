// 整板视角：对当前版本的所有班次重算计划、汇总存量冲突、定位订单派单位置。

import { planShift, type PlanResult } from "./engine";
import type { TravelMatrix } from "./travel";
import { nowISO } from "./time";
import type {
  BoardVersion,
  ConflictRecord,
  Driver,
  Order,
  Shift,
  ShiftAssignment
} from "./types";

export interface PlannedShift {
  driver: Driver;
  shift: Shift;
  assignment: ShiftAssignment;
  plan: PlanResult;
}

export function planBoard(
  version: BoardVersion,
  drivers: Driver[],
  orders: Order[],
  matrix: TravelMatrix
): Map<string, PlannedShift> {
  const result = new Map<string, PlannedShift>();
  for (const driver of drivers) {
    for (const shift of driver.shifts) {
      const assignment =
        version.assignments.find((a) => a.shiftId === shift.id) ??
        { shiftId: shift.id, tasks: [] };
      result.set(shift.id, {
        driver,
        shift,
        assignment,
        plan: planShift(shift, assignment, orders, matrix)
      });
    }
  }
  return result;
}

/**
 * 存量冲突：订单时段或班次参数被修改后，已有派单可能不再合法。
 * 刷新页面后同样由纯规则重算得到，保证「排班与承诺一致」。
 */
export function liveConflicts(
  version: BoardVersion,
  drivers: Driver[],
  orders: Order[],
  matrix: TravelMatrix
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  const board = planBoard(version, drivers, orders, matrix);
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  for (const ps of board.values()) {
    if (ps.plan.ok) continue;
    const order = ps.plan.rejectOrderId ? orderMap.get(ps.plan.rejectOrderId) : undefined;
    conflicts.push({
      id: `live:${ps.shift.id}:${ps.plan.rejectIndex}`,
      at: nowISO(),
      version: version.version,
      source: "存量",
      orderId: order?.id ?? ps.plan.rejectOrderId ?? "",
      orderNo: order?.orderNo ?? "—",
      driverId: ps.driver.id,
      driverName: ps.driver.name,
      shiftId: ps.shift.id,
      kind: ps.plan.rejectKind === "超载" ? "超载" : ps.plan.rejectKind === "休息冲突" ? "休息冲突" : "超时",
      overtimeMinutes: ps.plan.overtimeMinutes,
      overloadKg: ps.plan.overloadKg,
      message: ps.plan.message ?? "当前排班存在冲突"
    });
  }
  return conflicts;
}

export function findOrderPlacement(
  version: BoardVersion,
  orderId: string
): { assignment: ShiftAssignment; index: number } | undefined {
  for (const assignment of version.assignments) {
    const index = assignment.tasks.findIndex((t) => t.orderId === orderId);
    if (index >= 0) return { assignment, index };
  }
  return undefined;
}

export function latestVersion(versions: BoardVersion[]): BoardVersion {
  return versions.reduce((a, b) => (b.version > a.version ? b : a));
}
