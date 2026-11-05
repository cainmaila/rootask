import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, autoCompleteTarget, transitionAllowed, type ProjectConfig } from "../shared/rules";
import { onIssues, onSubIssues, type IssuesEvent } from "../worker/src/automation";
import { GhClient } from "../worker/src/github-app";
import { FakeGitHub } from "./fake-github";

const repo = { name: "r", owner: { login: "o" } };
const gh = new GhClient("test");
let fake: FakeGitHub;

function ev(action: string, n: number, extra: Partial<IssuesEvent> = {}): IssuesEvent {
  return {
    action,
    issue: { number: n, state: "open", labels: [] },
    sender: { login: "alice", type: "User" },
    repository: repo,
    ...extra,
  };
}
const issue = (n: number) => fake.issues.get(n)!;
const statusLabels = (n: number) => issue(n).labels.filter((l) => l.startsWith("status:"));

const withRules: ProjectConfig = {
  ...DEFAULT_CONFIG,
  auto_complete_parent: true,
  transitions: [
    { from: "review", to: "done", allowed: ["maintain"] },
    { from: "todo", to: "done", allowed: "none" },
  ],
};

beforeEach(() => {
  fake = new FakeGitHub();
  fake.config = { ...DEFAULT_CONFIG };
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("轉換規則（純邏輯）", () => {
  it("沒有規則時一律允許", () => {
    expect(transitionAllowed(DEFAULT_CONFIG, "todo", "done", "write", "a")).toBe(true);
  });
  it("依權限等級與帳號判斷", () => {
    expect(transitionAllowed(withRules, "review", "done", "write", "a")).toBe(false);
    expect(transitionAllowed(withRules, "review", "done", "maintain", "a")).toBe(true);
    expect(transitionAllowed(withRules, "review", "done", "admin", "a")).toBe(true);
    expect(transitionAllowed(withRules, "todo", "done", "admin", "a")).toBe(false);
    const byLogin = { ...withRules, transitions: [{ from: "*", to: "done", allowed: ["@Cain"] }] };
    expect(transitionAllowed(byLogin, "doing", "done", "write", "cain")).toBe(true);
  });
  it("有核准關卡時，自動完成停在關卡前", () => {
    expect(autoCompleteTarget(withRules)).toMatchObject({ status: { id: "review" }, needsApproval: true });
    expect(autoCompleteTarget(DEFAULT_CONFIG)).toMatchObject({ status: { id: "done" }, needsApproval: false });
  });
});

describe("#16 狀態一致性", () => {
  it("沒有設定檔的 repo 完全不動", async () => {
    fake.config = null;
    fake.add(1, []);
    await onIssues(gh, ev("opened", 1));
    expect(fake.patches).toBe(0);
  });

  it("新建的 issue 補上預設狀態", async () => {
    fake.add(1, ["bug"]);
    await onIssues(gh, ev("opened", 1));
    expect(issue(1).labels).toEqual(["bug", "status:todo"]);
  });

  it("貼了第二個狀態標籤：只留新的，並同步關閉", async () => {
    fake.add(1, ["status:doing"]);
    fake.userLabel(1, "status:done");
    await onIssues(gh, ev("labeled", 1, { label: { name: "status:done" } }));
    expect(statusLabels(1)).toEqual(["status:done"]);
    expect(issue(1).state).toBe("closed");
  });

  it("手動關閉：補上完成；以不處理關閉：補上放棄", async () => {
    fake.add(1, ["status:doing"], { state: "closed", state_reason: "completed" });
    await onIssues(gh, ev("closed", 1));
    expect(statusLabels(1)).toEqual(["status:done"]);

    fake.add(2, ["status:doing"], { state: "closed", state_reason: "not_planned" });
    await onIssues(gh, ev("closed", 2));
    expect(statusLabels(2)).toEqual(["status:dropped"]);
  });

  it("手動重開已完成的任務：退回待處理", async () => {
    fake.add(1, ["status:done"], { state: "open" });
    await onIssues(gh, ev("reopened", 1));
    expect(statusLabels(1)).toEqual(["status:todo"]);
    expect(issue(1).state).toBe("open");
  });

  it("已經一致時不送任何修改", async () => {
    fake.add(1, ["status:doing"]);
    await onIssues(gh, ev("unlabeled", 1));
    expect(fake.patches).toBe(0);
  });
});

describe("#17 轉換規則", () => {
  beforeEach(() => {
    fake.config = withRules;
  });

  it("沒權限的人把待審核改成完成：還原並留言", async () => {
    fake.roles.set("alice", "write");
    fake.add(1, ["status:review"]);
    fake.userLabel(1, "status:done");
    await onIssues(gh, ev("labeled", 1, { label: { name: "status:done" } }));
    expect(statusLabels(1)).toEqual(["status:review"]);
    expect(issue(1).state).toBe("open");
    expect(fake.comments[0].body).toContain("@alice");
  });

  it("maintainer 可以核准", async () => {
    fake.roles.set("alice", "maintain");
    fake.add(1, ["status:review"]);
    fake.userLabel(1, "status:done");
    await onIssues(gh, ev("labeled", 1, { label: { name: "status:done" } }));
    expect(statusLabels(1)).toEqual(["status:done"]);
    expect(issue(1).state).toBe("closed");
  });

  it("在 GitHub 網頁上直接關閉也受規則限制", async () => {
    fake.roles.set("alice", "admin");
    fake.add(1, ["status:todo"], { state: "closed", state_reason: "completed" });
    await onIssues(gh, ev("closed", 1));
    expect(issue(1).state).toBe("open");
    expect(statusLabels(1)).toEqual(["status:todo"]);
  });
});

describe("#32 換標籤的競態", () => {
  beforeEach(() => {
    fake.config = withRules;
    fake.roles.set("alice", "admin");
  });

  it("先移除再加上：等待期間新標籤到了，就不補預設狀態", async () => {
    fake.add(1, ["status:doing"]);
    fake.userUnlabel(1, "status:doing");
    let waited = 0;
    await onIssues(gh, ev("unlabeled", 1, { label: { name: "status:doing" } }), {
      sleep: async (ms) => {
        waited = ms;
        fake.userLabel(1, "status:done"); // 使用者在空檔加上新標籤
      },
    });
    expect(waited).toBeGreaterThan(0);
    expect(statusLabels(1)).toEqual(["status:done"]); // 沒有被補上 todo
    await onIssues(gh, ev("labeled", 1, { label: { name: "status:done" } }));
    expect(issue(1).state).toBe("closed"); // doing → done 允許
    expect(fake.comments).toHaveLength(0);
  });

  it("推算上一個狀態時忽略 bot 補的預設值（實際發生的情況）", async () => {
    fake.add(1, ["status:doing"]);
    fake.userUnlabel(1, "status:doing");
    // 舊版行為：bot 在空檔補了 todo
    issue(1).labels.push("status:todo");
    issue(1).events.push({ event: "labeled", label: { name: "status:todo" }, actor: { type: "Bot" } });
    fake.userLabel(1, "status:done");
    await onIssues(gh, ev("labeled", 1, { label: { name: "status:done" } }));
    // 上一個「使用者的」狀態是 doing，doing → done 允許，不該被 todo → done 禁止規則擋下
    expect(statusLabels(1)).toEqual(["status:done"]);
    expect(issue(1).state).toBe("closed");
    expect(fake.comments).toHaveLength(0);
  });

  it("真的只是移除狀態標籤：等待後仍補回", async () => {
    fake.add(1, ["status:doing"]);
    fake.userUnlabel(1, "status:doing");
    await onIssues(gh, ev("unlabeled", 1, { label: { name: "status:doing" } }), { sleep: async () => {} });
    expect(statusLabels(1)).toEqual(["status:todo"]);
  });
});

describe("#18 父任務自動完成", () => {
  it("沒有核准關卡：子任務全完成，父任務直接完成並一路往上", async () => {
    fake.config = { ...DEFAULT_CONFIG, auto_complete_parent: true };
    fake.add(1, ["status:doing"]);
    fake.add(2, ["status:doing"], { parent: 1 });
    fake.add(3, ["status:done"], { parent: 2, state: "closed", state_reason: "completed" });
    fake.add(4, ["status:doing"], { parent: 2, state: "closed", state_reason: "completed" });
    await onIssues(gh, ev("closed", 4));
    expect(statusLabels(2)).toEqual(["status:done"]);
    expect(issue(2).state).toBe("closed");
    expect(statusLabels(1)).toEqual(["status:done"]);
  });

  it("有核准關卡：停在待審核並通知，不再往上推", async () => {
    fake.config = withRules;
    fake.add(1, ["status:doing"]);
    fake.add(2, ["status:doing"], { parent: 1 });
    fake.add(3, ["status:done"], { parent: 2, state: "closed", state_reason: "completed" });
    await onSubIssues(gh, {
      action: "sub_issue_added",
      parent_issue: { number: 2, state: "open", labels: [] },
      sub_issue: { number: 3, state: "closed", labels: [] },
      sender: { login: "alice", type: "User" },
      repository: repo,
    });
    expect(statusLabels(2)).toEqual(["status:review"]);
    expect(issue(2).labels).toContain("rootask:auto");
    expect(issue(2).state).toBe("open");
    expect(fake.comments.some((c) => c.n === 2 && c.body.includes("審核"))).toBe(true);
    expect(statusLabels(1)).toEqual(["status:doing"]);
  });

  it("子任務被重開：自動推進過的父任務退回", async () => {
    fake.config = { ...DEFAULT_CONFIG, auto_complete_parent: true };
    fake.add(1, ["status:review", "rootask:auto"]);
    fake.add(2, ["status:done"], { parent: 1, state: "open" });
    await onIssues(gh, ev("reopened", 2));
    expect(statusLabels(2)).toEqual(["status:todo"]);
    expect(statusLabels(1)).toEqual(["status:doing"]);
    expect(issue(1).labels).not.toContain("rootask:auto");
  });

  it("人手動改過的父任務不會被自動退回", async () => {
    fake.config = { ...DEFAULT_CONFIG, auto_complete_parent: true };
    fake.add(1, ["status:review"]);
    fake.add(2, ["status:done"], { parent: 1, state: "open" });
    await onIssues(gh, ev("reopened", 2));
    expect(statusLabels(1)).toEqual(["status:review"]);
  });

  it("功能關閉時不碰父任務", async () => {
    fake.add(1, ["status:doing"]);
    fake.add(2, ["status:done"], { parent: 1, state: "closed", state_reason: "completed" });
    await onIssues(gh, ev("closed", 2));
    expect(statusLabels(1)).toEqual(["status:doing"]);
  });
});
