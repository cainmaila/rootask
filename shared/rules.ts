// 前端與 Worker 共用的純邏輯：設定檔格式、狀態判斷、轉換規則。
// 這裡不能呼叫任何 API，也不能依賴瀏覽器或 Worker 專屬的東西。

export type StatusCategory = "todo" | "active" | "done" | "cancelled";

export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
  color?: string;
}

/**
 * 轉換規則。`from: "*"` 代表任何狀態。
 * `allowed`："none" 禁止；或列出可以做的人：權限等級（write / maintain / admin，含以上）或 "@帳號"。
 */
export interface Transition {
  from: string;
  to: string;
  allowed: "none" | string[];
}

export interface ProjectConfig {
  version: 1;
  statuses: StatusDef[];
  transitions?: Transition[];
  /** 子任務全部完成時自動推進父任務 */
  auto_complete_parent?: boolean;
  /** 小檔與大檔的分界（MB），附件使用 */
  attachment_threshold_mb?: number;
}

export const STATUS_PREFIX = "status:";
/** 父任務被自動推進時加上的標記，子任務重開時據此退回 */
export const AUTO_LABEL = "rootask:auto";

export const DEFAULT_CONFIG: ProjectConfig = {
  version: 1,
  statuses: [
    { id: "todo", name: "待處理", category: "todo" },
    { id: "doing", name: "進行中", category: "active" },
    { id: "review", name: "待審核", category: "active" },
    { id: "done", name: "完成", category: "done" },
    { id: "dropped", name: "放棄", category: "cancelled" },
  ],
  transitions: [],
  auto_complete_parent: false,
  attachment_threshold_mb: 10,
};

export function validateConfig(c: unknown): ProjectConfig {
  const cfg = c as Partial<ProjectConfig>;
  if (!cfg || !Array.isArray(cfg.statuses) || cfg.statuses.length === 0) throw new Error("設定檔缺少 statuses");
  const ids = new Set<string>();
  for (const s of cfg.statuses) {
    if (!s.id || !/^[a-z0-9_-]+$/.test(s.id)) throw new Error(`狀態 id 不合法：${s.id}`);
    if (ids.has(s.id)) throw new Error(`狀態 id 重複：${s.id}`);
    if (!["todo", "active", "done", "cancelled"].includes(s.category)) throw new Error(`類別不合法：${s.category}`);
    ids.add(s.id);
  }
  for (const t of cfg.transitions ?? []) {
    if ((t.from !== "*" && !ids.has(t.from)) || !ids.has(t.to)) throw new Error(`轉換規則指到不存在的狀態：${t.from} → ${t.to}`);
    if (t.allowed !== "none" && !Array.isArray(t.allowed)) throw new Error(`轉換規則的 allowed 必須是 none 或清單`);
  }
  return { ...DEFAULT_CONFIG, ...cfg, version: 1 } as ProjectConfig;
}

export const isClosing = (c: StatusCategory) => c === "done" || c === "cancelled";

export function firstOf(cfg: ProjectConfig, category: StatusCategory): StatusDef | undefined {
  return cfg.statuses.find((s) => s.category === category);
}

export function statusIdsIn(labels: string[], cfg: ProjectConfig): string[] {
  const valid = new Set(cfg.statuses.map((s) => s.id));
  return labels
    .filter((l) => l.startsWith(STATUS_PREFIX))
    .map((l) => l.slice(STATUS_PREFIX.length))
    .filter((id) => valid.has(id));
}

/** 依標籤決定狀態；沒有狀態標籤時依 open/closed 推斷 */
export function statusFromLabels(
  labels: string[],
  state: "open" | "closed",
  stateReason: string | null | undefined,
  cfg: ProjectConfig,
): StatusDef {
  const ids = statusIdsIn(labels, cfg);
  const found = cfg.statuses.find((s) => ids.includes(s.id));
  if (found) return found;
  const want: StatusCategory =
    state === "closed" ? (stateReason?.toLowerCase() === "not_planned" ? "cancelled" : "done") : "todo";
  return firstOf(cfg, want) ?? cfg.statuses[0];
}

// ---------- 轉換規則 ----------

const ROLE_RANK: Record<string, number> = { read: 0, triage: 1, write: 2, maintain: 3, admin: 4 };

function permits(allowed: Transition["allowed"], role: string, login: string): boolean {
  if (allowed === "none") return false;
  return allowed.some((a) =>
    a.startsWith("@") ? a.slice(1).toLowerCase() === login.toLowerCase() : (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[a] ?? 99),
  );
}

/** 沒有任何規則符合 → 允許；有規則符合 → 任一條允許就允許 */
export function transitionAllowed(cfg: ProjectConfig, from: string, to: string, role: string, login: string): boolean {
  if (from === to) return true;
  const rules = (cfg.transitions ?? []).filter((t) => t.to === to && (t.from === from || t.from === "*"));
  if (rules.length === 0) return true;
  return rules.some((t) => permits(t.allowed, role, login));
}

/**
 * 父任務自動完成時要停在哪個狀態。
 * 若有規則限制「從某個狀態 S 進入完成類別」需要特定權限，就停在 S 等人核准；否則直接完成。
 */
export function autoCompleteTarget(cfg: ProjectConfig): { status: StatusDef; needsApproval: boolean } {
  const done = firstOf(cfg, "done") ?? cfg.statuses[cfg.statuses.length - 1];
  const gate = (cfg.transitions ?? []).find(
    (t) => t.to === done.id && t.from !== "*" && Array.isArray(t.allowed),
  );
  const gateStatus = gate && cfg.statuses.find((s) => s.id === gate.from);
  return gateStatus ? { status: gateStatus, needsApproval: true } : { status: done, needsApproval: false };
}
