import { useRef, useState } from "react";
import { attachmentMarkdown } from "../../shared/attachments";
import { uploadAttachment } from "./attachments";

interface Props {
  owner: string;
  repo: string;
  issue: number;
  thresholdMb: number;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** 放在「📎 附加檔案」右邊的按鈕（例如送出、儲存） */
  actions?: React.ReactNode;
  onUploadingChange?: (uploading: boolean) => void;
  onError?: (msg: string) => void;
}

/** 可附加檔案的編輯框：按鈕選檔、貼上截圖、拖曳檔案，上傳後在游標處插入附件的 Markdown */
export function AttachTextarea(p: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  function insert(md: string) {
    const el = ref.current;
    const v = el ? el.value : p.value;
    const at = el?.selectionStart ?? v.length;
    const before = v.slice(0, at);
    const after = v.slice(at);
    const pre = before && !before.endsWith("\n") ? "\n" : "";
    const post = after && !after.startsWith("\n") ? "\n" : "";
    p.onChange(`${before}${pre}${md}${post}${after}`);
  }

  async function attach(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      setUploading(f.name || "圖片");
      p.onUploadingChange?.(true);
      try {
        const r = await uploadAttachment(p.owner, p.repo, p.issue, f, p.thresholdMb);
        insert(attachmentMarkdown(r));
      } catch (e) {
        p.onError?.(`上傳「${f.name}」失敗：${(e as Error).message}`);
      } finally {
        setUploading(null);
        p.onUploadingChange?.(false);
      }
    }
  }

  return (
    <div className="attach-box">
      <textarea
        ref={ref}
        rows={p.rows ?? 3}
        value={p.value}
        autoFocus={p.autoFocus}
        onChange={(e) => p.onChange(e.target.value)}
        // 上傳中不觸發 blur 儲存，避免存到一半的內容
        onBlur={() => !uploading && p.onBlur?.()}
        onPaste={(e) => {
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
        placeholder={p.placeholder}
      />
      <div className="comment-actions">
        <label className={`btn ${uploading ? "disabled" : ""}`} onMouseDown={(e) => e.preventDefault()}>
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
        {p.actions}
      </div>
    </div>
  );
}
