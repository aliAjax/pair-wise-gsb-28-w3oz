// 领域模型：司机运力承诺台
// 该文件只包含类型定义，不包含任何规则、存储或界面逻辑。

/** 订单：登记商圈、装卸分钟、重量与可送达时段 */
export interface Order {
  id: string;
  orderNo: string;
  district: string; // 商圈
  serviceMinutes: number; // 装卸分钟
  weightKg: number; // 重量
  windowStart: string; // 可送达时段开始 "HH:mm"
  windowEnd: string; // 可送达时段结束 "HH:mm"
  notes: string;
  createdAt: string;
}

/** 司机：维护班次与载重 */
export interface Driver {
  id: string;
  name: string;
  shiftStart: string; // 班次开始 "HH:mm"
  shiftEnd: string; // 班次结束 "HH:mm"
  capacityKg: number; // 载重
}

/** 排班中的一个停靠点。配送完成后锁定，并记录锁定到达时间作为承诺锚点 */
export interface PlannedStop {
  orderId: string;
  locked: boolean;
  /** 锁定时记录的到达时间（分钟），重算时不可被改动 */
  lockedArriveMin?: number;
}

/** 每个司机一条有序停靠序列 */
export type Plans = Record<string, PlannedStop[]>;

/** 时间线条目：停靠或强制休息 */
export interface TimelineStop {
  kind: "stop";
  orderId: string;
  arriveMin: number; // 承诺到达（分钟）
  departMin: number; // 预计离开（分钟）
  locked: boolean;
  lateMinutes: number; // 超出可送达时段的分钟数
  shiftOverMinutes: number; // 超出班次的分钟数
}

export interface TimelineRest {
  kind: "rest";
  startMin: number;
  endMin: number;
}

export type TimelineEntry = TimelineStop | TimelineRest;

export type ConflictKind = "window" | "shift" | "weight";

/** 冲突：列出订单、司机、超时分钟、超出重量 */
export interface Conflict {
  id: string;
  orderId: string;
  orderNo: string;
  driverId: string;
  driverName: string;
  kind: ConflictKind;
  overtimeMinutes: number; // 超时分钟
  excessWeightKg: number; // 超出重量
  message: string;
  createdAt: string;
}

/** 派单版本：调班带原因建新版本，旧版本（原派单）完整保留 */
export interface DispatchVersion {
  version: number;
  reason: string;
  createdAt: string;
  /** 快照：司机 -> 订单号序列 */
  plans: Record<string, string[]>;
}

export type OrderStatus = "pending" | "assigned" | "delivered";
