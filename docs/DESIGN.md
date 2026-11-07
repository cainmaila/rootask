# Rootask 設計決策

> 這份文件是專案的長期記憶。每個決策都已經和 Cain 確認過；新決策請補在對應段落並註明日期。
> 待決定的事項開成 `type:decision` issue，不要寫在這裡。

## 核心概念（2026-11-04）

- 自己的顯示介面＋自己的客製流程；**登入、權限、資料全部用 GitHub**。
- **一個專案＝一個既有的 GitHub repo**。App 不建立新 repo（不申請 Administration 權限）。
- 參與者只限該 repo 的成員（collaborator / team）。被分配人必須是成員，每個任務最多 10 位。
- **成員能做什麼跟著 GitHub 的 repo 權限**（#59、#65，2026-11-07 Cain 決定 triage 用 B）：

  | 權限 | 能做的事 |
  |---|---|
  | read | 瀏覽、留言 |
  | triage | ＋新增任務與子任務、改狀態、指派（GitHub 上 triage 能改標籤、開關 issue、指派、加 sub-issue） |
  | write／maintain／admin | ＋改標題、說明、日期、順序、父任務 |
  | maintain／admin | ＋專案設定 |

  App 依權限把做不到的欄位停用或隱藏，並在頂端提示；狀態轉換規則另外照 `.taskapp/config.yml` 判斷。
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

### 隱藏已完成（2026-11-06，#46）

- 任務樹預設只載入**未完成**的任務（GraphQL `states: OPEN`），勾「顯示已完成」才載入全部；偏好記在瀏覽器（每人、每個專案各自）。
- 未完成任務的**已關閉上層**會另外補抓（依編號、用別名一次查多張），樹不會斷。
- 正在看的任務（側邊面板、整頁）一定載入，剛改成完成時面板不會消失。
- **剛完成的任務留在清單上，重新整理才隱藏**（Cain 決定，2026-11-07，#63）：開啟專案後才變成完成的任務（不論是自己改的、自動完成的父任務，或別人改的），之後的重新載入都照樣保留，改錯了能馬上改回來。重新整理頁面、換專案，或手動把「顯示已完成」切回隱藏時才照規則隱藏。
- 子任務數「完成／總數」用 GitHub 的 `subIssuesSummary`，包含沒載入的已完成子任務。
- 設定頁統計與搬移狀態需要**所有**任務，隱藏已完成時另外載入完整清單。
- 已知限制：隱藏時拖曳排序只參考看得到的同層任務；隱藏的已完成任務在最上層的位置可能被插隊，不影響未完成任務的順序。

### 搜尋與篩選（2026-11-07，#47）

- 條件：文字（標題、說明、`#編號`，多個詞要全部符合，不分大小寫）、分配人（我／未分配／指定成員）、狀態、逾期；可同時使用。
- **保留樹狀結構**：顯示符合的任務＋它們的上層，上層淡化當作脈絡，並自動展開；篩選中仍可手動展開收合，換條件就重來。
- 篩選邏輯是純函式（`shared/filter.ts`），看板（#43）共用。
- 篩選只作用在已載入的任務：隱藏已完成時，篩選「已完成」類狀態會提示勾選「顯示已完成」。
- 篩選條件不保存，離開專案就清除。

### 任務順序（2026-11-05，#42）

- **任務樹與看板共用同一個順序**（Cain 決定）。看板每欄照任務樹順序排列；在看板上互換位置＝在任務樹中移動；不同父任務的卡片在看板上只能改狀態、不能互換。
- 同一父任務底下：GitHub 原生 sub-issues 順序（`PATCH /issues/{parent}/sub_issues/priority`，`before_id`／`after_id`），在 GitHub 網頁上看到的順序一致。
- 最上層（虛擬 ROOT）：隱藏區塊的 `rank`（數字）。沒有 rank 時以 issue 編號當 rank，新任務自然排在最後；插入時取前後兩張的中間值，**只改被移動的那一張**，多人同時調整不會互相覆蓋。
- 拖到別的任務上方／下方＝成為它的同層並放在那個位置，必要時先換父任務（照樣檢查迴圈與 8 層上限）。
- 隱藏區塊採**逐欄位合併**：改日期不會動到 rank，反之亦然。
- **只有手把能拖曳**（2026-11-07，#54）：每列前面的 `⋮⋮` 手把；列的其他地方點了是開啟、滑動是捲動，觸控時不會誤觸。手把在觸控裝置常駐顯示（36×44px），滑鼠時 hover 才出現。
- 拖曳用 Pointer Events 自己實作（`web/src/useTreeDrag.ts`），滑鼠與觸控共用；不用瀏覽器內建的 HTML5 拖放（觸控支援差、會和點擊打架）。有跟著指標的影像、放置線、接近上下緣自動捲動，Esc 取消。
- 鍵盤：手把取得焦點後按上下鍵移動一格。詳情面板的上移／下移保留。

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

### 附件（第二階段，2026-11-04；實作 2026-11-05）

- **不用 Git LFS**（會計費）。
- 小於門檻（預設 10 MB，config 的 `attachment_threshold_mb`，上限 50 MB）：commit 到專用的 **orphan 分支** `taskapp-assets`（不含任何程式碼），路徑 `attachments/<issue>/<issue>-<時間>-<亂數>-<安全檔名>`。
- 大於門檻：上傳成 **prerelease** 的附件（`taskapp-attachments-001`…，滿 1000 個開下一個，`make_latest: false`）。
  - 原計畫用草稿 release，但草稿只有寫入權限的成員看得到，唯讀成員會打不開附件，所以改用 prerelease。代價：Releases 頁多一筆，建立時關注 release 的人收到一次通知。
  - 原始檔名存在附件的 label（GitHub 附件名稱不接受非 ASCII）。
- **單檔上限 100 MB**：上傳經過 Cloudflare Worker，免費方案每次請求最多 100 MB。大檔以串流轉送，不整個讀進 Worker 記憶體。
- 留言裡存 **GitHub 原生網址**（分支 blob 網址、release 下載網址），在 GitHub 網頁上也點得開；App 顯示時改走 `/api/files?u=`，由 Worker 帶登入者 token 取回，私有 repo 的圖片也能直接顯示。
- Worker 只代理符合上述兩種格式的網址；分支附件以 `Content-Security-Policy: sandbox` 回傳，避免上傳的 HTML／SVG 在我們網域執行。
- 全部操作用登入者本人的 token，權限由 GitHub 決定。

### 日期與甘特圖（2026-11-05）

- **需要截止日，開始日也一起做**（#37）。分成兩種時間：
  - **預計時間**（預計開始、預計截止）：使用者填寫。GitHub issue 沒有原生日期欄位，存在 issue 內文最後的隱藏區塊
    `<!-- rootask:meta {"start":"2026-11-10","due":"2026-11-20"} -->`，不使用 Projects v2。日期為 `YYYY-MM-DD`。
  - **實際時間**：不需填寫，從 GitHub 紀錄推算。實際開始＝第一次進入「進行中」類別（或直接進入完成類別）的時間；實際完成＝以「完成」關閉的時間。
- 未來要能列出**甘特圖**（#38，第三階段），日期格式要為此預留。
- 優先度暫不做。

### GitHub App 必須公開（2026-11-05）

私有 App（Only on this account）只有擁有者能授權登入，其他成員會在 GitHub 授權頁得到 404。
App 一律設為公開；存取範圍仍由「安裝在哪些 repo」與「使用者自己的 repo 權限」決定。

## 對使用者隱藏 GitHub

- 介面不出現 GitHub 字樣，只有登入頁說明「使用 GitHub 帳號登入」。
- 第一次登入的授權頁與 GitHub 通知信無法避免；第二階段用 Web Push 取代通知信。

## 同步

- **進入專案、回到前景、改了設定**：全部重新讀取（設定、任務樹、可指派成員、權限、登入者）。
- **自己的操作：樂觀更新**（2026-11-07，#48）。改狀態、標題、說明、日期、分配人、父任務、順序都先在畫面上生效，
  再寫回 GitHub；成功後**只重新讀取受影響的任務**（一個 GraphQL 別名查詢，例如自己＋原本與新的父任務），
  不再重讀設定、成員、權限。原本每個動作後要 5 個以上的請求，現在是「寫入＋1 個查詢」。
  - **畫面＝讀回來的資料＋還沒寫完的修改**（#66）：App 分開保存 GitHub 讀回來的任務樹（base）與進行中的樂觀修改；
    每次讀回資料（局部重讀、回到前景的整頁重讀）都把還沒寫完的修改重新疊上去，所以不會跳回舊值。
    寫入成功、讀回來之後才拿掉那筆修改；讀回來失敗時，修改直接併進 base（GitHub 上已經是那樣）。
  - 失敗時只要拿掉那筆修改，畫面自然回到 GitHub 上的樣子，再向 GitHub 確認一次實際狀態（多步驟的操作可能只做了一半）。
    同時進行的其他操作不受影響。
  - 重試＝整個操作從頭再做一次：畫面一樣先變、欄位一樣鎖住（#70）。同一張任務同步中，詳情面板的欄位都鎖住。
  - 失敗訊息一個操作一則，各自重試或關掉，後面的不會蓋掉前面的（#67）。說明沒存到時，內容放回編輯框。
  - 改子任務狀態時，父任務的完成數一起變（#69）；「實際時間」等同步完成才讀事件紀錄（#68）。
  - 同一張任務同步中不接受下一個排序操作，避免兩個寫入的到達順序顛倒。
  - 新增任務不做樂觀更新（要等 GitHub 給編號），成功後只讀取新任務。
  - 樹的換算都是 `web/src/optimistic.ts` 裡的純函式，有單元測試。
- **別人的變更：定時檢查**（2026-11-07，#49）。畫面開著（且在前景）時每 30 秒用條件式請求
  `GET /repos/{o}/{r}/issues?state=all&sort=updated&direction=desc&per_page=50` 帶 `If-None-Match`：
  沒變動時 GitHub 回 304，不扣額度；有變動時拿最近更新的 issue 和畫面上的比 `updatedAt`，只重新讀取不一樣的
  （沒載入過的：開著的就是別人新開的；已關閉的只在「顯示已完成」時讀）。一頁 50 張都變了才整棵重讀。
  - 讀回來的資料照樣疊上還沒寫完的修改（#66）；正在打的標題、正在寫的說明不會被蓋掉；打開的任務有更新就重讀留言。
  - 別人改成完成的任務也照 #63 留在清單上到重新整理。
  - **實測（demoTask）：子任務的新增、移除、排序都不會改變 issue 的 `updated_at`**，issue 列表看不到。
    新增／移除（換父任務）會在 repo 的 issue events 留下 `sub_issue_added/removed`、`parent_issue_added/removed`，
    所以同時用條件式請求檢查 `GET /repos/{o}/{r}/issues/events`，有這類新事件就重讀相關任務。
  - **限制**：同一個父任務底下調整子任務順序，GitHub 不留事件也不改更新時間，別人排的順序要等回到前景整頁重讀才看得到。
  - 間隔可用 `localStorage["rootask:poll-ms"]` 調短（只給測試與 QA 用）。
