// 樂觀更新（#48）：寫回 GitHub 之前先在畫面上生效，之後只重新讀取受影響的任務。
// 這裡都是純函式：輸入目前的樹，回傳新的樹，不會改到原本的物件。
import { STATUS_PREFIX, type StatusDef } from "./config";
import type { MovePlan } from "../../shared/order";
import { buildTree, orderable, type LoadedTree, type Task } from "./tasks";

const isClosed = (t: Task | undefined) => t?.state === "CLOSED";

/**
 * 把一組任務換成新版本（沒有的就加進來），重建樹。
 * 已載入的任務開關狀態改變時，repo 的已關閉總數跟著調整。
 */
export function replaceTasks(tree: LoadedTree, tasks: Task[]): LoadedTree {
  const byNumber = new Map(tree.byNumber);
  let closedCount = tree.closedCount;
  for (const t of tasks) {
    const old = byNumber.get(t.number);
    // 沒載入過的已關閉任務本來就算在總數裡
    if (old) closedCount += Number(isClosed(t)) - Number(isClosed(old));
    byNumber.set(t.number, t);
  }
  return { ...buildTree([...byNumber.values()]), closedCount, includeClosed: tree.includeClosed };
}

/** 改一張任務的欄位 */
export function patchTask(tree: LoadedTree, n: number, patch: Partial<Task>): LoadedTree {
  const t = tree.byNumber.get(n);
  return t ? replaceTasks(tree, [{ ...t, ...patch }]) : tree;
}

/** 失敗時把這幾張任務換回操作前的版本 */
export function restoreTasks(tree: LoadedTree, before: LoadedTree, numbers: number[]): LoadedTree {
  const olds = numbers.map((n) => before.byNumber.get(n)).filter((t): t is Task => !!t);
  return replaceTasks(tree, olds);
}

/** 改狀態後的標籤與開關，和 setStatus() 寫回 GitHub 的一致 */
export function statusPatch(task: Task, status: StatusDef, now = new Date().toISOString()): Partial<Task> {
  const closed = status.category === "done" || status.category === "cancelled";
  return {
    labels: [...task.labels.filter((l) => !l.startsWith(STATUS_PREFIX)), STATUS_PREFIX + status.id],
    state: closed ? "CLOSED" : "OPEN",
    stateReason: closed ? (status.category === "done" ? "COMPLETED" : "NOT_PLANNED") : task.state === "CLOSED" ? "REOPENED" : null,
    closedAt: closed ? (task.state === "CLOSED" ? task.closedAt : now) : null,
  };
}

/** 換父任務：從舊的父任務拿掉、接到新父任務的最後（GitHub 也是加在最後） */
export function reparent(tree: LoadedTree, n: number, to: number | null): LoadedTree {
  const task = tree.byNumber.get(n);
  if (!task) return tree;
  const from = task.parent;
  if (from === to) return tree;
  const done = Number(isClosed(task));
  const changed: Task[] = [{ ...task, parent: to }];
  const fromT = from !== null ? tree.byNumber.get(from) : undefined;
  if (fromT) {
    changed.push({
      ...fromT,
      childOrder: fromT.childOrder.filter((k) => k !== n),
      childTotal: Math.max(0, fromT.childTotal - 1),
      childCompleted: Math.max(0, fromT.childCompleted - done),
    });
  }
  const toT = to !== null ? tree.byNumber.get(to) : undefined;
  if (toT) {
    changed.push({
      ...toT,
      childOrder: [...toT.childOrder.filter((k) => k !== n), n],
      childTotal: toT.childTotal + 1,
      childCompleted: toT.childCompleted + done,
    });
  }
  return replaceTasks(tree, changed);
}

/** 照 planReorder() 的計畫調整順序 */
export function applyReorder(tree: LoadedTree, moving: number, plan: MovePlan): LoadedTree {
  let next = tree;
  if (plan.reparent) next = reparent(next, moving, plan.parent);
  if (plan.parent === null) {
    const t = next.byNumber.get(moving)!;
    // 上層不在這棵樹裡（例如在別的 repo）時，原本的 parent 照樣保留，只是畫在 ROOT
    return patchTask(next, moving, { meta: { ...t.meta, rank: plan.rank } });
  }
  if (!plan.anchor) return next;
  const parent = next.byNumber.get(plan.parent);
  if (!parent) return next;
  const order = parent.childOrder.filter((k) => k !== moving);
  const at = order.indexOf(plan.anchor.sibling);
  if (at < 0) order.push(moving);
  else order.splice(plan.anchor.position === "before" ? at : at + 1, 0, moving);
  return patchTask(next, plan.parent, { childOrder: order });
}

/** 調整順序會動到的任務：自己、原本與新的父任務 */
export function reorderAffects(tree: LoadedTree, moving: number, plan: MovePlan): number[] {
  const from = orderable(tree, moving).parent;
  return [...new Set([moving, from, plan.parent].filter((x): x is number => x !== null))];
}

/** 剛從開啟變成關閉的任務（#63：留在清單上到重新整理為止） */
export function newlyClosed(prev: LoadedTree, next: LoadedTree): number[] {
  const out: number[] = [];
  for (const t of next.byNumber.values()) {
    if (t.state === "CLOSED" && prev.byNumber.get(t.number)?.state === "OPEN") out.push(t.number);
  }
  return out;
}
