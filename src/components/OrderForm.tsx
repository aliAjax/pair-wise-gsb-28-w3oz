import { Button, Form, Input, InputNumber, Select, TimePicker } from "antd";
import type { Dayjs } from "dayjs";
import { DISTRICTS } from "../domain/rules";
import { useScheduleStore } from "../store/scheduleStore";

interface OrderFormValues {
  orderNo: string;
  district: string;
  serviceMinutes: number;
  weightKg: number;
  window: [Dayjs, Dayjs];
  notes?: string;
}

/** 订单登记：商圈、装卸分钟、重量、可送达时段 */
export function OrderForm() {
  const addOrder = useScheduleStore((state) => state.addOrder);
  const [form] = Form.useForm<OrderFormValues>();

  function handleFinish(values: OrderFormValues) {
    addOrder({
      orderNo: values.orderNo.trim(),
      district: values.district,
      serviceMinutes: values.serviceMinutes,
      weightKg: values.weightKg,
      windowStart: values.window[0].format("HH:mm"),
      windowEnd: values.window[1].format("HH:mm"),
      notes: values.notes?.trim() ?? "",
    });
    form.resetFields();
  }

  return (
    <section className="panel">
      <h2>订单登记</h2>
      <Form<OrderFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{ district: DISTRICTS[0], serviceMinutes: 30, weightKg: 100 }}
        requiredMark={false}
      >
        <Form.Item name="orderNo" label="订单号" rules={[{ required: true, message: "请输入订单号" }]}>
          <Input placeholder="如 ORD-1008" />
        </Form.Item>
        <Form.Item name="district" label="商圈" rules={[{ required: true }]}>
          <Select options={DISTRICTS.map((district) => ({ value: district, label: district }))} />
        </Form.Item>
        <div className="field-row">
          <Form.Item name="serviceMinutes" label="装卸分钟" rules={[{ required: true }]}>
            <InputNumber min={5} max={240} step={5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="weightKg" label="重量（kg）" rules={[{ required: true }]}>
            <InputNumber min={1} max={5000} style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Form.Item name="window" label="可送达时段" rules={[{ required: true, message: "请选择时段" }]}>
          <TimePicker.RangePicker format="HH:mm" minuteStep={15} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} placeholder="装卸要求、联系人等" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          登记为待分配
        </Button>
      </Form>
    </section>
  );
}
