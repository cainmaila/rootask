// 附件網址與檔名的規則，前端與 Worker 共用。

export const ASSET_BRANCH = "taskapp-assets";

/** 檔名只留安全字元（GitHub release 附件名稱不接受非 ASCII），原始檔名另外保存 */
export function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 10) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "file"}${ext ? "." + ext.toLowerCase() : ""}`;
}

export const BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/taskapp-assets\/(attachments\/.+)$/;
export const RELEASE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/(taskapp-attachments-\d+)\/([^/]+)$/;

/** 只接受我們自己產生的附件網址，避免被當成任意 GitHub 代理 */
export function parseAttachmentUrl(u: string):
  | { kind: "branch"; owner: string; repo: string; path: string }
  | { kind: "release"; owner: string; repo: string; tag: string; name: string }
  | null {
  let m = u.match(BLOB_RE);
  if (m) return { kind: "branch", owner: m[1], repo: m[2], path: m[3] };
  m = u.match(RELEASE_RE);
  if (m) return { kind: "release", owner: m[1], repo: m[2], tag: m[3], name: decodeURIComponent(m[4]) };
  return null;
}


/** App 內顯示附件時改走 Worker（私有 repo 也能看）；不是附件的網址原樣回傳 */
export function viewUrl(u: string): string {
  return parseAttachmentUrl(u) ? `/api/files?u=${encodeURIComponent(u)}` : u;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
export const isImageName = (name: string) => IMAGE_EXT.test(name);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 上傳完成後插入留言的 Markdown；圖片直接顯示，其他檔案是連結 */
export function attachmentMarkdown(r: { url: string; name: string; size: number }): string {
  const label = r.name.replace(/[\[\]]/g, "");
  return isImageName(r.name) ? `![${label}](${r.url})` : `[📎 ${label}（${formatSize(r.size)}）](${r.url})`;
}
