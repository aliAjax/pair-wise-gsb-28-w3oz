import { Button, Drawer, Empty, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useBoard } from "../store/useBoard";
import type { ConflictRecord } from "../rules/types";

interface Props {
  open: boolean;
  live: ConflictRecord[];
  onClose: () => void;
}

const kindColor: Record<ConflictRecord["kind"], string> = {
  超时: "red",
  超载: "volcano",
  休息冲突: "orange"
};

export default function ConflictDrawer({ open, live, onClose }: Props) {
  const { conflicts, clearConflicts } = useBoard();

  // 被拒日志在前，存量冲突（刷新后由规则重算）在后
  const rows = useMemoRows(conflicts, live);

  const columns: ColumnsType<ConflictRecord> = [
    {
      title: "来源",
      dataIndex: "source",
      width: 92,
      render: (v: string) => <Tag color={v === "存量" ? "gold" : "red"}>{v}</Tag>
    },
    {
      title: "订单",
      key: "order",
      width: 120,
      render: (_, r) => <strong>{r.orderNo}</strong>
    },
    { title: "司机", dataIndex: "driverName", width: 90 },
    {
      title: "类型",
      dataIndex: "kind",
      width: 90,
      render: (v: ConflictRecord["kind"]) => <Tag color={kindColor[v]}>{v}</Tag>
    },
    {
      title: "超时分钟",
      dataIndex: "overtimeMinutes",
      width: 90,
      align: "right",
      render: (v: number) => (v > 0 ? <span className="danger-text">+{v}′</span> : "—")
    },
    {
      title: "超出重量",
      dataIndex: "overloadKg",
      width: 90,
      align: "right",
      render: (v: number) => (v > 0 ? <span className="danger-text">+{v} kg</span> : "—")
    },
    { title: "说明", dataIndex: "message" },
    {
      title: "时间",
      dataIndex: "at",
      width: 150,
      render: (v: string, row) =>
        row.source === "存量" ? "实时校验" : dayjs(v).format("MM-DD HH:mm")
    }
  ];

  return (
    <Drawer
      title={`冲突清单（${rows.length}）`}
      open={open}
      onClose={onClose}
      width={900}
      extra={
        <Space>
          <Button onClick={clearConflicts}>清空被拒日志</Button>
        </Space>
      }
    >
      <p className="muted">
        拖入 / 移动被「整单拒绝」时会记录一条冲突；「存量」冲突由规则引擎对当前排班实时重算得出，
        修改订单时段或班次运力后立即出现。
      </p>
      {rows.length === 0 ? (
        <Empty description="没有冲突，排班与承诺一致" />
      ) : (
        <Table rowKey="id" columns={columns} dataSource={rows} pagination={{ pageSize: 12 }} size="small" />
      )}
    </Drawer>
  );
}

function useMemoRows(logs: ConflictRecord[], live: ConflictRecord[]): ConflictRecord[] {
  // 同一班次同一拒绝位置的存量与日志不重复展示
  const seen = new Set<string>();
  const out: ConflictRecord[] = [];
  for (const r of logs) {
    seen.add(r.shiftId + r.orderId + r.kind);
    out.push(r);
  }
  for (const r of live) {
    const key = r.shiftId + r.orderId + r.kind;
    if (!seen.has(key)) out.push(r);
  }
  return out;
}
