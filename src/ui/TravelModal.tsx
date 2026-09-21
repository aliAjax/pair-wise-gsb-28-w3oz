import { Button, Form, InputNumber, Modal, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useBoard } from "../store/useBoard";
import { RULES } from "../rules/constants";
import { legKey } from "../rules/travel";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Row {
  key: string;
  a: string;
  b: string;
  minutes: number;
  custom: boolean;
}

export default function TravelModal({ open, onClose }: Props) {
  const { orders, travelMatrix, setTravel } = useBoard();
  const districts = useMemo(
    () => Array.from(new Set(orders.map((o) => o.district).filter(Boolean))).sort(),
    [orders]
  );
  const [a, setA] = useState<string>();
  const [b, setB] = useState<string>();
  const [minutes, setMinutes] = useState<number>(RULES.defaultTravelMinutes);

  const rows: Row[] = useMemo(() => {
    const places = [RULES.depot, ...districts];
    const list: Row[] = [];
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        const x = places[i];
        const y = places[j];
        const key = legKey(x, y);
        const v = travelMatrix[key];
        list.push({
          key,
          a: x,
          b: y,
          minutes: Number.isFinite(v) ? v : RULES.defaultTravelMinutes,
          custom: Number.isFinite(v)
        });
      }
    }
    return list;
  }, [districts, travelMatrix]);

  const columns: ColumnsType<Row> = [
    { title: "从", dataIndex: "a", width: 110 },
    { title: "到", dataIndex: "b", width: 110 },
    {
      title: "行驶分钟",
      key: "minutes",
      render: (_, row) => (
        <Space>
          <InputNumber
            size="small"
            min={0}
            max={240}
            value={row.minutes}
            onChange={(v) => setTravel(row.a, row.b, v == null ? null : Number(v))}
            addonAfter="分钟"
          />
          {row.custom ? (
            <Button size="small" type="link" onClick={() => setTravel(row.a, row.b, null)}>
              恢复默认 {RULES.defaultTravelMinutes}′
            </Button>
          ) : (
            <span className="muted">默认</span>
          )}
        </Space>
      )
    }
  ];

  const allPlaces = [RULES.depot, ...districts];

  return (
    <Modal title="车程设置（商圈间行驶分钟）" open={open} onCancel={onClose} footer={null} width={640}>
      <p className="muted">
        车程矩阵为无向对称：A→B 与 B→A 相同；相同商圈连续两单行驶为 0 分钟；未设置时取默认
        {RULES.defaultTravelMinutes} 分钟。
      </p>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          placeholder="地点 A"
          style={{ width: 140 }}
          value={a}
          onChange={setA}
          options={allPlaces.map((p) => ({ value: p, label: p }))}
        />
        <Select
          placeholder="地点 B"
          style={{ width: 140 }}
          value={b}
          onChange={setB}
          options={allPlaces.filter((p) => p !== a).map((p) => ({ value: p, label: p }))}
        />
        <InputNumber min={0} max={240} value={minutes} onChange={(v) => setMinutes(Number(v) || 0)} addonAfter="分钟" />
        <Button
          type="primary"
          disabled={!a || !b || a === b}
          onClick={() => {
            if (a && b) setTravel(a, b, minutes);
          }}
        >
          设置车程
        </Button>
      </Space>
      <Table rowKey="key" columns={columns} dataSource={rows} pagination={false} size="small" />
    </Modal>
  );
}
