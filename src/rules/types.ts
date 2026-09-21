// 领域模型：订单、司机/班次、排班版本、冲突
// 时间在规则层一律使用「当日 00:00 起的分钟数」，界面层负责 HH:mm 文案转换。

/** 可送达时段 / 班次时间，格式 HH:mm */
export type HHMM = string;

/** 订单：登记商圈、装卸分钟、重量、可送达时段 */
export interface Order {
  id: string;
  orderNo: string;
  /** 商圈（送达目的地） */
  district: string;
  /** 装卸分钟（到达后的作业时长） */
  serviceMinutes: number;
  /** 重量 kg */
  weightKg: number;
  /** 可送达时段起 */
  windowStart: HHMM;
  /** 可送达时段止 */
  windowEnd: HHMM;
  /** 配送后锁定（至少被某一版本锁定即视为已配送） */
  delivered: boolean;
  /** 首次锁定时间 ISO */
  deliveredAt?: string;
}

/** 司机维护的班次与载重 */
export interface Shift {
  id: string;
  driverId: string;
  /** 班次开始 HH:mm（从场站发车） */
  start: HHMM;
  /** 班次结束 HH:mm */
  end: HHMM;
  /** 本班次载重上限 kg（累计在途重量不得超过） */
  capacityKg: number;
}

export interface Driver {
  id: string;
  name: string;
  shifts: Shift[];
}

/** 版本内某个订单在班次中的排程位（顺序即执行顺序） */
export interface TaskPlacement {
  orderId: string;
  /** 配送锁定后承诺的到达分钟（null 表示未锁定，由引擎顺序推算） */
  fixedArriveMin?: number;
  /** 配送锁定后承诺的完成分钟 */
  fixedEndMin?: number;
  /** 该任务是否已锁定 */
  locked?: boolean;
}

/** 一个班次一条执行序列 */
export interface ShiftAssignment {
  shiftId: string;
  tasks: TaskPlacement[];
}

/** 排班版本：调班带原因新建，原派单原样保留 */
export interface BoardVersion {
  version: number;
  reason: string;
  createdAt: string;
  parentVersion?: number;
  assignments: ShiftAssignment[];
}

export type ConflictKind = "超时" | "超载" | "休息冲突";

/** 冲突记录：列出订单、司机、超时分钟、超出重量 */
export interface ConflictRecord {
  id: string;
  at: string;
  version: number;
  /** 触发场景：拖入被拒 / 调班被拒 / 当前排班存量 */
  source: "拖入拒绝" | "调班拒绝" | "移动拒绝" | "存量";
  orderId: string;
  orderNo: string;
  driverId: string;
  driverName: string;
  shiftId: string;
  kind: ConflictKind;
  /** 超时分钟（相对可送达时段止/班次结束取较大超出） */
  overtimeMinutes: number;
  /** 超出重量 kg（累计重量 - 班次载重） */
  overloadKg: number;
  message: string;
}
