import { Button, Drawer, Popconfirm, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useBoard } from "../store/useBoard";
import { findOrderPlacement, latestVersion } from "../rules";
import type { Order } from "../rules/types";
import OrderFormModal, { type OrderFormValue } from "./OrderFormModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}

export default function OrdersDrawer({ open, onClose, onRegistered }: Props) {
  const { orders, drivers, versions, addOrder, updateOrder, deleteOrder } = useBoard();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const ver = latestVersion(versions);
  const driverOfShift = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) for (const s of d.shifts) m.set(s.id, d.name);
    return m;
  }, [drivers]);

  function handleSubmit(v: OrderFormValue) {
    if (editing) {
      updateOrder(editing.id, v);
    } else {
      addOrder(v);
    }
    setFormOpen(false);
    setEditing(null);
    onRegistered();
  }

  const columns: ColumnsType<Order> = [
    { title: "订单号", dataIndex: "orderNo", width: 110, render: (v: string) => <strong>{v}</strong> },
    { title: "商圈", dataIndex: "district", width: 90 },
    { title: "装卸", dataIndex: "serviceMinutes", width: 70, align: "right", render: (v: number) => `${v}′` },
    { title: "重量", dataIndex: "weightKg", width: 80, align: "right", render: (v: number) => `${v}kg` },
    {
      title: "可送达时段",
      key: "win",
      width: 120,
      render: (_, r) => `${r.windowStart}–${r.windowEnd}`
    },
    {
      title: "状态",
      key: "status",
      width: 150,
      render: (_, r) => {
        if (r.delivered) return <Tag color="green">已配送 · 承诺锁定</Tag>;
        const p = findOrderPlacement(ver, r.id);
        if (p) return <Tag color="blue">已派 · {driverOfShift.get(p.assignment.shiftId) ?? "班次"}</Tag>;
        return <Tag>待派</Tag>;
      }
    },
    {
      title: "操作",
      key: "op",
      render: (_, r) => {
        const placed = !r.delivered && !!findOrderPlacement(ver, r.id);
        return (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setEditing(r);
                setFormOpen(true);
              }}
            >
              编辑
            </Button>
            <Popconfirm
              title={placed ? "该订单已派单，需先从班次移出再删除" : "删除该订单？"}
              disabled={placed}
              onConfirm={() => deleteOrder(r.id)}
            >
              <Button size="small" danger disabled={placed}>删除</Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  return (
    <Drawer
      title="订单登记与管理"
      open={open}
      onClose={onClose}
      width={860}
      extra={<Button type="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>登记订单</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={orders} pagination={{ pageSize: 12 }} size="small" />
      <OrderFormModal
        open={formOpen}
        editing={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSubmit={handleSubmit}
      />
    </Drawer>
  );
}
