// 附件（#14）：小檔 commit 到專用分支，大檔上傳成 prerelease 的附件。
// 全部以「登入者本人」的 token 操作，權限完全由 GitHub 決定。
//
// 留言裡存的是 GitHub 原生網址（在 GitHub 網頁上也點得開）：
//   小檔：https://github.com/<o>/<r>/blob/taskapp-assets/<path>
//   大檔：https://github.com/<o>/<r>/releases/download/<tag>/<asset>
// App 顯示時改走 /api/files?u=<網址>，由這裡帶 token 取回，私有 repo 也能顯示圖片。

import { ASSET_BRANCH, parseAttachmentUrl, safeName } from "../../shared/attachments";

const GH_API = "https://api.github.com";
const GH_UPLOADS = "https://uploads.github.com";

const RELEASE_PREFIX = "taskapp-attachments-";
const MAX_ASSETS_PER_RELEASE = 1000;
/** Cloudflare Workers 免費方案的請求大小上限 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** 分支上的單檔大小，超過 GitHub 會警告／拒收 */
const MAX_BRANCH_BYTES = 50 * 1024 * 1024;

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rootask",
    ...extra,
  };
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(GH_API + path, {
    method,
    headers: headers(token, body !== undefined ? { "Content-Type": "application/json" } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new HttpError(res.status, `${method} ${path}：${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const rand = crypto.getRandomValues(new Uint8Array(3)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${rand}`;
}

export interface UploadResult {
  url: string;
  name: string;
  size: number;
  kind: "branch" | "release";
}

export async function upload(
  token: string,
  req: Request,
  p: { owner: string; repo: string; issue: number; name: string; thresholdMb: number },
): Promise<UploadResult> {
  const size = Number(req.headers.get("Content-Length") ?? "0");
  if (!size) throw new HttpError(411, "需要 Content-Length");
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `單檔上限 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const threshold = Math.min(Math.max(p.thresholdMb, 0), MAX_BRANCH_BYTES / 1024 / 1024) * 1024 * 1024;
  const file = `${p.issue}-${stamp()}-${safeName(p.name)}`;
  const type = req.headers.get("Content-Type") || "application/octet-stream";

  if (size <= threshold) {
    const buf = new Uint8Array(await req.arrayBuffer());
    const path = `attachments/${p.issue}/${file}`;
    await ensureBranch(token, p.owner, p.repo);
    await api(token, "PUT", `/repos/${p.owner}/${p.repo}/contents/${path}`, {
      message: `Rootask：#${p.issue} 附件 ${p.name}`,
      content: toBase64(buf),
      branch: ASSET_BRANCH,
    });
    return {
      url: `https://github.com/${p.owner}/${p.repo}/blob/${ASSET_BRANCH}/${path}`,
      name: p.name,
      size,
      kind: "branch",
    };
  }

  const release = await currentRelease(token, p.owner, p.repo);
  const up = new URL(`${GH_UPLOADS}/repos/${p.owner}/${p.repo}/releases/${release.id}/assets`);
  up.searchParams.set("name", file);
  up.searchParams.set("label", p.name.slice(0, 200));
  // 直接把請求的串流轉給 GitHub，不在 Worker 記憶體裡整個讀進來。
  // GitHub 要求固定的 Content-Length，Worker 一般的串流會用 chunked 傳送，所以包一層 FixedLengthStream。
  let body: BodyInit | null = req.body;
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream }).FixedLengthStream;
  if (FLS && req.body) {
    const { readable, writable } = new FLS(size);
    void req.body.pipeTo(writable);
    body = readable;
  }
  const res = await fetch(up, {
    method: "POST",
    headers: headers(token, { "Content-Type": type, "Content-Length": String(size) }),
    body,
  });
  if (!res.ok) throw new HttpError(res.status, `上傳 release 附件失敗：${res.status} ${await res.text()}`);
  const asset = (await res.json()) as { browser_download_url: string };
  return { url: asset.browser_download_url, name: p.name, size, kind: "release" };
}

function toBase64(buf: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(s);
}

/** 附件分支不存在時，建立一條獨立（orphan）分支，不帶任何程式碼 */
async function ensureBranch(token: string, owner: string, repo: string) {
  const base = `/repos/${owner}/${repo}`;
  try {
    await api(token, "GET", `${base}/git/ref/heads/${ASSET_BRANCH}`);
    return;
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  }
  const tree = await api<{ sha: string }>(token, "POST", `${base}/git/trees`, {
    tree: [
      {
        path: "README.md",
        mode: "100644",
        type: "blob",
        content: "# Rootask 附件\n\n這條分支由 Rootask 自動管理，存放任務留言的附件，請勿刪除。\n",
      },
    ],
  });
  const commit = await api<{ sha: string }>(token, "POST", `${base}/git/commits`, {
    message: "Rootask：建立附件分支",
    tree: tree.sha,
    parents: [],
  });
  try {
    await api(token, "POST", `${base}/git/refs`, { ref: `refs/heads/${ASSET_BRANCH}`, sha: commit.sha });
  } catch (e) {
    // 同時有人也在建立：已存在就好
    if (!(e instanceof HttpError && e.status === 422)) throw e;
  }
}

interface Release {
  id: number;
  tag_name: string;
  assets: { name: string; url: string }[];
}

/** 找目前在用的附件 release；滿了或不存在就開下一個 */
async function currentRelease(token: string, owner: string, repo: string): Promise<Release> {
  const base = `/repos/${owner}/${repo}`;
  const list = await api<(Release & { assets_url: string })[]>(token, "GET", `${base}/releases?per_page=100`);
  const ours = list
    .filter((r) => r.tag_name.startsWith(RELEASE_PREFIX))
    .sort((a, b) => b.tag_name.localeCompare(a.tag_name));
  const latest = ours[0];
  if (latest) {
    // releases 列表裡的 assets 最多帶 100 筆，數量要另外算
    const count = await countAssets(token, base, latest.id);
    if (count < MAX_ASSETS_PER_RELEASE) return latest;
  }
  const next = latest ? Number(latest.tag_name.slice(RELEASE_PREFIX.length)) + 1 : 1;
  const tag = `${RELEASE_PREFIX}${String(next).padStart(3, "0")}`;
  const info = await api<{ default_branch: string }>(token, "GET", base);
  return api<Release>(token, "POST", `${base}/releases`, {
    tag_name: tag,
    target_commitish: info.default_branch,
    name: `Rootask 附件 ${String(next).padStart(3, "0")}（請勿刪除）`,
    body: "由 Rootask 自動管理，存放任務留言中較大的附件。刪除這個 release 會讓對應的附件連結失效。",
    prerelease: true,
    make_latest: "false",
  });
}

async function countAssets(token: string, base: string, id: number): Promise<number> {
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const a = await api<unknown[]>(token, "GET", `${base}/releases/${id}/assets?per_page=100&page=${page}`);
    total += a.length;
    if (a.length < 100) break;
  }
  return total;
}

// ---------- 下載 ----------

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export async function download(token: string, u: string): Promise<Response> {
  const t = parseAttachmentUrl(u);
  if (!t) return new Response("不是 Rootask 附件網址", { status: 400 });

  if (t.kind === "branch") {
    const path = t.path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${GH_API}/repos/${t.owner}/${t.repo}/contents/${path}?ref=${ASSET_BRANCH}`, {
      headers: headers(token, { Accept: "application/vnd.github.raw" }),
    });
    if (!res.ok) return new Response("找不到附件", { status: res.status });
    const ext = t.path.split(".").pop()?.toLowerCase() ?? "";
    return new Response(res.body, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        // 不讓附件在我們網域上執行腳本（例如上傳的 HTML／SVG）
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const rel = await fetch(`${GH_API}/repos/${t.owner}/${t.repo}/releases/tags/${t.tag}`, { headers: headers(token) });
  if (!rel.ok) return new Response("找不到附件", { status: rel.status });
  const release = (await rel.json()) as { id: number };
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${GH_API}/repos/${t.owner}/${t.repo}/releases/${release.id}/assets?per_page=100&page=${page}`, {
      headers: headers(token),
    });
    const assets = (await r.json()) as { name: string; url: string }[];
    const hit = assets.find((a) => a.name === t.name);
    if (hit) {
      // GitHub 會回一個短效的簽章網址；直接轉址過去，大檔不經過 Worker
      const res = await fetch(hit.url, {
        headers: headers(token, { Accept: "application/octet-stream" }),
        redirect: "manual",
      });
      const loc = res.headers.get("Location");
      if (loc) return new Response(null, { status: 302, headers: { Location: loc, "Cache-Control": "no-store" } });
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/octet-stream" } });
    }
    if (assets.length < 100) break;
  }
  return new Response("找不到附件", { status: 404 });
}
