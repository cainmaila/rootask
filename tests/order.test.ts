import { describe, expect, it } from "vitest";
import { planMove, rankBetween, sortRoots, type Orderable } from "../shared/order";

type T = Orderable & { parent: number | null };
const t = (number: number, parent: number | null = null, rank?: number): T => ({ number, parent, rank });

function world(items: T[], childOrder: Record<number, number[]> = {}) {
  const by = new Map(items.map((i) => [i.number, i]));
  return (p: number | null) =>
    p === null ? sortRoots(items.filter((i) => i.parent === null)) : (childOrder[p] ?? []).map((n) => by.get(n)!);
}

describe("最上層排序", () => {
  it("沒有 rank 時依編號，有 rank 時依 rank", () => {
    expect(sortRoots([t(3), t(1), t(2)]).map((x) => x.number)).toEqual([1, 2, 3]);
    expect(sortRoots([t(3), t(1), t(2, null, 0.5)]).map((x) => x.number)).toEqual([2, 1, 3]);
  });

  it("取中間值", () => {
    expect(rankBetween(2, 3)).toBe(2.5);
    expect(rankBetween(undefined, 1)).toBe(0);
    expect(rankBetween(5, undefined)).toBe(6);
  });

  it("把第三項移到第二項前面（Cain 的例子）：只算出被移動那張的新 rank", () => {
    const items = [t(1), t(2), t(3)];
    const plan = planMove(items[2], items[1], "before", world(items));
    expect(plan).toMatchObject({ parent: null, reparent: false, rank: 1.5, noop: false });
    // 套用後順序變成 1, 3, 2
    const after = sortRoots([t(1), t(2), t(3, null, plan.rank)]).map((x) => x.number);
    expect(after).toEqual([1, 3, 2]);
  });

  it("移到最前面與最後面", () => {
    const items = [t(1), t(2), t(3)];
    expect(planMove(items[2], items[0], "before", world(items)).rank).toBe(0);
    expect(planMove(items[0], items[2], "after", world(items)).rank).toBe(4);
  });

  it("放回原位不做任何事", () => {
    const items = [t(1), t(2), t(3)];
    expect(planMove(items[1], items[0], "after", world(items)).noop).toBe(true);
    expect(planMove(items[1], items[2], "before", world(items)).noop).toBe(true);
  });

  it("連續插在同兩張中間，順序仍然正確", () => {
    let items = [t(1), t(2)];
    for (let i = 0; i < 30; i++) {
      const n = 100 + i;
      const moving = t(n);
      const all = [...items, moving];
      const plan = planMove(moving, all.find((x) => x.number === 2)!, "before", world(all));
      items = [...items, t(n, null, plan.rank)];
    }
    const order = sortRoots(items).map((x) => x.number);
    expect(order[0]).toBe(1);
    expect(order[order.length - 1]).toBe(2);
  });
});

describe("子任務排序", () => {
  it("同一父任務底下：用 GitHub 原生順序，放在目標前後", () => {
    const items = [t(10), t(11, 10), t(12, 10), t(13, 10)];
    const plan = planMove(items[3], items[1], "after", world(items, { 10: [11, 12, 13] }));
    expect(plan).toMatchObject({ parent: 10, reparent: false, anchor: { position: "after", sibling: 11 } });
  });

  it("拖到別的父任務的子任務旁：要換父任務", () => {
    const items = [t(10), t(20), t(11, 10), t(21, 20)];
    const plan = planMove(items[2], items[3], "before", world(items, { 10: [11], 20: [21] }));
    expect(plan).toMatchObject({ parent: 20, reparent: true, anchor: { position: "before", sibling: 21 } });
  });

  it("把子任務拖到最上層兩張之間：換成最上層並給 rank", () => {
    const items = [t(1), t(2), t(11, 1)];
    const plan = planMove(items[2], items[1], "before", world(items, { 1: [11] }));
    expect(plan).toMatchObject({ parent: null, reparent: true, rank: 1.5 });
  });
});
