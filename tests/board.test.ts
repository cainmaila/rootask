import { describe, expect, it } from "vitest";
import { ancestry, boardColumns, treeOrder, type BoardItem } from "../shared/board";

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
