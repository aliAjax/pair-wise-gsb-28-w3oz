import { useEffect } from "react";
import { Button, Form, Input, InputNumber, Modal, TimePicker } from "antd";
import type { Order } from "../rules/types";
import { dayjsToHHMM, hhmmToDayjs } from "./timefmt";

export interface OrderFormValue {
  orderNo: string;
  district: string;
  serviceMinutes: number;
  weightKg: number;
  windowStart: string;
  windowEnd: string;
}

interface Props {
  open: boolean;
  editing?: Order | null;
  onClose: () => void;
  onSubmit: (v: OrderFormValue) => void;
}

export default function OrderFormModal({ open, editing, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        orderNo: editing.orderNo,
        district: editing.district,
        serviceMinutes: editing.serviceMinutes,
        weightKg: editing.weightKg,
        window: [hhmmToDayjs(editing.windowStart), hhmmToDayjs(editing.windowEnd)]
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        serviceMinutes: 20,
        weightKg: 200,
        window: [hhmmToDayjs("09:00"), hhmmToDayjs("12:00")]
      });
    }
  }, [open, editing, form]);

  return (
    <Modal
      title={editing ? `编辑订单 ${editing.orderNo}` : "登记订单"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const [ws, we] = v.window as [ReturnType<typeof hhmmToDayjs>, ReturnType<typeof hhmmToDayjs>];
          onSubmit({
            orderNo: String(v.orderNo).trim(),
            district: String(v.district).trim(),
            serviceMinutes: Number(v.serviceMinutes),
            weightKg: Number(v.weightKg),
            windowStart: dayjsToHHMM(ws),
            windowEnd: dayjsToHHMM(we)
          });
        }}
      >
        <Form.Item name="orderNo" label="订单号" rules={[{ required: true, message: "请输入订单号" }]}>
          <Input placeholder="ORD-1008" />
        </Form.Item>
        <Form.Item name="district" label="商圈（送达目的地）" rules={[{ required: true, message: "请输入商圈" }]}>
          <Input placeholder="陆家嘴 / 虹桥 / 静安寺…" />
        </Form.Item>
        <div className="form-row-2">
          <Form.Item
            name="serviceMinutes"
            label="装卸分钟"
            rules={[{ required: true, message: "请输入装卸分钟" }]}
          >
            <InputNumber min={1} max={480} addonAfter="分钟" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="weightKg"
            label="重量"
            rules={[{ required: true, message: "请输入重量" }]}
          >
            <InputNumber min={1} addonAfter="kg" style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Form.Item
          name="window"
          label="可送达时段"
          rules={[
            { required: true, message: "请选择可送达时段" },
            {
              validator: (_, value: [unknown, unknown] | undefined) => {
                if (!value || !value[0] || !value[1]) return Promise.resolve();
                const a = value[0] as { hour(): number; minute(): number };
                const b = value[1] as { hour(): number; minute(): number };
                return a.hour() * 60 + a.minute() < b.hour() * 60 + b.minute()
                  ? Promise.resolve()
                  : Promise.reject(new Error("时段止必须晚于时段起"));
              }
            }
          ]}
        >
          <TimePicker.RangePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} />
        </Form.Item>
        <div className="form-actions">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit">{editing ? "保存" : "登记订单"}</Button>
        </div>
      </Form>
    </Modal>
  );
}
