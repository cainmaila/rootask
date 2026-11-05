// 所有 GitHub 呼叫都經過 Worker 的 /api/gh 代理，token 只存在加密 cookie。

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function gh<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/gh${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("rootask:logged-out"));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await gh<{ data?: T; errors?: { message: string }[] }>("/graphql", {
    method: "POST",
    json: { query, variables },
  });
  if (r.errors?.length) throw new ApiError(400, r.errors.map((e) => e.message).join("; "));
  return r.data as T;
}

export interface SessionInfo {
  loggedIn: boolean;
  installUrl: string;
}

export async function getSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  return (await res.json()) as SessionInfo;
}
