import { useEffect, useRef, useState } from "react";
import { AttachTextarea } from "./AttachTextarea";
import { Markdown } from "./Markdown";
import type { Comment } from "./tasks";

interface Props {
  c: Comment;
  owner: string;
  repo: string;
  issue: number;
  thresholdMb: number;
  /** 作者本人或 repo 管理者才能編輯、刪除（#50） */
  canManage: boolean;
  /** 回傳是否成功；失敗時編輯框留著打好的內容 */
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onError: (msg: string) => void;
  /** 編輯中的內容（null＝沒在編輯）：留言被別人刪掉時，TaskDetail 用它保住打好的字（#80） */
  onDraft: (text: string | null) => void;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("zh-TW");

/** 一則留言：顯示、編輯、刪除（#50）。刪除前在原地確認，不用瀏覽器的確認對話框 */
export function CommentItem({ c, owner, repo, issue, thresholdMb, canManage, onEdit, onDelete, onError, onDraft }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  // 開始編輯時的內容：沒改就不寫回，免得把別人剛改的蓋掉（#72）
  const base = useRef(c.body);
  const edited = !!c.updated_at && c.updated_at !== c.created_at;
  // 卸載時不清掉：留言被刪掉而卸載時，TaskDetail 還要拿得到最後的內容
  useEffect(() => onDraft(editing ? draft : null), [editing, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // 沒存到後按頂端列的「重試」存好了：關掉編輯框
  useEffect(() => {
    if (failed && editing && c.body === draft.trim()) {
      setFailed(false);
      setEditing(false);
    }
  }, [failed, editing, c.body, draft]);

  async function save() {
    const text = draft.trim();
    if (!text || text === base.current.trim() || text === c.body) {
      setEditing(false);
      return;
    }
    setEditing(false);
    setFailed(false);
    if (!(await onEdit(text))) {
      // 沒存到：打的內容放回編輯框
      setDraft(text);
      setEditing(true);
      setFailed(true);
    }
  }

  return (
    <li>
      <div className="comment-head">
        {c.user && <img className="avatar" src={c.user.avatar_url} alt="" />}
        <b>{c.user?.login ?? "已刪除的使用者"}</b>
        <span className="muted small comment-time" title={edited ? `編輯於 ${fmt(c.updated_at!)}` : undefined}>
          {fmt(c.created_at)}
          {edited && "（已編輯）"}
        </span>
        {canManage && !editing && !confirming && (
          <span className="comment-actions">
            <button
              className="link-btn small"
              onClick={() => {
                base.current = c.body;
                setDraft(c.body);
                setEditing(true);
              }}
            >
              編輯
            </button>
            <button className="link-btn small danger" onClick={() => setConfirming(true)}>
              刪除
            </button>
          </span>
        )}
      </div>
      {confirming && (
        <div className="comment-confirm" role="group" aria-label="確認刪除留言">
          <span className="small">確定要刪除這則留言？刪除後無法復原。</span>
          <button
            className="btn small danger"
            onClick={() => {
              setConfirming(false);
              void onDelete();
            }}
          >
            確定刪除
          </button>
          <button className="btn small" onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      )}
      {editing ? (
        <div
          className="comment-edit"
          onKeyDown={(e) => {
            // Esc 取消編輯（中文輸入法選字中的 Esc 不算）
            if (e.key === "Escape" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              setEditing(false);
              setFailed(false);
              setDraft(c.body);
            }
          }}
        >
          {failed && <p className="error small">留言沒有存到，內容還在編輯框裡，可以再按一次儲存。</p>}
          <AttachTextarea
            owner={owner}
            repo={repo}
            issue={issue}
            thresholdMb={thresholdMb}
            autoFocus
            value={draft}
            onChange={setDraft}
            onUploadingChange={setUploading}
            onError={onError}
            actions={
              <span className="row-gap">
                <button
                  className="btn"
                  onClick={() => {
                    setEditing(false);
                    setFailed(false);
                    setDraft(c.body);
                  }}
                >
                  取消
                </button>
                <button className="btn primary" disabled={uploading || !draft.trim()} onClick={() => void save()}>
                  儲存
                </button>
              </span>
            }
          />
        </div>
      ) : (
        <div className="comment-body">
          <Markdown text={c.body} />
        </div>
      )}
    </li>
  );
}
