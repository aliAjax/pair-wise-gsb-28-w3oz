import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { App as AntApp } from "antd";
import { orderStatusOf } from "./domain/rules";
import { useScheduleStore } from "./store/scheduleStore";
import { OrderForm } from "./components/OrderForm";
import { DriverForm } from "./components/DriverForm";
import { OrderPool } from "./components/OrderPool";
import { DriverLane } from "./components/DriverLane";
import { ConflictPanel } from "./components/ConflictPanel";
import { VersionPanel } from "./components/VersionPanel";
import { ReasonModal } from "./components/ReasonModal";

interface DragData {
  kind: "pool-order" | "stop";
  orderId: string;
  driverId?: string;
}

interface PendingMove {
  orderId: string;
  fromDriverId: string;
  toDriverId: string | null; // null 表示退回待分配
  insertIndex: number;
}

function Board() {
  const { message } = AntApp.useApp();
  const orders = useScheduleStore((state) => state.orders);
  const drivers = useScheduleStore((state) => state.drivers);
  const plans = useScheduleStore((state) => state.plans);
  const versions = useScheduleStore((state) => state.versions);
  const tryAssign = useScheduleStore((state) => state.tryAssign);
  const reschedule = useScheduleStore((state) => state.reschedule);
  const unassign = useScheduleStore((state) => state.unassign);

  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const metrics = useMemo(() => {
    let assigned = 0;
    let delivered = 0;
    for (const order of orders) {
      const status = orderStatusOf(order.id, plans);
      if (status === "assigned") assigned += 1;
      if (status === "delivered") delivered += 1;
    }
    return {
      pending: orders.length - assigned - delivered,
      assigned,
      delivered,
      versions: versions.length,
    };
  }, [orders, plans, versions]);

  /** 解析放置目标：泳道（追加）、停靠卡（插到其前）、待分配池 */
  function resolveTarget(overId: string): { driverId: string | null; insertIndex: number } | null {
    if (overId === "pool") return { driverId: null, insertIndex: 0 };
    if (overId.startsWith("lane:")) {
      const driverId = overId.slice(5);
      return { driverId, insertIndex: (plans[driverId] ?? []).length };
    }
    if (overId.startsWith("before:")) {
      const targetOrderId = overId.slice(7);
      for (const [driverId, stops] of Object.entries(plans)) {
        const index = stops.findIndex((stop) => stop.orderId === targetOrderId);
        if (index >= 0) return { driverId, insertIndex: index };
      }
    }
    return null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined;
    const over = event.over;
    if (!data || !over) return;
    const target = resolveTarget(String(over.id));
    if (!target) return;

    if (data.kind === "pool-order") {
      if (!target.driverId) return; // 池内拖动，忽略
      const ok = tryAssign(data.orderId, target.driverId, target.insertIndex);
      if (ok) {
        message.success("已按顺序重算到达时间，承诺生效");
      } else {
        message.error("超时或累计超载，整单拒绝，详见冲突列表");
      }
      return;
    }

    // 已排班订单的拖动属于调班：需要原因并生成新版本
    const fromDriverId = data.driverId;
    if (!fromDriverId) return;
    if (target.driverId === fromDriverId) {
      const stops = plans[fromDriverId] ?? [];
      const oldIndex = stops.findIndex((stop) => stop.orderId === data.orderId);
      if (oldIndex === target.insertIndex || oldIndex === target.insertIndex - 1) return; // 位置未变
    }
    if (target.driverId === null && data.kind === "stop") {
      setPendingMove({ orderId: data.orderId, fromDriverId, toDriverId: null, insertIndex: 0 });
      return;
    }
    if (!target.driverId) return;
    setPendingMove({
      orderId: data.orderId,
      fromDriverId,
      toDriverId: target.driverId,
      insertIndex: target.insertIndex,
    });
  }

  function confirmMove(reason: string) {
    if (!pendingMove) return;
    if (pendingMove.toDriverId === null) {
      unassign(pendingMove.orderId, pendingMove.fromDriverId, reason);
      message.success("已退回待分配，并生成新派单版本");
    } else {
      const ok = reschedule({ ...pendingMove, toDriverId: pendingMove.toDriverId, reason });
      if (ok) {
        message.success("调班成功，已生成新派单版本，原派单保留");
      } else {
        message.error("调班后超时或累计超载，整单拒绝，详见冲突列表");
      }
    }
    setPendingMove(null);
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">物流 · 司机运力承诺台</p>
            <h1>配送任务拖拽排班</h1>
            <p className="subtitle">
              订单登记商圈、装卸分钟、重量与可送达时段；司机维护班次与载重。拖入即按顺序重算承诺到达时间，
              超时或累计超载整单拒绝；连续作业满 4 小时自动插入休息，休息不覆盖已锁定任务。
            </p>
          </div>
        </header>

        <section className="metrics">
          <article className="metric">
            <span>待分配订单</span>
            <strong>{metrics.pending}</strong>
          </article>
          <article className="metric">
            <span>承诺中</span>
            <strong>{metrics.assigned}</strong>
          </article>
          <article className="metric">
            <span>已锁定（已配送）</span>
            <strong>{metrics.delivered}</strong>
          </article>
          <article className="metric">
            <span>派单版本</span>
            <strong>{metrics.versions}</strong>
          </article>
        </section>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="board">
            <aside className="side">
              <OrderForm />
              <DriverForm />
              <OrderPool />
            </aside>
            <section className="lanes">
              {drivers.map((driver) => (
                <DriverLane key={driver.id} driver={driver} orders={orders} />
              ))}
            </section>
          </div>
        </DndContext>

        <div className="bottom-panels">
          <ConflictPanel />
          <VersionPanel />
        </div>

        <ReasonModal
          open={pendingMove !== null}
          title={pendingMove?.toDriverId === null ? "退回待分配" : "调班确认"}
          onConfirm={confirmMove}
          onCancel={() => setPendingMove(null)}
        />
      </div>
    </main>
  );
}

export default function App() {
  return (
    <AntApp>
      <Board />
    </AntApp>
  );
}
