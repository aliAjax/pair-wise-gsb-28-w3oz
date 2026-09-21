// 持久化层：负责 localStorage 读写与种子数据，不包含规则与界面逻辑。
// 只持久化「事实」（订单、司机、停靠序列、版本），承诺时间由规则层重算，
// 因此刷新后排班与承诺必然一致。

import type { DispatchVersion, Driver, Order, Plans } from "../domain/types";
import { toMinutes } from "../domain/rules";

const STORAGE_KEY = "hxwlfront-14-capacity-board-v1";

export interface PersistedState {
  orders: Order[];
  drivers: Driver[];
  plans: Plans;
  versions: DispatchVersion[];
}

function seedState(): PersistedState {
  const drivers: Driver[] = [
    { id: "drv-liu", name: "刘师傅", shiftStart: "08:00", shiftEnd: "17:00", capacityKg: 1200 },
    { id: "drv-zhao", name: "赵师傅", shiftStart: "09:00", shiftEnd: "18:00", capacityKg: 800 },
    { id: "drv-sun", name: "孙师傅", shiftStart: "08:30", shiftEnd: "16:30", capacityKg: 1500 },
  ];

  const now = Date.now();
  const order = (
    id: string,
    orderNo: string,
    district: string,
    serviceMinutes: number,
    weightKg: number,
    windowStart: string,
    windowEnd: string,
    notes: string,
    index: number
  ): Order => ({
    id,
    orderNo,
    district,
    serviceMinutes,
    weightKg,
    windowStart,
    windowEnd,
    notes,
    createdAt: new Date(now - index * 3600_000).toISOString(),
  });

  const orders: Order[] = [
    order("ord-1001", "ORD-1001", "浦东", 30, 260, "09:00", "11:00", "已送达并锁定", 0),
    order("ord-1002", "ORD-1002", "浦东", 20, 180, "10:00", "12:00", "冷链优先", 1),
    order("ord-1003", "ORD-1003", "嘉定", 25, 140, "10:00", "12:00", "客户要求上午", 2),
    order("ord-1004", "ORD-1004", "闵行", 40, 320, "13:00", "15:00", "大件需两人装卸", 3),
    order("ord-1005", "ORD-1005", "松江", 30, 90, "14:00", "16:00", "下午时段", 4),
    order("ord-1006", "ORD-1006", "青浦", 35, 410, "11:00", "13:00", "重货", 5),
    order("ord-1007", "ORD-1007", "浦东", 15, 60, "15:00", "17:00", "小件急送", 6),
  ];

  // 刘师傅 08:00 开班，车场到浦东 30 分钟，ORD-1001 已锁定在 09:00 送达
  const plans: Plans = {
    "drv-liu": [
      { orderId: "ord-1001", locked: true, lockedArriveMin: toMinutes("09:00") },
      { orderId: "ord-1002", locked: false },
    ],
    "drv-zhao": [{ orderId: "ord-1003", locked: false }],
    "drv-sun": [],
  };

  return { orders, drivers, plans, versions: [] };
}

export function loadState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.orders || !parsed.drivers || !parsed.plans || !parsed.versions) {
      return seedState();
    }
    return parsed;
  } catch {
    return seedState();
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
