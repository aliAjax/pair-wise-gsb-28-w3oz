import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, Popconfirm, Progress, Tag } from "antd";
import type { Driver, Order, PlannedStop, TimelineEntry } from "../domain/types";
import { evaluatePlan, ordersById, toHHMM } from "../domain/rules";
import { useScheduleStore } from "../store/scheduleStore";

interface DriverLaneProps {
  driver: Driver;
  orders: Order[];
}

/** 司机泳道：班次、载重占用、按顺序重算的承诺时间线（含休息块与锁定任务） */
export function DriverLane({ driver, orders }: DriverLaneProps) {
  const plans = useScheduleStore((state) => state.plans);
  const markDelivered = useScheduleStore((state) => state.markDelivered);
  const stops = plans[driver.id] ?? [];
  const orderMap = ordersById(orders);
  const { timeline, totalWeightKg } = evaluatePlan(driver, stops, orderMap);
  const percent = Math.min(100, Math.round((totalWeightKg / driver.capacityKg) * 100));

  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${driver.id}`,
    data: { kind: "lane", driverId: driver.id },
  });

  let seq = 0;

  return (
    <section ref={setNodeRef} className={`lane ${isOver ? "drop-over" : ""}`}>
      <header className="lane-head">
        <div>
          <strong>{driver.name}</strong>
          <span className="lane-shift">
            班次 {driver.shiftStart}–{driver.shiftEnd}
          </span>
        </div>
        <div className="lane-capacity">
          <span>
            载重 {totalWeightKg}/{driver.capacityKg} kg
          </span>
          <Progress
            percent={percent}
            size="small"
            showInfo={false}
            status={percent >= 90 ? "exception" : "active"}
          />
        </div>
      </header>

      <div className="lane-body">
        {timeline.length === 0 ? (
          <div className="lane-empty">把左侧订单拖到这里，按顺序自动重算承诺到达时间</div>
        ) : (
          timeline.map((entry, index) => {
            if (entry.kind === "rest") {
              return (
                <div className="rest-block" key={`rest-${index}`}>
                  😴 连续作业满 4 小时，休息 {toHHMM(entry.startMin)}–{toHHMM(entry.endMin)}
                </div>
              );
            }
            seq += 1;
            const order = orderMap.get(entry.orderId);
            if (!order) return null;
            return (
              <StopCard
                key={entry.orderId}
                seq={seq}
                driver={driver}
                order={order}
                entry={entry}
                onDeliver={() => markDelivered(driver.id, entry.orderId)}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

interface StopCardProps {
  seq: number;
  driver: Driver;
  order: Order;
  entry: Extract<TimelineEntry, { kind: "stop" }>;
  onDeliver: () => void;
}

function StopCard({ seq, driver, order, entry, onDeliver }: StopCardProps) {
  const locked = entry.locked;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `stop:${order.id}`,
    data: { kind: "stop", orderId: order.id, driverId: driver.id },
    disabled: locked,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `before:${order.id}`,
    data: { kind: "before", orderId: order.id, driverId: driver.id },
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <article
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      style={style}
      className={`stop-card ${locked ? "locked" : ""} ${isDragging ? "dragging" : ""} ${
        isOver ? "drop-over" : ""
      }`}
      {...(locked ? {} : { ...listeners, ...attributes })}
    >
      <div className="stop-card-head">
        <span className="stop-seq">{seq}</span>
        <strong>{order.orderNo}</strong>
        <Tag>{order.district}</Tag>
        {locked ? <Tag color="green">已锁定</Tag> : <Tag color="gold">承诺中</Tag>}
      </div>
      <div className="stop-card-meta">
        <span>
          承诺到达 <b>{toHHMM(entry.arriveMin)}</b>–{toHHMM(entry.departMin)}
        </span>
        <span>装卸 {order.serviceMinutes} 分钟</span>
        <span>{order.weightKg} kg</span>
        <span>
          时段 {order.windowStart}–{order.windowEnd}
        </span>
      </div>
      {!locked && (
        <div className="stop-card-actions" onPointerDown={(event) => event.stopPropagation()}>
          <Popconfirm
            title="确认送达？"
            description="送达后任务锁定，时间与位置不可再调整"
            onConfirm={onDeliver}
            okText="送达并锁定"
            cancelText="取消"
          >
            <Button size="small" type="primary">
              送达并锁定
            </Button>
          </Popconfirm>
        </div>
      )}
    </article>
  );
}
