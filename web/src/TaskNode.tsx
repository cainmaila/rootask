import { useState } from "react";
import type { ProjectCtx } from "./ProjectView";
import { isClosing } from "./config";
import { isOverdue, todayLocal } from "../../shared/meta";
import { track, useSync } from "./sync";
import { MAX_CHILDREN, MAX_DEPTH, createTask, depthOf, statusOf } from "./tasks";

/** 拖曳排序的共用狀態，由 ProjectView 提供（#42、#54） */
export interface DragCtx {
  dragging: number | null;
  /** 目前指標所在的放置位置 */
  over: { n: number; position: "before" | "after" } | null;
  /** 手把的 onPointerDown：只有手把能開始拖曳 */
  start: (n: number, e: React.PointerEvent<HTMLElement>) => void;
  /** 鍵盤：手把上按上下鍵移動一格 */
  moveBy: (n: number, dir: -1 | 1) => void;
}

interface Props {
  n: number;
  ctx: ProjectCtx;
  expanded: Set<number>;
  toggle: (n: number) => void;
  selected: number | null;
  select: (n: number) => void;
  drag: DragCtx;
}

export function TaskNode({ n, ctx, expanded, toggle, selected, select, drag }: Props) {
  const task = ctx.tree.byNumber.get(n)!;
  const kids = ctx.tree.children.get(n) ?? [];
  const open = expanded.has(n);
  const status = statusOf(task, ctx.cfg.config);
  // 子任務數用 GitHub 的統計：隱藏已完成時，沒載入的已完成子任務也要算進去（#46）
  const kidTotal = Math.max(task.childTotal, kids.length);
  const kidDone = task.childCompleted;

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const canAddChild = depthOf(ctx.tree, n) < MAX_DEPTH && kidTotal < MAX_CHILDREN;

  async function addChild() {
    if (!title.trim()) return;
    setBusy(true);
    const t = title.trim();
    try {
      await track(
        "新增子任務",
        async () => {
          await createTask(ctx.owner, ctx.repo, t, task, ctx.cfg.config);
          await ctx.reload();
        },
        [n],
      );
      setTitle("");
      setAdding(false);
      if (!open) toggle(n);
    } catch {
      /* 頂端列顯示錯誤，保留輸入內容 */
    } finally {
      setBusy(false);
    }
  }

  // 同步中的任務：淡化並顯示轉圈，暫時不能拖曳（#53）
  const syncing = useSync().tasks.has(n);
  const isOver = drag.over?.n === n && drag.dragging !== null && drag.dragging !== n;
  const dropClass = isOver ? `drop-${drag.over!.position}` : "";

  return (
    <li className={drag.dragging === n ? "dragging" : ""}>
      <div
        className={`node ${selected === n ? "sel" : ""} cat-${status.category} ${dropClass} ${syncing ? "syncing" : ""}`}
        aria-busy={syncing}
        data-node={n}
      >
        <button
          type="button"
          className="grip"
          aria-label={`拖曳調整「${task.title}」的順序，也可以用上下鍵移動`}
          title="拖曳調整順序（也可用上下鍵）"
          disabled={syncing}
          onPointerDown={(e) => drag.start(n, e)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              drag.moveBy(n, e.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <span aria-hidden>⋮⋮</span>
        </button>
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
            {task.meta.due && (
              <span
                className={`due small ${!isClosing(status.category) && isOverdue(task.meta.due, todayLocal()) ? "overdue" : ""}`}
                title="預計截止"
              >
                {task.meta.due.slice(5).replace("-", "/")}
              </span>
            )}
            {syncing && <span className="spinner" title="同步中" aria-label="同步中" />}
            <span className={`pill cat-${status.category}`}>{status.name}</span>
            {kidTotal > 0 && (
              <span className="muted small" title={`已完成 ${kidDone}／共 ${kidTotal} 個子任務`}>
                {kidDone}/{kidTotal}
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
            <TaskNode key={k} n={k} ctx={ctx} expanded={expanded} toggle={toggle} selected={selected} select={select} drag={drag} />
          ))}
        </ul>
      )}
    </li>
  );
}
