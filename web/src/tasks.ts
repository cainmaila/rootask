import { gh, graphql } from "./api";
import { STATUS_PREFIX, isClosing, statusFromLabels, type ProjectConfig, type StatusDef } from "./config";
import { mergeMeta, parseMeta, writeMeta, type TaskMeta } from "../../shared/meta";
import { planMove, sortRoots, type DropPosition } from "../../shared/order";

/** GitHub 原生 sub-issues 的巢狀上限 */
export const MAX_DEPTH = 8;
/** 每個父任務的子任務上限（ROOT 是虛擬的，不受此限） */
export const MAX_CHILDREN = 100;

export interface Person {
  login: string;
  avatarUrl: string;
}

export interface Task {
  id: string; // GraphQL node id
  databaseId: number; // REST 的 id（sub_issue_id 要用這個）
  number: number;
  title: string;
  /** 使用者看到的內文（已拿掉隱藏欄位） */
  body: string;
  /** 預計開始／截止 */
  meta: TaskMeta;
  closedAt: string | null;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  labels: string[];
  assignees: Person[];
  parent: number | null;
  /** GitHub 原生的子任務順序 */
  childOrder: number[];
  /** 子任務總數與已完成數（GitHub 統計，包含沒有載入的已關閉子任務） */
  childTotal: number;
  childCompleted: number;
  updatedAt: string;
}

export interface TaskTree {
  byNumber: Map<number, Task>;
  children: Map<number | null, number[]>; // null ＝ ROOT
}

const ISSUE_FIELDS = `
fragment T on Issue {
  id databaseId number title body state stateReason updatedAt closedAt
  labels(first: 30) { nodes { name } }
  assignees(first: 10) { nodes { login avatarUrl } }
  parent { number }
  subIssues(first: 100) { nodes { number } }
  subIssuesSummary { total completed }
}`;

const TREE_QUERY = `
query($owner: String!, $name: String!, $after: String, $states: [IssueState!]) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, states: $states, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { ...T }
    }
    closed: issues(states: CLOSED) { totalCount }
  }
}
${ISSUE_FIELDS}`;

interface IssueNode {
  id: string;
  databaseId: number;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  updatedAt: string;
  closedAt: string | null;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: Person[] };
  parent: { number: number } | null;
  subIssues: { nodes: { number: number }[] };
  subIssuesSummary: { total: number; completed: number };
}

interface TreeQueryResult {
  repository: {
    issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: IssueNode[] };
    closed: { totalCount: number };
  };
}

function toTask(n: IssueNode): Task {
  const { text, meta } = parseMeta(n.body);
  return {
    id: n.id,
    databaseId: n.databaseId,
    number: n.number,
    title: n.title,
    body: text,
    meta,
    closedAt: n.closedAt,
    state: n.state,
    stateReason: n.stateReason,
    labels: n.labels.nodes.map((l) => l.name),
    assignees: n.assignees.nodes,
    parent: n.parent?.number ?? null,
    childOrder: n.subIssues.nodes.map((c) => c.number),
    childTotal: n.subIssuesSummary.total,
    childCompleted: n.subIssuesSummary.completed,
    updatedAt: n.updatedAt,
  };
}

/** 依編號一次抓多張 issue（用別名組成單一查詢） */
async function loadByNumbers(owner: string, repo: string, numbers: number[]): Promise<Task[]> {
  if (numbers.length === 0) return [];
  const fields = numbers.map((n) => `i${n}: issue(number: ${n}) { ...T }`).join("\n");
  const q = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }\n${ISSUE_FIELDS}`;
  const r = await graphql<{ repository: Record<string, IssueNode | null> }>(q, { owner, name: repo });
  return Object.values(r.repository)
    .filter((n): n is IssueNode => !!n)
    .map(toTask);
}

export interface LoadOptions {
  /** 也載入已關閉的任務（#46：預設不載入） */
  includeClosed?: boolean;
  /** 一定要載入的任務（例如正在看的那張），即使已關閉 */
  pin?: number[];
}

export interface LoadedTree extends TaskTree {
  /** repo 裡已關閉的任務總數 */
  closedCount: number;
  includeClosed: boolean;
}

export async function loadTree(owner: string, repo: string, opts: LoadOptions = {}): Promise<LoadedTree> {
  const includeClosed = !!opts.includeClosed;
  const tasks: Task[] = [];
  let closedCount = 0;
  let after: string | null = null;
  do {
    const r: TreeQueryResult = await graphql<TreeQueryResult>(TREE_QUERY, {
      owner,
      name: repo,
      after,
      states: includeClosed ? null : ["OPEN"],
    });
    tasks.push(...r.repository.issues.nodes.map(toTask));
    closedCount = r.repository.closed.totalCount;
    after = r.repository.issues.pageInfo.hasNextPage ? r.repository.issues.pageInfo.endCursor : null;
  } while (after);

  // 補上沒載入的：指定要看的任務，以及未完成任務的已關閉上層（樹才不會斷掉）
  const have = new Set(tasks.map((t) => t.number));
  for (let round = 0; round <= MAX_DEPTH + 1; round++) {
    const missingParents = tasks.map((t) => t.parent).filter((p): p is number => p !== null && !have.has(p));
    const pins = round === 0 ? (opts.pin ?? []).filter((n) => !have.has(n)) : [];
    const want = [...new Set([...pins, ...missingParents])];
    if (want.length === 0) break;
    const more = await loadByNumbers(owner, repo, want);
    for (const t of more) have.add(t.number);
    for (const n of want) have.add(n); // 抓不到的（例如已刪除）也不再重試
    tasks.push(...more);
  }
  return { ...buildTree(tasks), closedCount, includeClosed };
}

export function buildTree(tasks: Task[]): TaskTree {
  const byNumber = new Map(tasks.map((t) => [t.number, t]));
  const children = new Map<number | null, number[]>();
  for (const t of tasks) {
    // 父任務不在清單裡（例如在別的 repo）就掛到 ROOT
    const p = t.parent !== null && byNumber.has(t.parent) ? t.parent : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(t.number);
  }
  // 子任務照 GitHub 原生順序；最上層照 rank（#42）
  for (const [p, kids] of children) {
    if (p === null) {
      children.set(p, sortRoots(kids.map((n) => ({ number: n, rank: byNumber.get(n)!.meta.rank }))).map((x) => x.number));
    } else {
      const order = byNumber.get(p)!.childOrder;
      const pos = new Map(order.map((n, i) => [n, i]));
      kids.sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9) || a - b);
    }
  }
  return { byNumber, children };
}

const orderable = (tree: TaskTree, n: number) => {
  const t = tree.byNumber.get(n)!;
  const parent = t.parent !== null && tree.byNumber.has(t.parent) ? t.parent : null;
  return { number: n, rank: t.meta.rank, parent };
};

/**
 * 把 moving 放到 target 的前或後（#42）。回傳 false 表示不能移動或位置沒變。
 * 必要時先換父任務，再調整位置。
 */
export async function reorderTask(
  owner: string,
  repo: string,
  tree: TaskTree,
  moving: number,
  target: number,
  position: DropPosition,
): Promise<boolean> {
  if (moving === target) return false;
  const m = orderable(tree, moving);
  const t = orderable(tree, target);
  if (t.parent !== m.parent && moveBlockReason(tree, moving, t.parent)) return false;
  const plan = planMove(m, t, position, (p) => (tree.children.get(p) ?? []).map((n) => orderable(tree, n)));
  if (plan.noop) return false;

  const task = tree.byNumber.get(moving)!;
  if (plan.reparent) await moveTask(owner, repo, { ...task, parent: m.parent }, plan.parent);

  if (plan.parent === null) {
    await updateBody(owner, repo, moving, { meta: { rank: plan.rank } });
  } else if (plan.anchor) {
    const sibling = tree.byNumber.get(plan.anchor.sibling)!;
    await gh(`/repos/${owner}/${repo}/issues/${plan.parent}/sub_issues/priority`, {
      method: "PATCH",
      json: {
        sub_issue_id: task.databaseId,
        [plan.anchor.position === "before" ? "before_id" : "after_id"]: sibling.databaseId,
      },
    });
  }
  return true;
}

/** 上移／下移一格（手機用） */
export function neighbor(
  tree: TaskTree,
  n: number,
  dir: -1 | 1,
  /** 篩選中只在看得到的任務之間移動（#57） */
  visible?: Set<number> | null,
): { target: number; position: DropPosition } | null {
  const p = orderable(tree, n).parent;
  const sibs = (tree.children.get(p) ?? []).filter((k) => k === n || !visible || visible.has(k));
  const i = sibs.indexOf(n);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return null;
  return { target: sibs[j], position: dir < 0 ? "before" : "after" };
}

// ---------- 樹的計算 ----------

/** 節點所在層數，ROOT 底下第一層為 1 */
export function depthOf(tree: TaskTree, n: number): number {
  let d = 0;
  let cur: number | null = n;
  while (cur !== null) {
    d++;
    const t = tree.byNumber.get(cur);
    cur = t && t.parent !== null && tree.byNumber.has(t.parent) ? t.parent : null;
  }
  return d;
}

/** 以此節點為根的子樹高度（只有自己為 1） */
export function heightOf(tree: TaskTree, n: number): number {
  const kids = tree.children.get(n) ?? [];
  return 1 + kids.reduce((m, k) => Math.max(m, heightOf(tree, k)), 0);
}

export function isDescendant(tree: TaskTree, candidate: number, ancestor: number): boolean {
  let cur: number | null = candidate;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = tree.byNumber.get(cur)?.parent ?? null;
  }
  return false;
}

/** 檢查能否把 n 移到 newParent（null ＝ ROOT），回傳不能的原因 */
export function moveBlockReason(tree: TaskTree, n: number, newParent: number | null): string | null {
  if (newParent === null) return null;
  if (newParent === n || isDescendant(tree, newParent, n)) return "不能移到自己或自己的子任務底下";
  if (depthOf(tree, newParent) + heightOf(tree, n) > MAX_DEPTH) return `移動後會超過 ${MAX_DEPTH} 層`;
  const total = Math.max(tree.byNumber.get(newParent)?.childTotal ?? 0, (tree.children.get(newParent) ?? []).length);
  if (total >= MAX_CHILDREN) return `每個任務最多 ${MAX_CHILDREN} 個子任務`;
  return null;
}

// ---------- 狀態 ----------

export function statusOf(task: Task, config: ProjectConfig): StatusDef {
  return statusFromLabels(task.labels, task.state === "CLOSED" ? "closed" : "open", task.stateReason, config);
}

// ---------- 寫入操作（REST） ----------

export async function createTask(
  owner: string,
  repo: string,
  title: string,
  parent: Task | null,
  config: ProjectConfig,
): Promise<void> {
  const initial = config.statuses.find((s) => s.category === "todo") ?? config.statuses[0];
  const issue = await gh<{ id: number }>(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    json: { title, labels: [STATUS_PREFIX + initial.id] },
  });
  if (parent) {
    await gh(`/repos/${owner}/${repo}/issues/${parent.number}/sub_issues`, {
      method: "POST",
      json: { sub_issue_id: issue.id },
    });
  }
}

export async function moveTask(owner: string, repo: string, task: Task, newParent: number | null): Promise<void> {
  if (newParent === task.parent) return;
  if (newParent === null) {
    // 移到 ROOT ＝ 解除父關係
    await gh(`/repos/${owner}/${repo}/issues/${task.parent}/sub_issue`, {
      method: "DELETE",
      json: { sub_issue_id: task.databaseId },
    });
    return;
  }
  await gh(`/repos/${owner}/${repo}/issues/${newParent}/sub_issues`, {
    method: "POST",
    json: { sub_issue_id: task.databaseId, replace_parent: true },
  });
}

export async function setStatus(owner: string, repo: string, task: Task, status: StatusDef): Promise<void> {
  const labels = [...task.labels.filter((l) => !l.startsWith(STATUS_PREFIX)), STATUS_PREFIX + status.id];
  const closed = status.category === "done" || status.category === "cancelled";
  const json: Record<string, unknown> = { labels, state: closed ? "closed" : "open" };
  if (closed) json.state_reason = status.category === "done" ? "completed" : "not_planned";
  else if (task.state === "CLOSED") json.state_reason = "reopened";
  await gh(`/repos/${owner}/${repo}/issues/${task.number}`, { method: "PATCH", json });
}

export async function updateTask(
  owner: string,
  repo: string,
  n: number,
  patch: { title?: string; assignees?: string[] },
): Promise<void> {
  await gh(`/repos/${owner}/${repo}/issues/${n}`, { method: "PATCH", json: patch });
}

/** 改內文或預計日期；兩者存在同一個 body，先讀最新的再合併，避免蓋掉別人剛改的另一半 */
export async function updateBody(
  owner: string,
  repo: string,
  n: number,
  patch: { text?: string; meta?: Partial<TaskMeta> },
): Promise<void> {
  const cur = await gh<{ body: string | null }>(`/repos/${owner}/${repo}/issues/${n}`);
  const parsed = parseMeta(cur.body);
  // 欄位逐一合併：改日期不會動到排序值，反之亦然
  const body = writeMeta(patch.text ?? parsed.text, patch.meta ? mergeMeta(parsed.meta, patch.meta) : parsed.meta);
  if (body === (cur.body ?? "")) return;
  await gh(`/repos/${owner}/${repo}/issues/${n}`, { method: "PATCH", json: { body } });
}

export interface ActualTimes {
  /** 第一次進入進行中（或直接完成）的時間 */
  start: string | null;
  /** 以完成關閉的時間 */
  end: string | null;
}

/** 從 issue 的事件紀錄推算實際開始／完成 */
export async function actualTimes(owner: string, repo: string, task: Task, config: ProjectConfig): Promise<ActualTimes> {
  const started = new Set(config.statuses.filter((s) => s.category === "active" || s.category === "done").map((s) => STATUS_PREFIX + s.id));
  let start: string | null = null;
  for (let page = 1; page <= 10 && !start; page++) {
    const evs = await gh<{ event: string; created_at: string; label?: { name: string } }[]>(
      `/repos/${owner}/${repo}/issues/${task.number}/events?per_page=100&page=${page}`,
    );
    start = evs.find((e) => e.event === "labeled" && e.label && started.has(e.label.name))?.created_at ?? null;
    if (evs.length < 100) break;
  }
  const status = statusFromLabels(task.labels, task.state === "CLOSED" ? "closed" : "open", task.stateReason, config);
  const end = task.state === "CLOSED" && isClosing(status.category) && status.category === "done" ? task.closedAt : null;
  return { start, end };
}

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string; avatar_url: string } | null;
}

export function listComments(owner: string, repo: string, n: number): Promise<Comment[]> {
  return gh<Comment[]>(`/repos/${owner}/${repo}/issues/${n}/comments?per_page=100`);
}

export function addComment(owner: string, repo: string, n: number, body: string): Promise<Comment> {
  return gh<Comment>(`/repos/${owner}/${repo}/issues/${n}/comments`, { method: "POST", json: { body } });
}

export async function listAssignable(owner: string, repo: string): Promise<Person[]> {
  const r = await gh<{ login: string; avatar_url: string }[]>(`/repos/${owner}/${repo}/assignees?per_page=100`);
  return r.map((u) => ({ login: u.login, avatarUrl: u.avatar_url }));
}

export async function myPermission(owner: string, repo: string): Promise<string> {
  const r = await gh<{ permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }>(`/repos/${owner}/${repo}`);
  const p = r.permissions ?? {};
  return p.admin ? "admin" : p.maintain ? "maintain" : p.push ? "write" : "read";
}
