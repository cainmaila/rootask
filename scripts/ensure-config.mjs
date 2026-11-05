// 本機沒有 wrangler.toml 時從範本複製一份。wrangler.toml 是每個部署自己的設定，不進 git。
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync("wrangler.toml")) {
  copyFileSync("wrangler.example.toml", "wrangler.toml");
  console.log("已從 wrangler.example.toml 建立 wrangler.toml，可依需要修改 Worker 名稱等設定。");
}
