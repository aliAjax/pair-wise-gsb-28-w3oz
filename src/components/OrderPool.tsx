import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, Empty, Popconfirm, Tag } from "antd";
import type { Order } from "../domain/types";
import { orderStatusOf } from "../domain/rules";
import { useScheduleStore } from "../store/scheduleStore";

/** 待分配订单池：可拖入司机泳道，也可作为已排订单的退回目标 */
export function OrderPool() {
  const orders = useScheduleStore((state) => state.orders);
  const plans = useScheduleStore((state) => state.plans);
  const removeOrder = useScheduleStore((state) => state.removeOrder);
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });

  const pending = orders.filter((order) => orderStatusOf(order.id, plans) === "pending");

  return (
    <section className={`panel pool ${isOver ? "drop-over" : ""}`} ref={setNodeRef}>
      <h2>待分配订单（{pending.length}）</h2>
      <p className="hint">拖动订单卡片到右侧司机泳道；拖回此处即退回待分配（需填调班原因）。</p>
      {pending.length === 0 ? (
        <Empty description="暂无待分配订单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="pool-list">
          {pending.map((order) => (
            <PoolOrderCard key={order.id} order={order} onRemove={() => removeOrder(order.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PoolOrderCard({ order, onRemove }: { order: Order; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `order:${order.id}`,
    data: { kind: "pool-order", orderId: order.id },
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`order-card ${isDragging ? "dragging" : ""}`}
      {...listeners}
      {...attributes}
    >
      <div className="order-card-head">
        <strong>{order.orderNo}</strong>
        <Tag color="blue">{order.district}</Tag>
      </div>
      <div className="order-card-meta">
        <span>装卸 {order.serviceMinutes} 分钟</span>
        <span>{order.weightKg} kg</span>
        <span>
          可送达 {order.windowStart}–{order.windowEnd}
        </span>
      </div>
      {order.notes ? <p className="order-card-notes">{order.notes}</p> : null}
      <div className="order-card-actions" onPointerDown={(event) => event.stopPropagation()}>
        <Popconfirm title="删除该待分配订单？" onConfirm={onRemove} okText="删除" cancelText="取消">
          <Button size="small" danger type="text">
            删除
          </Button>
        </Popconfirm>
      </div>
    </article>
  );
}
