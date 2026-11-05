// Webhook 自動化：狀態一致性（#16）、轉換規則（#17）、父任務自動完成（#18）。
// 所有修改都用 App（bot）身分；bot 自己觸發的事件在入口就略過，不會形成迴圈。

import YAML from "yaml";
import {
  AUTO_LABEL,
  STATUS_PREFIX,
  autoCompleteTarget,
  firstOf,
  isClosing,
  statusFromLabels,
  statusIdsIn,
  transitionAllowed,
  validateConfig,
  type ProjectConfig,
  type StatusDef,
} from "../../shared/rules";
import { GhClient, NotFound } from "./github-app";

const CONFIG_PATH = ".taskapp/config.yml";
/** 往上追父任務的安全上限（GitHub 最多 8 層） */
const MAX_CASCADE = 10;

interface GhLabel {
  name: string;
}
interface GhIssue {
  number: number;
  state: "open" | "closed";
  state_reason?: string | null;
  labels: (GhLabel | string)[];
  pull_request?: unknown;
}

export interface IssuesEvent {
  action: string;
  issue: GhIssue;
  label?: GhLabel;
  sender: { login: string; type: string };
  repository: { name: string; owner: { login: string } };
  installation?: { id: number };
}

export interface SubIssuesEvent {
  action: string;
  parent_issue: GhIssue;
  sub_issue: GhIssue;
  sender: { login: string; type: string };
  repository: { name: string; owner: { login: string } };
  installation?: { id: number };
}

const names = (i: GhIssue) => i.labels.map((l) => (typeof l === "string" ? l : l.name));

class Repo {
  readonly base: string;
  constructor(
    readonly gh: GhClient,
    readonly owner: string,
    readonly name: string,
  ) {
    this.base = `/repos/${owner}/${name}`;
  }

  async config(): Promise<ProjectConfig | null> {
    try {
      const f = await this.gh.get<{ content: string }>(`${this.base}/contents/${CONFIG_PATH}`);
      const bin = atob(f.content.replace(/\n/g, ""));
      const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      return validateConfig(YAML.parse(text));
    } catch (e) {
      if (e instanceof NotFound) return null; // 還沒初始化的 repo 不做任何自動化
      throw e;
    }
  }

  issue(n: number) {
    return this.gh.get<GhIssue>(`${this.base}/issues/${n}`);
  }

  async parentOf(n: number): Promise<GhIssue | null> {
    try {
      return await this.gh.get<GhIssue>(`${this.base}/issues/${n}/parent`);
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  }

  children(n: number) {
    return this.gh.get<GhIssue[]>(`${this.base}/issues/${n}/sub_issues?per_page=100`);
  }

  async role(login: string): Promise<string> {
    try {
      const r = await this.gh.get<{ role_name?: string; permission?: string }>(
        `${this.base}/collaborators/${encodeURIComponent(login)}/permission`,
      );
      return r.role_name ?? r.permission ?? "read";
    } catch {
      return "read";
    }
  }

  /** 改狀態：只留一個 status: 標籤，同步 open/closed；extraAdd / extraRemove 處理其他標籤 */
  async apply(issue: GhIssue, status: StatusDef, opts: { addLabels?: string[]; removeLabels?: string[] } = {}) {
    const keep = names(issue).filter((l) => !l.startsWith(STATUS_PREFIX) && !opts.removeLabels?.includes(l));
    const labels = [...new Set([...keep, STATUS_PREFIX + status.id, ...(opts.addLabels ?? [])])];
    const closed = isClosing(status.category);
    const body: Record<string, unknown> = { labels, state: closed ? "closed" : "open" };
    if (closed) body.state_reason = status.category === "done" ? "completed" : "not_planned";
    else if (issue.state === "closed") body.state_reason = "reopened";

    const same =
      sameSet(labels, names(issue)) &&
      (closed ? "closed" : "open") === issue.state &&
      (!closed || (issue.state_reason ?? "completed") === body.state_reason);
    if (same) return false;
    await this.gh.req("PATCH", `${this.base}/issues/${issue.number}`, body);
    return true;
  }

  comment(n: number, body: string) {
    return this.gh.req("POST", `${this.base}/issues/${n}/comments`, { body });
  }

  async ensureLabel(name: string, color: string, description: string) {
    try {
      await this.gh.req("POST", `${this.base}/labels`, { name, color, description });
    } catch {
      /* 已存在 */
    }
  }

  /** 從 issue 事件紀錄推算這次加上 `to` 之前的狀態 */
  async previousStatus(n: number, to: string, cfg: ProjectConfig): Promise<string | null> {
    const valid = new Set(cfg.statuses.map((s) => s.id));
    type Ev = { event: string; label?: { name: string }; actor?: { type?: string } | null };
    const page1 = await this.gh.req<Ev[]>("GET", `${this.base}/issues/${n}/events?per_page=100`);
    let events = page1;
    if (page1.length === 100) {
      // 事件很多時抓最後幾頁就夠了
      for (let p = 2; p <= 10; p++) {
        const more = await this.gh.get<Ev[]>(`${this.base}/issues/${n}/events?per_page=100&page=${p}`);
        events = events.concat(more);
        if (more.length < 100) break;
      }
    }
    let last: string | null = null;
    for (const e of events) {
      const id = e.label?.name.startsWith(STATUS_PREFIX) ? e.label.name.slice(STATUS_PREFIX.length) : null;
      // bot 自己補的標籤不算使用者的狀態（例如換標籤的空檔被補上的預設值）
      if (e.event === "labeled" && id && valid.has(id) && id !== to && e.actor?.type !== "Bot") last = id;
    }
    return last;
  }
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function repoFrom(gh: GhClient, ev: { repository: { name: string; owner: { login: string } } }) {
  return new Repo(gh, ev.repository.owner.login, ev.repository.name);
}

// ---------- issues 事件 ----------

export interface Options {
  /** 移除狀態標籤後等待多久再判斷（使用者換標籤通常是「先移除、再加上」兩個事件） */
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function onIssues(gh: GhClient, ev: IssuesEvent, opts: Options = {}): Promise<void> {
  if (ev.issue.pull_request) return;
  if (!["opened", "labeled", "unlabeled", "closed", "reopened"].includes(ev.action)) return;
  const repo = repoFrom(gh, ev);
  const cfg = await repo.config();
  if (!cfg) return;

  if (ev.action === "unlabeled" && ev.label?.name.startsWith(STATUS_PREFIX)) {
    await (opts.sleep ?? defaultSleep)(opts.settleMs ?? 5000);
  }

  // 事件內容可能已過時，以最新狀態為準
  const issue = await repo.issue(ev.issue.number);
  const current = statusFromLabels(names(issue), issue.state, issue.state_reason, cfg);
  const humanTouched = names(issue).includes(AUTO_LABEL) && ["labeled", "closed", "reopened"].includes(ev.action);
  const removeLabels = humanTouched ? [AUTO_LABEL] : [];

  // 1. 使用者直接改狀態標籤：檢查轉換規則，標籤決定 open/closed
  if (ev.action === "labeled" && ev.label?.name.startsWith(STATUS_PREFIX)) {
    const to = cfg.statuses.find((s) => STATUS_PREFIX + s.id === ev.label!.name);
    if (!to) return;
    const from = await repo.previousStatus(issue.number, to.id, cfg);
    if (from && !transitionAllowed(cfg, from, to.id, await repo.role(ev.sender.login), ev.sender.login)) {
      const back = cfg.statuses.find((s) => s.id === from)!;
      await repo.apply(issue, back);
      await repo.comment(
        issue.number,
        `@${ev.sender.login} 依專案的轉換規則，你不能把狀態從「${back.name}」改成「${to.name}」，已還原。`,
      );
      return;
    }
    await repo.apply(issue, to, { removeLabels });
  }
  // 2. 使用者直接關閉／重開：open/closed 決定標籤
  else if (ev.action === "closed" && !isClosing(current.category)) {
    const target =
      (issue.state_reason === "not_planned" ? firstOf(cfg, "cancelled") : firstOf(cfg, "done")) ?? firstOf(cfg, "done");
    if (!target) return;
    if (!transitionAllowed(cfg, current.id, target.id, await repo.role(ev.sender.login), ev.sender.login)) {
      await repo.apply(issue, current);
      await repo.comment(
        issue.number,
        `@${ev.sender.login} 依專案的轉換規則，你不能把「${current.name}」直接改成「${target.name}」，已重新開啟。`,
      );
      return;
    }
    await repo.apply(issue, target, { removeLabels });
  } else if (ev.action === "reopened" && isClosing(current.category)) {
    const target = firstOf(cfg, "todo") ?? firstOf(cfg, "active") ?? cfg.statuses[0];
    await repo.apply(issue, target, { removeLabels });
  }
  // 3. 其他情況（新建、移除標籤、多個狀態標籤）：整理成剛好一個
  else if (statusIdsIn(names(issue), cfg).length !== 1 || removeLabels.length) {
    await repo.apply(issue, current, { removeLabels });
  }

  if (cfg.auto_complete_parent) await cascade(repo, cfg, issue.number);
}

// ---------- sub_issues 事件：子任務加入或移出也會影響父任務是否完成 ----------

export async function onSubIssues(gh: GhClient, ev: SubIssuesEvent): Promise<void> {
  const repo = repoFrom(gh, ev);
  const cfg = await repo.config();
  if (!cfg?.auto_complete_parent) return;
  const parentNum = ev.parent_issue.number;
  if (await evaluateParent(repo, cfg, parentNum)) await cascade(repo, cfg, parentNum);
}

// ---------- 父任務自動完成 ----------

/** 從某個任務往上檢查每一層父任務 */
async function cascade(repo: Repo, cfg: ProjectConfig, from: number) {
  let n = from;
  for (let i = 0; i < MAX_CASCADE; i++) {
    const parent = await repo.parentOf(n);
    if (!parent) return;
    if (!(await evaluateParent(repo, cfg, parent.number))) return;
    n = parent.number;
  }
}

/** 依子任務決定父任務狀態；回傳是否需要再往上檢查 */
async function evaluateParent(repo: Repo, cfg: ProjectConfig, n: number): Promise<boolean> {
  const [parent, kids] = await Promise.all([repo.issue(n), repo.children(n)]);
  const status = statusFromLabels(names(parent), parent.state, parent.state_reason, cfg);
  const allDone =
    kids.length > 0 && kids.every((k) => isClosing(statusFromLabels(names(k), k.state, k.state_reason, cfg).category));
  const isAuto = names(parent).includes(AUTO_LABEL);

  if (allDone && !isClosing(status.category)) {
    const target = autoCompleteTarget(cfg);
    if (status.id === target.status.id) return false; // 已經在等核准
    await repo.ensureLabel(AUTO_LABEL, "ededed", "由 Rootask 依子任務自動推進");
    await repo.apply(parent, target.status, { addLabels: [AUTO_LABEL] });
    if (target.needsApproval) {
      await repo.comment(n, `子任務已全部完成，已自動改為「${target.status.name}」，請有權限的成員審核後完成。`);
      return false; // 還沒真的完成，不再往上推
    }
    return true;
  }

  if (!allDone && isAuto) {
    // 子任務被重開或新增：自動推進過的父任務退回
    const back = firstOf(cfg, "active") ?? firstOf(cfg, "todo") ?? cfg.statuses[0];
    await repo.apply(parent, back, { removeLabels: [AUTO_LABEL] });
    await repo.comment(n, `有子任務尚未完成，已自動退回「${back.name}」。`);
    return true; // 上一層若也是自動完成的，也要一起退回
  }
  return false;
}
