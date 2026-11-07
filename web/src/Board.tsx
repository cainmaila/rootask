import type { ProjectCtx } from "./ProjectView";
import { isOverdue, todayLocal } from "../../shared/meta";
import { ancestry } from "../../shared/board";
import { useSync } from "./sync";

interface Props {
  ctx: ProjectCtx;
  /** 狀態 id → 欄內的任務（已照任務樹順序） */
  columns: Map<string, number[]>;
  selected: number | null;
  select: (n: number) => void;
}

/** 看板（#43、#82）：欄位＝自訂狀態，卡片＝任務 */
export function Board({ ctx, columns, selected, select }: Props) {
  const statuses = ctx.cfg.config.statuses;
  return (
    <div className="board" role="list" aria-label="看板">
      {statuses.map((s) => {
        const cards = columns.get(s.id) ?? [];
        return (
          <section key={s.id} className={`board-col cat-${s.category}`} role="listitem" aria-label={s.name}>
            <header className="board-col-head">
              <span className={`pill cat-${s.category}`}>{s.name}</span>
              <span className="muted small">{cards.length}</span>
            </header>
            <ul className="board-cards">
              {cards.map((n) => (
                <BoardCard key={n} ctx={ctx} n={n} selected={selected === n} select={select} />
              ))}
              {cards.length === 0 && <li className="board-empty muted small">沒有任務</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ ctx, n, selected, select }: { ctx: ProjectCtx; n: number; selected: boolean; select: (n: number) => void }) {
  const task = ctx.tree.byNumber.get(n)!;
  const syncing = useSync().tasks.has(n);
  const tree = ctx.tree;
  const parentOf = (k: number) => {
    const p = tree.byNumber.get(k)?.parent ?? null;
    return p !== null && tree.byNumber.has(p) ? p : null;
  };
  const up = ancestry(n, parentOf);
  const kids = tree.children.get(n) ?? [];
  const kidTotal = Math.max(task.childTotal, kids.length);
  const closed = task.state === "CLOSED";
  const overdue = !closed && !!task.meta.due && isOverdue(task.meta.due, todayLocal());

  return (
    <li className={`board-card ${selected ? "sel" : ""} ${syncing ? "syncing" : ""}`} aria-busy={syncing} data-card={n}>
      <button className="board-card-main" onClick={() => select(n)}>
        {up.numbers.length > 0 && (
          <span className="board-crumb muted small">
            {up.truncated && "… › "}
            {up.numbers.map((p) => tree.byNumber.get(p)!.title).join(" › ")}
          </span>
        )}
        <span className="board-title">{task.title}</span>
        <span className="board-meta">
          <span className="muted small">#{n}</span>
          {task.meta.due && (
            <span className={`due small ${overdue ? "overdue" : ""}`} title="預計截止">
              {task.meta.due.slice(5).replace("-", "/")}
            </span>
          )}
          {kidTotal > 0 && (
            <span className="muted small" title={`已完成 ${task.childCompleted}／共 ${kidTotal} 個子任務`}>
              {task.childCompleted}/{kidTotal}
            </span>
          )}
          {syncing && <span className="spinner" title="同步中" aria-label="同步中" />}
          <span className="board-people">
            {task.assignees.slice(0, 3).map((a) => (
              <img key={a.login} className="avatar" src={a.avatarUrl} alt={a.login} title={a.login} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}
