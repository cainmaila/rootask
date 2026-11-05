import { useState } from "react";
import type { ProjectCtx } from "./ProjectView";
import { MAX_CHILDREN, MAX_DEPTH, createTask, depthOf, statusOf } from "./tasks";

interface Props {
  n: number;
  ctx: ProjectCtx;
  expanded: Set<number>;
  toggle: (n: number) => void;
  selected: number | null;
  select: (n: number) => void;
}

export function TaskNode({ n, ctx, expanded, toggle, selected, select }: Props) {
  const task = ctx.tree.byNumber.get(n)!;
  const kids = ctx.tree.children.get(n) ?? [];
  const open = expanded.has(n);
  const status = statusOf(task, ctx.cfg.config);
  const doneKids = kids.filter((k) => {
    const c = statusOf(ctx.tree.byNumber.get(k)!, ctx.cfg.config).category;
    return c === "done" || c === "cancelled";
  }).length;

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const canAddChild = depthOf(ctx.tree, n) < MAX_DEPTH && kids.length < MAX_CHILDREN;

  async function addChild() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createTask(ctx.owner, ctx.repo, title.trim(), task, ctx.cfg.config);
      setTitle("");
      setAdding(false);
      if (!open) toggle(n);
      await ctx.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className={`node ${selected === n ? "sel" : ""} cat-${status.category}`}>
        <button
          className="twisty"
          aria-label={open ? "收合" : "展開"}
          onClick={() => toggle(n)}
          style={{ visibility: kids.length ? "visible" : "hidden" }}
        >
          {open ? "▾" : "▸"}
        </button>
        <button className="node-main" onClick={() => select(n)}>
          <span className="node-title">{task.title}</span>
          <span className="node-meta">
            <span className={`pill cat-${status.category}`}>{status.name}</span>
            {kids.length > 0 && (
              <span className="muted small">
                {doneKids}/{kids.length}
              </span>
            )}
            {task.assignees.slice(0, 3).map((a) => (
              <img key={a.login} className="avatar" src={a.avatarUrl} alt={a.login} title={a.login} />
            ))}
          </span>
        </button>
        {canAddChild && (
          <button className="icon" title="新增子任務" onClick={() => setAdding((v) => !v)}>
            ＋
          </button>
        )}
      </div>
      {adding && (
        <form
          className="add-row child"
          onSubmit={(e) => {
            e.preventDefault();
            void addChild();
          }}
        >
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="子任務名稱…" disabled={busy} />
          <button className="btn small primary" disabled={busy || !title.trim()}>
            新增
          </button>
        </form>
      )}
      {open && kids.length > 0 && (
        <ul className="nodes">
          {kids.map((k) => (
            <TaskNode key={k} n={k} ctx={ctx} expanded={expanded} toggle={toggle} selected={selected} select={select} />
          ))}
        </ul>
      )}
    </li>
  );
}
