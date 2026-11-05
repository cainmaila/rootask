import YAML from "yaml";
import { ApiError, gh } from "./api";

export type StatusCategory = "todo" | "active" | "done" | "cancelled";

export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
  color?: string;
}

export interface ProjectConfig {
  version: 1;
  statuses: StatusDef[];
  /** 小檔與大檔的分界（MB），第二階段附件使用 */
  attachment_threshold_mb?: number;
  auto_complete_parent?: boolean;
}

export const CONFIG_PATH = ".taskapp/config.yml";
export const STATUS_PREFIX = "status:";

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: "未開始",
  active: "進行中",
  done: "完成",
  cancelled: "取消",
};

const CATEGORY_COLOR: Record<StatusCategory, string> = {
  todo: "c5def5",
  active: "fbca04",
  done: "0e8a16",
  cancelled: "cfd3d7",
};

export const DEFAULT_CONFIG: ProjectConfig = {
  version: 1,
  statuses: [
    { id: "todo", name: "待處理", category: "todo" },
    { id: "doing", name: "進行中", category: "active" },
    { id: "review", name: "待審核", category: "active" },
    { id: "done", name: "完成", category: "done" },
    { id: "dropped", name: "放棄", category: "cancelled" },
  ],
  attachment_threshold_mb: 10,
  auto_complete_parent: false,
};

export interface LoadedConfig {
  config: ProjectConfig;
  /** 檔案的 blob sha；null 表示 repo 裡還沒有設定檔 */
  sha: string | null;
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function validateConfig(c: unknown): ProjectConfig {
  const cfg = c as Partial<ProjectConfig>;
  if (!cfg || !Array.isArray(cfg.statuses) || cfg.statuses.length === 0) {
    throw new Error("設定檔缺少 statuses");
  }
  const ids = new Set<string>();
  for (const s of cfg.statuses) {
    if (!s.id || !/^[a-z0-9_-]+$/.test(s.id)) throw new Error(`狀態 id 不合法：${s.id}`);
    if (ids.has(s.id)) throw new Error(`狀態 id 重複：${s.id}`);
    if (!["todo", "active", "done", "cancelled"].includes(s.category)) throw new Error(`類別不合法：${s.category}`);
    ids.add(s.id);
  }
  return { ...DEFAULT_CONFIG, ...cfg, version: 1 } as ProjectConfig;
}

export async function loadConfig(owner: string, repo: string): Promise<LoadedConfig> {
  try {
    const f = await gh<{ content: string; sha: string }>(
      `/repos/${owner}/${repo}/contents/${CONFIG_PATH}`,
    );
    return { config: validateConfig(YAML.parse(decodeBase64Utf8(f.content))), sha: f.sha };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { config: DEFAULT_CONFIG, sha: null };
    throw e;
  }
}

export async function saveConfig(
  owner: string,
  repo: string,
  config: ProjectConfig,
  sha: string | null,
  message: string,
): Promise<string> {
  const text =
    "# Rootask 專案設定。可以在 App 的設定頁修改，也可以直接編輯這個檔案。\n" + YAML.stringify(config);
  const r = await gh<{ content: { sha: string } }>(`/repos/${owner}/${repo}/contents/${CONFIG_PATH}`, {
    method: "PUT",
    json: { message, content: encodeBase64Utf8(text), ...(sha ? { sha } : {}) },
  });
  await ensureLabels(owner, repo, config);
  return r.content.sha;
}

/** 依設定建立缺少的 status: 標籤（已存在的會回 422，忽略即可） */
export async function ensureLabels(owner: string, repo: string, config: ProjectConfig): Promise<void> {
  await Promise.all(
    config.statuses.map((s) =>
      gh(`/repos/${owner}/${repo}/labels`, {
        method: "POST",
        json: {
          name: STATUS_PREFIX + s.id,
          color: s.color ?? CATEGORY_COLOR[s.category],
          description: s.name,
        },
      }).catch((e) => {
        if (!(e instanceof ApiError && e.status === 422)) throw e;
      }),
    ),
  );
}
