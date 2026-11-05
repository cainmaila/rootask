import { useEffect, useMemo, useState } from "react";
import type { ProjectCtx } from "./ProjectView";
import {
  addComment,
  depthOf,
  listComments,
  moveBlockReason,
  moveTask,
  setStatus,
  statusOf,
  updateTask,
  type Comment,
} from "./tasks";

const MAX_ASSIGNEES = 10;

export function TaskDetail({ n, ctx, close }: { n: number; ctx: ProjectCtx; close: () => void }) {
  const task = ctx.tree.byNumber.get(n)!;
  const { owner, repo, cfg } = ctx;
  const status = statusOf(task, cfg.config);

  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listComments(owner, repo, n).then(setComments, (e: Error) => setErr(e.message));
  }, [owner, repo, n]);

  // 可移動的目標：ROOT ＋ 所有合法的父任務
  const targets = useMemo(() => {
    const all = [...ctx.tree.byNumber.values()].sort((a, b) => a.number - b.number);
    return all
      .filter((t) => t.number !== n)
      .map((t) => ({ t, reason: moveBlockReason(ctx.tree, n, t.number), depth: depthOf(ctx.tree, t.number) }));
  }, [ctx.tree, n]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await ctx.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const assigned = new Set(task.assignees.map((a) => a.login));
  function toggleAssignee(login: string) {
    const next = new Set(assigned);
    if (next.has(login)) next.delete(login);
    else if (next.size < MAX_ASSIGNEES) next.add(login);
    void run(() => updateTask(owner, repo, n, { assignees: [...next] }));
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="muted small">#{task.number}</span>
        <button className="icon" onClick={close} aria-label="關閉">
          ✕
        </button>
      </div>

      <input
        className="title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && run(() => updateTask(owner, repo, n, { title: title.trim() }))}
      />

      <label className="field">
        <span>狀態</span>
        <select
          value={status.id}
          disabled={busy}
          onChange={(e) => {
            const s = cfg.config.statuses.find((x) => x.id === e.target.value)!;
            void run(() => setStatus(owner, repo, task, s));
          }}
        >
          {cfg.config.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>父任務</span>
        <select
          value={task.parent ?? ""}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            void run(() => moveTask(owner, repo, task, v));
          }}
        >
          <option value="">（最上層）</option>
          {targets.map(({ t, reason, depth }) => (
            <option key={t.number} value={t.number} disabled={!!reason && t.number !== task.parent}>
              {"　".repeat(Math.max(0, depth - 1))}#{t.number} {t.title}
              {reason && t.number !== task.parent ? `（${reason}）` : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>分配人</span>
        <div className="people">
          {ctx.people.map((p) => (
            <button
              key={p.login}
              className={`person ${assigned.has(p.login) ? "on" : ""}`}
              disabled={busy || (!assigned.has(p.login) && assigned.size >= MAX_ASSIGNEES)}
              onClick={() => toggleAssignee(p.login)}
            >
              <img className="avatar" src={p.avatarUrl} alt="" />
              {p.login}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>說明</span>
        <textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== (task.body ?? "") && run(() => updateTask(owner, repo, n, { body }))}
          placeholder="補充說明（支援 Markdown）"
        />
      </label>

      {err && <p className="error small">{err}</p>}

      <h3>留言</h3>
      {!comments && <p className="muted small">載入中…</p>}
      <ul className="comments">
        {comments?.map((c) => (
          <li key={c.id}>
            <div className="comment-head">
              {c.user && <img className="avatar" src={c.user.avatar_url} alt="" />}
              <b>{c.user?.login ?? "已刪除的使用者"}</b>
              <span className="muted small">{new Date(c.created_at).toLocaleString("zh-TW")}</span>
            </div>
            <div className="comment-body">{c.body}</div>
          </li>
        ))}
      </ul>
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void run(async () => {
            const c = await addComment(owner, repo, n, draft.trim());
            setComments((cs) => [...(cs ?? []), c]);
            setDraft("");
          });
        }}
      >
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="寫下留言…" />
        <button className="btn primary" disabled={busy || !draft.trim()}>
          送出
        </button>
      </form>
    </aside>
  );
}
