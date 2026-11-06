import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, saveConfig, type LoadedConfig } from "./config";
import { Settings } from "./Settings";
import { TaskDetail } from "./TaskDetail";
import { TaskNode, type DragCtx } from "./TaskNode";
import { gh } from "./api";
import { track } from "./sync";
import {
  createTask,
  isDescendant,
  listAssignable,
  loadTree,
  moveBlockReason,
  myPermission,
  reorderTask,
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
  reload: () => Promise<void>;
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

const projectHash = (owner: string, repo: string) => `#/p/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const taskHash = (owner: string, repo: string, n: number) => `${projectHash(owner, repo)}/t/${n}`;

export function ProjectView({ owner, repo, fullTask = null }: { owner: string; repo: string; fullTask?: number | null }) {
  const [ctx, setCtx] = useState<Omit<ProjectCtx, "reload"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"tasks" | "settings">("tasks");
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<DragCtx["over"]>(null);
  const [showDone, setShowDone] = useState(() => readShowDone(owner, repo));
  const [loadingDone, setLoadingDone] = useState(false);

  // 正在看的任務一定要載入，即使已完成（剛改成完成時面板不會突然消失）
  const pinned = useRef<number[]>([]);
  pinned.current = [selected, fullTask].filter((x): x is number => x !== null);
  const showDoneRef = useRef(showDone);
  showDoneRef.current = showDone;

  const reload = useCallback(async () => {
    try {
      const [cfg, tree, people, permission, user] = await Promise.all([
        loadConfig(owner, repo),
        loadTree(owner, repo, { includeClosed: showDoneRef.current, pin: pinned.current }),
        listAssignable(owner, repo),
        myPermission(owner, repo),
        gh<{ login: string }>("/user"),
      ]);
      setCtx({ owner, repo, cfg, tree, people, permission, me: user.login });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [owner, repo]);

  async function toggleShowDone() {
    const next = !showDone;
    setShowDone(next);
    showDoneRef.current = next;
    writeShowDone(owner, repo, next);
    setLoadingDone(true);
    await reload();
    setLoadingDone(false);
  }

  useEffect(() => {
    void reload();
    // 簡易同步：回到畫面時重新讀取
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [reload]);

  if (error) return <main className="page error">讀取失敗：{error}</main>;
  if (!ctx) return <main className="page muted">載入任務中…</main>;

  const full: ProjectCtx = { ...ctx, reload };

  const parentOf = (n: number) => {
    const p = ctx.tree.byNumber.get(n)?.parent ?? null;
    return p !== null && ctx.tree.byNumber.has(p) ? p : null;
  };
  const drag: DragCtx = {
    dragging,
    setDragging,
    over,
    setOver,
    canDrop: (target) => {
      if (dragging === null || dragging === target) return false;
      if (isDescendant(ctx.tree, target, dragging)) return false; // 不能放進自己的子孫之間
      const tp = parentOf(target);
      return tp === parentOf(dragging) || !moveBlockReason(ctx.tree, dragging, tp);
    },
    drop: (target, position) => {
      const moving = dragging;
      setDragging(null);
      if (moving === null) return;
      const tree = ctx.tree;
      void track(
        "調整順序",
        async () => {
          if (await reorderTask(owner, repo, tree, moving, target, position)) await reload();
        },
        [moving],
      ).catch(() => {});
    },
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
  const roots = ctx.tree.children.get(null) ?? [];

  const toggle = (n: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  async function addRoot() {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    const config = ctx!.cfg.config;
    try {
      await track("新增任務", async () => {
        await createTask(owner, repo, title, null, config);
        await reload();
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
            <div className="tree-bar">
              <label className="check small">
                <input type="checkbox" checked={showDone} disabled={loadingDone} onChange={() => void toggleShowDone()} />
                顯示已完成{ctx.tree.closedCount > 0 && `（${ctx.tree.closedCount}）`}
              </label>
              {loadingDone && <span className="spinner" aria-label="載入中" />}
            </div>
            {roots.length === 0 && (
              <p className="muted empty">
                {!showDone && ctx.tree.closedCount > 0 ? "目前沒有未完成的任務 🎉" : "還沒有任務，從上面新增第一個吧。"}
              </p>
            )}
            <ul className="nodes">
              {roots.map((n) => (
                <TaskNode
                  key={n}
                  n={n}
                  ctx={full}
                  expanded={expanded}
                  toggle={toggle}
                  selected={selected}
                  select={setSelected}
                  drag={drag}
                />
              ))}
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
