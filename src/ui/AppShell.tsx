import { App as AntApp, Button, Input, Modal, Segmented, Space, Statistic, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useBoard } from "../store/useBoard";
import { latestVersion, liveConflicts, planBoard } from "../rules";
import Board from "./Board";
import OrdersDrawer from "./OrdersDrawer";
import DriverDrawer from "./DriverDrawer";
import TravelModal from "./TravelModal";
import ConflictDrawer from "./ConflictDrawer";
import OrderFormModal, { type OrderFormValue } from "./OrderFormModal";

export default function AppShell() {
  const { message, modal } = AntApp.useApp();
  const {
    orders, drivers, versions, travelMatrix, viewingVersion,
    addOrder, startRevision, viewVersion, viewLatest, resetAll
  } = useBoard();

  const [ordersOpen, setOrdersOpen] = useState(false);
  const [driversOpen, setDriversOpen] = useState(false);
  const [travelOpen, setTravelOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [quickFormOpen, setQuickFormOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const version = versions.find((v) => v.version === viewingVersion) ?? latestVersion(versions);
  const isLatest = version.version === latestVersion(versions).version;

  const live = useMemo(
    () => liveConflicts(version, drivers, orders, travelMatrix),
    [version, drivers, orders, travelMatrix]
  );

  // 进入页面（刷新）时若存量冲突存在，直接提示打开冲突清单
  useEffect(() => {
    if (live.length > 0) {
      message.warning(`当前排班存在 ${live.length} 个存量冲突，请核对承诺`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planned = useMemo(
    () => planBoard(version, drivers, orders, travelMatrix),
    [version, drivers, orders, travelMatrix]
  );

  const metrics = useMemo(() => {
    const delivered = orders.filter((o) => o.delivered).length;
    let placed = 0;
    for (const a of version.assignments) placed += a.tasks.length;
    const capacity = drivers.reduce((acc, d) => acc + d.shifts.reduce((x, s) => x + s.capacityKg, 0), 0);
    return { total: orders.length, delivered, placed, capacity, live: live.length };
  }, [orders, drivers, version, live.length]);

  function notify(ok: boolean, text: string) {
    if (ok) message.success(text);
    else message.error(text);
  }

  function confirmRevision() {
    if (!reason.trim()) {
      message.warning("调班必须填写原因");
      return;
    }
    startRevision(reason);
    setReviseOpen(false);
    setReason("");
    message.success("已基于当前派单创建新版本，原派单完整保留");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>司机运力承诺台</h1>
          <p className="subtitle">
            登记订单商圈 / 装卸分钟 / 重量 / 可送达时段，拖入班次即顺序重算到达时间；
            超时或累计超载整单拒绝，连续满 4 小时强制插入休息；配送后锁定承诺，调班带原因版本化留痕。
          </p>
        </div>
        <Space wrap>
          <Button onClick={() => setOrdersOpen(true)}>订单管理</Button>
          <Button type="primary" onClick={() => setQuickFormOpen(true)}>登记订单</Button>
          <Button onClick={() => setDriversOpen(true)}>司机运力</Button>
          <Button onClick={() => setTravelOpen(true)}>车程设置</Button>
          <Button danger onClick={() => setConflictsOpen(true)}>
            冲突清单{metrics.live > 0 ? `（${metrics.live}）` : ""}
          </Button>
          <Button
            onClick={() =>
              modal.confirm({
                title: "恢复演示数据？",
                content: "将清空当前全部订单、司机、版本与冲突记录。",
                okText: "恢复",
                okButtonProps: { danger: true },
                onOk: () => {
                  resetAll();
                  message.success("已恢复演示数据");
                }
              })
            }
          >
            重置
          </Button>
        </Space>
      </header>

      <section className="metrics-row">
        <div className="metric-card"><Statistic title="订单总数" value={metrics.total} /></div>
        <div className="metric-card"><Statistic title="当前版本派单数" value={metrics.placed} /></div>
        <div className="metric-card"><Statistic title="已配送锁定" value={metrics.delivered} valueStyle={{ color: "#389e0d" }} /></div>
        <div className="metric-card"><Statistic title="班次总载重(kg)" value={metrics.capacity} /></div>
        <div className="metric-card">
          <Statistic title="存量冲突" value={metrics.live} valueStyle={{ color: metrics.live ? "#cf1322" : undefined }} />
        </div>
      </section>

      <section className="version-bar">
        <div className="version-left">
          <Segmented
            value={version.version}
            onChange={(v) => viewVersion(Number(v))}
            options={[...versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => ({
                label: `V${v.version}${v.version === latestVersion(versions).version ? "（当前）" : ""}`,
                value: v.version
              }))}
          />
          <div className="version-meta">
            <Tag color={isLatest ? "green" : "default"}>{isLatest ? "可编辑" : "历史只读"}</Tag>
            <span>{version.reason}</span>
            {version.parentVersion != null && (
              <span className="muted"> · 基于 V{version.parentVersion} 派单复制</span>
            )}
          </div>
        </div>
        <Space>
          {!isLatest && <Button onClick={viewLatest}>回到最新版本</Button>}
          <Button type="primary" disabled={!isLatest} onClick={() => setReviseOpen(true)}>
            调班（新建版本）
          </Button>
        </Space>
      </section>

      <Board planned={planned} isLatest={isLatest} onMessage={notify} />

      <OrdersDrawer open={ordersOpen} onClose={() => setOrdersOpen(false)} onRegistered={() => message.success("订单已登记")} />
      <DriverDrawer open={driversOpen} onClose={() => setDriversOpen(false)} />
      <TravelModal open={travelOpen} onClose={() => setTravelOpen(false)} />
      <ConflictDrawer open={conflictsOpen} live={live} onClose={() => setConflictsOpen(false)} />

      <OrderFormModal
        open={quickFormOpen}
        onClose={() => setQuickFormOpen(false)}
        onSubmit={(v: OrderFormValue) => {
          addOrder(v);
          setQuickFormOpen(false);
          message.success("订单已登记，可从待派池拖入班次");
        }}
      />

      <Modal
        title="调班：新建排班版本"
        open={reviseOpen}
        onOk={confirmRevision}
        onCancel={() => setReviseOpen(false)}
        okText="创建新版本"
        cancelText="取消"
      >
        <p className="muted">
          新版本将复制当前全部派单作为起点；已配送锁定的任务在新版本中仍保持承诺时间不可移动，
          原版本 V{version.version} 完整保留用于核对。
        </p>
        <Input.TextArea
          autoFocus
          rows={3}
          placeholder="请填写调班原因（必填），如：客户要求改到下午、车辆保养换车…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          showCount
          maxLength={120}
        />
      </Modal>
    </div>
  );
}
