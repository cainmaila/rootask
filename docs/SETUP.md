# 部署與 GitHub App 設定

整個流程大約 15 分鐘。需要：GitHub 帳號、Cloudflare 帳號（免費方案即可）、Node.js 22 以上。

## 1. 先部署一次 Worker，取得網址

```bash
npm install
npx wrangler login          # 開瀏覽器登入 Cloudflare（只有這個不用指定設定檔）
npm run deploy
```

第一次執行會自動從範本 `local.example/` 建立你自己的 **`local/`** 資料夾（不進 git），裡面是 `wrangler.toml` 和 `.dev.vars`。
想改網址名稱就改 `local/wrangler.toml` 的 `name`（例如 `name = "cain-tasks"`），再部署一次。

**所有個人部署的設定都只放在 `local/`**，`local.example/` 是給所有人的範本，不要動，這樣 `git pull` 更新程式時永遠不會衝突。
（請一律用 `npm run deploy`、`npm run secret` 這些指令，它們會自動指向 `local/wrangler.toml`。）

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

App 代稱不用設定，Worker 會自動查詢。設定機密：

```bash
npm run secret GITHUB_CLIENT_ID
npm run secret GITHUB_CLIENT_SECRET
npm run secret SESSION_SECRET     # 任意 32 字元以上亂數，例如 openssl rand -hex 32
npm run secret WEBHOOK_SECRET     # 與 App 設定的 webhook secret 相同
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
2. 同一頁上方的 **App ID**（純數字）填進 `local/wrangler.toml` 的 `GITHUB_APP_ID`。
3. 把私鑰設成 secret（直接從檔案讀入，避免複製貼上出錯）：
   ```bash
   npm run secret GITHUB_APP_PRIVATE_KEY < ~/Downloads/你的app名稱.*.private-key.pem
   ```
4. 確認 App 設定頁 **Permissions & events → Subscribe to events** 有勾 `Issues` 和 `Sub issues`，Webhook 為 Active。
5. `npm run deploy`。

> 私鑰檔下載後請妥善保管或刪除，它等同 App 的密碼。

## 4. 安裝到測試 repo、開始使用

1. 打開 APP_URL → 「使用 GitHub 帳號登入」。
2. 按「綁定 repo」，選擇要當專案的 repo（建議先用一個測試 repo）。
3. 回到 App 重新整理，點進專案 → 「初始化專案」（會寫入 `.taskapp/config.yml` 並建立 `status:` 標籤）。

其他成員只要是該 repo 的 collaborator，登入後就會直接看到這個專案。

## 自動部署（選用）

設定後，每次 push 到 `main` 且 CI 檢查通過，就會自動部署到 Cloudflare，不用再手動 `npm run deploy`。
沒設定時這一步會自動跳過，不影響 CI。

**1. 建立 Cloudflare API Token**

1. 打開 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**
2. 選範本 **Edit Cloudflare Workers** → **Use template**
3. Account Resources 選你的帳號；Zone Resources 可選 *All zones*（只用 workers.dev 網址的話不影響）
4. **Continue to summary** → **Create Token**，複製 token（只會顯示一次）

**2. 在 GitHub repo 設定**（repo 的 Settings → Secrets and variables → Actions）

| 類型 | 名稱 | 值 |
|---|---|---|
| Secrets 分頁 | `CLOUDFLARE_API_TOKEN` | 上一步的 token |
| Variables 分頁 | `WORKER_NAME` | 你的 Worker 名稱（和 `local/wrangler.toml` 的 `name` 相同） |
| Variables 分頁 | `GITHUB_APP_ID` | App ID（純數字，啟用 webhook 自動化才需要） |
| Secrets 或 Variables 分頁（選填） | `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare 帳號底下有多個 account 時才需要 |
| Variables 分頁（選填） | `GITHUB_APP_SLUG` | 通常不用，Worker 會自動查詢 |

設好後，到 repo 的 **Actions** 分頁找最新一次 CI，按 **Re-run all jobs** 就會部署一次。

> Worker 上用 `npm run secret` 設定的機密（client secret、私鑰等）不會被自動部署覆蓋。

## 本機開發

```bash
# 在 local/.dev.vars 填入同樣的機密（第一次執行 npm run dev 時會自動建立）
npm run dev                      # 建置前端並用 wrangler dev 在 http://localhost:8787 執行
```

本機登入需要在 GitHub App 的 Callback URL 再加一條 `http://localhost:8787/auth/callback`（GitHub App 可以設定多個 callback）。

## 從舊版更新（根目錄有 wrangler.toml 的人）

舊版的個人設定放在根目錄的 `wrangler.toml`。更新前先把它搬進 `local/`，修改就不會遺失：

```bash
mkdir -p local && mv wrangler.toml local/
git pull
npm run deploy      # 會自動修正 local/wrangler.toml 裡的相對路徑
```
