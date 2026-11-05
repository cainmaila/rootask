# 部署與 GitHub App 設定

整個流程大約 15 分鐘。需要：GitHub 帳號、Cloudflare 帳號（免費方案即可）、Node.js 20 以上。

## 1. 先部署一次 Worker，取得網址

```bash
npm install
npx wrangler login          # 開瀏覽器登入 Cloudflare
npm run deploy
```

部署完成會顯示網址，例如 `https://rootask.<你的子網域>.workers.dev`，以下稱為 **APP_URL**。
（此時還不能登入，因為還沒設定 GitHub App。）

## 2. 建立 GitHub App

打開 <https://github.com/settings/apps/new>，填寫：

| 欄位 | 值 |
|---|---|
| GitHub App name | 例如 `Rootask-Cain`（名稱是全 GitHub 唯一的，被用掉就換一個） |
| Homepage URL | APP_URL |
| Callback URL | `APP_URL/auth/callback` |
| Expire user authorization tokens | ✅ 勾選 |
| Request user authorization (OAuth) during installation | ✅ 勾選（安裝時順便登入） |
| Webhook → Active | ✅ 勾選 |
| Webhook URL | `APP_URL/api/webhook` |
| Webhook secret | 自己產生一串亂數，記下來（下一步要用） |

**Repository permissions**（其他全部保持 No access）：

| 權限 | 等級 |
|---|---|
| Contents | Read and write |
| Issues | Read and write |
| Metadata | Read-only（自動） |

**Subscribe to events**：勾 `Issues`、`Issue comment`、`Sub issues`（第二階段自動化會用到）。

**Where can this GitHub App be installed?**：先選 *Only on this account*。

按 **Create GitHub App**。建立後在 App 頁面：

1. 記下 **Client ID**。
2. 按 **Generate a new client secret**，記下 secret（只會顯示一次）。
3. 網址列 `https://github.com/settings/apps/<slug>` 的 `<slug>` 就是 App 代稱。

## 3. 設定機密並重新部署

如果 App 代稱不是 `rootask`，先改 `wrangler.toml` 的 `GITHUB_APP_SLUG`。然後：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET     # 任意 32 字元以上亂數，例如 openssl rand -hex 32
npx wrangler secret put WEBHOOK_SECRET     # 與 App 設定的 webhook secret 相同
npm run deploy
```

## 4. 安裝到測試 repo、開始使用

1. 打開 APP_URL → 「使用 GitHub 帳號登入」。
2. 按「綁定 repo」，選擇要當專案的 repo（建議先用一個測試 repo）。
3. 回到 App 重新整理，點進專案 → 「初始化專案」（會寫入 `.taskapp/config.yml` 並建立 `status:` 標籤）。

其他成員只要是該 repo 的 collaborator，登入後就會直接看到這個專案。

## 本機開發

```bash
cp .dev.vars.example .dev.vars   # 填入同樣的機密
npm run dev                      # 建置前端並用 wrangler dev 在 http://localhost:8787 執行
```

本機登入需要在 GitHub App 的 Callback URL 再加一條 `http://localhost:8787/auth/callback`（GitHub App 可以設定多個 callback）。
