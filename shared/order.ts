// 任務順序（#42）。任務樹與看板共用同一個順序。
// - 同一父任務底下：GitHub 原生 sub-issues 的順序
// - 最上層（虛擬 ROOT）：任務隱藏區塊的 rank；沒有 rank 時以 issue 編號當 rank（新任務自然排在最後）

export interface Orderable {
  number: number;
  rank?: number;
}

export const rankOf = (t: Orderable): number => t.rank ?? t.number;

export function sortRoots<T extends Orderable>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => rankOf(a) - rankOf(b) || a.number - b.number);
}

/** 取兩個 rank 之間的值；只移動一張卡片、只改這一張的 rank */
export function rankBetween(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + 1;
  if (next !== undefined) return next - 1;
  return 0;
}

export type DropPosition = "before" | "after";

export interface MovePlan {
  /** 移動後的父任務，null ＝ ROOT */
  parent: number | null;
  /** 需不需要換父任務 */
  reparent: boolean;
  /** 最上層：新的 rank */
  rank?: number;
  /** 子任務：放在哪個兄弟的前或後（issue 編號） */
  anchor?: { position: DropPosition; sibling: number };
  /** 位置沒有改變 */
  noop: boolean;
}

/**
 * 把 moving 放到 target 的前或後，成為 target 的同層。
 * siblingsOf(parent) 回傳該父任務底下目前的順序（含 moving 自己）。
 */
export function planMove(
  moving: Orderable & { parent: number | null },
  target: Orderable & { parent: number | null },
  position: DropPosition,
  siblingsOf: (parent: number | null) => Orderable[],
): MovePlan {
  const parent = target.parent;
  const reparent = moving.parent !== parent;
  const others = siblingsOf(parent).filter((t) => t.number !== moving.number);
  const at = others.findIndex((t) => t.number === target.number);
  const insertAt = position === "before" ? at : at + 1;

  if (!reparent) {
    const cur = siblingsOf(parent).map((t) => t.number);
    const next = [...others.map((t) => t.number)];
    next.splice(insertAt, 0, moving.number);
    if (cur.join(",") === next.join(",")) return { parent, reparent, noop: true };
  }

  if (parent === null) {
    const prev = others[insertAt - 1];
    const next = others[insertAt];
    return { parent, reparent, rank: rankBetween(prev && rankOf(prev), next && rankOf(next)), noop: false };
  }
  return { parent, reparent, anchor: { position, sibling: target.number }, noop: false };
}
