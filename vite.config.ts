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
