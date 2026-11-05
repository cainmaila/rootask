import { useState } from "react";
import type { ProjectCtx } from "./ProjectView";
import { isClosing } from "./config";
import { isOverdue, todayLocal } from "../../shared/meta";
import { MAX_CHILDREN, MAX_DEPTH, createTask, depthOf, statusOf } from "./tasks";

/** 拖曳排序（#42）的共用狀態，由 ProjectView 提供 */
export interface DragCtx {
  dragging: number | null;
  setDragging: (n: number | null) => void;
  /** 目前滑鼠所在的放置位置 */
  over: { n: number; position: "before" | "after" } | null;
  setOver: (o: DragCtx["over"]) => void;
  drop: (target: number, position: "before" | "after") => void;
  /** 能不能放在這張的前後（擋自己的子孫、超過 8 層等） */
  canDrop: (target: number) => boolean;
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

  const isOver = drag.over?.n === n && drag.dragging !== null && drag.dragging !== n;
  const dropClass = isOver ? `drop-${drag.over!.position}` : "";

  return (
    <li className={drag.dragging === n ? "dragging" : ""}>
      <div
        className={`node ${selected === n ? "sel" : ""} cat-${status.category} ${dropClass}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `#${n}`);
          drag.setDragging(n);
        }}
        onDragEnd={() => {
          drag.setDragging(null);
          drag.setOver(null);
        }}
        // dragenter 和 dragover 都要 preventDefault 才算放置目標，否則放開時不會觸發 drop（#42 實測）
        onDragEnter={(e) => {
          if (drag.dragging !== null && drag.dragging !== n && drag.canDrop(n)) e.preventDefault();
        }}
        onDragOver={(e) => {
          if (drag.dragging === null || drag.dragging === n || !drag.canDrop(n)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const r = e.currentTarget.getBoundingClientRect();
          const position = e.clientY < r.top + r.height / 2 ? "before" : "after";
          if (drag.over?.n !== n || drag.over.position !== position) drag.setOver({ n, position });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drag.over?.n === n) drag.setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          // 放開當下直接用滑鼠位置判斷上／下半，不依賴 dragover 記下的狀態
          // （真實拖曳時 dragleave 可能先把它清掉，#42 實測）
          const r = e.currentTarget.getBoundingClientRect();
          const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
          drag.setOver(null);
          drag.drop(n, pos);
        }}
      >
        <span className="grip" aria-hidden title="拖曳調整順序">
          ⋮⋮
        </span>
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
            <TaskNode key={k} n={k} ctx={ctx} expanded={expanded} toggle={toggle} selected={selected} select={select} drag={drag} />
          ))}
        </ul>
      )}
    </li>
  );
}
