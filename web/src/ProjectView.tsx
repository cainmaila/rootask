import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, saveConfig, type LoadedConfig } from "./config";
import { Settings } from "./Settings";
import { FilterBar } from "./FilterBar";
import { EMPTY_FILTER, filterTasks, isFilterActive, type TaskFilter } from "../../shared/filter";
import { isClosing } from "./config";
import { todayLocal } from "../../shared/meta";
import { TaskDetail } from "./TaskDetail";
import { TaskNode, type DragCtx, type TreeView } from "./TaskNode";
import { gh } from "./api";
import { track } from "./sync";
import { useTreeDrag, type DropPosition } from "./useTreeDrag";
import { applyReorder, newlyClosed, reorderAffects, replaceTasks } from "./optimistic";
import {
  createTask,
  fetchTasks,
  isDescendant,
  listAssignable,
  loadTree,
  moveBlockReason,
  myPermission,
  neighbor,
  planReorder,
  statusOf,
  writeReorder,
  type TaskTree,
  type Person,
  type LoadedTree,
} from "./tasks";

export interface ProjectCtx {
  owner: string;
  repo: string;
  cfg: LoadedConfig;
  tree: LoadedTree;
  people: Person[];
  permission: string;
  /** 目前登入者的 GitHub 帳號 */
  me: string;
  /** 全部重新讀取（設定、任務、成員、權限） */
  reload: () => Promise<void>;
  /** 寫回 GitHub：先在畫面上生效，成功後只重新讀取受影響的任務，失敗時還原（#48） */
  mutate: (label: string, op: Mutation) => Promise<void>;
  /** 只重新讀取這幾張任務 */
  refresh: (numbers: number[]) => Promise<void>;
  /** 調整順序（拖曳、鍵盤、上移下移按鈕共用） */
  reorder: (moving: number, target: number, position: DropPosition) => void;
}

export interface Mutation {
  /** 顯示同步中的任務 */
  tasks: number[];
  /** 寫回後要重新讀取的任務（預設同 tasks）；失敗時也是還原這些 */
  refresh?: number[];
  /** 先在畫面上生效的變化 */
  optimistic?: (tree: LoadedTree) => LoadedTree;
  write: () => Promise<unknown>;
}

// 「顯示已完成」是每位使用者自己的偏好，記在瀏覽器（#46）
const showDoneKey = (owner: string, repo: string) => `rootask:show-done:${owner}/${repo}`;
function readShowDone(owner: string, repo: string): boolean {
  try {
    return localStorage.getItem(showDoneKey(owner, repo)) === "1";
  } catch {
    return false;
  }
}
function writeShowDone(owner: string, repo: string, v: boolean) {
  try {
    localStorage.setItem(showDoneKey(owner, repo), v ? "1" : "0");
  } catch {
    /* 無痕模式等情況存不了，不影響使用 */
  }
}

/** 能不能把 moving 放到 target 的前後（擋放進自己的子孫、換父任務後超過 8 層等） */
function canDropIn(tree: TaskTree, moving: number, target: number): boolean {
  if (moving === target || !tree.byNumber.has(target)) return false;
  if (isDescendant(tree, target, moving)) return false;
  const parentOf = (n: number) => {
    const p = tree.byNumber.get(n)?.parent ?? null;
    return p !== null && tree.byNumber.has(p) ? p : null;
  };
  const tp = parentOf(target);
  return tp === parentOf(moving) || !moveBlockReason(tree, moving, tp);
}

const projectHash = (owner: string, repo: string) => `#/p/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const taskHash = (owner: string, repo: string, n: number) => `${projectHash(owner, repo)}/t/${n}`;

export function ProjectView({
  owner,
  repo,
  fullTask = null,
}: {
  owner: string;
  repo: string;
  fullTask?: number | null;
}) {
  type Loaded = Omit<ProjectCtx, "reload" | "mutate" | "refresh" | "reorder">;
  const [ctx, setCtx] = useState<Loaded | null>(null);
  const ctxRef = useRef<Loaded | null>(null);
  ctxRef.current = ctx;
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"tasks" | "settings">("tasks");
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(() => readShowDone(owner, repo));
  const [loadingDone, setLoadingDone] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  // 篩選時會自動展開符合任務的上層；使用者在篩選中手動展開／收合的記在這裡，換條件就重來
  const [filterToggles, setFilterToggles] = useState<Map<number, boolean>>(new Map());
  useEffect(() => setFilterToggles(new Map()), [filter]);

  // 正在看的任務一定要載入，即使已完成（剛改成完成時面板不會突然消失）
  const pinned = useRef<number[]>([]);
  pinned.current = [selected, fullTask].filter((x): x is number => x !== null);
  const showDoneRef = useRef(showDone);
  showDoneRef.current = showDone;
  // 這次開啟後才完成的任務，留在清單上到重新整理為止，改錯了還能馬上改回來（#63）
  const keepDone = useRef(new Set<number>());

  // 畫面上的任務樹＝GitHub 讀回來的資料（base）＋還沒寫完的樂觀修改（pending）。
  // 讀回來的資料可能還不含寫到一半的修改，所以每次都重新疊上去，畫面才不會跳回舊值（#66）；
  // 失敗時只要拿掉那筆修改，畫面自然回到 GitHub 上的樣子。
  const base = useRef<LoadedTree | null>(null);
  const pending = useRef(new Map<number, (t: LoadedTree) => LoadedTree>());
  const seq = useRef(0);

  /** 依 base 與 pending 重算畫面；記下剛完成的任務（#63） */
  const render = useCallback(() => {
    setCtx((c) => {
      if (!c || !base.current) return c;
      const tree = [...pending.current.values()].reduce((t, f) => f(t), base.current);
      newlyClosed(c.tree, tree).forEach((n) => keepDone.current.add(n));
      return { ...c, tree };
    });
  }, []);

  const loadTasks = useCallback(
    () => loadTree(owner, repo, { includeClosed: showDoneRef.current, pin: [...pinned.current, ...keepDone.current] }),
    [owner, repo],
  );

  /** 全部重新讀取：進入專案、回到畫面、改了設定 */
  const reload = useCallback(async () => {
    try {
      const [cfg, tree, people, permission, user] = await Promise.all([
        loadConfig(owner, repo),
        loadTasks(),
        listAssignable(owner, repo),
        myPermission(owner, repo),
        gh<{ login: string }>("/user"),
      ]);
      base.current = tree;
      setCtx((c) => ({ owner, repo, cfg, tree: c?.tree ?? tree, people, permission, me: user.login }));
      render();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [owner, repo, loadTasks, render]);

  /** 只重新讀取這幾張任務（#48）；done 是剛寫完的修改，讀回來之後就不必再疊 */
  const refresh = useCallback(
    async (numbers: number[], done?: number) => {
      const cur = base.current;
      if (!cur) return;
      const got = numbers.length ? await fetchTasks(owner, repo, numbers, (n) => cur.byNumber.has(n)) : [];
      base.current = replaceTasks(base.current!, got);
      if (done !== undefined) pending.current.delete(done);
      render();
    },
    [owner, repo, render],
  );

  const mutateRef = useRef<ProjectCtx["mutate"] | null>(null);
  const mutate = useCallback(
    async (label: string, op: Mutation) => {
      const affected = op.refresh ?? op.tasks;
      const id = ++seq.current;
      if (op.optimistic) {
        pending.current.set(id, op.optimistic);
        render();
      }
      let written = false;
      try {
        await track(
          label,
          async () => {
            await op.write();
            written = true;
            await refresh(affected, id);
          },
          op.tasks,
          // 重試＝從頭再做一次，畫面一樣先變、欄位一樣鎖住（#70）
          { retry: () => void mutateRef.current?.(label, op).catch(() => {}) },
        );
      } catch (e) {
        if (pending.current.delete(id)) {
          // 已經寫進 GitHub、只是讀回來失敗：GitHub 上就是這個樣子，直接留在 base
          if (written && op.optimistic && base.current) base.current = op.optimistic(base.current);
          render();
        }
        // 向 GitHub 確認實際狀態（多步驟的操作可能只做了一半）
        if (!written) void refresh(affected).catch(() => {});
        throw e;
      }
    },
    [refresh, render],
  );
  mutateRef.current = mutate;

  async function toggleShowDone() {
    const next = !showDone;
    setShowDone(next);
    showDoneRef.current = next;
    writeShowDone(owner, repo, next);
    if (!next) keepDone.current.clear(); // 明確切回隱藏，就全部照規則隱藏
    setLoadingDone(true);
    try {
      base.current = await loadTasks();
      render();
    } catch (e) {
      setError((e as Error).message);
    }
    setLoadingDone(false);
  }

  /** 拖曳、鍵盤、上移下移共用：先在畫面上移好，再寫回 GitHub（#48、#53） */
  const reorder = useCallback(
    (moving: number, target: number, position: DropPosition) => {
      const tree = ctxRef.current?.tree;
      if (!tree) return;
      const plan = planReorder(tree, moving, target, position);
      if (!plan) return;
      void mutate("調整順序", {
        tasks: [moving],
        refresh: reorderAffects(tree, moving, plan),
        optimistic: (t) => applyReorder(t, moving, plan),
        write: () => writeReorder(owner, repo, tree, moving, plan),
      }).catch(() => {});
    },
    [owner, repo, mutate],
  );

  // 篩選結果在下面才算得出來，鍵盤移動時用最新的（#57）
  const visibleRef = useRef<Set<number> | null>(null);
  const rootList = useRef<HTMLUListElement>(null);

  function moveBy(n: number, dir: -1 | 1) {
    const nb = ctx && neighbor(ctx.tree, n, dir, visibleRef.current);
    if (nb) reorder(n, nb.target, nb.position);
  }

  // 手把拖曳（#54）；hook 必須在下面的提早 return 之前呼叫
  const treeDrag = useTreeDrag({
    canDrop: (moving, target) => !!ctx && canDropIn(ctx.tree, moving, target),
    drop: reorder,
    titleOf: (n) => ctx?.tree.byNumber.get(n)?.title ?? `#${n}`,
    // 最後一列下方的空白處（含手機自動捲到底時手指停在畫面底緣）＝放到最上層的最後（#61）
    fallback: (moving, x, y) => {
      const ul = rootList.current;
      if (!ul || !ctx) return null;
      const r = ul.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.bottom - 2) return null;
      const roots = [...ul.children]
        .map((li) => Number((li.querySelector(":scope > .node") as HTMLElement | null)?.dataset.node))
        .filter((k) => !Number.isNaN(k));
      const last = roots[roots.length - 1];
      if (last === undefined || last === moving || !canDropIn(ctx.tree, moving, last)) return null;
      return { n: last, position: "after", end: true };
    },
  });

  useEffect(() => {
    void reload();
    // 簡易同步：回到畫面時重新讀取
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [reload]);

  if (error) return <main className="page error">讀取失敗：{error}</main>;
  if (!ctx) return <main className="page muted">載入任務中…</main>;

  const full: ProjectCtx = { ...ctx, reload, mutate, refresh: (ns: number[]) => refresh(ns), reorder };

  // 唯讀成員不能新增、排序、修改（#59）
  const canWrite = ["admin", "maintain", "write"].includes(ctx.permission);
  const drag: DragCtx = {
    dragging: treeDrag.dragging,
    // 放到最後時，放置線畫在清單底部，不畫在最後一列上（它可能展開著子任務）
    over: treeDrag.over?.end ? null : treeDrag.over,
    start: treeDrag.start,
    moveBy,
    enabled: canWrite,
  };

  // 整頁任務檢視（#41）：網址 #/p/<owner>/<repo>/t/<n>，可直接分享
  if (fullTask !== null) {
    if (!ctx.tree.byNumber.has(fullTask)) {
      return (
        <main className="page">
          <p className="muted">找不到任務 #{fullTask}，可能已被刪除或你沒有權限。</p>
          <a href={projectHash(owner, repo)}>回到任務列表</a>
        </main>
      );
    }
    return (
      <main className="page wide">
        <TaskDetail
          key={fullTask}
          n={fullTask}
          ctx={full}
          full
          close={() => {
            setSelected(fullTask);
            location.hash = projectHash(owner, repo);
          }}
          open={(n) => (location.hash = taskHash(owner, repo, n))}
        />
      </main>
    );
  }
  const canAdmin = ctx.permission === "admin" || ctx.permission === "maintain";
  // ---------- 搜尋與篩選（#47） ----------
  const filtering = isFilterActive(filter);
  const result = filtering
    ? filterTasks(
        [...ctx.tree.byNumber.values()].map((t) => {
          const st = statusOf(t, ctx.cfg.config);
          return {
            number: t.number,
            title: t.title,
            body: t.body,
            parent: t.parent,
            assignees: t.assignees.map((a) => a.login),
            statusId: st.id,
            closed: isClosing(st.category),
            due: t.meta.due,
          };
        }),
        filter,
        ctx.me,
        todayLocal(),
      )
    : null;
  const view: TreeView | null = result && { visible: result.visible, matches: result.matches };
  visibleRef.current = view?.visible ?? null;
  const effExpanded = result
    ? new Set(
        [...ctx.tree.byNumber.keys()].filter((n) =>
          filterToggles.has(n) ? filterToggles.get(n) : result.expand.has(n) || expanded.has(n),
        ),
      )
    : expanded;
  const roots = (ctx.tree.children.get(null) ?? []).filter((n) => !view || view.visible.has(n));
  // 篩選「已完成」類的狀態，但已完成的任務被隱藏著
  const filterNeedsDone =
    !showDone &&
    !!filter.status &&
    isClosing(ctx.cfg.config.statuses.find((s) => s.id === filter.status)?.category ?? "todo");

  const toggle = (n: number) => {
    if (result) {
      setFilterToggles((m) => new Map(m).set(n, !effExpanded.has(n)));
      return;
    }
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  async function addRoot() {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    const config = ctx!.cfg.config;
    try {
      await track("新增任務", async () => {
        const n = await createTask(owner, repo, title, null, config);
        await refresh([n]);
      });
      setNewTitle("");
    } catch {
      /* 頂端列顯示錯誤，保留輸入內容 */
    } finally {
      setBusy(false);
    }
  }

  async function initProject() {
    setBusy(true);
    const config = ctx!.cfg.config;
    try {
      await track("初始化專案", async () => {
        await saveConfig(owner, repo, config, null, "Rootask：初始化專案設定");
        await reload();
      });
    } catch {
      /* 頂端列顯示錯誤 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page wide">
      <nav className="tabs">
        <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
          任務
        </button>
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
          設定
        </button>
      </nav>

      {ctx.cfg.sha === null && (
        <div className="banner">
          這個 repo 還沒有 Rootask 設定，目前使用預設狀態。
          {canAdmin ? (
            <button className="btn small" disabled={busy} onClick={initProject}>
              初始化專案
            </button>
          ) : (
            <span className="muted"> 請專案管理者初始化。</span>
          )}
        </div>
      )}

      {tab === "settings" ? (
        <Settings ctx={full} canAdmin={canAdmin} />
      ) : (
        <div className={`split ${selected !== null ? "has-detail" : ""}`}>
          <section className="tree">
            {!canWrite && (
              <p className="banner small" role="note">
                你在這個專案只有讀取權限：可以瀏覽與留言，不能新增、修改或調整順序。
              </p>
            )}
            {canWrite && (
              <form
                className="add-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addRoot();
                }}
              >
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="新增任務…"
                  disabled={busy}
                />
                <button className="btn primary" disabled={busy || !newTitle.trim()}>
                  新增
                </button>
              </form>
            )}
            <FilterBar
              filter={filter}
              onChange={setFilter}
              statuses={ctx.cfg.config.statuses}
              people={ctx.people}
              matchCount={result ? result.matches.size : null}
              showDone={showDone}
              closedCount={ctx.tree.closedCount}
              loadingDone={loadingDone}
              onToggleDone={() => void toggleShowDone()}
            />
            {filtering && roots.length === 0 && (
              <div className="muted empty">
                <p>沒有符合的任務。</p>
                {(filterNeedsDone || (!showDone && ctx.tree.closedCount > 0)) && (
                  <p>
                    {filterNeedsDone ? "這個狀態的任務已完成而被隱藏了，" : "已完成的任務被隱藏了，要找的可能在裡面，"}
                    <button className="link-btn" onClick={() => void toggleShowDone()}>
                      顯示已完成
                    </button>
                    就看得到。
                  </p>
                )}
                <button className="btn small" onClick={() => setFilter(EMPTY_FILTER)}>
                  清除篩選
                </button>
              </div>
            )}
            {!filtering && roots.length === 0 && (
              <p className="muted empty">
                {!showDone && ctx.tree.closedCount > 0 ? "目前沒有未完成的任務 🎉" : canWrite ? "還沒有任務，從上面新增第一個吧。" : "這個專案還沒有任務。"}
              </p>
            )}
            {filtering && !showDone && ctx.tree.closedCount > 0 && roots.length > 0 && (
              <p className="muted small filter-hint">
                已完成的任務沒有列入搜尋。
                <button className="link-btn" onClick={() => void toggleShowDone()}>
                  顯示已完成
                </button>
              </p>
            )}
            <ul className="nodes" ref={rootList}>
              {roots.map((n) => (
                <TaskNode
                  key={n}
                  view={view}
                  n={n}
                  ctx={full}
                  expanded={effExpanded}
                  toggle={toggle}
                  selected={selected}
                  select={setSelected}
                  drag={drag}
                />
              ))}
              {treeDrag.over?.end && <li className="drop-end" aria-hidden />}
            </ul>
          </section>
          {selected !== null && ctx.tree.byNumber.has(selected) && (
            <TaskDetail
              key={selected}
              n={selected}
              ctx={full}
              close={() => setSelected(null)}
              expand={() => (location.hash = taskHash(owner, repo, selected))}
            />
          )}
        </div>
      )}
    </main>
  );
}
