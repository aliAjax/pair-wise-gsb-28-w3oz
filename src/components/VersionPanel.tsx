import { Collapse, Empty, Tag } from "antd";
import { useScheduleStore } from "../store/scheduleStore";
import { formatDateTime } from "./timeUtils";

/** 派单版本：每次调班带原因生成新版本，原派单完整保留可回看 */
export function VersionPanel() {
  const versions = useScheduleStore((state) => state.versions);
  const drivers = useScheduleStore((state) => state.drivers);

  if (versions.length === 0) {
    return (
      <section className="panel">
        <h2>派单版本</h2>
        <Empty description="尚未发生调班，首次调班时将留存原派单为 V1" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </section>
    );
  }

  const ordered = [...versions].sort((a, b) => b.version - a.version);

  return (
    <section className="panel">
      <h2>派单版本（{versions.length}）</h2>
      <Collapse
        size="small"
        items={ordered.map((version) => ({
          key: version.version,
          label: (
            <span>
              <Tag color={version.version === versions.length ? "green" : "default"}>
                V{version.version}
              </Tag>
              {version.reason}
              <span className="version-time"> · {formatDateTime(version.createdAt)}</span>
            </span>
          ),
          children: (
            <ul className="version-plans">
              {drivers.map((driver) => {
                const orderNos = version.plans[driver.id] ?? [];
                if (orderNos.length === 0) return null;
                return (
                  <li key={driver.id}>
                    <b>{driver.name}</b>：{orderNos.join(" → ")}
                  </li>
                );
              })}
            </ul>
          ),
        }))}
      />
    </section>
  );
}
