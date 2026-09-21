// Store 端到端自测：内存 localStorage 桩 + Zustand
// 覆盖：拖入接受/整单拒绝落冲突、原派单不变、配送锁定、调班版本保留、刷新后承诺一致。
// 运行：esbuild 打包后 node 执行（见 package.json 的 test 脚本）。

import "./localStorage-stub";
import { useBoard } from "../src/store/useBoard";
import { liveConflicts } from "../src/rules/board";

let pass = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (!cond) throw new Error(`${name} ${extra}`);
  pass++;
}

const s0 = useBoard.getState();
assert("初始 V1 只有 1 个锁定任务", s0.versions[0].version === 1 && s0.versions[0].assignments[0].tasks.length === 1);

// 赵班次已有锁定五角场 09:25；把莘庄单插到锁定之前：07:30+40=08:10，窗口 08:30 起 => 合法
assert("ORD-1005 可派（早到等待）", s0.assignTask("o-1005", "s-zhao-am", 0));

// 刘上午班次顺序派 3 单
assert("1001 可派", useBoard.getState().assignTask("o-1001", "s-liu-am", 0));
assert("1002 可派", useBoard.getState().assignTask("o-1002", "s-liu-am", 1));
assert("1003 可派", useBoard.getState().assignTask("o-1003", "s-liu-am", 2));

// 1004：到陆家嘴 11:30 等到 13:00，作业到 13:35 > 班次 12:00 => 超时整单拒绝；累计也超载
assert("1004 超时被整单拒绝", !useBoard.getState().assignTask("o-1004", "s-liu-am", 3));

const st = useBoard.getState();
assert("落 1 条拒绝冲突", st.conflicts.length === 1);
const c = st.conflicts[0];
assert("冲突列出订单", c.orderNo === "ORD-1004");
assert("冲突列出司机", c.driverName === "刘师傅");
assert("冲突含超时分钟", c.overtimeMinutes === 95, `got ${c.overtimeMinutes}`);
assert("冲突类型为超时", c.kind === "超时");
const liuV1Before = st.versions[0].assignments.find((a) => a.shiftId === "s-liu-am")!;
assert("拒绝后原派单不变（仍 3 单）", liuV1Before.tasks.length === 3);

// 配送锁定 1001（08:35 到场，等待到窗口 09:00，作业到 09:25）
st.markDelivered("o-1001", "s-liu-am");
const delivered = useBoard.getState().orders.find((o) => o.id === "o-1001")!;
assert("订单标记已配送", delivered.delivered === true);

// 调班带原因 -> V2，V1 原派单保留
useBoard.getState().startRevision("客户要求改下午");
const after = useBoard.getState();
assert("生成 V2", after.versions.length === 2);
const v2 = after.versions[1];
assert("V2 带原因与父版本", v2.reason === "客户要求改下午" && v2.parentVersion === 1);
const liuV2 = v2.assignments.find((a) => a.shiftId === "s-liu-am")!;
assert("V2 锁定任务被复制保留", liuV2.tasks[0].locked === true);
// 重新读取调班后的 V1：锁发生在调班前，V1 应为 3 单且首单锁定；调班本身不改动 V1
const liuV1After = after.versions[0].assignments.find((a) => a.shiftId === "s-liu-am")!;
assert("V1 保留调班时原派单（3 单、首单锁定）", liuV1After.tasks.length === 3 && liuV1After.tasks[0].locked === true);

// 模拟刷新：从 localStorage 读取再由规则重放
const raw = JSON.parse(
  (globalThis as unknown as { localStorage: Storage }).localStorage.getItem("driver-capacity-commitment-board:v1")!
);
assert("持久化有 2 个版本", raw.versions.length === 2);
const persistedLock = raw.versions[1].assignments
  .find((a: { shiftId: string }) => a.shiftId === "s-liu-am")
  .tasks[0];
assert("刷新后承诺到达=09:00", persistedLock.fixedArriveMin === 9 * 60, `got ${persistedLock.fixedArriveMin}`);
assert("刷新后承诺完成=09:25", persistedLock.fixedEndMin === 9 * 60 + 25);

const live = liveConflicts(raw.versions[1], raw.drivers, raw.orders, raw.travelMatrix);
assert("刷新重放无存量冲突（排班=承诺）", live.length === 0, JSON.stringify(live));

// 调小 V2 所在班次载重 => 存量冲突应立刻由规则算出
const lighterDrivers = raw.drivers.map((d: (typeof raw.drivers)[number]) =>
  d.id === "d-liu"
    ? { ...d, shifts: d.shifts.map((sh) => (sh.id === "s-liu-am" ? { ...sh, capacityKg: 500 } : sh)) }
    : d
);
const live2 = liveConflicts(raw.versions[1], lighterDrivers, raw.orders, raw.travelMatrix);
assert("降载重后出现存量超载冲突", live2.some((x) => x.kind === "超载" && x.overloadKg > 0), JSON.stringify(live2));

console.log(`\nstore e2e: ${pass} assertions passed`);
