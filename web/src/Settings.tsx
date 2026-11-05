import { useState } from "react";
import { CATEGORY_LABEL, saveConfig, validateConfig, type StatusCategory, type StatusDef } from "./config";
import type { ProjectCtx } from "./ProjectView";
import { setStatus, statusOf } from "./tasks";

const CATEGORIES: StatusCategory[] = ["todo", "active", "done", "cancelled"];

export function Settings({ ctx, canAdmin }: { ctx: ProjectCtx; canAdmin: boolean }) {
  const { owner, repo, cfg, tree } = ctx;
  const [rows, setRows] = useState<StatusDef[]>(cfg.config.statuses.map((s) => ({ ...s })));
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tasks = [...tree.byNumber.values()];
  const usage = (id: string) => tasks.filter((t) => statusOf(t, cfg.config).id === id);

  function patch(i: number, p: Partial<StatusDef>) {
    setRows((r) => r.map((s, j) => (j === i ? { ...s, ...p } : s)));
  }

  function move(i: number, d: -1 | 1) {
    setRows((r) => {
      const next = [...r];
      const j = i + d;
      if (j < 0 || j >= next.length) return r;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const next = validateConfig({ ...cfg.config, statuses: rows });
      const removed = cfg.config.statuses.filter((s) => !rows.some((r) => r.id === s.id));
      const fallback = next.statuses.find((s) => s.category === "todo") ?? next.statuses[0];

      // 1. 被刪除的狀態：任務改到 fallback 狀態
      for (const s of removed) {
        for (const t of usage(s.id)) await setStatus(owner, repo, t, fallback);
      }
      // 2. 類別改變：同步 open/closed
      for (const s of next.statuses) {
        const old = cfg.config.statuses.find((o) => o.id === s.id);
        if (old && old.category !== s.category) {
          for (const t of usage(s.id)) await setStatus(owner, repo, t, s);
        }
      }
      await saveConfig(owner, repo, next, cfg.sha, "Rootask：更新狀態設定");
      setMsg("已儲存");
      await ctx.reload();
    } catch (e) {
      setMsg(`儲存失敗：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!canAdmin) {
    return (
      <section className="settings">
        <p className="muted">只有專案管理者（admin / maintain）可以修改設定。</p>
        <StatusList statuses={cfg.config.statuses} />
      </section>
    );
  }

  return (
    <section className="settings">
      <h3>狀態</h3>
      <p className="muted small">
        「類別」決定任務在 GitHub 上是開啟還是關閉。刪除狀態時，使用中的任務會改成第一個「未開始」類別的狀態。
      </p>
      <table className="status-table">
        <thead>
          <tr>
            <th>順序</th>
            <th>id</th>
            <th>名稱</th>
            <th>類別</th>
            <th>任務數</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id}>
              <td>
                <button className="icon" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button className="icon" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                  ↓
                </button>
              </td>
              <td>
                <code>{s.id}</code>
              </td>
              <td>
                <input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} />
              </td>
              <td>
                <select value={s.category} onChange={(e) => patch(i, { category: e.target.value as StatusCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="muted">{usage(s.id).length}</td>
              <td>
                <button className="icon" title="刪除" disabled={rows.length <= 1} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          const id = newId.trim().toLowerCase();
          if (!/^[a-z0-9_-]+$/.test(id) || rows.some((r) => r.id === id)) {
            setMsg("id 只能用英文小寫、數字、- 和 _，且不能重複");
            return;
          }
          setRows((r) => [...r, { id, name: id, category: "active" }]);
          setNewId("");
        }}
      >
        <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="新狀態 id（例如 design）" />
        <button className="btn">加入</button>
      </form>
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? "儲存中…" : "儲存設定"}
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  );
}

function StatusList({ statuses }: { statuses: StatusDef[] }) {
  return (
    <ul>
      {statuses.map((s) => (
        <li key={s.id}>
          <span className={`pill cat-${s.category}`}>{s.name}</span> <span className="muted small">{CATEGORY_LABEL[s.category]}</span>
        </li>
      ))}
    </ul>
  );
}
