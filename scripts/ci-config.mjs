// CI 部署用：依環境變數從範本產生 local/wrangler.toml。
// 需要：WORKER_NAME；選填：GITHUB_APP_ID、GITHUB_APP_SLUG（留空時 Worker 會自動查詢）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const name = process.env.WORKER_NAME?.trim();
if (!name) {
  console.error("缺少 WORKER_NAME（請在 repo 的 Actions variables 設定）");
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`WORKER_NAME 只能用英文小寫、數字和 -：${name}`);
  process.exit(1);
}

const set = (toml, key, value) => {
  const re = new RegExp(`^(${key}\\s*=\\s*)".*"`, "m");
  if (!re.test(toml)) throw new Error(`範本裡找不到 ${key}`);
  return toml.replace(re, `$1${JSON.stringify(value)}`);
};

let toml = readFileSync("local.example/wrangler.toml", "utf8");
toml = set(toml, "name", name);
toml = set(toml, "GITHUB_APP_ID", process.env.GITHUB_APP_ID?.trim() ?? "");
toml = set(toml, "GITHUB_APP_SLUG", process.env.GITHUB_APP_SLUG?.trim() ?? "");

mkdirSync("local", { recursive: true });
writeFileSync("local/wrangler.toml", toml);
console.log(`已產生 local/wrangler.toml（Worker：${name}）`);
