import { ApiError } from "./api";

/** 與 Worker 的 MAX_UPLOAD_BYTES 相同 */
export const MAX_UPLOAD_MB = 100;

export interface UploadResult {
  url: string;
  name: string;
  size: number;
  kind: "branch" | "release";
}

export async function uploadAttachment(
  owner: string,
  repo: string,
  issue: number,
  file: File,
  thresholdMb: number,
): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new ApiError(413, `檔案太大，單檔上限 ${MAX_UPLOAD_MB} MB`);
  const q = new URLSearchParams({
    owner,
    repo,
    issue: String(issue),
    name: file.name || "pasted-image.png",
    threshold: String(thresholdMb),
  });
  const res = await fetch(`/api/files/upload?${q}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as UploadResult;
}
