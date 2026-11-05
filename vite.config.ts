import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "web",
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // 由 main.tsx 自己註冊（含主動檢查更新），不要再注入 registerSW.js
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Rootask",
        short_name: "Rootask",
        description: "任務管理",
        lang: "zh-Hant",
        display: "standalone",
        start_url: "/",
        background_color: "#f6f5f1",
        theme_color: "#2f5d50",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        // 新版 service worker 裝好立刻接管，舊快取一併清掉
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // 登入與 API 不能被 service worker 攔成離線頁
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
      },
    }),
  ],
  server: {
    // `npm run dev:web` 時把 API 轉給 `wrangler dev`
    proxy: { "/api": "http://localhost:8787", "/auth": "http://localhost:8787" },
  },
});
