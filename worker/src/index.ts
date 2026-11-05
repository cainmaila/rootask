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

export interface Env {
  ASSETS: Fetcher;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  WEBHOOK_SECRET: string;
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // refresh token 有效約 6 個月
const GH_API = "https://api.github.com";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/auth/login") return login(url, env);
    if (p === "/auth/callback") return callback(req, url, env);
    if (p === "/auth/logout") return logout();
    if (p === "/api/session") return sessionInfo(req, env);
    if (p === "/api/webhook" && req.method === "POST") return webhook(req, env);
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
  // 從「安裝 App」流程回來時 GitHub 也會帶 code，但沒有我們的 state
  const expected = readCookie(req, STATE_COOKIE);
  if (!code) return Response.redirect(`${url.origin}/`, 302);
  if (expected && state !== expected) return new Response("登入狀態驗證失敗，請重新登入", { status: 400 });

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
  const body = JSON.stringify({
    loggedIn: !!s,
    installUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
  });
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(body, { headers });
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

async function webhook(req: Request, env: Env): Promise<Response> {
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

  // TODO(第二階段)：依 X-GitHub-Event 處理 issues / sub_issues 事件
  return new Response(null, { status: 204 });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
