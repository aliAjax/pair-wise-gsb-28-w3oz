import dayjs, { type Dayjs } from "dayjs";

/** "HH:mm" -> 当天 dayjs 对象（用于 TimePicker 回显） */
export function hhmmToDayjs(text: string): Dayjs {
  const [h, m] = text.split(":").map(Number);
  return dayjs().hour(h).minute(m).second(0).millisecond(0);
}

/** ISO 时间 -> "MM-dd HH:mm" 展示 */
export function formatDateTime(iso: string): string {
  return dayjs(iso).format("MM-DD HH:mm");
}
