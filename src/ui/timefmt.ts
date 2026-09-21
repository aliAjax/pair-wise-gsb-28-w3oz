// 界面层时间工具：规则层用分钟数 / HH:mm，这里负责与 dayjs 控件互转。

import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

export function hhmmToDayjs(hhmm: string): Dayjs {
  const [h, m] = hhmm.split(":").map(Number);
  return dayjs().hour(h || 0).minute(m || 0).second(0).millisecond(0);
}

export function dayjsToHHMM(v: Dayjs | null): string {
  if (!v) return "08:00";
  return v.format("HH:mm");
}
