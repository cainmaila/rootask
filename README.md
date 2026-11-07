# Rootask

以 GitHub repo 為完整後端的任務管理 PWA。

- 一個專案＝一個 repo；任務是 Issue，子任務是原生 sub-issues，repo 本身就是唯一的 ROOT。
- 登入、權限、資料、留言、分配人全部沿用 GitHub，伺服器只是一個無狀態的 Cloudflare Worker。
- 每個專案用 `.taskapp/config.yml` 自訂任務狀態。

## 使用者：把自己的 repo 加進 Rootask

Rootask 是一個 GitHub App。要把某個 repo 當成專案，需要兩件事都完成：

| | 是什麼 | 誰來做 | 次數 |
|---|---|---|---|
| **安裝（Install）** | repo 的擁有者允許 Rootask 存取這個 repo | repo 所屬帳號的擁有者（個人帳號本人，或組織 owner） | 每個帳號一次 |
| **授權（Authorize）** | 你允許 Rootask 以你的身分操作 | 每位使用者自己 | 每人一次 |

Rootask 能做的事是「安裝範圍」和「你本人在 GitHub 上的權限」的交集。只登入（授權）但 repo 的擁有者沒安裝，專案清單裡就不會出現這個 repo。

### 安裝步驟

1. 登入 Rootask，按「綁定 repo」，會開啟 GitHub 的安裝頁。
2. **選擇 repo 所屬的帳號**：repo 在組織底下就選那個**組織**，在你個人帳號底下就選**個人帳號**。
3. 選 **Only select repositories** 勾要用的 repo（或 All repositories）→ **Install**。
4. 回到 Rootask 重新整理，專案清單就會出現這個 repo。

### 常見問題

- **為什麼要我把 App 加到組織？**
  因為 repo 屬於組織，存取權要由組織授與，個人登入不夠。這是 GitHub App 的正常流程。
- **按了 Install 但沒有生效／顯示 Request**
  你不是組織的 owner，按下去只會送出安裝申請。請組織 owner 核准：owner 會收到通知，也可以到 組織 **Settings → GitHub Apps** 處理；或請 owner 直接打開安裝頁替組織安裝。
- **裝好了還是看不到 repo**
  - 裝錯帳號：例如裝在個人帳號，但 repo 在組織底下。要再裝到組織一次。
  - 漏勾 repo：到 repo 所屬帳號的 **Settings → Applications**（組織是 **Settings → GitHub Apps**）→ Rootask → **Configure**，補勾 repo 後儲存。
  - 你不是這個 repo 的成員，或還沒接受 GitHub 的成員邀請。
- **別人已經裝好了，我還要裝嗎？**
  不用。同一個 repo 只要裝一次，其他成員登入並授權後就會直接看到專案。

> 自己架設 Rootask 的人：GitHub App 的 **Where can this GitHub App be installed?** 必須是 **Any account**（App 設定頁 Advanced 的 Danger zone 顯示 *Make private* 即代表已公開），其他帳號才能安裝。詳見 [SETUP](docs/SETUP.md)。

## 文件

- [設計決策](docs/DESIGN.md)
- [部署與 GitHub App 設定](docs/SETUP.md)
- 開發進度：本 repo 的 [Issues](https://github.com/cainmaila/rootask/issues)（#1 第一階段、#2 第二階段）

## 指令

```bash
npm install
npm run typecheck   # 型別檢查
npm run build       # 建置前端到 web/dist
npm run dev         # 本機執行（wrangler dev）
npm run deploy      # 部署到 Cloudflare
```
