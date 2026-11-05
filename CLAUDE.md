# Rootask — Claude 工作約定

這個 repo 由 Claude 主導開發，Cain（cainmaila）是產品負責人。
**所有回覆、文件、issue、commit 訊息一律用繁體中文**（專有名詞除外）。

## 記憶與任務拆解：都放在 GitHub

這個專案本身就是「以 GitHub 為後端的任務管理」，所以開發過程也用同一套結構，順便吃自己的狗糧：

- **Issues ＝ 任務**，用原生 sub-issues 拆成樹。#1（第一階段）、#2（第二階段）是 epic。
- **Milestones ＝ 階段**。
- **狀態用 `status:` 標籤**：`status:todo` → `status:doing` → `status:review` → `status:done`（done 時關閉 issue）。
  `status:review` 代表需要 Cain 確認。同一個 issue 只能有一個 `status:` 標籤。
- **類型**：`type:epic`、`type:feature`、`type:spike`（需實測的風險）、`type:docs`、`type:decision`（等 Cain 決定，不要自己決定）。
- **設計決策**記在 `docs/DESIGN.md`；新決策要寫進去，並在相關 issue 留言連過去。

### 每次開始工作時

1. 讀 `docs/DESIGN.md`。
2. 列出開著的 issue（`gh api repos/cainmaila/rootask/issues?state=open`），找 `status:doing` 的接著做，沒有再從目前 milestone 的 `status:todo` 挑。
3. 開工時把 issue 改成 `status:doing`；做完在 issue 留言寫結果（做了什麼、怎麼驗證、留下的問題），改成 `status:done` 並關閉。
4. commit 訊息引用 issue：`#6 任務樹：支援移動到 ROOT`，完成用 `Closes #6`。
5. 過程中發現的新工作，開新 issue 掛到對應 epic 底下，不要只記在對話裡。

> 注意：這個開發環境的 `gh` 無法使用 GraphQL，只能用 REST（`gh api repos/cainmaila/rootask/...`）。
> App 本身在正式環境會使用 GraphQL，不受此限。

## 技術概要

- `worker/`：Cloudflare Worker（無狀態）。GitHub 登入、加密 cookie、`/api/gh/*` 代理、webhook。
- `web/`：React + Vite PWA，由 Worker 的 static assets 服務，同網域。
- 部署：`npm run deploy`（wrangler）。

## 驗證

改完程式至少跑：`npm run typecheck && npm test && npm run build`。
自動化邏輯的測試用 `tests/fake-github.ts`（記憶體中的假 GitHub），新增規則時請一併加測試。
