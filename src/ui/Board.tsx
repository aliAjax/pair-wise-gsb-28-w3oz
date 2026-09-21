import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { Badge, Button, Empty, Popconfirm, Tag, Tooltip } from "antd";
import { useBoard } from "../store/useBoard";
import type { Order } from "../rules/types";
import { toHHMM } from "../rules/time";
import type { PlannedShift } from "../rules/board";

// —— 拖拽数据载荷 ——
interface DragData {
  kind: "order";
  orderId: string;
  from: "pool" | string; // "pool" 或班次 shiftId
  locked: boolean;
}

interface DropData {
  kind: "pool" | "lane";
  shiftId?: string;
  beforeOrderId?: string; // 落在某个任务前；缺省=追加到末尾
}

const HOUR_WIDTH = 88; // 时间轴每小时像素宽
const AXIS_PAD = 12;

export default function Board({
  planned,
  isLatest,
  onMessage
}: {
  planned: Map<string, PlannedShift>;
  isLatest: boolean;
  onMessage: (ok: boolean, text: string) => void;
}) {
  const { orders, drivers, assignTask, moveTask, unassignTask, markDelivered } = useBoard();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const version = useBoard((s) => s.versions.find((v) => v.version === s.viewingVersion))!;

  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of version.assignments) for (const t of a.tasks) ids.add(t.orderId);
    return ids;
  }, [version]);

  const poolOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (assignedIds.has(o.id)) return false;
        // 该版本创建之前（或当时）已配送锁定的订单不再进入此版本的待派池
        if (o.delivered && o.deliveredAt && o.deliveredAt <= version.createdAt) return false;
        return true;
      }),
    [orders, assignedIds, version.createdAt]
  );
  const activeOrder = orders.find((o) => activeId === `drag:pool:${o.id}` || activeId === `drag:lane:${o.id}`);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const drag = e.active.data.current as DragData | undefined;
    const drop = e.over?.data.current as DropData | undefined;
    if (!drag || drag.locked) return;

    // 拖回待派订单池
    if (drop?.kind === "pool") {
      if (drag.from !== "pool") unassignTask(drag.orderId, drag.from);
      return;
    }
    if (drop?.kind !== "lane" || !drop.shiftId) return;

    // 同班次落在自己的槽位：无操作
    if (drag.from === drop.shiftId && drop.beforeOrderId === drag.orderId) return;

    // 计算插入下标
    const lane = planned.get(drop.shiftId);
    let index = lane?.assignment.tasks.length ?? 0;
    if (drop.beforeOrderId) {
      index = lane?.assignment.tasks.findIndex((t) => t.orderId === drop.beforeOrderId) ?? -1;
      if (index < 0) index = lane?.assignment.tasks.length ?? 0;
    }

    let ok: boolean;
    if (drag.from === "pool") {
      ok = assignTask(drag.orderId, drop.shiftId, index);
    } else {
      ok = moveTask(drag.orderId, drag.from, drop.shiftId, index);
    }
    if (!ok) {
      const order = orders.find((o) => o.id === drag.orderId);
      onMessage(false, `${order?.orderNo ?? "订单"} 已整单拒绝，详见冲突清单`);
    } else {
      onMessage(true, "派单成功，到达时间已按顺序重算");
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="board">
        <OrderPool orders={poolOrders} disabled={!isLatest} />

        <div className="lanes">
          {drivers.length === 0 && <Empty description="请先在「司机运力」中维护司机与班次" />}
          {drivers.map((driver) =>
            driver.shifts.map((shift) => {
              const ps = planned.get(shift.id);
              if (!ps) return null;
              return (
                <ShiftLane
                  key={shift.id}
                  ps={ps}
                  orders={orders}
                  disabled={!isLatest}
                  onDeliver={(orderId) => {
                    markDelivered(orderId, shift.id);
                    const o = orders.find((x) => x.id === orderId);
                    onMessage(true, `${o?.orderNo} 已配送并锁定承诺时间`);
                  }}
                  onRemove={(orderId) => unassignTask(orderId, shift.id)}
                />
              );
            })
          )}
        </div>
      </div>

      <DragOverlay>
        {activeOrder ? <TaskChip order={activeOrder} overlay locked={!!activeOrder.delivered} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// 待派订单池
// ---------------------------------------------------------------------------

function OrderPool({ orders, disabled }: { orders: Order[]; disabled: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: "drop:pool", data: { kind: "pool" } as DropData });
  return (
    <aside className={`order-pool ${isOver ? "over" : ""}`}>
      <div className="pool-head">
        <strong>待派订单</strong>
        <Badge count={orders.length} showZero color="#176b87" />
      </div>
      <p className="muted small">拖入班次即按顺序重算到达时间；不满足窗口/载重整单拒绝。</p>
      <div ref={setNodeRef} className="pool-drop">
        {orders.length === 0 && <div className="pool-empty">暂无可派订单（已配送的订单已锁定）</div>}
        {orders.map((o) => (
          <PoolCard key={o.id} order={o} disabled={disabled} />
        ))}
      </div>
    </aside>
  );
}

function PoolCard({ order, disabled }: { order: Order; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `drag:pool:${order.id}`,
    data: {
      kind: "order",
      orderId: order.id,
      from: "pool",
      locked: false
    } satisfies DragData,
    disabled
  });
  return (
    <div
      ref={setNodeRef}
      className={`pool-card ${isDragging ? "dragging" : ""}`}
      {...listeners}
      {...attributes}
      title="拖到右侧班次排班"
    >
      <div className="pool-card-head">
        <strong>{order.orderNo}</strong>
        <Tag>{order.district}</Tag>
      </div>
      <div className="pool-card-meta">
        <span>{order.windowStart}–{order.windowEnd}</span>
        <span>装卸 {order.serviceMinutes}′</span>
        <span>{order.weightKg} kg</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 班次泳道（时间轴）
// ---------------------------------------------------------------------------

function ShiftLane({
  ps,
  orders,
  disabled,
  onDeliver,
  onRemove
}: {
  ps: PlannedShift;
  orders: Order[];
  disabled: boolean;
  onDeliver: (orderId: string) => void;
  onRemove: (orderId: string) => void;
}) {
  const { driver, shift, plan, assignment } = ps;
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const startMin = (() => {
    const [h] = shift.start.split(":").map(Number);
    return h * 60;
  })();
  const endMin = (() => {
    const [h, m] = shift.end.split(":").map(Number);
    return h * 60 + m;
  })();
  const spanHours = Math.max(1, (endMin - startMin) / 60);
  const axisWidth = AXIS_PAD * 2 + spanHours * HOUR_WIDTH;

  const totalWeight = assignment.tasks.reduce(
    (acc, t) => acc + (orderMap.get(t.orderId)?.weightKg ?? 0),
    0
  );

  const { setNodeRef, isOver } = useDroppable({
    id: `drop:lane:${shift.id}`,
    data: { kind: "lane", shiftId: shift.id } satisfies DropData,
    disabled
  });

  return (
    <section className={`lane ${isOver ? "over" : ""} ${plan.ok ? "" : "has-conflict"}`}>
      <header className="lane-head">
        <div className="lane-title">
          <strong>{driver.name}</strong>
          <Tag color="blue">{shift.start}–{shift.end}</Tag>
          <Tag color={totalWeight > shift.capacityKg ? "error" : "default"}>
            累计 {totalWeight}/{shift.capacityKg}kg
          </Tag>
          {!plan.ok && <Tag color="error">冲突：{plan.rejectKind}</Tag>}
        </div>
        <div className="lane-hint">
          {plan.ok ? (
            assignment.tasks.some((t) => !t.locked) ? (
              <span className="muted small">可继续拖入或拖动排序</span>
            ) : (
              <span className="muted small">{assignment.tasks.length ? "全部已锁定" : "空班次"}</span>
            )
          ) : (
            <Tooltip title={plan.message}>
              <span className="danger-text small">{plan.message}</span>
            </Tooltip>
          )}
        </div>
      </header>

      <div className="timeline-scroll">
        <div className="timeline" style={{ width: axisWidth }} ref={setNodeRef}>
          <div className="time-axis" style={{ paddingLeft: AXIS_PAD }}>
            {Array.from({ length: Math.floor(spanHours) + 1 }).map((_, i) => (
              <span
                key={i}
                className="tick"
                style={{ left: AXIS_PAD + i * HOUR_WIDTH - 14 }}
              >
                {toHHMM(startMin + i * 60)}
              </span>
            ))}
          </div>
          <div className="track" style={{ marginLeft: AXIS_PAD, width: spanHours * HOUR_WIDTH }}>
            {Array.from({ length: Math.ceil(spanHours) }).map((_, i) => (
              <div key={i} className="gridline" style={{ left: i * HOUR_WIDTH }} />
            ))}

            {/* 休息区间 */}
            {plan.ok &&
              plan.tasks
                .filter((t) => t.breakBefore)
                .map((t) => {
                  const bs = t.breakStart!;
                  const be = t.breakEnd!;
                  return (
                    <div
                      key={`break-${t.orderId}`}
                      className="break-block"
                      style={{
                        left: ((bs - startMin) / 60) * HOUR_WIDTH,
                        width: Math.max(18, ((be - bs) / 60) * HOUR_WIDTH)
                      }}
                      title={`休息 ${toHHMM(bs)}–${toHHMM(be)}（连续满4小时强制）`}
                    >
                      休息
                    </div>
                  );
                })}

            {/* 任务：按计划时间定位；有冲突时退回顺序条展示 */}
            {plan.ok
              ? plan.tasks.map((t) => {
                  const order = orderMap.get(t.orderId);
                  if (!order) return null;
                  return (
                    <DroppableTask
                      key={t.orderId}
                      order={order}
                      fromShiftId={shift.id}
                      left={((t.arriveMin - startMin) / 60) * HOUR_WIDTH}
                      width={Math.max(70, (order.serviceMinutes / 60) * HOUR_WIDTH)}
                      arrive={toHHMM(t.arriveMin)}
                      end={toHHMM(t.endMin)}
                      locked={!!t.locked}
                      disabled={disabled}
                      onDeliver={() => onDeliver(t.orderId)}
                      onRemove={() => onRemove(t.orderId)}
                    />
                  );
                })
              : assignment.tasks.map((t, idx) => {
                  const order = orderMap.get(t.orderId);
                  if (!order) return null;
                  const bad = idx === plan.rejectIndex;
                  return (
                    <div key={t.orderId} className={`reject-strip ${bad ? "bad" : ""}`} style={{ left: 8 + idx * 150 }}>
                      <TaskChip order={order} compact locked={!!t.locked} />
                      {bad && <span className="reject-flag">此处拒绝</span>}
                    </div>
                  );
                })}
          </div>
        </div>
      </div>
    </section>
  );
}

function DroppableTask(props: {
  order: Order;
  fromShiftId: string;
  left: number;
  width: number;
  arrive: string;
  end: string;
  locked: boolean;
  disabled: boolean;
  onDeliver: () => void;
  onRemove: () => void;
}) {
  const { order, fromShiftId, left, width, arrive, end, locked, disabled } = props;
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:task:${fromShiftId}:${order.id}`,
    data: {
      kind: "lane",
      shiftId: fromShiftId,
      beforeOrderId: order.id
    } satisfies DropData,
    disabled
  });

  return (
    <div
      ref={setDropRef}
      className={`task-slot ${isOver ? "over" : ""}`}
      style={{ left, width: Math.max(width, 76) }}
    >
      <DraggableTask
        order={order}
        fromShiftId={fromShiftId}
        locked={locked}
        disabled={disabled}
        arrive={arrive}
        end={end}
        onDeliver={props.onDeliver}
        onRemove={props.onRemove}
      />
    </div>
  );
}

function DraggableTask(props: {
  order: Order;
  fromShiftId: string;
  locked: boolean;
  disabled: boolean;
  arrive: string;
  end: string;
  onDeliver: () => void;
  onRemove: () => void;
}) {
  const { order, fromShiftId, locked, disabled, arrive, end } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `drag:lane:${fromShiftId}:${order.id}`,
    data: {
      kind: "order",
      orderId: order.id,
      from: fromShiftId,
      locked
    } satisfies DragData,
    disabled: disabled || locked
  });

  return (
    <div className={`task-wrap ${isDragging ? "dragging" : ""}`}>
      <div
        ref={setNodeRef}
        className={`task-chip ${locked ? "locked" : ""}`}
        {...(locked ? {} : listeners)}
        {...attributes}
      >
        <div className="task-chip-head">
          <strong>{order.orderNo}</strong>
          {locked ? <Tag color="green">已锁定</Tag> : <Tag>{order.district}</Tag>}
        </div>
        <div className="task-chip-time">
          {arrive}–{end}
        </div>
        <div className="task-chip-meta">
          {order.weightKg}kg · {order.serviceMinutes}′
        </div>
      </div>
      {!disabled && (
        <div className="task-actions">
          {!locked && (
            <>
              <Popconfirm
                title="确认该订单已配送？"
                description="配送后将锁定承诺到达时间，不可再拖拽移动。"
                onConfirm={props.onDeliver}
              >
                <Button size="small" type="link">配送锁定</Button>
              </Popconfirm>
              <Button size="small" type="link" danger onClick={props.onRemove}>移出</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TaskChip({ order, overlay, compact, locked }: { order: Order; overlay?: boolean; compact?: boolean; locked?: boolean }) {
  return (
    <div className={`pool-card task-overlay-chip ${overlay ? "overlay" : ""} ${compact ? "compact" : ""} ${locked ? "locked" : ""}`}>
      <div className="pool-card-head">
        <strong>{order.orderNo}</strong>
        <Tag>{order.district}</Tag>
      </div>
      <div className="pool-card-meta">
        <span>{order.windowStart}–{order.windowEnd}</span>
        <span>{order.weightKg}kg</span>
        {locked && <Tag color="green">锁定</Tag>}
      </div>
    </div>
  );
}
