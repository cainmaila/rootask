# Rootask 設計決策

> 這份文件是專案的長期記憶。每個決策都已經和 Cain 確認過；新決策請補在對應段落並註明日期。
> 待決定的事項開成 `type:decision` issue，不要寫在這裡。

## 核心概念（2026-11-04）

- 自己的顯示介面＋自己的客製流程；**登入、權限、資料全部用 GitHub**。
- **一個專案＝一個既有的 GitHub repo**。App 不建立新 repo（不申請 Administration 權限）。
- 參與者只限該 repo 的成員（collaborator / team）。被分配人必須是成員，每個任務最多 10 位。
- 盡量**零成本**：GitHub Free ＋ Cloudflare Workers 免費方案。

## 架構

| 層 | 做法 |
|---|---|
| 介面 | Web App（PWA），React + Vite |
| 伺服器 | 一個**無狀態** Cloudflare Worker，同網域服務前端靜態檔 |
| 登入 | GitHub App 的 user authorization。Worker 換 token 後以 AES-GCM 加密存進 HttpOnly cookie，前端拿不到 token。開啟 token 過期，Worker 自動用 refresh token 換新 |
| API | 前端呼叫 `/api/gh/*`，Worker 帶上 token 轉給 `api.github.com`。讀取樹用 GraphQL，寫入用 REST |
| 自動化 | 由 GitHub App webhook 送到 Worker 處理（**不用 GitHub Actions**，不需 Workflows 權限、規則集中一處） |

GitHub App 權限（第一階段）：Metadata: read、Issues: write、Contents: write。

## 資料對應

| Rootask | GitHub |
|---|---|
| 任務 | Issue |
| 子任務 | 原生 sub-issues |
| ROOT | **repo 本身（虛擬）**，沒有父任務的 issue 就是 ROOT 的子節點 |
| 狀態 | `status:<id>` 標籤，搭配 open/closed |
| 留言 | Issue comments |
| 分配人 | Assignees |
| 專案設定 | repo 內 `.taskapp/config.yml` |
| 階段 | Milestones（之後才會用到） |

不使用 Projects v2（它掛在使用者／組織底下，不屬於 repo）。看板由自己的介面畫。

### 任務樹（2026-11-04）

- 以 GitHub 原生 sub-issues 為準：**最多 8 層、每個父任務最多 100 個子任務**。ROOT 是虛擬的，不佔層數也不受 100 個限制。
- 移動節點：換父層用 `replace_parent: true`；移到 ROOT 就是解除父關係。
- 介面必須擋：移到自己或子孫底下（迴圈）、移動後超過 8 層。
- 程式把父子關係包在 `web/src/tasks.ts`，日後若要超過 8 層可以換成自訂存法。

### 狀態（2026-11-04）

每個專案在 `.taskapp/config.yml` 自由定義狀態：

```yaml
version: 1
statuses:
  - { id: todo, name: 待處理, category: todo }
  - { id: doing, name: 進行中, category: active }
  - { id: review, name: 待審核, category: active }
  - { id: done, name: 完成, category: done }
  - { id: dropped, name: 放棄, category: cancelled }
```

- `id` 存在標籤上（`status:review`），`name` 只是顯示名稱，改名不影響任務。
- 類別決定 GitHub 原生狀態：`done` → closed（completed）、`cancelled` → closed（not_planned）、其他 → open。
- 刪除狀態時，使用中的任務先移到別的狀態；改類別時同步 open/closed。
- 只有 admin / maintain 可以在介面改設定。
- 沒有 `status:` 標籤的 issue，依 open/closed 推斷。

### 狀態轉換規則與父任務自動完成（第二階段，2026-11-04）

- 兩者都由設定檔開關。
- 轉換規則可限制誰能做哪個轉換；違規（例如直接在 GitHub 網頁改）由 webhook 還原並留言。
- 子任務全部完成時，父任務自動完成，**但遵守轉換規則**：若父任務的完成需要核准，就停在需要核准的狀態並通知，不直接完成。子任務被重開時，自動推進的父任務跟著退回。

#### 實作細節（2026-11-05）

- 規則格式：`{ from: <狀態 id 或 "*">, to: <狀態 id>, allowed: "none" | [write|maintain|admin（含以上）|"@帳號"] }`。沒有符合的規則＝允許；有符合的規則時任一條允許就允許。
- 「核准關卡」：若有一條規則是「從特定狀態 S（不是 `*`）進入第一個完成類別狀態」且限定人員，自動完成時就停在 S。
- 自動推進的父任務會加上 `rootask:auto` 標籤；子任務重開時只退回有這個標籤的父任務；有人手動改父任務狀態時移除標籤。
- webhook 以 App 身分（bot）修改；所有 `sender.type === "Bot"` 的事件略過，避免迴圈。
- 轉換規則的「上一個狀態」從 issue 事件紀錄推算（webhook 本身不帶舊狀態）。
- 介面端先隱藏不允許的選項，伺服器端（webhook）再檢查一次，涵蓋直接在 GitHub 網頁上操作的情況。
- 共用邏輯在 `shared/rules.ts`，前端和 Worker 都用它。

### 附件（第二階段，2026-11-04）

- **不用 Git LFS**（會計費）。
- 小於門檻（預設 10 MB，config 可調）：commit 到專用分支 `taskapp-assets`。
- 大於門檻（最大 2 GB）：上傳成 Release 附件（不限總容量與頻寬），App 自動管理專用 release，滿 1000 個附件開下一個；優先試草稿 release。
- 私有 repo 的附件經 Worker 代理下載。

### 日期與甘特圖（2026-11-05）

- **需要截止日，開始日也一起做**（#37）。分成兩種時間：
  - **預計時間**（預計開始、預計截止）：使用者填寫。GitHub issue 沒有原生日期欄位，存在 issue 內文最後的隱藏區塊
    `<!-- rootask:meta {"start":"2026-11-10","due":"2026-11-20"} -->`，不使用 Projects v2。日期為 `YYYY-MM-DD`。
  - **實際時間**：不需填寫，從 GitHub 紀錄推算。實際開始＝第一次進入「進行中」類別（或直接進入完成類別）的時間；實際完成＝以「完成」關閉的時間。
- 未來要能列出**甘特圖**（#38，第三階段），日期格式要為此預留。
- 優先度暫不做。

## 對使用者隱藏 GitHub

- 介面不出現 GitHub 字樣，只有登入頁說明「使用 GitHub 帳號登入」。
- 第一次登入的授權頁與 GitHub 通知信無法避免；第二階段用 Web Push 取代通知信。

## 同步

第一版：畫面回到前景時重新讀取。之後加 ETag 條件式請求（304 不扣額度）與 webhook 推播。
