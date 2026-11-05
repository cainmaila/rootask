import { useEffect, useMemo, useState } from "react";
import { isClosing, transitionAllowed } from "./config";
import { isOverdue, metaError, todayLocal, type TaskMeta } from "../../shared/meta";
import type { ProjectCtx } from "./ProjectView";
import { Markdown } from "./Markdown";
import { uploadAttachment } from "./attachments";
import { attachmentMarkdown } from "../../shared/attachments";
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

export function TaskDetail({ n, ctx, close }: { n: number; ctx: ProjectCtx; close: () => void }) {
  const task = ctx.tree.byNumber.get(n)!;
  const { owner, repo, cfg } = ctx;
  const status = statusOf(task, cfg.config);

  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  /** 上傳後把附件的 Markdown 接在留言草稿後面，使用者確認後再送出 */
  async function attach(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      setUploading(f.name || "圖片");
      setErr(null);
      try {
        const r = await uploadAttachment(owner, repo, n, f, cfg.config.attachment_threshold_mb ?? 10);
        const md = attachmentMarkdown(r);
        setDraft((d) => (d && !d.endsWith("\n") ? `${d}\n${md}` : `${d}${md}`));
      } catch (e) {
        setErr(`上傳「${f.name}」失敗：${(e as Error).message}`);
      } finally {
        setUploading(null);
      }
    }
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<TaskMeta>(task.meta);
  const [actual, setActual] = useState<ActualTimes | null>(null);

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

  const assigned = new Set(task.assignees.map((a) => a.login));
  function toggleAssignee(login: string) {
    const next = new Set(assigned);
    if (next.has(login)) next.delete(login);
    else if (next.size < MAX_ASSIGNEES) next.add(login);
    void run(() => updateTask(owner, repo, n, { assignees: [...next] }));
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="muted small">#{task.number}</span>
        <button className="icon" onClick={close} aria-label="關閉">
          ✕
        </button>
      </div>

      <input
        className="title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && run(() => updateTask(owner, repo, n, { title: title.trim() }))}
      />

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

      <label className="field">
        <span>說明</span>
        <textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== (task.body ?? "") && run(() => updateBody(owner, repo, n, { text: body }))}
          placeholder="補充說明（支援 Markdown）"
        />
      </label>

      {err && <p className="error small">{err}</p>}

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
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            // 直接貼上截圖
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void attach(files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              void attach(e.dataTransfer.files);
            }
          }}
          placeholder="寫下留言…（可直接貼上或拖曳檔案）"
        />
        <div className="comment-actions">
          <label className={`btn ${uploading ? "disabled" : ""}`}>
            {uploading ? `上傳中：${uploading}…` : "📎 附加檔案"}
            <input
              type="file"
              multiple
              hidden
              disabled={!!uploading}
              onChange={(e) => {
                if (e.target.files?.length) void attach(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button className="btn primary" disabled={busy || !!uploading || !draft.trim()}>
            送出
          </button>
        </div>
      </form>
    </aside>
  );
}
