# 司机运力承诺台（配送任务拖拽排班）

- 行业：物流
- 技术栈：React、Vite、TypeScript、Ant Design、dnd-kit、zustand
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

## 功能

- 订单登记：商圈、装卸分钟、重量、可送达时段
- 司机维护：班次、载重
- 拖拽排班：拖入司机泳道即按顺序重算承诺到达时间；超时（超出可送达时段/班次）或累计超载 → 整单拒绝，冲突列表列出订单、司机、超时分钟、超出重量
- 连续作业满 4 小时自动插入 30 分钟休息，休息块不覆盖已锁定任务
- 送达后任务锁定；调班需填写原因，生成新派单版本，原派单保留可回看
- 数据持久化在 localStorage，只存事实（订单、司机、停靠序列、版本），承诺时间由规则引擎重算，刷新后排班与承诺一致

## 分层（规则 / 持久化 / 界面分离）

- `src/domain/` 规则层（纯函数）：`types.ts` 领域模型，`rules.ts` 时间线重算、休息插入、冲突评估、插入校验
- `src/store/` 持久化与状态：`persistence.ts`（localStorage + 种子数据），`scheduleStore.ts`（zustand，变更先校验再落盘）
- `src/components/` + `src/App.tsx` 界面层（antd + dnd-kit）
