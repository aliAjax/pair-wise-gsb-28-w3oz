import { Button, Drawer, Empty, Form, Input, InputNumber, Popconfirm, Space, Table, TimePicker } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useBoard } from "../store/useBoard";
import type { Driver, Shift } from "../rules/types";
import { dayjsToHHMM, hhmmToDayjs } from "./timefmt";

type ShiftFormValue = {
  range: [ReturnType<typeof hhmmToDayjs>, ReturnType<typeof hhmmToDayjs>];
  capacityKg: number;
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function DriverDrawer({ open, onClose }: Props) {
  const { drivers, addDriver, updateDriver, deleteDriver, addShift, updateShift, deleteShift } = useBoard();
  const [newDriver, setNewDriver] = useState("");

  const shiftColumns = (driver: Driver): ColumnsType<Shift> => [
    {
      title: "班次",
      key: "time",
      width: 200,
      render: (_, row) => (
        <ShiftTimeEditor
          shift={row}
          onChange={(start, end) => updateShift(row.id, { start, end })}
        />
      )
    },
    {
      title: "载重 kg",
      key: "cap",
      width: 150,
      render: (_, row) => (
        <InputNumber
          size="small"
          min={1}
          value={row.capacityKg}
          onChange={(v) => updateShift(row.id, { capacityKg: Number(v) || 1 })}
          addonAfter="kg"
        />
      )
    },
    {
      title: "操作",
      key: "op",
      width: 80,
      render: (_, row) => (
        <Popconfirm
          title="删除该班次？"
          description="该班次上的派单会一并移出。"
          onConfirm={() => deleteShift(driver.id, row.id)}
        >
          <Button size="small" danger type="link">删除</Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Drawer title="司机与班次运力维护" open={open} onClose={onClose} width={720}>
      <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
        <Input
          placeholder="新增司机姓名，如：周师傅"
          value={newDriver}
          onChange={(e) => setNewDriver(e.target.value)}
          onPressEnter={() => {
            if (newDriver.trim()) {
              addDriver(newDriver.trim());
              setNewDriver("");
            }
          }}
        />
        <Button
          type="primary"
          onClick={() => {
            if (newDriver.trim()) {
              addDriver(newDriver.trim());
              setNewDriver("");
            }
          }}
        >
          添加司机
        </Button>
      </Space.Compact>

      {drivers.length === 0 && <Empty description="还没有司机" />}

      {drivers.map((driver) => (
        <section className="driver-block" key={driver.id}>
          <div className="driver-head">
            <Input
              value={driver.name}
              onChange={(e) => updateDriver(driver.id, { name: e.target.value })}
              style={{ width: 160, fontWeight: 700 }}
            />
            <Popconfirm title="删除该司机？" description="其所有班次派单会一并移出。" onConfirm={() => deleteDriver(driver.id)}>
              <Button danger type="link">删除司机</Button>
            </Popconfirm>
          </div>

          <Table<Shift>
            rowKey="id"
            size="small"
            pagination={false}
            columns={shiftColumns(driver)}
            dataSource={driver.shifts}
            locale={{ emptyText: "暂无班次" }}
          />

          <AddShiftForm
            key={`${driver.id}-${driver.shifts.length}`}
            onAdd={(v) => {
              addShift(driver.id, {
                start: dayjsToHHMM(v.range[0]),
                end: dayjsToHHMM(v.range[1]),
                capacityKg: v.capacityKg
              });
            }}
          />
        </section>
      ))}
    </Drawer>
  );
}

function ShiftTimeEditor({ shift, onChange }: { shift: Shift; onChange: (start: string, end: string) => void }) {
  return (
    <TimePicker.RangePicker
      size="small"
      format="HH:mm"
      minuteStep={5}
      value={[hhmmToDayjs(shift.start), hhmmToDayjs(shift.end)]}
      onChange={(v) => {
        if (v && v[0] && v[1]) onChange(dayjsToHHMM(v[0]), dayjsToHHMM(v[1]));
      }}
    />
  );
}

function AddShiftForm({ onAdd }: { onAdd: (v: ShiftFormValue) => void }) {
  const [form] = Form.useForm<ShiftFormValue>();
  return (
    <Form<ShiftFormValue>
      form={form}
      layout="inline"
      className="add-shift-form"
      initialValues={{
        range: [hhmmToDayjs("08:00"), hhmmToDayjs("18:00")],
        capacityKg: 1000
      }}
      onFinish={(v) => {
        onAdd(v);
        form.resetFields();
      }}
    >
      <Form.Item
        name="range"
        rules={[
          { required: true, message: "请选择班次时间" },
          {
            validator: (_, value: [unknown, unknown] | undefined) => {
              if (!value?.[0] || !value?.[1]) return Promise.resolve();
              const a = value[0] as { hour(): number; minute(): number };
              const b = value[1] as { hour(): number; minute(): number };
              return a.hour() * 60 + a.minute() < b.hour() * 60 + b.minute()
                ? Promise.resolve()
                : Promise.reject(new Error("下班须晚于上班"));
            }
          }
        ]}
      >
        <TimePicker.RangePicker format="HH:mm" minuteStep={15} placeholder={["上班", "下班"]} />
      </Form.Item>
      <Form.Item name="capacityKg" rules={[{ required: true }]}>
        <InputNumber min={1} addonBefore="载重" addonAfter="kg" />
      </Form.Item>
      <Form.Item>
        <Button type="dashed" htmlType="submit">+ 添加班次</Button>
      </Form.Item>
    </Form>
  );
}
