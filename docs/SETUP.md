# 部署與 GitHub App 設定

整個流程大約 15 分鐘。需要：GitHub 帳號、Cloudflare 帳號（免費方案即可）、Node.js 22 以上。

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

| 名稱 | 值從哪來 |
|---|---|
| `GITHUB_CLIENT_ID` | **GitHub 產生**：App 設定頁 General 的 Client ID（`Iv23` 開頭，不是純數字的 App ID） |
| `GITHUB_CLIENT_SECRET` | **GitHub 產生**：App 設定頁 General → Client secrets → Generate a new client secret。**不能自己打** |
| `SESSION_SECRET` | 自己決定，只存在 Worker |
| `WEBHOOK_SECRET` | 自己決定，但 App 設定頁的 Webhook secret 必須填同一串 |

> 登入出現「The client_id and/or client_secret passed are incorrect」＝前兩個值不對，重新產生 secret 再設一次即可（secret 設定後立即生效，不用重新部署）。

## 3-1. 啟用 webhook 自動化（狀態修正、轉換規則、父任務自動完成）

自動化要以 App 自己的身分修改 issue，所以需要 App 的私鑰。不設定的話登入和一般操作照常可用，只是沒有自動化。

1. App 設定頁 General 最下方 **Private keys** → **Generate a private key**，會下載一個 `.pem` 檔。
2. 同一頁上方的 **App ID**（純數字）填進 `wrangler.toml` 的 `GITHUB_APP_ID`。
3. 把私鑰設成 secret（直接從檔案讀入，避免複製貼上出錯）：
   ```bash
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/你的app名稱.*.private-key.pem
   ```
4. 確認 App 設定頁 **Permissions & events → Subscribe to events** 有勾 `Issues` 和 `Sub issues`，Webhook 為 Active。
5. `npm run deploy`。

> 私鑰檔下載後請妥善保管或刪除，它等同 App 的密碼。

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
