// 無狀態 session：GitHub 給的 token 以 AES-GCM 加密後放進 HttpOnly cookie。
// Worker 本身不存任何資料。

export interface Session {
  /** GitHub user access token */
  at: string;
  /** refresh token（GitHub App 開啟 token 過期時才有） */
  rt?: string;
  /** access token 到期時間（epoch 秒），沒有代表不過期 */
  exp?: number;
}

export const SESSION_COOKIE = "rt_session";
export const STATE_COOKIE = "rt_state";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sealSession(s: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(JSON.stringify(s))),
  );
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return b64url(all);
}

export async function openSession(token: string, secret: string): Promise<Session | null> {
  try {
    const all = unb64url(token);
    const iv = all.slice(0, 12);
    const ct = all.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(secret), ct);
    return JSON.parse(dec.decode(pt)) as Session;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}
