// 初始演示数据：覆盖 窗口约束、累计超载、4 小时休息、已锁定承诺 等场景。

import type { BoardVersion, Driver, Order } from "../rules/types";
import { legKey } from "../rules/travel";

export interface PersistState {
  orders: Order[];
  drivers: Driver[];
  versions: BoardVersion[];
  /** 最近冲突（被拒记录，最多保留 50 条） */
  conflicts: import("../rules/types").ConflictRecord[];
  travelMatrix: Record<string, number>;
}

export const storageKey = "driver-capacity-commitment-board:v1";

export function seedState(): PersistState {
  const orders: Order[] = [
    {
      id: "o-1001",
      orderNo: "ORD-1001",
      district: "陆家嘴",
      serviceMinutes: 25,
      weightKg: 320,
      windowStart: "09:00",
      windowEnd: "11:00",
      delivered: false
    },
    {
      id: "o-1002",
      orderNo: "ORD-1002",
      district: "静安寺",
      serviceMinutes: 30,
      weightKg: 480,
      windowStart: "09:30",
      windowEnd: "12:00",
      delivered: false
    },
    {
      id: "o-1003",
      orderNo: "ORD-1003",
      district: "虹桥",
      serviceMinutes: 20,
      weightKg: 260,
      windowStart: "10:00",
      windowEnd: "13:00",
      delivered: false
    },
    {
      id: "o-1004",
      orderNo: "ORD-1004",
      district: "陆家嘴",
      serviceMinutes: 35,
      weightKg: 600,
      windowStart: "13:00",
      windowEnd: "16:30",
      delivered: false
    },
    {
      id: "o-1005",
      orderNo: "ORD-1005",
      district: "莘庄",
      serviceMinutes: 25,
      weightKg: 350,
      windowStart: "08:30",
      windowEnd: "10:00",
      delivered: false
    },
    {
      id: "o-1006",
      orderNo: "ORD-1006",
      district: "虹桥",
      serviceMinutes: 20,
      weightKg: 150,
      windowStart: "14:00",
      windowEnd: "18:00",
      delivered: false
    },
    {
      id: "o-1007",
      orderNo: "ORD-1007",
      district: "五角场",
      serviceMinutes: 30,
      weightKg: 420,
      windowStart: "09:00",
      windowEnd: "12:30",
      delivered: true,
      deliveredAt: new Date(Date.now() - 86400000).toISOString()
    }
  ];

  const drivers: Driver[] = [
    {
      id: "d-liu",
      name: "刘师傅",
      shifts: [
        { id: "s-liu-am", driverId: "d-liu", start: "08:00", end: "12:00", capacityKg: 1200 },
        { id: "s-liu-pm", driverId: "d-liu", start: "13:00", end: "18:00", capacityKg: 1200 }
      ]
    },
    {
      id: "d-zhao",
      name: "赵师傅",
      shifts: [
        { id: "s-zhao-am", driverId: "d-zhao", start: "07:30", end: "14:00", capacityKg: 800 }
      ]
    },
    {
      id: "d-sun",
      name: "孙师傅",
      shifts: [
        { id: "s-sun-all", driverId: "d-sun", start: "08:30", end: "18:00", capacityKg: 1500 }
      ]
    }
  ];

  // ORD-1007 已配送：承诺 09:25 到达五角场，09:55 完成（锁定值与初始车程矩阵一致）
  const versions: BoardVersion[] = [
    {
      version: 1,
      reason: "初始排班",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      assignments: [
        {
          shiftId: "s-zhao-am",
          tasks: [
            { orderId: "o-1007", locked: true, fixedArriveMin: 9 * 60 + 25, fixedEndMin: 9 * 60 + 55 }
          ]
        }
      ]
    }
  ];

  const travelMatrix: Record<string, number> = {
    [legKey("场站", "陆家嘴")]: 35,
    [legKey("场站", "静安寺")]: 30,
    [legKey("场站", "虹桥")]: 45,
    [legKey("场站", "莘庄")]: 40,
    [legKey("场站", "五角场")]: 55,
    [legKey("陆家嘴", "静安寺")]: 25,
    [legKey("静安寺", "虹桥")]: 30,
    [legKey("陆家嘴", "虹桥")]: 45,
    [legKey("虹桥", "莘庄")]: 25,
    [legKey("陆家嘴", "莘庄")]: 40,
    [legKey("静安寺", "莘庄")]: 35,
    [legKey("陆家嘴", "五角场")]: 35,
    [legKey("静安寺", "五角场")]: 40
  };

  return { orders, drivers, versions, conflicts: [], travelMatrix };
}
