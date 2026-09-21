// 纯时间工具：HH:mm <-> 分钟数。

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHHMM(min: number): string {
  const h = Math.floor(Math.max(0, min) / 60);
  const m = Math.max(0, min) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
