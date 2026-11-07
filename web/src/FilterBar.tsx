import { useEffect, useRef } from "react";
import { EMPTY_FILTER, isFilterActive, type TaskFilter } from "../../shared/filter";
import type { StatusDef } from "./config";
import type { Person } from "./tasks";

interface Props {
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  statuses: StatusDef[];
  people: Person[];
  /** 符合的任務數；沒有篩選時為 null */
  matchCount: number | null;
  /** 「顯示已完成」切換（#46） */
  showDone: boolean;
  closedCount: number;
  loadingDone: boolean;
  onToggleDone: () => void;
}

/** 任務樹的搜尋與篩選列（#47） */
export function FilterBar(p: Props) {
  const f = p.filter;
  const set = (patch: Partial<TaskFilter>) => p.onChange({ ...f, ...patch });
  const search = useRef<HTMLInputElement>(null);
  const active = isFilterActive(f);

  // 按「/」快速跳到搜尋框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="filter-bar" role="search">
      <input
        ref={search}
        type="search"
        className="filter-search"
        value={f.text}
        onChange={(e) => set({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (f.text) set({ text: "" });
            else e.currentTarget.blur();
          }
        }}
        placeholder="搜尋任務（標題、說明、#編號）　按 / 快速搜尋"
        aria-label="搜尋任務"
      />
      <div className="filter-row">
        <select
          value={f.assignee}
          onChange={(e) => set({ assignee: e.target.value })}
          aria-label="依分配人篩選"
          className={f.assignee ? "on" : ""}
        >
          <option value="">所有人</option>
          <option value="@me">分配給我</option>
          <option value="@none">未分配</option>
          {p.people.length > 0 && (
            <optgroup label="成員">
              {p.people.map((x) => (
                <option key={x.login} value={x.login}>
                  {x.login}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          value={f.status}
          onChange={(e) => set({ status: e.target.value })}
          aria-label="依狀態篩選"
          className={f.status ? "on" : ""}
        >
          <option value="">所有狀態</option>
          {p.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className={`check small chip ${f.overdue ? "on" : ""}`}>
          <input type="checkbox" checked={f.overdue} onChange={(e) => set({ overdue: e.target.checked })} />
          逾期
        </label>
        <label className="check small chip">
          <input type="checkbox" checked={p.showDone} disabled={p.loadingDone} onChange={p.onToggleDone} />
          顯示已完成{p.closedCount > 0 && `（${p.closedCount}）`}
          {p.loadingDone && <span className="spinner" aria-label="載入中" />}
        </label>
        {active && (
          <>
            <span className="muted small filter-count" role="status">
              符合 {p.matchCount} 項
            </span>
            <button className="link-btn small" onClick={() => p.onChange(EMPTY_FILTER)}>
              清除篩選
            </button>
          </>
        )}
      </div>
    </div>
  );
}
