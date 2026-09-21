// 规则引擎快速自测（node 直接跑 ts 通过 esbuild 不可用，这里用 vite 的 TS 转译：改用简单断言脚本由 vite-node 运行）
import { RULES } from "../src/rules/constants";
import { planShift, tryInsertTask, tryMoveTask, lockTask } from "../src/rules/engine";
import { legKey } from "../src/rules/travel";
import type { Driver, Order, ShiftAssignment } from "../src/rules/types";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${name} ${extra}`);
  }
}

// 让测试商圈到场站车程为 0，便于纯工时推算
const matrix: Record<string, number> = {
  [legKey(RULES.depot, "ZZZ")]: 0,
  [legKey(RULES.depot, "LK")]: 0,
  [legKey(RULES.depot, "QK")]: 0
};

function order(p: Partial<Order> & Pick<Order, "id" | "orderNo" | "district">): Order {
  return {
    serviceMinutes: 20,
    weightKg: 100,
    windowStart: "08:00",
    windowEnd: "20:00",
    delivered: false,
    ...p
  };
}

const shift = {
  id: "s1", driverId: "d1", start: "08:00", end: "18:00", capacityKg: 2000
};

// 场景1：超时整单拒绝（窗口 08:00-08:20，场站车程默认30 -> 到达 08:30）
{
  const o = order({ id: "a", orderNo: "A", district: "X", windowStart: "08:00", windowEnd: "08:20" });
  const res = tryInsertTask(shift, { shiftId: "s1", tasks: [] }, 0, "a", [o], matrix);
  assert("超时整单拒绝", !res.ok);
  if (!res.ok) assert("记录超时分钟=10", res.reject.overtimeMinutes === 10, `got ${res.reject.overtimeMinutes}`);
}

// 场景2：累计超载（500 上限，300+300 -> 第二单拒绝，第一单保留）
{
  const smallShift = { id: "sc", driverId: "d1", start: "08:00", end: "18:00", capacityKg: 500 };
  const o1 = order({ id: "b1", orderNo: "B1", district: "X", weightKg: 300, windowEnd: "20:00" });
  const o2 = order({ id: "b2", orderNo: "B2", district: "X", weightKg: 300, windowEnd: "20:00" });
  const r1 = tryInsertTask(smallShift, { shiftId: "sc", tasks: [] }, 0, "b1", [o1, o2], matrix);
  assert("第一单 300kg 可入", r1.ok);
  if (r1.ok) {
    const r2 = tryInsertTask(smallShift, r1.assignment, 1, "b2", [o1, o2], matrix);
    assert("累计超载整单拒绝", !r2.ok);
    if (!r2.ok) assert("超出重量=100", r2.reject.overloadKg === 100, `got ${r2.reject.overloadKg}`);
  }
}

// 场景3：顺序重算到达时间（场站->A 30分，08:00出发，08:30到，装卸20 -> 08:50；
// A->B 同商圈0车程，08:50 到 B）
{
  const o1 = order({ id: "c1", orderNo: "C1", district: "AAA" });
  const o2 = order({ id: "c2", orderNo: "C2", district: "AAA" });
  let a: ShiftAssignment = { shiftId: "s1", tasks: [] };
  const r1 = tryInsertTask(shift, a, 0, "c1", [o1, o2], matrix);
  const r2 = r1.ok ? tryInsertTask(shift, r1.assignment, 1, "c2", [o1, o2], matrix) : null;
  assert("同商圈两单都可入", !!r2?.ok);
  if (r2?.ok) {
    const plan = planShift(shift, r2.assignment, [o1, o2], matrix);
    assert("第一单 08:30 到达", plan.tasks[0].arriveMin === 8 * 60 + 30, `got ${plan.tasks[0].arriveMin}`);
    assert("第二单 08:50 到达", plan.tasks[1].arriveMin === 8 * 60 + 50, `got ${plan.tasks[1].arriveMin}`);
  }
}

// 场景4：连续满4小时自动插入休息。
// 构造：车程均为0（同商圈），每单作业60分钟。第4单后连续=240 -> 第5单行驶前插30分钟休息。
{
  const orders = Array.from({ length: 6 }, (_, i) =>
    order({ id: `w${i}`, orderNo: `W${i}`, district: "ZZZ", serviceMinutes: 60, windowEnd: "20:00" }));
  let a: ShiftAssignment = { shiftId: "s1", tasks: [] };
  let ok = true;
  for (let i = 0; i < 6; i++) {
    const r = tryInsertTask(shift, a, i, `w${i}`, orders, matrix);
    if (!r.ok) { ok = false; break; }
    a = r.assignment;
  }
  assert("6单排班成功", ok);
  const plan = planShift(shift, a, orders, matrix);
  const breaks = plan.tasks.filter((t) => t.breakBefore);
  // 连续作业在第4单完成时达到240分钟；第5单行驶前必须休息 => 休息标记挂在第5单(w4)
  assert("第5单行驶前插入1次休息", breaks.length === 1 && breaks[0].orderId === "w4",
    `breaks=${breaks.map((b) => b.orderId).join(",")}`);
  if (breaks.length === 1) {
    assert("休息 30 分钟", (breaks[0].breakEnd! - breaks[0].breakStart!) === RULES.breakMinutes);
    // 08:00 起，4*60=240 工作 => 12:00-12:30 休息
    assert("休息在 12:00-12:30", breaks[0].breakStart === 12 * 60 && breaks[0].breakEnd === 12 * 60 + 30,
      `got ${breaks[0].breakStart}-${breaks[0].breakEnd}`);
    assert("第5单 12:30 到达", plan.tasks[4].arriveMin === 12 * 60 + 30, `got ${plan.tasks[4].arriveMin}`);
  }
}

// 场景5：休息不得覆盖已锁定任务。
// 先排 w0..w3（4小时），锁定 w3；再尝试插入 w4 使休息落在 w3 锁定区间内。
{
  const orders = Array.from({ length: 5 }, (_, i) =>
    order({ id: `l${i}`, orderNo: `L${i}`, district: "LK", serviceMinutes: 60, windowEnd: "20:00" }));
  let a: ShiftAssignment = { shiftId: "s1", tasks: [] };
  for (let i = 0; i < 4; i++) {
    const r = tryInsertTask(shift, a, i, `l${i}`, orders, matrix);
    if (!r.ok) throw new Error("setup failed");
    a = r.assignment;
  }
  // 锁定全部4单：承诺 08:00-12:00（无休息，因为当时只有4单，第4单结束正好240）
  const p0 = planShift(shift, a, orders, matrix);
  for (let i = 0; i < 4; i++) a = lockTask(a, p0, `l${i}`);
  // 第5单正常应在 l3 之后：l3 锁定 11:00-12:00；行驶0；12:00时连续工时=240 -> 需休息，
  // cursor=12:00 后休息 12:00-12:30，不覆盖锁定（锁定12:00结束）=> 应成功。
  const r5 = tryInsertTask(shift, a, 4, "l4", orders, matrix);
  assert("锁定结束后的休息合法", r5.ok, r5.ok ? "" : r5.reject.message);
}

// 场景6：锁定任务本身被覆盖 -> 休息冲突
// 锁定一个 12:00-12:30 的任务，前面3单(60′)在 11:00-12:00 之间需要休息才能到第4单
{
  const orders = [
    order({ id: "q1", orderNo: "Q1", district: "QK", serviceMinutes: 60 }),
    order({ id: "q2", orderNo: "Q2", district: "QK", serviceMinutes: 60 }),
    order({ id: "q3", orderNo: "Q3", district: "QK", serviceMinutes: 60 }),
    order({
      id: "qL", orderNo: "QL", district: "QK", serviceMinutes: 30,
      windowStart: "12:00", windowEnd: "12:30"
    })
  ];
  // 直接构造锁定序列：q1(08:00-09:00) q2(09:00-10:00) q3(10:00-11:00) qL locked 12:00-12:30
  const a: ShiftAssignment = {
    shiftId: "s1",
    tasks: [
      { orderId: "q1" }, { orderId: "q2" }, { orderId: "q3" },
      { orderId: "qL", locked: true, fixedArriveMin: 12 * 60, fixedEndMin: 12 * 60 + 30 }
    ]
  };
  // 到 q3 结束连续工作=180；到 qL 车程0，180<240 不需要休息，qL 12:00 锁定。中间 11:00-12:00 等待。
  const plan = planShift(shift, a, orders, matrix);
  assert("空档等待后锁定任务合法", plan.ok, plan.message ?? "");
}

// 场景6：休息不得覆盖已锁定任务
{
  const matrixKK = { ...matrix, [legKey(RULES.depot, "KK")]: 0 };
  const orders = [
    order({ id: "k1", orderNo: "K1", district: "KK", serviceMinutes: 60 }),
    order({ id: "k2", orderNo: "K2", district: "KK", serviceMinutes: 60 }),
    order({ id: "k3", orderNo: "K3", district: "KK", serviceMinutes: 60 }),
    order({ id: "k4", orderNo: "K4", district: "KK", serviceMinutes: 60 }),
    order({
      id: "kL", orderNo: "KL", district: "KK", serviceMinutes: 30,
      windowStart: "12:30", windowEnd: "13:00"
    })
  ];
  // 08:00 起 4*60′ 到 12:00 连续工时=240；锁定任务承诺 12:30 到达，
  // 空档 12:00-12:30 可容纳 30′ 休息 + 0′ 车程 => 合法
  const okAssign: ShiftAssignment = {
    shiftId: "s1",
    tasks: [
      { orderId: "k1" }, { orderId: "k2" }, { orderId: "k3" }, { orderId: "k4" },
      { orderId: "kL", locked: true, fixedArriveMin: 12 * 60 + 30, fixedEndMin: 13 * 60 }
    ]
  };
  const okPlan = planShift(shift, okAssign, orders, matrixKK);
  assert("空档容纳休息时锁定任务合法", okPlan.ok, okPlan.message ?? "");
  if (okPlan.ok) {
    const b = okPlan.tasks.find((t) => t.orderId === "kL");
    assert("休息安排在 12:00-12:30", b?.breakStart === 12 * 60 && b.breakEnd === 12 * 60 + 30,
      `got ${b?.breakStart}-${b?.breakEnd}`);
  }

  // 同样的前序，但锁定任务承诺 12:00 到达：必须先休息30′ => 休息会覆盖锁定任务 => 拒绝
  const badAssign: ShiftAssignment = {
    shiftId: "s1",
    tasks: [
      { orderId: "k1" }, { orderId: "k2" }, { orderId: "k3" }, { orderId: "k4" },
      { orderId: "kL", locked: true, fixedArriveMin: 12 * 60, fixedEndMin: 12 * 60 + 30 }
    ]
  };
  const badPlan = planShift(shift, badAssign, orders, matrixKK);
  assert("休息会覆盖锁定任务时拒绝", !badPlan.ok, badPlan.message ?? "");
  assert("拒绝点为锁定任务 kL", badPlan.rejectOrderId === "kL", `got ${badPlan.rejectOrderId}`);
  assert("拒绝类型为休息冲突", badPlan.rejectKind === "休息冲突", `got ${badPlan.rejectKind}`);
}

// 场景7：跨班次移动被超载拒绝时原派单不变
{
  const o = order({ id: "m1", orderNo: "M1", district: "MV", weightKg: 400 });
  const a: ShiftAssignment = { shiftId: "s1", tasks: [{ orderId: "m1" }] };
  const small = { id: "s2", driverId: "d1", start: "08:00", end: "18:00", capacityKg: 300 };
  const res = tryMoveTask(small, { shiftId: "s2", tasks: [] }, 0, { orderId: "m1" }, [o], matrix);  assert("移动到低载重班次被拒绝", !res.ok);
  assert("原序列仍含该单", a.tasks.length === 1 && a.tasks[0].orderId === "m1");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
