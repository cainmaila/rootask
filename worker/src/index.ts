import {
  SESSION_COOKIE,
  STATE_COOKIE,
  type Session,
  cookie,
  openSession,
  randomState,
  readCookie,
  sealSession,
} from "./session";
import { onIssues, onSubIssues, type IssuesEvent, type SubIssuesEvent } from "./automation";
import { GhClient, appSlugFromKey, installationToken } from "./github-app";

export interface Env {
  ASSETS: Fetcher;
  /** 可留空，留空時自動查詢 */
  GITHUB_APP_SLUG?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  WEBHOOK_SECRET: string;
  /** webhook 自動化以 App 身分操作時需要（未設定時自動化不啟用） */
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // refresh token 有效約 6 個月
const GH_API = "https://api.github.com";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/auth/login") return login(url, env);
    if (p === "/auth/callback") return callback(req, url, env);
    if (p === "/auth/logout") return logout();
    if (p === "/api/session") return sessionInfo(req, env);
    if (p === "/api/webhook" && req.method === "POST") return webhook(req, env, ctx);
    if (p.startsWith("/api/gh/")) return proxy(req, url, env);

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

// ---------- 登入 ----------

function login(url: URL, env: Env): Response {
  const state = randomState();
  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", env.GITHUB_CLIENT_ID.trim());
  auth.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  auth.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: auth.toString(), "Set-Cookie": cookie(STATE_COOKIE, state, 600) },
  });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function exchange(env: Env, params: Record<string, string>): Promise<Session> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      // 貼上 secret 時常多帶換行或空白，這裡一律去掉
      client_id: env.GITHUB_CLIENT_ID.trim(),
      client_secret: env.GITHUB_CLIENT_SECRET.trim(),
      ...params,
    }),
  });
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error(data.error_description ?? data.error ?? "token exchange failed");
  return {
    at: data.access_token,
    rt: data.refresh_token,
    exp: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
  };
}

async function callback(req: Request, url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE_COOKIE);
  if (!code) return Response.redirect(`${url.origin}/`, 302);

  // 只接受帶著我們自己發出的 state 回來的 code（防 CSRF：別人塞 code 讓你登入成他的帳號）。
  // 從「安裝 App」流程回來時 GitHub 也會帶 code，但沒有 state；這時不使用那個 code，
  // 改走一次正常登入。使用者已授權過，GitHub 會直接跳回，不會再問一次。
  if (!expected || state !== expected) {
    if (url.searchParams.has("installation_id") || url.searchParams.has("setup_action")) {
      return Response.redirect(`${url.origin}/auth/login`, 302);
    }
    return new Response("登入狀態驗證失敗，請回到首頁重新登入", { status: 400 });
  }

  try {
    const s = await exchange(env, { code, redirect_uri: `${url.origin}/auth/callback` });
    const headers = new Headers({ Location: "/" });
    headers.append("Set-Cookie", cookie(SESSION_COOKIE, await sealSession(s, env.SESSION_SECRET), SESSION_MAX_AGE));
    headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return new Response(`登入失敗：${(e as Error).message}`, { status: 400 });
  }
}

function logout(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": cookie(SESSION_COOKIE, "", 0) },
  });
}

/** 取得目前 session；快過期時用 refresh token 換新，回傳要寫回的 cookie */
async function currentSession(req: Request, env: Env): Promise<{ s: Session | null; setCookie?: string }> {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return { s: null };
  let s = await openSession(raw, env.SESSION_SECRET);
  if (!s) return { s: null, setCookie: cookie(SESSION_COOKIE, "", 0) };

  const now = Math.floor(Date.now() / 1000);
  if (s.exp && s.exp - 60 < now) {
    if (!s.rt) return { s: null, setCookie: cookie(SESSION_COOKIE, "", 0) };
    try {
      s = await exchange(env, { grant_type: "refresh_token", refresh_token: s.rt });
      return { s, setCookie: cookie(SESSION_COOKIE, await sealSession(s, env.SESSION_SECRET), SESSION_MAX_AGE) };
    } catch {
      return { s: null, setCookie: cookie(SESSION_COOKIE, "", 0) };
    }
  }
  return { s };
}

async function sessionInfo(req: Request, env: Env): Promise<Response> {
  const { s, setCookie } = await currentSession(req, env);
  const slug = s ? await resolveSlug(env, s.at) : null;
  const body = JSON.stringify({
    loggedIn: !!s,
    // 查不到代稱時退回 GitHub 的 App 安裝管理頁，使用者仍可手動找到
    installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : "https://github.com/settings/installations",
  });
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(body, { headers });
}

/**
 * App 的網址代稱，依序：手動設定 → 用私鑰向 GitHub 查 → 從使用者已有的安裝紀錄取得。
 * 這樣部署的人通常不用設定它。
 */
async function resolveSlug(env: Env, userToken: string): Promise<string | null> {
  if (env.GITHUB_APP_SLUG?.trim()) return env.GITHUB_APP_SLUG.trim();
  if (env.GITHUB_APP_ID?.trim() && env.GITHUB_APP_PRIVATE_KEY) {
    try {
      return await appSlugFromKey({ GITHUB_APP_ID: env.GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY });
    } catch {
      /* 繼續試下一個方法 */
    }
  }
  try {
    // GitHub App 的使用者 token 只看得到「這個 App」的安裝紀錄，每筆都帶 app_slug
    const res = await fetch(`${GH_API}/user/installations?per_page=1`, {
      headers: { Authorization: `Bearer ${userToken}`, Accept: "application/vnd.github+json", "User-Agent": "rootask" },
    });
    if (res.ok) {
      const d = (await res.json()) as { installations: { app_slug?: string }[] };
      return d.installations[0]?.app_slug ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ---------- GitHub API 代理（token 不進前端） ----------

async function proxy(req: Request, url: URL, env: Env): Promise<Response> {
  const { s, setCookie } = await currentSession(req, env);
  if (!s) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (setCookie) headers.append("Set-Cookie", setCookie);
    return new Response(JSON.stringify({ message: "not logged in" }), { status: 401, headers });
  }

  const target = GH_API + url.pathname.slice("/api/gh".length) + url.search;
  const headers = new Headers({
    Authorization: `Bearer ${s.at}`,
    Accept: req.headers.get("Accept") ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rootask",
  });
  const ct = req.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  // 讓瀏覽器的條件式請求（ETag）傳下去，沒變動時 GitHub 回 304 不扣額度
  const inm = req.headers.get("If-None-Match");
  if (inm) headers.set("If-None-Match", inm);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
  });

  const out = new Headers();
  for (const h of ["Content-Type", "ETag", "Link", "X-RateLimit-Remaining", "X-RateLimit-Reset"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("Cache-Control", "no-store");
  if (setCookie) out.append("Set-Cookie", setCookie);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// ---------- Webhook（第二階段：狀態修正、轉換規則、父任務自動完成） ----------

async function webhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get("X-Hub-Signature-256") ?? "";
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  const expected = "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!timingSafeEqual(sig, expected)) return new Response("bad signature", { status: 401 });

  const event = req.headers.get("X-GitHub-Event");
  const payload = JSON.parse(body) as { sender?: { type?: string }; installation?: { id: number } };
  // bot（包含我們自己）觸發的事件一律略過，避免自己改、自己再被觸發的迴圈
  if (payload.sender?.type === "Bot") return new Response(null, { status: 204 });
  if (event !== "issues" && event !== "sub_issues") return new Response(null, { status: 204 });
  if (!env.GITHUB_APP_ID?.trim() || !env.GITHUB_APP_PRIVATE_KEY || !payload.installation) {
    return new Response("automation disabled", { status: 202 });
  }
  const appEnv = { GITHUB_APP_ID: env.GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY };
  const installationId = payload.installation.id;

  // GitHub 要求 10 秒內回應，處理放到背景
  ctx.waitUntil(
    (async () => {
      const gh = new GhClient(await installationToken(appEnv, installationId));
      if (event === "issues") await onIssues(gh, payload as unknown as IssuesEvent);
      else await onSubIssues(gh, payload as unknown as SubIssuesEvent);
    })().catch((e) => console.error("webhook 自動化失敗", event, e)),
  );
  return new Response(null, { status: 202 });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
