import { useEffect, useMemo, useRef, useState } from "react";
import { isClosing, transitionAllowed } from "./config";
import { isOverdue, mergeMeta, metaError, todayLocal, type TaskMeta } from "../../shared/meta";
import type { Mutation, ProjectCtx } from "./ProjectView";
import { patchTask, reparent, withStatus } from "./optimistic";
import { AttachTextarea } from "./AttachTextarea";
import { Markdown } from "./Markdown";
import { CommentItem } from "./CommentItem";
import { dismissSyncError, track, useSync } from "./sync";
import { ApiError } from "./api";
import {
  abilitiesOf,
  actualTimes,
  addComment,
  deleteComment,
  editComment,
  depthOf,
  listComments,
  moveBlockReason,
  moveTask,
  neighbor,
  setAssignee,
  setMilestone,
  setStatus,
  statusOf,
  updateBody,
  updateTask,
  type ActualTimes,
  type Comment,
} from "./tasks";

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

const MAX_ASSIGNEES = 10;

/** 沒存到的說明草稿：切到別的任務再回來還在（#67、#71 QA 觀察） */
const failedDrafts = new Map<string, string>();

interface Props {
  n: number;
  ctx: ProjectCtx;
  close: () => void;
  /** 整頁檢視（#41）；false 為側邊面板 */
  full?: boolean;
  /** 側邊面板 → 整頁 */
  expand?: () => void;
  /** 打開別的任務（整頁時點父任務、子任務用） */
  open?: (n: number) => void;
}

export function TaskDetail({ n, ctx, close, full = false, expand, open }: Props) {
  const task = ctx.tree.byNumber.get(n)!;
  const { owner, repo, cfg } = ctx;
  const status = statusOf(task, cfg.config);
  const threshold = cfg.config.attachment_threshold_mb ?? 10;
  // 唯讀成員：可以看、可以留言，不能修改（#59）；triage：可以改狀態與指派，其他不行（#65）
  const can = abilitiesOf(ctx.permission);
  const canWrite = can.edit;

  const draftKey = `${owner}/${repo}#${n}`;
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(() => failedDrafts.get(draftKey) ?? task.body ?? "");
  const [editingBody, setEditingBody] = useState(() => failedDrafts.has(draftKey));
  const [comments, setComments] = useState<Comment[] | null>(null);
  // 編輯中的留言內容；留言被別人刪掉時保住打好的字（#80）
  const commentDrafts = useRef(new Map<number, string>());
  const [orphans, setOrphans] = useState<string[]>([]);
  useEffect(() => {
    if (!comments) return;
    const ids = new Set(comments.map((c) => c.id));
    const lost: string[] = [];
    for (const [id, text] of commentDrafts.current) {
      if (ids.has(id)) continue;
      commentDrafts.current.delete(id);
      if (text.trim()) lost.push(text);
    }
    if (lost.length) setOrphans((o) => [...o, ...lost]);
  }, [comments]);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(() =>
    failedDrafts.has(draftKey) ? "說明沒有存到，內容還在編輯框裡，可以再按一次儲存。" : null,
  );
  const [meta, setMeta] = useState<TaskMeta>(task.meta);
  const [actual, setActual] = useState<ActualTimes | null>(null);
  // 同步中（含按重試、或從列表拖曳）欄位一律鎖住，免得以為沒反應又改一次（#70）
  const syncing = useSync().tasks.has(n);
  const locked = busy || syncing;

  // 別人改了內容而自己沒在編輯時，跟著更新
  useEffect(() => {
    if (!editingBody) setBody(task.body ?? "");
  }, [task.body, editingBody]);
  // 說明沒存到後，按頂端列的「重試」存好了：關掉編輯框（#67）
  const [bodyFailed, setBodyFailed] = useState(() => failedDrafts.has(draftKey));
  useEffect(() => {
    if (bodyFailed && editingBody && (task.body ?? "") === body) {
      failedDrafts.delete(draftKey);
      setBodyFailed(false);
      setEditingBody(false);
      setErr(null);
    }
  }, [bodyFailed, editingBody, task.body, body]);
  // 失敗還原、或別人改了標題與日期時，欄位跟著更新（#48）
  // 正在打標題時不蓋掉（#49：別人同時改了標題）
  const titleRef = useRef<HTMLInputElement>(null);
  const titleBase = useRef(task.title);
  const titleCancel = useRef(false);
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(task.title);
  }, [task.title]);
  useEffect(() => setMeta(task.meta), [task.meta.start, task.meta.due]); // eslint-disable-line react-hooks/exhaustive-deps

  // 任務有更新（含別人留言，#49）就重讀留言
  useEffect(() => {
    let live = true;
    listComments(owner, repo, n).then(
      (c) => live && setComments(c),
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [owner, repo, n, task.updatedAt]);

  useEffect(() => {
    // 事件紀錄要等寫進 GitHub 才有，同步中先不讀（#68）
    if (syncing) return;
    let live = true;
    actualTimes(owner, repo, task, cfg.config).then(
      (a) => live && setActual(a),
      () => live && setActual({ start: null, end: null }),
    );
    return () => {
      live = false;
    };
    // 狀態或關閉時間變了、同步完成時才重算
  }, [owner, repo, task.number, task.state, task.closedAt, task.labels.join(","), cfg.config, syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveDates(next: TaskMeta) {
    setMeta(next);
    const e = metaError(next);
    if (e) {
      setErr(e);
      return;
    }
    // 只送有變的那一個日期：另一個以 GitHub 上最新的為準，不會把同事剛設的清掉（#79）
    const patch: Partial<TaskMeta> = {};
    if (next.start !== task.meta.start) patch.start = next.start;
    if (next.due !== task.meta.due) patch.due = next.due;
    if (Object.keys(patch).length === 0) return;
    void run("更新日期", {
      optimistic: (t) => {
        const cur = t.byNumber.get(n);
        return cur ? patchTask(t, n, { meta: mergeMeta(cur.meta, patch) }) : t;
      },
      write: () => updateBody(owner, repo, n, { meta: patch }),
    });
  }
  const overdue = !isClosing(status.category) && isOverdue(meta.due, todayLocal());

  // 可移動的目標：ROOT ＋ 所有合法的父任務
  const targets = useMemo(() => {
    const all = [...ctx.tree.byNumber.values()].sort((a, b) => a.number - b.number);
    return all
      .filter((t) => t.number !== n)
      .map((t) => ({ t, reason: moveBlockReason(ctx.tree, n, t.number), depth: depthOf(ctx.tree, t.number) }));
  }, [ctx.tree, n]);

  /**
   * 寫回 GitHub：先在畫面上生效，成功後只重新讀取這張任務（#48）；
   * 期間頂端列顯示同步中，失敗時還原並在頂端列提示（#53）
   */
  async function run(label: string, op: Omit<Mutation, "tasks"> & { tasks?: number[] }): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      await ctx.mutate(label, { tasks: [n], ...op });
      return true;
    } catch {
      return false; // 錯誤由頂端列顯示
    } finally {
      setBusy(false);
    }
  }

  // 開始編輯時的說明：存檔時只有「真的改過」才寫回，沒改就不會把別人剛改的蓋回舊值（#72）
  const bodyBase = useRef(task.body ?? "");
  function startEditBody() {
    bodyBase.current = task.body ?? "";
    setBody(task.body ?? "");
    setEditingBody(true);
  }

  async function saveBody() {
    setEditingBody(false);
    const text = body;
    if (text === bodyBase.current || text === (task.body ?? "")) {
      setBody(task.body ?? "");
      return;
    }
    const ok = await run("更新說明", {
      optimistic: (t) => patchTask(t, n, { body: text }),
      write: () => updateBody(owner, repo, n, { text }),
    });
    if (ok) failedDrafts.delete(draftKey);
    // 沒存到：打的內容放回編輯框，不會因為關掉錯誤訊息就不見（#67）
    if (!ok) {
      setBody(text);
      setEditingBody(true);
      setBodyFailed(true);
      failedDrafts.set(draftKey, text);
      setErr("說明沒有存到，內容還在編輯框裡，可以再按一次儲存。");
    }
  }

  const assigned = new Set(task.assignees.map((a) => a.login));
  function toggleAssignee(login: string) {
    const on = !assigned.has(login);
    if (on && assigned.size >= MAX_ASSIGNEES) return;
    const person = [...ctx.people, ...task.assignees].find((p) => p.login === login) ?? { login, avatarUrl: "" };
    void run("更新分配人", {
      // 樂觀更新也只動這一位：同步中收到別人加的分配人，畫面上照樣保留
      optimistic: (t) => {
        const cur = t.byNumber.get(n)?.assignees ?? [];
        const rest = cur.filter((a) => a.login !== login);
        return patchTask(t, n, { assignees: on ? [...rest, person] : rest });
      },
      write: () => setAssignee(owner, repo, n, login, on),
    });
  }

  const parent = task.parent !== null ? ctx.tree.byNumber.get(task.parent) : undefined;
  const kids = (ctx.tree.children.get(n) ?? []).map((k) => ctx.tree.byNumber.get(k)!);

  // ---------- 區塊 ----------

  const head = (
    <div className="detail-head">
      <span className="muted small">
        {full && parent && (
          <>
            <button className="link-btn" onClick={() => open?.(parent.number)}>
              #{parent.number} {parent.title}
            </button>
            {" › "}
          </>
        )}
        #{task.number}
      </span>
      <span>
        {!full && expand && (
          <button className="icon" onClick={expand} title="展開成整頁" aria-label="展開成整頁">
            ⤢
          </button>
        )}
        <button
          className="icon"
          onClick={close}
          aria-label={full ? "回到任務列表" : "關閉"}
          title={full ? "回到任務列表" : "關閉"}
        >
          {full ? "⤡" : "✕"}
        </button>
      </span>
    </div>
  );

  const titleInput = (
    <input
      ref={titleRef}
      className="title-input"
      aria-label="標題"
      readOnly={!canWrite}
      value={title}
      onFocus={() => (titleBase.current = task.title)}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        // Enter 存、Esc 取消（#76）。中文輸入法選字中的 Enter／Esc 是給輸入法的，不算
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          titleCancel.current = true;
          setTitle(task.title);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const t = title.trim();
        // 取消、清空、或沒有改（只是點了一下）：換回最新的標題，不寫回（#72）
        if (titleCancel.current || !t || t === titleBase.current.trim() || t === task.title) {
          titleCancel.current = false;
          setTitle(task.title);
          return;
        }
        void run("更新標題", {
          optimistic: (tr) => patchTask(tr, n, { title: t }),
          write: () => updateTask(owner, repo, n, { title: t }),
        });
      }}
    />
  );

  const description = (
    <div className="field">
      <span className="field-head">
        說明
        {canWrite && !editingBody && (
          <button className="link-btn small" onClick={startEditBody}>
            編輯
          </button>
        )}
      </span>
      {editingBody ? (
        <AttachTextarea
          owner={owner}
          repo={repo}
          issue={n}
          thresholdMb={threshold}
          rows={full ? 12 : 6}
          autoFocus
          value={body}
          onChange={setBody}
          onUploadingChange={setUploading}
          onError={setErr}
          placeholder="補充說明（支援 Markdown，可貼上或拖曳圖片）"
          actions={
            <span className="row-gap">
              <button
                className="btn"
                onClick={() => {
                  // 取消＝不要這段了：頂端那則失敗也拿掉，免得按重試又寫進去
                  dismissSyncError(`更新說明|${n}`);
                  failedDrafts.delete(draftKey);
                  setBodyFailed(false);
                  setErr(null);
                  setBody(task.body ?? "");
                  setEditingBody(false);
                }}
              >
                取消
              </button>
              <button className="btn primary" disabled={uploading || busy} onClick={() => void saveBody()}>
                儲存
              </button>
            </span>
          }
        />
      ) : body.trim() ? (
        <div className="description" onDoubleClick={() => canWrite && startEditBody()}>
          <Markdown text={body} />
        </div>
      ) : canWrite ? (
        <button className="description empty" onClick={startEditBody}>
          加上說明或圖片…
        </button>
      ) : (
        <p className="muted small">沒有說明</p>
      )}
    </div>
  );

  const properties = (
    <>
      <label className="field">
        <span>狀態</span>
        <select
          aria-label="狀態"
          value={status.id}
          disabled={locked || !can.triage}
          onChange={(e) => {
            const s = cfg.config.statuses.find((x) => x.id === e.target.value)!;
            void run("改狀態", {
              // 父任務的完成數也會變
              refresh: [n, ...(task.parent !== null ? [task.parent] : [])],
              optimistic: (t) => withStatus(t, n, s),
              write: () => setStatus(owner, repo, task, s),
            });
          }}
        >
          {cfg.config.statuses
            // 轉換規則不允許的選項直接不顯示（伺服器端也會再檢查一次）
            .filter((s) => transitionAllowed(cfg.config, status.id, s.id, ctx.permission, ctx.me))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>

      <label className="field">
        <span>父任務</span>
        <select
          aria-label="父任務"
          value={task.parent ?? ""}
          disabled={locked || !canWrite}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            void run("移動任務", {
              refresh: [n, task.parent, v].filter((x): x is number => x !== null),
              optimistic: (t) => reparent(t, n, v),
              write: () => moveTask(owner, repo, task, v),
            });
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

      {canWrite && (
        <div className="field">
          <span>順序（也可以用列表左側的 ⋮⋮ 手把拖曳）</span>
          <div className="row-gap">
            {([-1, 1] as const).map((dir) => {
              const nb = neighbor(ctx.tree, n, dir);
              return (
                <button
                  key={dir}
                  className="btn small"
                  disabled={locked || !nb}
                  onClick={() => nb && ctx.reorder(n, nb.target, nb.position)}
                >
                  {dir < 0 ? "↑ 上移" : "↓ 下移"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="field">
        <span>預計時間</span>
        <div className="dates">
          <label>
            開始
            <input
              type="date"
              value={meta.start ?? ""}
              max={meta.due}
              disabled={locked || !canWrite}
              onChange={(e) => saveDates({ ...meta, start: e.target.value || undefined })}
            />
          </label>
          <label className={overdue ? "overdue" : ""}>
            截止{overdue && "（已逾期）"}
            <input
              type="date"
              value={meta.due ?? ""}
              min={meta.start}
              disabled={locked || !canWrite}
              onChange={(e) => saveDates({ ...meta, due: e.target.value || undefined })}
            />
          </label>
        </div>
      </div>

      <div className="field">
        <span>實際時間（依紀錄自動計算）</span>
        <div className="actual small">
          <span>開始：{actual ? fmtTime(actual.start) : "…"}</span>
          <span>完成：{actual ? fmtTime(actual.end) : "…"}</span>
        </div>
      </div>

      {(ctx.milestones.length > 0 || task.milestone) && (
        <label className="field">
          <span>Sprint</span>
          <select
            aria-label="Sprint"
            value={task.milestone?.number ?? ""}
            disabled={locked || !can.triage}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              const m = v === null ? null : (ctx.milestones.find((x) => x.number === v) ?? null);
              void run("排入 Sprint", {
                optimistic: (t) => patchTask(t, n, { milestone: m && { number: m.number, title: m.title, state: "OPEN" } }),
                write: () => setMilestone(owner, repo, n, v),
              });
            }}
          >
            <option value="">未排入</option>
            {/* 已關閉的 Sprint 不在清單裡，但目前排在那裡時照樣顯示 */}
            {task.milestone && !ctx.milestones.some((m) => m.number === task.milestone!.number) && (
              <option value={task.milestone.number}>{task.milestone.title}（已結束）</option>
            )}
            {ctx.milestones.map((m) => (
              <option key={m.number} value={m.number}>
                {m.title}
                {m.dueOn ? `（${m.dueOn.slice(5, 10).replace("-", "/")} 截止）` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field">
        <span>分配人</span>
        <div className="people">
          {ctx.people.map((p) => (
            <button
              key={p.login}
              className={`person ${assigned.has(p.login) ? "on" : ""}`}
              disabled={!can.triage || locked || (!assigned.has(p.login) && assigned.size >= MAX_ASSIGNEES)}
              onClick={() => toggleAssignee(p.login)}
            >
              <img className="avatar" src={p.avatarUrl} alt="" />
              {p.login}
            </button>
          ))}
        </div>
      </div>

      {full && kids.length > 0 && (
        <div className="field">
          <span>子任務</span>
          <ul className="kid-list">
            {kids.map((k) => {
              const ks = statusOf(k, cfg.config);
              return (
                <li key={k.number}>
                  <button className="link-btn" onClick={() => open?.(k.number)}>
                    #{k.number} {k.title}
                  </button>
                  <span className={`pill cat-${ks.category}`}>{ks.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  // ---------- 留言（#50） ----------
  const isManager = ctx.permission === "admin" || ctx.permission === "maintain";

  /**
   * 編輯／刪除留言：畫面先變；失敗時馬上把那則換回原樣，再向 GitHub 重讀確認；重試＝從頭再做
   */
  async function commentOp(
    label: string,
    id: number,
    apply: (cs: Comment[]) => Comment[],
    write: () => Promise<unknown>,
  ): Promise<boolean> {
    const at = comments?.findIndex((x) => x.id === id) ?? -1;
    const old = at >= 0 ? comments![at] : undefined;
    const revert = (cs: Comment[]) => {
      const rest = cs.filter((x) => x.id !== id);
      if (old) rest.splice(Math.min(at, rest.length), 0, old);
      return rest;
    };
    const attempt = async (): Promise<boolean> => {
      setComments((cs) => cs && apply(cs));
      try {
        await track(label, write, [n], { retry: () => void attempt() });
        return true;
      } catch (e) {
        // 留言已被別人刪掉：不顯示「Not Found」，改由下面的提示保住打好的字（#80）
        if (e instanceof ApiError && e.status === 404) dismissSyncError(`${label}|${n}`);
        setComments((cs) => cs && revert(cs));
        listComments(owner, repo, n).then(setComments, () => {});
        return false;
      }
    };
    return attempt();
  }

  const commentSection = (
    <>
      <h3>留言</h3>
      {!comments && <p className="muted small">載入中…</p>}
      <ul className="comments">
        {comments?.map((c) => (
          <CommentItem
            key={c.id}
            c={c}
            owner={owner}
            repo={repo}
            issue={n}
            thresholdMb={threshold}
            canManage={c.user?.login === ctx.me || isManager}
            onError={setErr}
            onDraft={(text) => {
              if (text === null) commentDrafts.current.delete(c.id);
              else commentDrafts.current.set(c.id, text);
            }}
            onEdit={(body) =>
              commentOp(
                "編輯留言",
                c.id,
                (cs) => cs.map((x) => (x.id === c.id ? { ...x, body, updated_at: new Date().toISOString() } : x)),
                () => editComment(owner, repo, c.id, body),
              )
            }
            onDelete={() =>
              commentOp(
                "刪除留言",
                c.id,
                (cs) => cs.filter((x) => x.id !== c.id),
                () => deleteComment(owner, repo, c.id),
              )
            }
          />
        ))}
      </ul>
      {orphans.map((text, i) => (
        <div className="orphan-draft" role="status" key={i}>
          <p className="small">你正在編輯的留言已經被別人刪除，打好的內容還在：</p>
          <div className="orphan-text">
            <Markdown text={text} />
          </div>
          <span className="row-gap">
            <button
              className="btn small primary"
              onClick={() => {
                setDraft((d) => (d.trim() ? `${d}\n\n${text}` : text));
                setOrphans((o) => o.filter((_, j) => j !== i));
              }}
            >
              放到新留言
            </button>
            <button className="btn small" onClick={() => setOrphans((o) => o.filter((_, j) => j !== i))}>
              捨棄
            </button>
          </span>
        </div>
      ))}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          // 留言不影響任務樹，不必重新讀取
          setBusy(true);
          setErr(null);
          void track("送出留言", async () => {
            const c = await addComment(owner, repo, n, draft.trim());
            setComments((cs) => [...(cs ?? []), c]);
            setDraft("");
          }, [n])
            .catch(() => {})
            .finally(() => setBusy(false));
        }}
      >
        <AttachTextarea
          owner={owner}
          repo={repo}
          issue={n}
          thresholdMb={threshold}
          value={draft}
          onChange={setDraft}
          onUploadingChange={setUploading}
          onError={setErr}
          placeholder="寫下留言…（可直接貼上或拖曳檔案）"
          actions={
            <button className="btn primary" disabled={busy || uploading || !draft.trim()}>
              送出
            </button>
          }
        />
      </form>
    </>
  );

  const error = err && <p className="error small">{err}</p>;

  if (full) {
    return (
      <article className="detail full">
        {head}
        {titleInput}
        <div className="full-grid">
          <div className="full-main">
            {description}
            {error}
            {commentSection}
          </div>
          <div className="full-side">{properties}</div>
        </div>
      </article>
    );
  }

  return (
    <aside className="detail">
      {head}
      {titleInput}
      {properties}
      {description}
      {error}
      {commentSection}
    </aside>
  );
}
