// 以 GitHub App 自己的身分（bot）呼叫 API：私鑰簽 JWT → 換 installation token。
// webhook 自動化用這個身分修改 issue，這樣 bot 觸發的事件可以被辨識並略過，避免無限迴圈。

const GH_API = "https://api.github.com";

export interface AppEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

// ---------- 私鑰：GitHub 給的是 PKCS#1 PEM，WebCrypto 只吃 PKCS#8，這裡自己包一層 ----------

function pemToDer(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  return { der: Uint8Array.from(bin, (c) => c.charCodeAt(0)), pkcs1 };
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function tlv(tag: number, body: Uint8Array | number[]): number[] {
  const b = Array.from(body);
  return [tag, ...derLength(b.length), ...b];
}

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array(tlv(0x30, [...version, ...alg, ...tlv(0x04, pkcs1)]));
}

let keyCache: { pem: string; key: CryptoKey } | null = null;

async function signingKey(pem: string): Promise<CryptoKey> {
  if (keyCache?.pem === pem) return keyCache.key;
  // wrangler secret 貼多行 PEM 時常被轉成字面上的 \n
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const { der, pkcs1 } = pemToDer(normalized);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs1 ? pkcs1ToPkcs8(der) : der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  keyCache = { pem, key };
  return key;
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function appJwt(env: AppEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 往前 60 秒容忍時鐘誤差；GitHub 規定 exp 最多 10 分鐘
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID.trim() }));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(env.GITHUB_APP_PRIVATE_KEY),
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const tokenCache = new Map<number, { token: string; exp: number }>();

export async function installationToken(env: AppEnv, installationId: number): Promise<string> {
  const hit = tokenCache.get(installationId);
  if (hit && hit.exp - 120 > Date.now() / 1000) return hit.token;
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await appJwt(env)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rootask",
    },
  });
  if (!res.ok) throw new Error(`取得 installation token 失敗：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: data.token, exp: Date.parse(data.expires_at) / 1000 });
  return data.token;
}

export class GhClient {
  constructor(private token: string) {}

  async req<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(GH_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rootask",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) throw new NotFound(path);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  get<T>(path: string) {
    return this.req<T>("GET", path);
  }
}

export class NotFound extends Error {}
