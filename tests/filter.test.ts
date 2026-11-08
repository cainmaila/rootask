import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterTasks, isFilterActive, type FilterableTask, type TaskFilter } from "../shared/filter";

const t = (number: number, title: string, o: Partial<FilterableTask> = {}): FilterableTask => ({
  number,
  title,
  body: "",
  parent: null,
  assignees: [],
  statusId: "todo",
  closed: false,
  ...o,
});

// 1 網站改版
//   2 首頁設計（cain，逾期）
//     3 Hero 圖片（amy）
//   4 後台 API（done）
// 5 行銷活動（amy，doing）
const tasks = [
  t(1, "網站改版"),
  t(2, "首頁設計", { parent: 1, assignees: ["Cain"], due: "2026-11-01" }),
  t(3, "Hero 圖片", { parent: 2, assignees: ["amy"], body: "需要 SVG 版本" }),
  t(4, "後台 API", { parent: 1, statusId: "done", closed: true, due: "2026-10-01" }),
  t(5, "行銷活動", { assignees: ["amy"], statusId: "doing" }),
];
const run = (f: Partial<TaskFilter>) => filterTasks(tasks, { ...EMPTY_FILTER, ...f }, "cain", "2026-11-07");
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("搜尋與篩選（#47）", () => {
  it("沒有條件時不算篩選中", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, text: "  " })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, overdue: true })).toBe(true);
  });

  it("文字搜尋標題與說明，不分大小寫，多個詞要全部符合", () => {
    expect(sorted(run({ text: "hero" }).matches)).toEqual([3]);
    expect(sorted(run({ text: "svg" }).matches)).toEqual([3]);
    expect(sorted(run({ text: "hero 版本" }).matches)).toEqual([3]);
    expect(sorted(run({ text: "hero 後台" }).matches)).toEqual([]);
  });

  it("可以用 #編號 找任務", () => {
    expect(sorted(run({ text: "#4" }).matches)).toEqual([4]);
  });

  it("保留樹狀結構：符合的任務帶出所有上層並展開", () => {
    const r = run({ text: "hero" });
    expect(sorted(r.visible)).toEqual([1, 2, 3]);
    expect(sorted(r.expand)).toEqual([1, 2]);
  });

  it("分配人：我（不分大小寫）、指定成員、未分配", () => {
    expect(sorted(run({ assignee: "@me" }).matches)).toEqual([2]);
    expect(sorted(run({ assignee: "amy" }).matches)).toEqual([3, 5]);
    expect(sorted(run({ assignee: "@none" }).matches)).toEqual([1, 4]);
  });

  it("狀態篩選", () => {
    expect(sorted(run({ status: "doing" }).matches)).toEqual([5]);
  });

  it("逾期：有截止日、已過、而且還沒完成", () => {
    expect(sorted(run({ overdue: true }).matches)).toEqual([2]); // #4 已完成不算
  });

  it("多個條件同時成立才符合", () => {
    expect(sorted(run({ assignee: "amy", text: "活動" }).matches)).toEqual([5]);
    expect(sorted(run({ assignee: "@me", status: "doing" }).matches)).toEqual([]);
  });

  it("父子關係有迴圈的壞資料不會卡住", () => {
    const loop = [t(1, "a", { parent: 2 }), t(2, "b", { parent: 1 })];
    const r = filterTasks(loop, { ...EMPTY_FILTER, text: "a" }, "me", "2026-11-07");
    expect(sorted(r.visible)).toEqual([1, 2]);
  });
});

describe("Sprint 篩選（#85）", () => {
  const ms = [
    t(1, "A", { milestone: 2 }),
    t(2, "B", { milestone: 3 }),
    t(3, "C", { milestone: null }),
    t(4, "D"),
  ];
  const go = (milestone: string) => filterTasks(ms, { ...EMPTY_FILTER, milestone }, "cain", "2026-11-07").matches;
  it("指定 Sprint、未排入", () => {
    expect([...go("2")]).toEqual([1]);
    expect([...go("@none")].sort()).toEqual([3, 4]);
    expect(isFilterActive({ ...EMPTY_FILTER, milestone: "2" })).toBe(true);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });
});
