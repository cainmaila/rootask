// 記憶體裡的假 GitHub，只實作自動化會用到的 REST 端點。
import YAML from "yaml";
import type { ProjectConfig } from "../shared/rules";

export interface FakeIssue {
  number: number;
  state: "open" | "closed";
  state_reason: string | null;
  labels: string[];
  parent: number | null;
  events: { event: string; label?: { name: string } }[];
}

export class FakeGitHub {
  issues = new Map<number, FakeIssue>();
  comments: { n: number; body: string }[] = [];
  roles = new Map<string, string>();
  config: ProjectConfig | null = null;
  patches = 0;

  add(number: number, labels: string[], opts: Partial<FakeIssue> = {}) {
    const i: FakeIssue = {
      number,
      state: "open",
      state_reason: null,
      labels: [...labels],
      parent: null,
      events: labels.map((l) => ({ event: "labeled", label: { name: l } })),
      ...opts,
    };
    this.issues.set(number, i);
    return i;
  }

  /** 模擬使用者在 GitHub 網頁上加標籤（會留下事件紀錄） */
  userLabel(n: number, label: string) {
    const i = this.issues.get(n)!;
    if (!i.labels.includes(label)) i.labels.push(label);
    i.events.push({ event: "labeled", label: { name: label } });
  }

  private view(i: FakeIssue) {
    return { number: i.number, state: i.state, state_reason: i.state_reason, labels: i.labels.map((name) => ({ name })) };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/repos\/o\/r/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
    const notFound = () => new Response("{}", { status: 404 });
    let m: RegExpMatchArray | null;

    if (path === "/contents/.taskapp/config.yml") {
      if (!this.config) return notFound();
      const b64 = Buffer.from(YAML.stringify(this.config)).toString("base64");
      return json({ content: b64 });
    }
    if ((m = path.match(/^\/collaborators\/([^/]+)\/permission$/))) {
      return json({ role_name: this.roles.get(decodeURIComponent(m[1])) ?? "read" });
    }
    if (path === "/labels" && method === "POST") return json({}, 201);
    if ((m = path.match(/^\/issues\/(\d+)\/parent$/))) {
      const p = this.issues.get(Number(m[1]))?.parent;
      return p ? json(this.view(this.issues.get(p)!)) : notFound();
    }
    if ((m = path.match(/^\/issues\/(\d+)\/sub_issues$/))) {
      const n = Number(m[1]);
      return json([...this.issues.values()].filter((i) => i.parent === n).map((i) => this.view(i)));
    }
    if ((m = path.match(/^\/issues\/(\d+)\/events$/))) {
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(page === 1 ? this.issues.get(Number(m[1]))!.events : []);
    }
    if ((m = path.match(/^\/issues\/(\d+)\/comments$/)) && method === "POST") {
      this.comments.push({ n: Number(m[1]), body: body.body });
      return json({}, 201);
    }
    if ((m = path.match(/^\/issues\/(\d+)$/))) {
      const i = this.issues.get(Number(m[1]));
      if (!i) return notFound();
      if (method === "PATCH") {
        this.patches++;
        if (body.labels) {
          for (const l of body.labels as string[]) if (!i.labels.includes(l)) i.events.push({ event: "labeled", label: { name: l } });
          i.labels = body.labels;
        }
        if (body.state) i.state = body.state;
        i.state_reason = body.state === "closed" ? (body.state_reason ?? "completed") : body.state_reason ?? null;
      }
      return json(this.view(i));
    }
    throw new Error(`FakeGitHub 未實作：${method} ${url.pathname}`);
  };
}
