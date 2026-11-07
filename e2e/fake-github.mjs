// 有狀態的假 GitHub（#51、#55）：模擬 App 透過 Worker 呼叫的所有 API，資料存在記憶體。
// QA agent 與自動化測試都用它，不需要登入、不會動到真實資料。
//
// 測試用的控制端點：
//   POST /__reset              還原成示範資料
//   POST /__fail?times=1&method=PATCH&path=/issues/   讓接下來符合的寫入失敗（測錯誤處理）
//   POST /__latency?ms=800     每個寫入延遲幾毫秒（看 loading 回饋）
//   POST /__as?login=amy&role=write   切換登入者與權限（測多人與權限）
//   GET  /__state              目前狀態（除錯用）
//
// 限制：沒有模擬 webhook 自動化（bot 補狀態、轉換規則還原、父任務自動完成）。

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const dateOnly = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function avatar(login) {
  const colors = ["#2f5d50", "#b7791f", "#6b7f99", "#9b2c2c", "#553c9a"];
  const c = colors[[...login].reduce((s, ch) => s + ch.charCodeAt(0), 0) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${c}"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${login[0].toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const DEFAULT_STATUSES = [
  { id: "todo", name: "待處理", category: "todo" },
  { id: "doing", name: "進行中", category: "active" },
  { id: "review", name: "待審核", category: "active" },
  { id: "done", name: "完成", category: "done" },
  { id: "dropped", name: "放棄", category: "cancelled" },
];

/** 一張小 PNG（示範附件） */
const DEMO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJ0lEQVR4nGNkYGD4z0AEYBxVSF+FjP8ZGBj+M5CgEMMgk9KjCikPAAAzUQUPUz3DSQAAAABJRU5ErkJggg==",
  "base64",
);

function configYaml(statuses, extra = "") {
  const lines = ["# Rootask 專案設定", "version: 1", "statuses:"];
  for (const s of statuses) lines.push(`  - id: ${s.id}`, `    name: ${s.name}`, `    category: ${s.category}`);
  return lines.join("\n") + "\n" + extra;
}

export class FakeGitHub {
  constructor() {
    this.reset();
  }

  reset() {
    this.me = { login: "cain", role: "admin" };
    this.people = ["cain", "amy", "ben"];
    this.latency = 0;
    this.failures = [];
    this.files = new Map();
    this.nextId = 5000;
    this.nextComment = 9000;
    /** @type {Map<string, any>} */
    this.repos = new Map();
    this.#seedWebsite();
    this.#seedEmpty();
  }

  repo(owner, name) {
    return this.repos.get(`${owner}/${name}`.toLowerCase());
  }

  #newRepo(owner, name, description, config) {
    const r = {
      owner,
      name,
      description,
      id: this.nextId++,
      private: true,
      pushed_at: iso(Date.now() - this.repos.size * DAY),
      config, // 字串或 null
      configSha: config ? "sha-1" : null,
      labels: new Set(),
      issues: new Map(),
      children: new Map(), // parent number -> number[]（原生子任務順序）
      nextNumber: 1,
    };
    this.repos.set(`${owner}/${name}`.toLowerCase(), r);
    return r;
  }

  #seedEmpty() {
    this.#newRepo("demo", "empty-project", "還沒初始化、也沒有任務的專案", null);
  }

  #seedWebsite() {
    const r = this.#newRepo(
      "demo",
      "website",
      "官網改版（示範資料）",
      configYaml(DEFAULT_STATUSES, "transitions:\n  - from: review\n    to: done\n    allowed: [maintain]\nauto_complete_parent: true\n"),
    );
    for (const s of DEFAULT_STATUSES) r.labels.add(`status:${s.id}`);
    const add = (title, o = {}) => this.#create(r, { title, ...o }, { silent: true });

    const site = add("官網改版", { status: "doing", body: "## 目標\n- [x] 確認需求\n- [ ] 上線新版首頁\n\n**負責人**：cain" });
    const design = add("首頁設計", { parent: site, status: "doing", who: ["cain"], due: dateOnly(-3), start: dateOnly(-10) });
    add("Hero 主視覺", {
      parent: design,
      status: "todo",
      who: ["amy"],
      due: dateOnly(4),
      body: "需要 SVG 與 PNG 兩種版本。\n\n參考圖：\n![參考](https://github.com/demo/website/blob/taskapp-assets/attachments/3/ref.png)",
    });
    add("導覽列互動", { parent: design, status: "review", who: ["ben"] });
    add("字體與色票", { parent: design, status: "done", closed: true });
    const api = add("後台 API", { parent: site, status: "doing", who: ["ben"], due: dateOnly(10) });
    add("登入流程", { parent: api, status: "done", closed: true, who: ["ben"] });
    add("文章列表 API", { parent: api, status: "todo", who: ["ben"], due: dateOnly(-1) });
    add("上傳圖片 API", { parent: api, status: "todo" });
    const mkt = add("行銷活動", { status: "todo", who: ["amy"], due: dateOnly(20) });
    add("社群貼文排程", { parent: mkt, status: "todo", who: ["amy"] });
    add("電子報文案", { parent: mkt, status: "dropped", closed: true, reason: "not_planned" });
    add("整理專案文件", { status: "todo" });
    add(
      "一個非常非常長的任務標題，用來測試在手機和窄螢幕上會不會把版面撐開或是被截斷得很難看",
      { status: "todo", who: ["cain", "amy", "ben"], due: dateOnly(1) },
    );
    add("舊版網站下線", { status: "done", closed: true });

    this.files.set("demo/website:attachments/3/ref.png", { type: "image/png", data: DEMO_PNG });
    const c = r.issues.get(design);
    c.comments.push({
      id: this.nextComment++,
      body: "初稿已上傳，請大家看看 👀\n![初稿](https://github.com/demo/website/blob/taskapp-assets/attachments/3/ref.png)",
      created_at: iso(Date.now() - 2 * DAY),
      user: { login: "amy", avatar_url: avatar("amy") },
    });
  }

  /** 建立 issue；status、who、due、start、parent 為示範資料用的簡寫 */
  #create(r, o, { silent = false } = {}) {
    const number = r.nextNumber++;
    const meta = {};
    if (o.start) meta.start = o.start;
    if (o.due) meta.due = o.due;
    let body = o.body ?? "";
    if (Object.keys(meta).length) body += `${body ? "\n\n" : ""}<!-- rootask:meta ${JSON.stringify(meta)} -->`;
    const created = Date.now() - (30 - number) * DAY;
    const labels = o.labels ?? (o.status ? [`status:${o.status}`] : []);
    const issue = {
      id: this.nextId++,
      number,
      title: o.title,
      body,
      state: o.closed ? "closed" : "open",
      state_reason: o.closed ? (o.reason ?? "completed") : null,
      closed_at: o.closed ? iso(created + 3 * DAY) : null,
      updated_at: iso(created),
      labels,
      assignees: o.who ?? [],
      parent: null,
      comments: [],
      events: labels.map((name) => ({
        event: "labeled",
        label: { name },
        created_at: iso(created + DAY),
        actor: { login: "cain", type: "User" },
      })),
    };
    r.issues.set(number, issue);
    if (o.parent) this.#attach(r, o.parent, number);
    if (!silent) r.pushed_at = iso(Date.now());
    return number;
  }

  #attach(r, parent, child) {
    const issue = r.issues.get(child);
    if (issue.parent !== null) {
      const sib = r.children.get(issue.parent) ?? [];
      r.children.set(issue.parent, sib.filter((n) => n !== child));
    }
    issue.parent = parent;
    r.children.set(parent, [...(r.children.get(parent) ?? []), child]);
  }

  #depth(r, n) {
    let d = 0;
    for (let cur = n; cur !== null && d < 20; cur = r.issues.get(cur)?.parent ?? null) d++;
    return d;
  }

  #height(r, n) {
    const kids = r.children.get(n) ?? [];
    return 1 + kids.reduce((m, k) => Math.max(m, this.#height(r, k)), 0);
  }

  // ---------- 輸出格式 ----------

  #node(r, i) {
    const kids = r.children.get(i.number) ?? [];
    return {
      id: `I_${i.id}`,
      databaseId: i.id,
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state.toUpperCase(),
      stateReason: i.state_reason ? i.state_reason.toUpperCase() : null,
      updatedAt: i.updated_at,
      closedAt: i.closed_at,
      labels: { nodes: i.labels.map((name) => ({ name })) },
      assignees: { nodes: i.assignees.map((login) => ({ login, avatarUrl: avatar(login) })) },
      parent: i.parent ? { number: i.parent } : null,
      subIssues: { nodes: kids.map((number) => ({ number })) },
      subIssuesSummary: {
        total: kids.length,
        completed: kids.filter((k) => r.issues.get(k).state === "closed").length,
      },
    };
  }

  #rest(i) {
    return {
      id: i.id,
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      state_reason: i.state_reason,
      labels: i.labels.map((name) => ({ name })),
      assignees: i.assignees.map((login) => ({ login, avatar_url: avatar(login) })),
    };
  }

  // ---------- 請求處理 ----------

  /**
   * @param {{method: string, path: string, query: URLSearchParams, body: any, raw?: Buffer, headers?: Record<string,string>}} req
   * @returns {Promise<{status: number, json?: any, body?: Buffer, headers?: Record<string,string>}>}
   */
  async handle(req) {
    const { method, path, query } = req;

    // 控制端點
    if (path === "/__reset") return this.reset(), { status: 204 };
    if (path === "/__latency") return (this.latency = Number(query.get("ms") ?? 0)), { status: 204 };
    if (path === "/__fail") {
      this.failures.push({
        times: Number(query.get("times") ?? 1),
        method: (query.get("method") ?? "").toUpperCase(),
        path: query.get("path") ?? "",
        status: Number(query.get("status") ?? 503),
      });
      return { status: 204 };
    }
    if (path === "/__as") {
      this.me = { login: query.get("login") ?? "cain", role: query.get("role") ?? "admin" };
      if (!this.people.includes(this.me.login)) this.people.push(this.me.login);
      return { status: 204 };
    }
    if (path === "/__state") {
      const repos = {};
      for (const [k, r] of this.repos)
        repos[k] = { config: r.config, issues: [...r.issues.values()], children: Object.fromEntries(r.children) };
      return { status: 200, json: { me: this.me, repos } };
    }

    if (path === "/api/session") return { status: 200, json: { loggedIn: true, installUrl: "https://github.com/apps/rootask/installations/new" } };

    const isWrite = method !== "GET" && !(method === "POST" && path === "/api/gh/graphql");
    if (isWrite) {
      if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
      const f = this.failures.find((x) => x.times > 0 && (!x.method || x.method === method) && path.includes(x.path));
      if (f) {
        f.times--;
        return { status: f.status, json: { message: `模擬失敗（${f.status}）` } };
      }
    }

    if (path === "/api/files/upload" && method === "POST") return this.#upload(req);
    if (path === "/api/files" && method === "GET") return this.#download(query.get("u") ?? "");

    if (!path.startsWith("/api/gh/")) return { status: 404, json: { message: "Not Found" } };
    const p = path.slice("/api/gh".length);
    let m;

    if (p === "/user") return { status: 200, json: { login: this.me.login, avatar_url: avatar(this.me.login) } };
    if (p === "/user/installations") return { status: 200, json: { installations: [{ id: 1 }] } };
    if (p === "/user/installations/1/repositories") {
      const all = [...this.repos.values()].map((r) => ({
        id: r.id,
        full_name: `${r.owner}/${r.name}`,
        name: r.name,
        owner: { login: r.owner },
        private: r.private,
        description: r.description,
        pushed_at: r.pushed_at,
      }));
      return { status: 200, json: { total_count: all.length, repositories: all } };
    }
    if (p === "/graphql" && method === "POST") return this.#graphql(req.body);

    if (!(m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) return { status: 404, json: { message: "Not Found" } };
    const r = this.repo(m[1], m[2]);
    if (!r) return { status: 404, json: { message: "Not Found" } };
    const rest = m[3] ?? "";
    const canWrite = this.me.role !== "read";

    if (rest === "") {
      const role = this.me.role;
      return {
        status: 200,
        json: {
          default_branch: "main",
          permissions: { admin: role === "admin", maintain: role === "admin" || role === "maintain", push: role !== "read" },
        },
      };
    }
    if (rest === "/assignees") return { status: 200, json: this.people.map((login) => ({ login, avatar_url: avatar(login) })) };
    if (rest === "/labels" && method === "POST") {
      if (r.labels.has(req.body.name)) return { status: 422, json: { message: "already_exists" } };
      r.labels.add(req.body.name);
      return { status: 201, json: { name: req.body.name } };
    }
    if (rest === "/contents/.taskapp/config.yml") {
      if (method === "GET") {
        if (!r.config) return { status: 404, json: { message: "Not Found" } };
        return { status: 200, json: { content: Buffer.from(r.config).toString("base64"), sha: r.configSha } };
      }
      if (method === "PUT") {
        if (!canWrite) return { status: 403, json: { message: "沒有寫入權限" } };
        if (r.configSha && req.body.sha !== r.configSha) return { status: 409, json: { message: "設定檔已被別人修改" } };
        r.config = Buffer.from(req.body.content, "base64").toString("utf8");
        r.configSha = `sha-${Date.now()}`;
        return { status: 200, json: { content: { sha: r.configSha } } };
      }
    }
    if (rest === "/issues" && method === "POST") {
      if (!canWrite) return { status: 403, json: { message: "沒有寫入權限" } };
      if (!req.body.title?.trim()) return { status: 422, json: { message: "標題不能是空的" } };
      const n = this.#create(r, { title: req.body.title, body: req.body.body, labels: req.body.labels ?? [] });
      return { status: 201, json: this.#rest(r.issues.get(n)) };
    }

    if (!(m = rest.match(/^\/issues\/(\d+)(\/.*)?$/))) {
      if ((m = rest.match(/^\/issues\/comments\/(\d+)$/))) return this.#commentById(r, Number(m[1]), req);
      return { status: 404, json: { message: "Not Found" } };
    }
    const issue = r.issues.get(Number(m[1]));
    if (!issue) return { status: 404, json: { message: "Not Found" } };
    const sub = m[2] ?? "";

    if (sub === "") {
      if (method === "GET") return { status: 200, json: this.#rest(issue) };
      if (method === "PATCH") {
        if (!canWrite) return { status: 403, json: { message: "沒有寫入權限" } };
        const b = req.body;
        if (b.title !== undefined) {
          if (!String(b.title).trim()) return { status: 422, json: { message: "標題不能是空的" } };
          issue.title = b.title;
        }
        if (b.body !== undefined) issue.body = b.body;
        if (b.assignees !== undefined) {
          if (b.assignees.length > 10) return { status: 422, json: { message: "最多 10 位分配人" } };
          issue.assignees = b.assignees;
        }
        if (b.labels !== undefined) {
          const now = iso(Date.now());
          for (const l of b.labels)
            if (!issue.labels.includes(l))
              issue.events.push({ event: "labeled", label: { name: l }, created_at: now, actor: { login: this.me.login, type: "User" } });
          issue.labels = [...b.labels];
        }
        if (b.state !== undefined) {
          if (b.state === "closed" && issue.state !== "closed") issue.closed_at = iso(Date.now());
          if (b.state === "open") issue.closed_at = null;
          issue.state = b.state;
          issue.state_reason = b.state === "closed" ? (b.state_reason ?? "completed") : (b.state_reason ?? null);
        }
        issue.updated_at = iso(Date.now());
        r.pushed_at = issue.updated_at;
        return { status: 200, json: this.#rest(issue) };
      }
    }
    if (sub === "/comments") {
      if (method === "GET") return { status: 200, json: issue.comments };
      if (method === "POST") {
        if (!req.body.body?.trim()) return { status: 422, json: { message: "留言不能是空的" } };
        const c = {
          id: this.nextComment++,
          body: req.body.body,
          created_at: iso(Date.now()),
          user: { login: this.me.login, avatar_url: avatar(this.me.login) },
        };
        issue.comments.push(c);
        return { status: 201, json: c };
      }
    }
    if (sub === "/events" || sub.startsWith("/events?")) return { status: 200, json: issue.events };
    if (sub === "/sub_issues") {
      if (method === "GET")
        return { status: 200, json: (r.children.get(issue.number) ?? []).map((k) => this.#rest(r.issues.get(k))) };
      if (method === "POST") {
        const child = [...r.issues.values()].find((x) => x.id === req.body.sub_issue_id);
        if (!child) return { status: 404, json: { message: "找不到子任務" } };
        if (child.parent !== null && !req.body.replace_parent) return { status: 422, json: { message: "已經有父任務" } };
        for (let cur = issue.number; cur !== null; cur = r.issues.get(cur)?.parent ?? null)
          if (cur === child.number) return { status: 422, json: { message: "不能形成迴圈" } };
        if (this.#depth(r, issue.number) + this.#height(r, child.number) > 8)
          return { status: 422, json: { message: "超過 8 層" } };
        if ((r.children.get(issue.number) ?? []).length >= 100) return { status: 422, json: { message: "最多 100 個子任務" } };
        this.#attach(r, issue.number, child.number);
        return { status: 201, json: this.#rest(issue) };
      }
    }
    if (sub === "/sub_issue" && method === "DELETE") {
      const child = [...r.issues.values()].find((x) => x.id === req.body.sub_issue_id);
      if (!child || child.parent !== issue.number) return { status: 404, json: { message: "不是這個任務的子任務" } };
      r.children.set(issue.number, (r.children.get(issue.number) ?? []).filter((k) => k !== child.number));
      child.parent = null;
      return { status: 200, json: this.#rest(issue) };
    }
    if (sub === "/sub_issues/priority" && method === "PATCH") {
      const list = r.children.get(issue.number) ?? [];
      const byId = (id) => [...r.issues.values()].find((x) => x.id === id)?.number;
      const moving = byId(req.body.sub_issue_id);
      const anchor = byId(req.body.before_id ?? req.body.after_id);
      if (!list.includes(moving) || !list.includes(anchor)) return { status: 422, json: { message: "不是同一個父任務" } };
      const next = list.filter((n) => n !== moving);
      const at = next.indexOf(anchor) + (req.body.after_id ? 1 : 0);
      next.splice(at, 0, moving);
      r.children.set(issue.number, next);
      return { status: 200, json: this.#rest(issue) };
    }
    return { status: 404, json: { message: `假 GitHub 尚未支援：${method} ${p}` } };
  }

  #commentById(r, id, req) {
    for (const i of r.issues.values()) {
      const idx = i.comments.findIndex((c) => c.id === id);
      if (idx < 0) continue;
      const c = i.comments[idx];
      const mine = c.user.login === this.me.login || this.me.role === "admin" || this.me.role === "maintain";
      if (req.method === "PATCH") {
        if (!mine) return { status: 403, json: { message: "只能編輯自己的留言" } };
        c.body = req.body.body;
        return { status: 200, json: c };
      }
      if (req.method === "DELETE") {
        if (!mine) return { status: 403, json: { message: "只能刪除自己的留言" } };
        i.comments.splice(idx, 1);
        return { status: 204 };
      }
      return { status: 200, json: c };
    }
    return { status: 404, json: { message: "Not Found" } };
  }

  #graphql(body) {
    const { query, variables } = body;
    const r = this.repo(variables.owner, variables.name);
    if (!r) return { status: 200, json: { data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] } };
    if (query.includes("issues(first: 100")) {
      const states = variables.states;
      const all = [...r.issues.values()]
        .filter((i) => !states || states.includes(i.state.toUpperCase()))
        .sort((a, b) => a.number - b.number);
      const start = variables.after ? Number(variables.after) : 0;
      const page = all.slice(start, start + 100);
      const next = start + 100 < all.length;
      return {
        status: 200,
        json: {
          data: {
            repository: {
              issues: { pageInfo: { hasNextPage: next, endCursor: next ? String(start + 100) : null }, nodes: page.map((i) => this.#node(r, i)) },
              closed: { totalCount: [...r.issues.values()].filter((i) => i.state === "closed").length },
            },
          },
        },
      };
    }
    const repository = {};
    for (const mm of query.matchAll(/i(\d+): issue\(number: (\d+)\)/g)) {
      const i = r.issues.get(Number(mm[2]));
      repository[`i${mm[1]}`] = i ? this.#node(r, i) : null;
    }
    return { status: 200, json: { data: { repository } } };
  }

  #upload(req) {
    const q = req.query;
    const owner = q.get("owner");
    const repo = q.get("repo");
    const r = this.repo(owner, repo);
    if (!r) return { status: 404, json: { message: "Not Found" } };
    const data = req.raw ?? Buffer.alloc(0);
    if (data.length > 100 * 1024 * 1024) return { status: 413, json: { message: "單檔上限 100 MB" } };
    const name = q.get("name") ?? "file";
    const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
    const issue = q.get("issue");
    const path = `attachments/${issue}/${issue}-${Date.now()}-file${ext ? "." + ext : ""}`;
    const big = data.length > Number(q.get("threshold") ?? 10) * 1024 * 1024;
    this.files.set(`${owner}/${repo}:${path}`.toLowerCase(), { type: req.headers?.["content-type"] ?? "application/octet-stream", data });
    const url = big
      ? `https://github.com/${owner}/${repo}/releases/download/taskapp-attachments-001/${path.split("/").pop()}`
      : `https://github.com/${owner}/${repo}/blob/taskapp-assets/${path}`;
    if (big) this.files.set(url.toLowerCase(), this.files.get(`${owner}/${repo}:${path}`.toLowerCase()));
    return { status: 200, json: { url, name, size: data.length, kind: big ? "release" : "branch" } };
  }

  #download(u) {
    let m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/taskapp-assets\/(attachments\/.+)$/);
    const f = m ? this.files.get(`${m[1]}/${m[2]}:${m[3]}`.toLowerCase()) : this.files.get(u.toLowerCase());
    if (!f) return { status: 404, json: { message: "找不到附件" } };
    return { status: 200, body: f.data, headers: { "Content-Type": f.type } };
  }
}
