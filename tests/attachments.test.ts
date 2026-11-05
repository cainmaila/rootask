import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentMarkdown, parseAttachmentUrl, safeName, viewUrl } from "../shared/attachments";
import { download, upload } from "../worker/src/files";

afterEach(() => vi.unstubAllGlobals());

describe("附件網址與檔名", () => {
  it("檔名轉成 GitHub 接受的安全字元，保留副檔名", () => {
    expect(safeName("設計稿 v2.PNG")).toBe("v2.png");
    expect(safeName("報告.pdf")).toBe("file.pdf");
    expect(safeName("a b/c?.tar.gz")).toBe("a-b-c-.tar.gz");
    expect(safeName("no-ext")).toBe("no-ext");
  });

  it("只認得我們自己產生的附件網址", () => {
    expect(parseAttachmentUrl("https://github.com/o/r/blob/taskapp-assets/attachments/3/x.png")).toEqual({
      kind: "branch",
      owner: "o",
      repo: "r",
      path: "attachments/3/x.png",
    });
    expect(parseAttachmentUrl("https://github.com/o/r/releases/download/taskapp-attachments-001/a.mp4")).toMatchObject({
      kind: "release",
      tag: "taskapp-attachments-001",
      name: "a.mp4",
    });
    // 其他分支、其他 release、其他網站都不接受（避免 Worker 被當成任意代理）
    expect(parseAttachmentUrl("https://github.com/o/r/blob/main/secret.env")).toBeNull();
    expect(parseAttachmentUrl("https://github.com/o/r/releases/download/v1.0/app.zip")).toBeNull();
    expect(parseAttachmentUrl("https://evil.example/o/r/blob/taskapp-assets/attachments/x")).toBeNull();
  });

  it("App 內改走 Worker，其他連結不動", () => {
    const u = "https://github.com/o/r/blob/taskapp-assets/attachments/3/x.png";
    expect(viewUrl(u)).toBe(`/api/files?u=${encodeURIComponent(u)}`);
    expect(viewUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("圖片插成圖片，其他檔案插成連結並顯示大小", () => {
    expect(attachmentMarkdown({ url: "U", name: "截圖.png", size: 10 })).toBe("![截圖.png](U)");
    expect(attachmentMarkdown({ url: "U", name: "規格[v2].pdf", size: 2.5 * 1024 * 1024 })).toBe("[📎 規格v2.pdf（2.5 MB）](U)");
  });
});

/** 記錄 Worker 對 GitHub 發出的請求 */
function mockGitHub(handler: (method: string, url: string, init?: RequestInit) => Response | undefined) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    calls.push({ method, url, body });
    const r = handler(method, url, init);
    if (!r) throw new Error(`未預期的請求：${method} ${url}`);
    return r;
  });
  return calls;
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });

describe("上傳", () => {
  it("小檔：第一次會建立獨立的附件分支，再 commit 進去", async () => {
    const calls = mockGitHub((m, u) => {
      if (u.endsWith("/git/ref/heads/taskapp-assets")) return json({}, 404);
      if (u.endsWith("/git/trees") && m === "POST") return json({ sha: "tree1" }, 201);
      if (u.endsWith("/git/commits") && m === "POST") return json({ sha: "c1" }, 201);
      if (u.endsWith("/git/refs") && m === "POST") return json({}, 201);
      if (u.includes("/contents/attachments/7/") && m === "PUT") return json({}, 201);
    });
    const req = new Request("https://x/api/files/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "Content-Length": "3", "Content-Type": "image/png" },
    });
    const r = await upload("tok", req, { owner: "o", repo: "r", issue: 7, name: "截圖.png", thresholdMb: 10 });
    expect(r.kind).toBe("branch");
    expect(r.name).toBe("截圖.png");
    expect(r.url).toMatch(/^https:\/\/github\.com\/o\/r\/blob\/taskapp-assets\/attachments\/7\/7-\d{8}-\d{6}-[0-9a-f]{6}-file\.png$/);
    const commit = calls.find((c) => c.url.endsWith("/git/commits"))!;
    expect((commit.body as { parents: string[] }).parents).toEqual([]); // orphan：不帶任何程式碼
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ branch: "taskapp-assets", content: "AQID" });
  });

  it("大檔：沒有附件 release 時建立 prerelease 再上傳", async () => {
    const calls = mockGitHub((m, u) => {
      if (u.endsWith("/releases?per_page=100")) return json([{ id: 1, tag_name: "v1.0", assets: [] }]);
      if (u.endsWith("/repos/o/r") && m === "GET") return json({ default_branch: "main" });
      if (u.endsWith("/releases") && m === "POST") return json({ id: 9, tag_name: "taskapp-attachments-001", assets: [] }, 201);
      if (u.startsWith("https://uploads.github.com/repos/o/r/releases/9/assets"))
        return json({ browser_download_url: "https://github.com/o/r/releases/download/taskapp-attachments-001/f.mp4" }, 201);
    });
    const big = 11 * 1024 * 1024;
    const req = new Request("https://x/api/files/upload", {
      method: "POST",
      body: new Uint8Array(big),
      headers: { "Content-Length": String(big), "Content-Type": "video/mp4" },
    });
    const r = await upload("tok", req, { owner: "o", repo: "r", issue: 7, name: "錄影.mp4", thresholdMb: 10 });
    expect(r.kind).toBe("release");
    const created = calls.find((c) => c.url.endsWith("/releases") && c.method === "POST")!;
    expect(created.body).toMatchObject({ tag_name: "taskapp-attachments-001", prerelease: true, make_latest: "false" });
    const up = new URL(calls.find((c) => c.url.startsWith("https://uploads.github.com"))!.url);
    expect(up.searchParams.get("label")).toBe("錄影.mp4"); // 原始檔名存在 label
  });

  it("超過 100 MB 直接拒絕", async () => {
    mockGitHub(() => undefined);
    const req = new Request("https://x", { method: "POST", body: "x", headers: { "Content-Length": String(101 * 1024 * 1024) } });
    await expect(upload("tok", req, { owner: "o", repo: "r", issue: 1, name: "a", thresholdMb: 10 })).rejects.toThrow("100 MB");
  });
});

describe("下載", () => {
  it("拒絕不是附件的網址", async () => {
    mockGitHub(() => undefined);
    const r = await download("tok", "https://github.com/o/r/blob/main/.env");
    expect(r.status).toBe(400);
  });

  it("小檔回傳內容並禁止在我們網域執行腳本", async () => {
    mockGitHub((_m, u) =>
      u.includes("/contents/attachments/7/a.png?ref=taskapp-assets") ? new Response("PNG", { status: 200 }) : undefined,
    );
    const r = await download("tok", "https://github.com/o/r/blob/taskapp-assets/attachments/7/a.png");
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await r.text()).toBe("PNG");
  });

  it("大檔轉址到 GitHub 的簽章網址", async () => {
    mockGitHub((_m, u) => {
      if (u.endsWith("/releases/tags/taskapp-attachments-001")) return json({ id: 9 });
      if (u.includes("/releases/9/assets?")) return json([{ name: "f.mp4", url: "https://api.github.com/repos/o/r/releases/assets/55" }]);
      if (u.endsWith("/releases/assets/55")) return new Response(null, { status: 302, headers: { Location: "https://signed.example/f" } });
    });
    const r = await download("tok", "https://github.com/o/r/releases/download/taskapp-attachments-001/f.mp4");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("https://signed.example/f");
  });
});
