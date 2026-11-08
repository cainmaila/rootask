import { describe, expect, it } from "vitest";
import { ancestry, boardColumns, boardDrop, boardLanes, columnNeighbor, neighborStatus, sameDrop, treeOrder, type BoardItem } from "../shared/board";

// 1 ─ 4 ─ 6
//   └ 5
// 2
// 3 ─ 7
const children = new Map<number | null, number[]>([
  [null, [1, 2, 3]],
  [1, [4, 5]],
  [4, [6]],
  [3, [7]],
]);
const parents = new Map<number, number>([
  [4, 1],
  [5, 1],
  [6, 4],
  [7, 3],
]);
const item = (number: number, statusId: string, hasChildren = false): [number, BoardItem] => [
  number,
  { number, statusId, hasChildren },
];
const items = new Map<number, BoardItem>([
  item(1, "doing", true),
  item(2, "todo"),
  item(3, "todo", true),
  item(4, "todo", true),
  item(5, "done"),
  item(6, "todo"),
  item(7, "doing"),
]);

describe("看板（#82）", () => {
  it("照任務樹的深度優先順序", () => {
    expect(treeOrder(children)).toEqual([1, 4, 6, 5, 2, 3, 7]);
  });

  it("每個狀態一欄，欄內照任務樹順序；沒有任務的欄位也在", () => {
    const cols = boardColumns(["todo", "doing", "review", "done"], treeOrder(children), items, { leavesOnly: false, only: null });
    expect(Object.fromEntries(cols)).toEqual({ todo: [4, 6, 2, 3], doing: [1, 7], review: [], done: [5] });
  });

  it("只看最底層任務：有子任務的不放", () => {
    const cols = boardColumns(["todo", "doing", "done"], treeOrder(children), items, { leavesOnly: true, only: null });
    expect(Object.fromEntries(cols)).toEqual({ todo: [6, 2], doing: [7], done: [5] });
  });

  it("篩選時只放符合的任務", () => {
    const cols = boardColumns(["todo", "doing", "done"], treeOrder(children), items, {
      leavesOnly: false,
      only: new Set([1, 6, 7]),
    });
    expect(Object.fromEntries(cols)).toEqual({ todo: [6], doing: [1, 7], done: [] });
  });

  it("卡片上的上層路徑，太深的前面省略", () => {
    const parentOf = (n: number) => parents.get(n) ?? null;
    expect(ancestry(6, parentOf)).toEqual({ numbers: [1, 4], truncated: false });
    expect(ancestry(6, parentOf, 1)).toEqual({ numbers: [4], truncated: true });
    expect(ancestry(2, parentOf)).toEqual({ numbers: [], truncated: false });
  });

  it("資料有迴圈也不會卡住", () => {
    const loop = new Map<number | null, number[]>([
      [null, [1]],
      [1, [2]],
      [2, [1]],
    ]);
    expect(treeOrder(loop)).toEqual([1, 2]);
    expect(ancestry(1, (n) => (n === 1 ? 2 : 1)).numbers).toEqual([2]);
  });
});

describe("看板拖曳（#83、#84）", () => {
  const all = () => true;
  const can = { status: all, reorder: true };
  const mv = { n: 6, statusId: "todo", parent: 4 };

  it("拖到別欄＝改狀態，照轉換規則判斷能不能放", () => {
    expect(boardDrop(mv, "doing", null, can)).toEqual({ kind: "status", status: "doing", ok: true });
    const noDone = { status: (_f: string, t: string) => t !== "done", reorder: true };
    expect(boardDrop(mv, "done", null, noDone)).toEqual({ kind: "status", status: "done", ok: false });
    // 放在別欄的卡片上也是改狀態，不管那張卡片
    expect(boardDrop(mv, "doing", { ref: { n: 1, statusId: "doing", parent: null }, position: "before" }, can)?.kind).toBe("status");
  });

  it("同一欄：同一個父任務才能互換；不同父任務、沒有權限都不行", () => {
    const sib = { n: 9, statusId: "todo", parent: 4 };
    const other = { n: 2, statusId: "todo", parent: null };
    expect(boardDrop(mv, "todo", { ref: sib, position: "after" }, can)).toEqual({
      kind: "reorder", status: "todo", n: 9, position: "after", ok: true,
    });
    expect(boardDrop(mv, "todo", { ref: other, position: "after" }, can)).toMatchObject({ ok: false, reason: "parent" });
    // #89：沒有權限時說是權限，不是父任務
    expect(boardDrop(mv, "todo", { ref: sib, position: "after" }, { status: all, reorder: false })).toMatchObject({
      ok: false,
      reason: "permission",
    });
    expect(boardDrop(mv, "todo", null, can)).toBeNull();
    expect(boardDrop(mv, "todo", { ref: mv, position: "after" }, can)).toBeNull();
  });

  it("相同的目標不必重繪", () => {
    const a = boardDrop(mv, "doing", null, can);
    expect(sameDrop(a, boardDrop(mv, "doing", null, can))).toBe(true);
    expect(sameDrop(a, boardDrop(mv, "review", null, can))).toBe(false);
    expect(sameDrop(null, null)).toBe(true);
    expect(sameDrop(a, null)).toBe(false);
  });

  it("鍵盤上下：只跳過不同父任務的卡片", () => {
    const parentOf = (n: number) => parents.get(n) ?? null;
    // 待處理欄：4（父 1）、6（父 4）、2（最上層）、3（最上層）
    const column = [4, 6, 2, 3];
    expect(columnNeighbor(column, 3, -1, parentOf)).toEqual({ target: 2, position: "before" });
    expect(columnNeighbor(column, 2, 1, parentOf)).toEqual({ target: 3, position: "after" });
    expect(columnNeighbor(column, 2, -1, parentOf)).toBeNull(); // 上面的 4、6 是別的父任務
    expect(columnNeighbor(column, 6, 1, parentOf)).toBeNull();
  });

  it("鍵盤左右：只移到隔壁欄，不允許就擋下（#93）", () => {
    const ids = ["todo", "doing", "review", "done"];
    expect(neighborStatus(ids, "todo", 1, all)).toEqual({ to: "doing", blocked: false });
    expect(neighborStatus(ids, "todo", 1, (_f, t) => t !== "doing")).toEqual({ to: "doing", blocked: true });
    expect(neighborStatus(ids, "todo", -1, all)).toBeNull();
    expect(neighborStatus(ids, "done", 1, all)).toBeNull();
  });
});

describe("泳道（#86）", () => {
  it("依父任務分泳道：最上層在前，其他照任務樹順序；空的泳道不列", () => {
    const order = treeOrder(children);
    const cols = boardColumns(["todo", "doing", "done"], order, items, { leavesOnly: true, only: null });
    const lanes = boardLanes(cols, order, (n) => parents.get(n) ?? null);
    expect(lanes.map((l) => l.parent)).toEqual([null, 1, 4, 3]);
    expect(Object.fromEntries(lanes[0].columns)).toEqual({ todo: [2], doing: [], done: [] });
    expect(Object.fromEntries(lanes[1].columns)).toEqual({ todo: [], doing: [], done: [5] });
    expect(lanes[2].count).toBe(1);
  });
});
