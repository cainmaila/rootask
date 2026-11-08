import { describe, expect, it } from "vitest";
import { buildTree, planReorder, type LoadedTree, type Task } from "../web/src/tasks";
import {
  applyReorder,
  changedIssues,
  structureChanges,
  newlyClosed,
  patchTask,
  reorderAffects,
  reparent,
  replaceTasks,
  restoreTasks,
  statusPatch,
  withStatus,
} from "../web/src/optimistic";
import type { StatusDef } from "../web/src/config";

function task(number: number, over: Partial<Task> = {}): Task {
  return {
    id: `I_${number}`,
    databaseId: 1000 + number,
    number,
    title: `任務 ${number}`,
    body: "",
    meta: {},
    closedAt: null,
    state: "OPEN",
    stateReason: null,
    labels: ["status:todo"],
    assignees: [],
    parent: null,
    milestone: null,
    childOrder: [],
    childTotal: 0,
    childCompleted: 0,
    updatedAt: "2026-11-07T00:00:00Z",
    ...over,
  };
}

function tree(tasks: Task[], closedCount = 0): LoadedTree {
  return { ...buildTree(tasks), closedCount, includeClosed: false };
}

// 1、2、3 在最上層；1 底下有 4、5
const base = () =>
  tree([
    task(1, { childOrder: [4, 5], childTotal: 2 }),
    task(2),
    task(3),
    task(4, { parent: 1 }),
    task(5, { parent: 1 }),
  ]);

const done: StatusDef = { id: "done", name: "完成", category: "done" };
const todo: StatusDef = { id: "todo", name: "待處理", category: "todo" };
const dropped: StatusDef = { id: "dropped", name: "取消", category: "cancelled" };

describe("樂觀更新（#48）", () => {
  it("改欄位不會動到原本的樹", () => {
    const t = base();
    const next = patchTask(t, 2, { title: "新標題" });
    expect(next.byNumber.get(2)!.title).toBe("新標題");
    expect(t.byNumber.get(2)!.title).toBe("任務 2");
    expect(next.children.get(null)).toEqual([1, 2, 3]);
  });

  it("改狀態：標籤、開關與已關閉總數一致", () => {
    const t = base();
    const p = statusPatch(t.byNumber.get(2)!, done, "2026-11-07T01:00:00Z");
    expect(p).toMatchObject({ labels: ["status:done"], state: "CLOSED", stateReason: "COMPLETED", closedAt: "2026-11-07T01:00:00Z" });
    const closed = patchTask(t, 2, p);
    expect(closed.closedCount).toBe(1);
    expect(newlyClosed(t, closed)).toEqual([2]);

    const reopened = patchTask(closed, 2, statusPatch(closed.byNumber.get(2)!, todo));
    expect(reopened.byNumber.get(2)).toMatchObject({ state: "OPEN", stateReason: "REOPENED", closedAt: null });
    expect(reopened.closedCount).toBe(0);

    expect(statusPatch(t.byNumber.get(2)!, dropped).stateReason).toBe("NOT_PLANNED");
  });

  it("#69 子任務改成完成／改回來，父任務的完成數立刻跟著變", () => {
    const t = withStatus(base(), 4, done);
    expect(t.byNumber.get(1)).toMatchObject({ childCompleted: 1, childTotal: 2 });
    expect(withStatus(t, 4, done).byNumber.get(1)!.childCompleted).toBe(1); // 已完成再改成完成不重複計算
    expect(withStatus(t, 4, todo).byNumber.get(1)!.childCompleted).toBe(0);
    expect(withStatus(base(), 2, done).byNumber.get(2)!.state).toBe("CLOSED"); // 沒有父任務也可以
  });

  it("換父任務：舊的拿掉、新的接在最後，子任務數跟著變", () => {
    const t = reparent(base(), 4, 2);
    expect(t.byNumber.get(1)).toMatchObject({ childOrder: [5], childTotal: 1 });
    expect(t.byNumber.get(2)).toMatchObject({ childOrder: [4], childTotal: 1 });
    expect(t.children.get(2)).toEqual([4]);
    expect(t.children.get(1)).toEqual([5]);
    // 移到最上層
    const r = reparent(base(), 5, null);
    expect(r.children.get(null)).toContain(5);
    expect(r.byNumber.get(1)!.childOrder).toEqual([4]);
  });

  it("最上層排序：照 planReorder 的 rank 移動", () => {
    const t = base();
    const plan = planReorder(t, 3, 1, "before")!;
    const next = applyReorder(t, 3, plan);
    expect(next.children.get(null)).toEqual([3, 1, 2]);
    expect(reorderAffects(t, 3, plan)).toEqual([3]);
  });

  it("子任務排序：照錨點插入", () => {
    const t = base();
    const plan = planReorder(t, 5, 4, "before")!;
    const next = applyReorder(t, 5, plan);
    expect(next.children.get(1)).toEqual([5, 4]);
    expect(reorderAffects(t, 5, plan)).toEqual([5, 1]);
  });

  it("拖到別的父任務底下：換父任務並放在指定位置", () => {
    const t = base();
    const plan = planReorder(t, 2, 4, "after")!;
    expect(plan.reparent).toBe(true);
    const next = applyReorder(t, 2, plan);
    expect(next.children.get(1)).toEqual([4, 2, 5]);
    expect(next.children.get(null)).toEqual([1, 3]);
    expect(reorderAffects(t, 2, plan)).toEqual([2, 1]);
  });

  it("從子任務拖到最上層", () => {
    const t = base();
    const plan = planReorder(t, 4, 2, "after")!;
    const next = applyReorder(t, 4, plan);
    expect(next.children.get(null)).toEqual([1, 2, 4, 3]);
    expect(next.byNumber.get(1)!.childOrder).toEqual([5]);
    expect(reorderAffects(t, 4, plan)).toEqual([4, 1]);
  });

  it("失敗還原：只換回受影響的任務，其他同時進行的改動保留", () => {
    const before = base();
    const moved = applyReorder(before, 5, planReorder(before, 5, 4, "before")!);
    const other = patchTask(moved, 3, { title: "別的改動" });
    const restored = restoreTasks(other, before, [5, 1]);
    expect(restored.children.get(1)).toEqual([4, 5]);
    expect(restored.byNumber.get(3)!.title).toBe("別的改動");
  });

  it("重新讀取到沒載入過的已關閉任務，不重複計算已關閉總數", () => {
    const t = base();
    const hidden = task(9, { state: "CLOSED", parent: null });
    const next = replaceTasks({ ...t, closedCount: 3 }, [hidden]);
    expect(next.closedCount).toBe(3);
    expect(next.byNumber.has(9)).toBe(true);
  });
});

describe("定時檢查（#49）", () => {
  const stamp = (number: number, updated_at: string, state: "open" | "closed" = "open") => ({ number, updated_at, state });
  it("只挑出和畫面上不一樣的", () => {
    const t = base(); // 所有任務 updatedAt 都是 2026-11-07T00:00:00Z
    const same = "2026-11-07T00:00:00Z";
    const later = "2026-11-07T01:00:00Z";
    expect(
      changedIssues(t, [stamp(2, later), stamp(3, same), stamp(9, later), stamp(10, later, "closed"), stamp(4, later, "closed")]),
    ).toEqual([2, 9, 4]);
    // 顯示已完成時，沒載入的已關閉任務也要讀
    expect(changedIssues({ ...t, includeClosed: true }, [stamp(10, later, "closed")])).toEqual([10]);
  });
});

describe("定時檢查：任務樹結構（#49）", () => {
  const ev = (id: number, event: string, number: number) => ({ id, event, issue: { number } });
  it("第一次只記下最新的事件", () => {
    expect(structureChanges([ev(5, "sub_issue_added", 2)], null)).toEqual({ numbers: [], lastId: 5 });
    // repo 還沒有任何事件：從 0 開始，下一次的新事件才不會又被當成第一次
    const first = structureChanges([], null);
    expect(first).toEqual({ numbers: [], lastId: 0 });
    expect(structureChanges([ev(1, "parent_issue_added", 7)], first.lastId).numbers).toEqual([7]);
  });
  it("之後挑出新的換父任務事件，其他事件不管", () => {
    const events = [ev(9, "parent_issue_added", 5), ev(8, "sub_issue_added", 2), ev(7, "labeled", 3), ev(4, "sub_issue_removed", 1)];
    expect(structureChanges(events, 5)).toEqual({ numbers: [5, 2], lastId: 9 });
    expect(structureChanges([], 9)).toEqual({ numbers: [], lastId: 9 });
  });
});
