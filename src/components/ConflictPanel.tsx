import { Button, Table, Tag } from "antd";
import type { Conflict } from "../domain/types";
import { useScheduleStore } from "../store/scheduleStore";
import { formatDateTime } from "./timeUtils";

const KIND_LABEL: Record<Conflict["kind"], { text: string; color: string }> = {
  window: { text: "超出可送达时段", color: "red" },
  shift: { text: "超出班次时段", color: "volcano" },
  weight: { text: "累计超载", color: "magenta" },
};

/** 冲突列表：整单拒绝时列出订单、司机、超时分钟、超出重量 */
export function ConflictPanel() {
  const conflicts = useScheduleStore((state) => state.conflicts);
  const clearConflicts = useScheduleStore((state) => state.clearConflicts);

  if (conflicts.length === 0) return null;

  return (
    <section className="panel conflict-panel">
      <div className="panel-title-row">
        <h2>冲突（整单拒绝 {conflicts.length} 项）</h2>
        <Button size="small" onClick={clearConflicts}>
          知道了
        </Button>
      </div>
      <Table<Conflict>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={conflicts}
        columns={[
          { title: "订单", dataIndex: "orderNo", width: 110 },
          { title: "司机", dataIndex: "driverName", width: 90 },
          {
            title: "冲突类型",
            dataIndex: "kind",
            width: 130,
            render: (kind: Conflict["kind"]) => (
              <Tag color={KIND_LABEL[kind].color}>{KIND_LABEL[kind].text}</Tag>
            ),
          },
          {
            title: "超时分钟",
            dataIndex: "overtimeMinutes",
            width: 90,
            render: (value: number) => (value > 0 ? `${value} 分钟` : "—"),
          },
          {
            title: "超出重量",
            dataIndex: "excessWeightKg",
            width: 90,
            render: (value: number) => (value > 0 ? `${value} kg` : "—"),
          },
          { title: "说明", dataIndex: "message" },
          {
            title: "时间",
            dataIndex: "createdAt",
            width: 110,
            render: (value: string) => formatDateTime(value),
          },
        ]}
      />
    </section>
  );
}
