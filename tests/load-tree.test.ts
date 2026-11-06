import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTree } from "../web/src/tasks";

afterEach(() => vi.unstubAllGlobals());

interface Fake {
  number: number;
  state: "OPEN" | "CLOSED";
  parent: number | null;
  kids?: number[];
  completed?: number;
}

const node = (f: Fake) => ({
  id: `I_${f.number}`,
  databaseId: 1000 + f.number,
  number: f.number,
  title: `任務 ${f.number}`,
  body: "",
  state: f.state,
  stateReason: f.state === "CLOSED" ? "COMPLETED" : null,
  updatedAt: "2026-11-06T00:00:00Z",
  closedAt: f.state === "CLOSED" ? "2026-11-05T00:00:00Z" : null,
  labels: { nodes: [] },
  assignees: { nodes: [] },
  parent: f.parent ? { number: f.parent } : null,
  subIssues: { nodes: (f.kids ?? []).map((number) => ({ number })) },
  subIssuesSummary: { total: f.kids?.length ?? 0, completed: f.completed ?? 0 },
});

/** 假的 GraphQL：列表查詢依 states 過濾，別名查詢依編號回傳 */
function fakeGraphql(all: Fake[]) {
  const calls: { states?: string[] | null; numbers?: number[] }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { states?: string[] | null } };
    if (query.includes("issues(first: 100")) {
      calls.push({ states: variables.states });
      const nodes = all.filter((f) => !variables.states || variables.states.includes(f.state)).map(node);
      const closed = all.filter((f) => f.state === "CLOSED").length;
      return Response.json({
        data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes }, closed: { totalCount: closed } } },
      });
    }
    const numbers = [...query.matchAll(/i(\d+): issue/g)].map((m) => Number(m[1]));
    calls.push({ numbers });
    const repository: Record<string, unknown> = {};
    for (const n of numbers) {
      const f = all.find((x) => x.number === n);
      repository[`i${n}`] = f ? node(f) : null;
    }
    return Response.json({ data: { repository } });
  });
  return calls;
}

const world: Fake[] = [
  { number: 1, state: "CLOSED", parent: null, kids: [2], completed: 1 },
  { number: 2, state: "CLOSED", parent: 1, kids: [3, 4], completed: 1 },
  { number: 3, state: "OPEN", parent: 2 },
  { number: 4, state: "CLOSED", parent: 2 },
  { number: 5, state: "OPEN", parent: null },
  { number: 9, state: "CLOSED", parent: null },
];

describe("載入任務樹（#46 隱藏已完成）", () => {
  it("預設只載入未完成的任務，但會補上它們已關閉的上層，樹不會斷", async () => {
    const calls = fakeGraphql(world);
    const t = await loadTree("o", "r");
    expect(calls[0].states).toEqual(["OPEN"]);
    expect([...t.byNumber.keys()].sort()).toEqual([1, 2, 3, 5]); // 4、9 沒有未完成的子孫，不載入
    expect(t.children.get(null)).toEqual([1, 5]);
    expect(t.children.get(1)).toEqual([2]);
    expect(t.children.get(2)).toEqual([3]);
    expect(t.closedCount).toBe(4); // #1 #2 #4 #9
    expect(t.includeClosed).toBe(false);
    // 子任務數用 GitHub 統計：#2 有 2 個子任務、完成 1 個，即使 #4 沒載入
    expect(t.byNumber.get(2)).toMatchObject({ childTotal: 2, childCompleted: 1 });
  });

  it("正在看的任務即使已完成也會載入", async () => {
    fakeGraphql(world);
    const t = await loadTree("o", "r", { pin: [9] });
    expect(t.byNumber.has(9)).toBe(true);
    expect(t.children.get(null)).toContain(9);
  });

  it("顯示已完成時一次載入全部，不需要額外補抓", async () => {
    const calls = fakeGraphql(world);
    const t = await loadTree("o", "r", { includeClosed: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].states).toBeNull();
    expect(t.byNumber.size).toBe(6);
  });

  it("找不到的編號（例如已刪除）不會無限重試", async () => {
    const calls = fakeGraphql(world);
    await loadTree("o", "r", { pin: [404] });
    expect(calls.filter((c) => c.numbers?.includes(404))).toHaveLength(1);
  });
});
