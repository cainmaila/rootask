import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

// PWA 更新：只註冊 service worker 不夠，瀏覽器不一定會去檢查新版（#39）。
// 回到前景時與每小時主動檢查；有新版時 autoUpdate 會自動啟用並重新載入頁面。
const HOUR = 60 * 60 * 1000;
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => {
      if (!navigator.onLine) return;
      reg.update().catch(() => {});
    };
    setInterval(check, HOUR);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
