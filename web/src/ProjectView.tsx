import { useCallback, useEffect, useState } from "react";
import { loadConfig, saveConfig, type LoadedConfig } from "./config";
import { Settings } from "./Settings";
import { TaskDetail } from "./TaskDetail";
import { TaskNode } from "./TaskNode";
import { createTask, listAssignable, loadTree, myPermission, type Person, type TaskTree } from "./tasks";

export interface ProjectCtx {
  owner: string;
  repo: string;
  cfg: LoadedConfig;
  tree: TaskTree;
  people: Person[];
  permission: string;
  reload: () => Promise<void>;
}

export function ProjectView({ owner, repo }: { owner: string; repo: string }) {
  const [ctx, setCtx] = useState<Omit<ProjectCtx, "reload"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"tasks" | "settings">("tasks");
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [cfg, tree, people, permission] = await Promise.all([
        loadConfig(owner, repo),
        loadTree(owner, repo),
        listAssignable(owner, repo),
        myPermission(owner, repo),
      ]);
      setCtx({ owner, repo, cfg, tree, people, permission });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [owner, repo]);

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
    try {
      await createTask(owner, repo, title, null, ctx!.cfg.config);
      setNewTitle("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function initProject() {
    setBusy(true);
    try {
      await saveConfig(owner, repo, ctx!.cfg.config, null, "Rootask：初始化專案設定");
      await reload();
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
            {roots.length === 0 && <p className="muted empty">還沒有任務，從上面新增第一個吧。</p>}
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
                />
              ))}
            </ul>
          </section>
          {selected !== null && ctx.tree.byNumber.has(selected) && (
            <TaskDetail key={selected} n={selected} ctx={full} close={() => setSelected(null)} />
          )}
        </div>
      )}
    </main>
  );
}
