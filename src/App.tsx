import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import AppShell from "./ui/AppShell";

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: "#176b87", borderRadius: 8 } }}>
      <AntApp>
        <AppShell />
      </AntApp>
    </ConfigProvider>
  );
}
