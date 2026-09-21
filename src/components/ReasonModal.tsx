import { Input, Modal } from "antd";
import { useEffect, useState } from "react";

interface ReasonModalProps {
  open: boolean;
  title: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** 调班原因弹窗：确认后生成新派单版本 */
export function ReasonModal({ open, title, onConfirm, onCancel }: ReasonModalProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      title={title}
      okText="确认调班"
      cancelText="取消"
      okButtonProps={{ disabled: reason.trim().length === 0 }}
      onOk={() => onConfirm(reason.trim())}
      onCancel={onCancel}
      destroyOnHidden
    >
      <p className="hint">调班将生成新派单版本，原派单保留在历史版本中。</p>
      <Input.TextArea
        rows={3}
        placeholder="请填写调班原因，如：客户改时段 / 车辆故障 / 商圈临时限行"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}
