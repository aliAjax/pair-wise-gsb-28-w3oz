// 规则常量：连续工时、休息时长、场站与默认车程。
// 界面层的设置弹窗可以覆盖车程矩阵与默认车程，这里只提供初始默认值。

export const RULES = {
  /** 连续执行（行驶 + 装卸）满 4 小时 */
  breakAfterMinutes: 4 * 60,
  /** 必须插入的休息时长 30 分钟 */
  breakMinutes: 30,
  /** 所有班次的起终点 */
  depot: "场站",
  /** 车程矩阵缺省时的默认车程（分钟） */
  defaultTravelMinutes: 30
} as const;
