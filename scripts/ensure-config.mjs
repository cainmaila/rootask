// 確保 local/ 裡有個人部署設定。local/ 不進 git，範本在 local.example/。
// 也負責把舊版放在根目錄的 wrangler.toml / .dev.vars 搬進 local/，使用者的修改不會遺失。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const say = (m) => console.log(`[rootask] ${m}`);
mkdirSync("local", { recursive: true });

/** 舊版設定的路徑是相對於根目錄，搬進 local/ 後要補上 ../ */
function fixPaths(toml) {
  return toml
    .replace(/^(\s*main\s*=\s*")(?!\.\.\/)(?:\.\/)?/m, "$1../")
    .replace(/^(\s*directory\s*=\s*")(?!\.\.\/)(?:\.\/)?/m, "$1../");
}

const target = "local/wrangler.toml";
if (!existsSync(target)) {
  if (existsSync("wrangler.toml")) {
    writeFileSync(target, fixPaths(readFileSync("wrangler.toml", "utf8")));
    say("已把根目錄的 wrangler.toml 搬到 local/wrangler.toml（保留你的修改）。根目錄那份可以刪掉。");
  } else {
    copyFileSync("local.example/wrangler.toml", target);
    say("已從範本建立 local/wrangler.toml，可依需要修改 Worker 名稱等設定。");
  }
} else {
  const cur = readFileSync(target, "utf8");
  const fixed = fixPaths(cur);
  if (fixed !== cur) {
    writeFileSync(target, fixed);
    say("已修正 local/wrangler.toml 裡的相對路徑。");
  }
}

if (!existsSync("local/.dev.vars")) {
  if (existsSync(".dev.vars")) {
    copyFileSync(".dev.vars", "local/.dev.vars");
    say("已把根目錄的 .dev.vars 複製到 local/.dev.vars。根目錄那份可以刪掉。");
  } else {
    copyFileSync("local.example/.dev.vars", "local/.dev.vars");
  }
}
