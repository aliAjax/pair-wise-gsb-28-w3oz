// 车程（行驶分钟）解析：商圈之间按无向对称矩阵取值，缺省回落到默认车程。
// 界面层的「车程设置」产出与本结构一致的 TravelMatrix。

import { RULES } from "./constants";

/** key: `${A}|${B}`（无向，存储前会排序），value: 行驶分钟 */
export type TravelMatrix = Record<string, number>;

export function legKey(from: string, to: string): string {
  return [from, to].sort().join("|");
}

/** 一段行驶分钟：相同地点（含同商圈连续两单）为 0 */
export function travelMinutes(from: string, to: string, matrix: TravelMatrix): number {
  if (from === to) return 0;
  const v = matrix[legKey(from, to)];
  return Number.isFinite(v) ? (v as number) : RULES.defaultTravelMinutes;
}
