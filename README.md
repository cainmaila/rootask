# Rootask

以 GitHub repo 為完整後端的任務管理 PWA。

- 一個專案＝一個 repo；任務是 Issue，子任務是原生 sub-issues，repo 本身就是唯一的 ROOT。
- 登入、權限、資料、留言、分配人全部沿用 GitHub，伺服器只是一個無狀態的 Cloudflare Worker。
- 每個專案用 `.taskapp/config.yml` 自訂任務狀態。

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
