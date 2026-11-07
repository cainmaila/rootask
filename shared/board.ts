// 看板（#43、#82）。純函式：把任務樹排成「欄位＝狀態」的卡片。
// - 每欄照任務樹的順序（深度優先：父任務在前、子任務照原生順序），和任務樹共用同一個順序（#42）
// - 卡片＝全部任務；可切換只看最底層任務（Cain 決定，2026-11-07）

export interface BoardItem {
  number: number;
  statusId: string;
  /** 有沒有子任務（含沒載入的已完成子任務） */
  hasChildren: boolean;
}

export interface BoardOptions {
  /** 只看最底層任務（沒有子任務的） */
  leavesOnly: boolean;
  /** 篩選時只放符合的任務；null 表示不篩選 */
  only: Set<number> | null;
}

/** 任務樹的深度優先順序（null＝ROOT） */
export function treeOrder(children: Map<number | null, number[]>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (p: number | null) => {
    for (const n of children.get(p) ?? []) {
      if (seen.has(n)) continue; // 保險：資料有迴圈時不會無限遞迴
      seen.add(n);
      out.push(n);
      walk(n);
    }
  };
  walk(null);
  return out;
}

/** 每個狀態一欄，欄內照任務樹順序 */
export function boardColumns(
  statusIds: string[],
  order: number[],
  items: Map<number, BoardItem>,
  opts: BoardOptions,
): Map<string, number[]> {
  const cols = new Map<string, number[]>(statusIds.map((id) => [id, []]));
  for (const n of order) {
    const it = items.get(n);
    if (!it) continue;
    if (opts.leavesOnly && it.hasChildren) continue;
    if (opts.only && !opts.only.has(n)) continue;
    cols.get(it.statusId)?.push(n);
  }
  return cols;
}

/** 卡片上的上層路徑（由上到下），最多 depth 層，太深的前面用 … */
export function ancestry(
  n: number,
  parentOf: (n: number) => number | null,
  depth = 2,
): { numbers: number[]; truncated: boolean } {
  const chain: number[] = [];
  const seen = new Set<number>([n]);
  let p = parentOf(n);
  while (p !== null && !seen.has(p)) {
    seen.add(p);
    chain.unshift(p);
    p = parentOf(p);
  }
  return { numbers: chain.slice(-depth), truncated: chain.length > depth };
}
