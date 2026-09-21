import { Button, Form, Input, InputNumber, TimePicker } from "antd";
import type { Dayjs } from "dayjs";
import { useScheduleStore } from "../store/scheduleStore";
import { hhmmToDayjs } from "./timeUtils";

interface DriverFormValues {
  name: string;
  shift: [Dayjs, Dayjs];
  capacityKg: number;
}

/** 司机维护：班次与载重 */
export function DriverForm() {
  const addDriver = useScheduleStore((state) => state.addDriver);
  const [form] = Form.useForm<DriverFormValues>();

  function handleFinish(values: DriverFormValues) {
    addDriver({
      name: values.name.trim(),
      shiftStart: values.shift[0].format("HH:mm"),
      shiftEnd: values.shift[1].format("HH:mm"),
      capacityKg: values.capacityKg,
    });
    form.resetFields();
  }

  return (
    <section className="panel">
      <h2>司机维护</h2>
      <Form<DriverFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          shift: [hhmmToDayjs("08:00"), hhmmToDayjs("17:00")],
          capacityKg: 1000,
        }}
        requiredMark={false}
      >
        <Form.Item name="name" label="司机姓名" rules={[{ required: true, message: "请输入姓名" }]}>
          <Input placeholder="如 王师傅" />
        </Form.Item>
        <Form.Item name="shift" label="班次" rules={[{ required: true, message: "请选择班次" }]}>
          <TimePicker.RangePicker format="HH:mm" minuteStep={30} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="capacityKg" label="载重（kg）" rules={[{ required: true }]}>
          <InputNumber min={100} max={20000} step={100} style={{ width: "100%" }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          新增司机
        </Button>
      </Form>
    </section>
  );
}
