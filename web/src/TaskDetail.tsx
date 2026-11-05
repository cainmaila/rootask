import { useEffect, useMemo, useState } from "react";
import { isClosing, transitionAllowed } from "./config";
import { isOverdue, metaError, todayLocal, type TaskMeta } from "../../shared/meta";
import type { ProjectCtx } from "./ProjectView";
import { AttachTextarea } from "./AttachTextarea";
import { Markdown } from "./Markdown";
import {
  actualTimes,
  addComment,
  depthOf,
  listComments,
  moveBlockReason,
  moveTask,
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

  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [editingBody, setEditingBody] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<TaskMeta>(task.meta);
  const [actual, setActual] = useState<ActualTimes | null>(null);

  // 別人改了內容而自己沒在編輯時，跟著更新
  useEffect(() => {
    if (!editingBody) setBody(task.body ?? "");
  }, [task.body, editingBody]);

  useEffect(() => {
    listComments(owner, repo, n).then(setComments, (e: Error) => setErr(e.message));
  }, [owner, repo, n]);

  useEffect(() => {
    actualTimes(owner, repo, task, cfg.config).then(setActual, () => setActual({ start: null, end: null }));
    // 狀態或關閉時間變了才重算
  }, [owner, repo, task.number, task.state, task.closedAt, task.labels.join(","), cfg.config]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveDates(next: TaskMeta) {
    setMeta(next);
    const e = metaError(next);
    if (e) {
      setErr(e);
      return;
    }
    if (next.start === task.meta.start && next.due === task.meta.due) return;
    void run(() => updateBody(owner, repo, n, { meta: next }));
  }
  const overdue = !isClosing(status.category) && isOverdue(meta.due, todayLocal());

  // 可移動的目標：ROOT ＋ 所有合法的父任務
  const targets = useMemo(() => {
    const all = [...ctx.tree.byNumber.values()].sort((a, b) => a.number - b.number);
    return all
      .filter((t) => t.number !== n)
      .map((t) => ({ t, reason: moveBlockReason(ctx.tree, n, t.number), depth: depthOf(ctx.tree, t.number) }));
  }, [ctx.tree, n]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await ctx.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveBody() {
    setEditingBody(false);
    if (body !== (task.body ?? "")) void run(() => updateBody(owner, repo, n, { text: body }));
  }

  const assigned = new Set(task.assignees.map((a) => a.login));
  function toggleAssignee(login: string) {
    const next = new Set(assigned);
    if (next.has(login)) next.delete(login);
    else if (next.size < MAX_ASSIGNEES) next.add(login);
    void run(() => updateTask(owner, repo, n, { assignees: [...next] }));
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
        <button className="icon" onClick={close} aria-label={full ? "回到任務列表" : "關閉"} title={full ? "回到任務列表" : "關閉"}>
          {full ? "⤡" : "✕"}
        </button>
      </span>
    </div>
  );

  const titleInput = (
    <input
      className="title-input"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() && title !== task.title && run(() => updateTask(owner, repo, n, { title: title.trim() }))}
    />
  );

  const description = (
    <div className="field">
      <span className="field-head">
        說明
        {!editingBody && (
          <button className="link-btn small" onClick={() => setEditingBody(true)}>
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
                  setBody(task.body ?? "");
                  setEditingBody(false);
                }}
              >
                取消
              </button>
              <button className="btn primary" disabled={uploading || busy} onClick={saveBody}>
                儲存
              </button>
            </span>
          }
        />
      ) : body.trim() ? (
        <div className="description" onDoubleClick={() => setEditingBody(true)}>
          <Markdown text={body} />
        </div>
      ) : (
        <button className="description empty" onClick={() => setEditingBody(true)}>
          加上說明或圖片…
        </button>
      )}
    </div>
  );

  const properties = (
    <>
      <label className="field">
        <span>狀態</span>
        <select
          value={status.id}
          disabled={busy}
          onChange={(e) => {
            const s = cfg.config.statuses.find((x) => x.id === e.target.value)!;
            void run(() => setStatus(owner, repo, task, s));
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
          value={task.parent ?? ""}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            void run(() => moveTask(owner, repo, task, v));
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

      <div className="field">
        <span>預計時間</span>
        <div className="dates">
          <label>
            開始
            <input
              type="date"
              value={meta.start ?? ""}
              max={meta.due}
              disabled={busy}
              onChange={(e) => saveDates({ ...meta, start: e.target.value || undefined })}
            />
          </label>
          <label className={overdue ? "overdue" : ""}>
            截止{overdue && "（已逾期）"}
            <input
              type="date"
              value={meta.due ?? ""}
              min={meta.start}
              disabled={busy}
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

      <div className="field">
        <span>分配人</span>
        <div className="people">
          {ctx.people.map((p) => (
            <button
              key={p.login}
              className={`person ${assigned.has(p.login) ? "on" : ""}`}
              disabled={busy || (!assigned.has(p.login) && assigned.size >= MAX_ASSIGNEES)}
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

  const commentSection = (
    <>
      <h3>留言</h3>
      {!comments && <p className="muted small">載入中…</p>}
      <ul className="comments">
        {comments?.map((c) => (
          <li key={c.id}>
            <div className="comment-head">
              {c.user && <img className="avatar" src={c.user.avatar_url} alt="" />}
              <b>{c.user?.login ?? "已刪除的使用者"}</b>
              <span className="muted small">{new Date(c.created_at).toLocaleString("zh-TW")}</span>
            </div>
            <div className="comment-body">
              <Markdown text={c.body} />
            </div>
          </li>
        ))}
      </ul>
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void run(async () => {
            const c = await addComment(owner, repo, n, draft.trim());
            setComments((cs) => [...(cs ?? []), c]);
            setDraft("");
          });
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
