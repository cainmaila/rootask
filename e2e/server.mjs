// QA／自動化測試用的伺服器（#51、#55）：提供建置好的前端（web/dist）＋假 GitHub。
//   npm run qa:serve   → http://localhost:4173
// 打開後直接是已登入狀態，示範專案在「demo/website」。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeGitHub } from "./fake-github.mjs";

const PORT = Number(process.env.PORT ?? 4173);
const DIST = fileURLToPath(new URL("../web/dist/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

const gh = new FakeGitHub();

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function serveStatic(path, res) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, safe);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(DIST, "index.html"); // SPA
  }
  const data = await readFile(file);
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  res.end(data);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname;
    if (path.startsWith("/api/") || path.startsWith("/__")) {
      const raw = await readBody(req);
      let body;
      const ct = req.headers["content-type"] ?? "";
      if (raw.length && (ct.includes("json") || path === "/api/gh/graphql")) body = JSON.parse(raw.toString("utf8"));
      const out = await gh.handle({ method: req.method ?? "GET", path, query: url.searchParams, body, raw, headers: req.headers });
      if (out.body) {
        res.writeHead(out.status, out.headers ?? {});
        res.end(out.body);
      } else if (out.json !== undefined) {
        res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(out.headers ?? {}) });
        res.end(JSON.stringify(out.json));
      } else {
        res.writeHead(out.status, out.headers ?? {});
        res.end();
      }
      return;
    }
    if (path === "/auth/logout" || path === "/auth/login") {
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    await serveStatic(path, res);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(e?.stack ?? e));
  }
});

server.listen(PORT, () => {
  console.log(`Rootask QA 環境：http://localhost:${PORT}/#/p/demo/website （假 GitHub，登入者 ${gh.me.login}）`);
});
