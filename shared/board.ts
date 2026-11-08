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

// ---------- 拖曳（#83、#84） ----------

export type BoardDrop =
  /** 拖到別欄＝改狀態；ok 為 false 表示轉換規則不允許 */
  | { kind: "status"; status: string; ok: boolean }
  /** 同一欄內放在某張卡片前後＝在任務樹中移動；ok 為 false 表示不同父任務（不能互換）或沒有權限 */
  | {
      kind: "reorder";
      status: string;
      n: number;
      position: "before" | "after";
      ok: boolean;
      /** 不能放的原因：不同父任務，或沒有調整順序的權限（#89） */
      reason?: "parent" | "permission";
    };

export interface BoardCardRef {
  n: number;
  statusId: string;
  /** 畫面上的父任務（null＝最上層） */
  parent: number | null;
}

/**
 * 卡片 moving 放到 status 欄（指標在 card 上的 position 半邊）時要做什麼。
 * 不能放（原地、沒有目標）回傳 null。
 */
export function boardDrop(
  moving: BoardCardRef,
  status: string,
  card: { ref: BoardCardRef; position: "before" | "after" } | null,
  can: { status: (from: string, to: string) => boolean; reorder: boolean },
): BoardDrop | null {
  if (status !== moving.statusId) return { kind: "status", status, ok: can.status(moving.statusId, status) };
  if (!card || card.ref.n === moving.n) return null;
  const base = { kind: "reorder" as const, status, n: card.ref.n, position: card.position };
  if (!can.reorder) return { ...base, ok: false, reason: "permission" };
  if (card.ref.parent !== moving.parent) return { ...base, ok: false, reason: "parent" };
  return { ...base, ok: true };
}

export function sameDrop(a: BoardDrop | null, b: BoardDrop | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.status !== b.status || a.ok !== b.ok) return false;
  return a.kind === "status" || (b.kind === "reorder" && a.n === b.n && a.position === b.position && a.reason === b.reason);
}

/**
 * 鍵盤：在欄內往上／下移一格，只和同一個父任務的卡片互換（#84）。
 * column 是這一欄目前顯示的卡片（照任務樹順序）。
 */
export function columnNeighbor(
  column: number[],
  n: number,
  dir: -1 | 1,
  parentOf: (n: number) => number | null,
): { target: number; position: "before" | "after" } | null {
  const p = parentOf(n);
  const sibs = column.filter((k) => k === n || parentOf(k) === p);
  const i = sibs.indexOf(n);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return null;
  return { target: sibs[j], position: dir < 0 ? "before" : "after" };
}

/**
 * 鍵盤：往左／右只移到隔壁欄（Cain 決定 B，#93）。
 * 隔壁不允許時回傳 blocked，畫面提示原因、不動；沒有隔壁回傳 null。
 */
export function neighborStatus(
  statusIds: string[],
  from: string,
  dir: -1 | 1,
  allowed: (from: string, to: string) => boolean,
): { to: string; blocked: boolean } | null {
  const to = statusIds[statusIds.indexOf(from) + dir];
  if (to === undefined) return null;
  return { to, blocked: !allowed(from, to) };
}
