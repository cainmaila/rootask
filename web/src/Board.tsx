import type { ProjectCtx } from "./ProjectView";
import { isOverdue, todayLocal } from "../../shared/meta";
import { ancestry, type BoardDrop } from "../../shared/board";
import { useSync } from "./sync";

/** 看板的拖曳狀態，由 ProjectView 提供（#83、#84） */
export interface BoardDragCtx {
  dragging: number | null;
  over: BoardDrop | null;
  /** 手把的 onPointerDown */
  start: (n: number, e: React.PointerEvent<HTMLElement>) => void;
  /** 手把上的方向鍵：左右換欄（改狀態）、上下調整順序 */
  key: (n: number, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => void;
  /** 拖曳中：這張卡片能不能改成這個狀態（不能的欄位淡化） */
  allowed: (n: number, status: string) => boolean;
  /** 能不能拖曳（triage 以上能改狀態，#65） */
  enabled: boolean;
}

interface Props {
  ctx: ProjectCtx;
  /** 狀態 id → 欄內的任務（已照任務樹順序） */
  columns: Map<string, number[]>;
  selected: number | null;
  select: (n: number) => void;
  drag: BoardDragCtx;
  boardRef: React.RefObject<HTMLDivElement>;
}

/** 看板（#43、#82）：欄位＝自訂狀態，卡片＝任務 */
export function Board({ ctx, columns, selected, select, drag, boardRef }: Props) {
  const statuses = ctx.cfg.config.statuses;
  const over = drag.over;
  return (
    <div className="board" role="list" aria-label="看板" ref={boardRef}>
      {statuses.map((s) => {
        const cards = columns.get(s.id) ?? [];
        let state = "";
        if (drag.dragging !== null) {
          if (over?.kind === "status" && over.status === s.id) state = over.ok ? "drop-target" : "drop-no";
          else if (!drag.allowed(drag.dragging, s.id)) state = "no-drop";
        }
        return (
          <section
            key={s.id}
            className={`board-col cat-${s.category} ${state}`}
            role="listitem"
            aria-label={s.name}
            data-col={s.id}
          >
            <header className="board-col-head">
              <span className={`pill cat-${s.category}`}>{s.name}</span>
              <span className="muted small">{cards.length}</span>
            </header>
            <ul className="board-cards">
              {cards.map((n) => (
                <BoardCard key={n} ctx={ctx} n={n} selected={selected === n} select={select} drag={drag} />
              ))}
              {cards.length === 0 && <li className="board-empty muted small">沒有任務</li>}
            </ul>
            {state === "drop-no" && <p className="board-hint small">轉換規則不允許改成「{s.name}」</p>}
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  ctx,
  n,
  selected,
  select,
  drag,
}: {
  ctx: ProjectCtx;
  n: number;
  selected: boolean;
  select: (n: number) => void;
  drag: BoardDragCtx;
}) {
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

  const over = drag.over;
  let dropClass = "";
  if (drag.dragging !== null && drag.dragging !== n && over?.kind === "reorder" && over.n === n) {
    dropClass = over.ok ? `drop-${over.position}` : "drop-no";
  }

  return (
    <li
      className={`board-card ${selected ? "sel" : ""} ${syncing ? "syncing" : ""} ${drag.dragging === n ? "dragging" : ""} ${dropClass}`}
      aria-busy={syncing}
      data-card={n}
      data-hint={dropClass === "drop-no" ? "不同父任務，不能互換位置" : undefined}
    >
      {drag.enabled && (
        <button
          type="button"
          className="grip board-grip"
          aria-label={`拖曳「${task.title}」換欄或調整順序，也可以用方向鍵`}
          title="拖曳換欄（改狀態）或調整順序；也可以用方向鍵"
          // 同步中不能用 disabled：會把鍵盤焦點踢走（#56）
          aria-disabled={syncing}
          onPointerDown={(e) => !syncing && drag.start(n, e)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              if (!syncing) drag.key(n, e.key);
            }
          }}
        >
          <span aria-hidden>⋮⋮</span>
        </button>
      )}
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
