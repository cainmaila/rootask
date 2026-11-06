import { useEffect, useState } from "react";
import { CATEGORY_LABEL, saveConfig, validateConfig, type StatusCategory, type StatusDef, type Transition } from "./config";
import type { ProjectCtx } from "./ProjectView";
import { track } from "./sync";
import { loadTree, setStatus, statusOf, type Task } from "./tasks";

const CATEGORIES: StatusCategory[] = ["todo", "active", "done", "cancelled"];

export function Settings({ ctx, canAdmin }: { ctx: ProjectCtx; canAdmin: boolean }) {
  const { owner, repo, cfg, tree } = ctx;
  const [rows, setRows] = useState<StatusDef[]>(cfg.config.statuses.map((s) => ({ ...s })));
  const [newId, setNewId] = useState("");
  const [autoParent, setAutoParent] = useState(!!cfg.config.auto_complete_parent);
  const [rules, setRules] = useState<Transition[]>((cfg.config.transitions ?? []).map((t) => ({ ...t })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 統計與搬移狀態要看「所有」任務；任務樹隱藏已完成時，這裡另外載入完整清單（#46）
  const [allTasks, setAllTasks] = useState<Task[] | null>(tree.includeClosed ? [...tree.byNumber.values()] : null);
  useEffect(() => {
    if (tree.includeClosed) {
      setAllTasks([...tree.byNumber.values()]);
      return;
    }
    let alive = true;
    loadTree(owner, repo, { includeClosed: true }).then(
      (t) => alive && setAllTasks([...t.byNumber.values()]),
      (e: Error) => alive && setMsg(`讀取任務失敗：${e.message}`),
    );
    return () => {
      alive = false;
    };
  }, [owner, repo, tree]);
  const tasks = allTasks ?? [];
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
    setMsg(null);
    let next: ReturnType<typeof validateConfig>;
    try {
      const ids = new Set(rows.map((r) => r.id));
      next = validateConfig({
        ...cfg.config,
        statuses: rows,
        auto_complete_parent: autoParent,
        // 指到已刪除狀態的規則一併拿掉
        transitions: rules.filter((t) => (t.from === "*" || ids.has(t.from)) && ids.has(t.to)),
      });
    } catch (e) {
      setMsg(`設定有誤：${(e as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      await track("儲存設定", async () => {
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
        await ctx.reload();
      });
      setMsg("已儲存");
    } catch {
      /* 頂端列顯示錯誤，可重試 */
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
              <td className="muted">{allTasks ? usage(s.id).length : "…"}</td>
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
      <h3>轉換規則</h3>
      <p className="muted small">
        限制誰能把任務從某個狀態改到另一個狀態。沒寫規則的轉換都允許。「誰可以」填 <code>none</code>（禁止），
        或用逗號列出權限等級（<code>write</code>、<code>maintain</code>、<code>admin</code>，含以上）或帳號（<code>@cain</code>）。
      </p>
      <table className="status-table">
        <thead>
          <tr>
            <th>從</th>
            <th>到</th>
            <th>誰可以</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((t, i) => (
            <tr key={i}>
              <td>
                <select value={t.from} onChange={(e) => setRules((r) => r.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>
                  <option value="*">（任何狀態）</option>
                  {rows.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select value={t.to} onChange={(e) => setRules((r) => r.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                  {rows.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  defaultValue={t.allowed === "none" ? "none" : t.allowed.join(", ")}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const allowed: Transition["allowed"] =
                      v === "" || v === "none" ? "none" : v.split(",").map((x) => x.trim()).filter(Boolean);
                    setRules((r) => r.map((x, j) => (j === i ? { ...x, allowed } : x)));
                  }}
                />
              </td>
              <td>
                <button className="icon" title="刪除" onClick={() => setRules((r) => r.filter((_, j) => j !== i))}>
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn small"
        onClick={() => setRules((r) => [...r, { from: "*", to: rows.find((s) => s.category === "done")?.id ?? rows[0].id, allowed: ["maintain"] }])}
      >
        ＋ 新增規則
      </button>

      <h3>自動化</h3>
      <label className="check">
        <input type="checkbox" checked={autoParent} onChange={(e) => setAutoParent(e.target.checked)} />
        子任務全部完成時，自動推進父任務
      </label>
      <p className="muted small">
        若有規則限制「從某狀態改成完成」需要特定權限，父任務會停在那個狀態等人核准，不會直接完成。子任務被重開時，自動推進的父任務會退回。
      </p>

      <div className="actions">
        <button className="btn primary" disabled={busy || !allTasks} onClick={save}>
          {busy ? "儲存中…" : !allTasks ? "讀取任務中…" : "儲存設定"}
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
