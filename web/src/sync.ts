// 與 GitHub 同步的狀態（#53）。所有寫回 GitHub 的操作都用 track() 包起來，
// 頂端列與任務列就能顯示「同步中」「已同步」「同步失敗（可重試）」。
import { useSyncExternalStore } from "react";
import { ApiError } from "./api";

export interface SyncError {
  /** 同一個操作（同名稱、同任務）再失敗時取代舊的那則 */
  key: string;
  message: string;
  /** 權限不足、資料不合法這類錯誤重試也不會成功，不提供重試（#59） */
  retry: (() => void) | null;
}

/** 4xx（逾時與流量限制除外）重試也不會成功 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // 網路中斷等
  return e.status >= 500 || e.status === 408 || e.status === 429 || e.status === 0;
}

export interface SyncState {
  /** 進行中的操作數 */
  pending: number;
  /** 正在同步的任務編號 */
  tasks: ReadonlySet<number>;
  /** 剛同步完成（短暫顯示「已同步」） */
  justSynced: boolean;
  /** 還沒處理的失敗，一個操作一則（#67：後面的失敗不會蓋掉前面的） */
  errors: SyncError[];
}

const SYNCED_MS = 1800;

let state: SyncState = { pending: 0, tasks: new Set(), justSynced: false, errors: [] };
const listeners = new Set<() => void>();
const taskCounts = new Map<number, number>();
let syncedTimer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function bump(tasks: number[], d: 1 | -1) {
  for (const n of tasks) {
    const c = (taskCounts.get(n) ?? 0) + d;
    if (c > 0) taskCounts.set(n, c);
    else taskCounts.delete(n);
  }
  return new Set(taskCounts.keys());
}

export interface TrackOptions {
  /** 失敗後按「重試」要做什麼；預設是再執行一次 fn（#70：樂觀更新要從頭再來，畫面才會先變） */
  retry?: () => void;
}

/**
 * 執行一個寫回 GitHub 的操作，期間標示為同步中。
 * 失敗時記下錯誤與重試方法，並把錯誤再丟出去讓呼叫端決定要不要還原畫面。
 */
export async function track<T>(
  label: string,
  fn: () => Promise<T>,
  tasks: number[] = [],
  opts: TrackOptions = {},
): Promise<T> {
  const key = `${label}|${tasks.join(",")}`;
  clearTimeout(syncedTimer);
  // 重做同一個操作時，先拿掉它上次的錯誤
  set({
    pending: state.pending + 1,
    tasks: bump(tasks, 1),
    justSynced: false,
    errors: state.errors.filter((e) => e.key !== key),
  });
  let ok = false;
  try {
    const r = await fn();
    ok = true;
    return r;
  } catch (e) {
    // 只有一張任務時標出是哪一張，同時做好幾件事時才分得清
    const which = tasks.length === 1 ? `（#${tasks[0]}）` : "";
    const retry = isRetryable(e) ? (opts.retry ?? (() => void track(label, fn, tasks, opts).catch(() => {}))) : null;
    set({
      errors: [
        ...state.errors.filter((x) => x.key !== key),
        { key, message: `${label}${which}失敗：${(e as Error).message}`, retry },
      ],
    });
    throw e;
  } finally {
    const pending = state.pending - 1;
    set({ pending, tasks: bump(tasks, -1) });
    if (pending === 0 && ok && state.errors.length === 0) {
      set({ justSynced: true });
      syncedTimer = setTimeout(() => set({ justSynced: false }), SYNCED_MS);
    }
  }
}

/** 關掉一則錯誤（不給 key 就全部關掉） */
export function dismissSyncError(key?: string) {
  set({ errors: key === undefined ? [] : state.errors.filter((e) => e.key !== key) });
}

export function getSyncState(): SyncState {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSync(): SyncState {
  return useSyncExternalStore(subscribe, getSyncState);
}

/** 只供測試使用 */
export function resetSyncForTest() {
  clearTimeout(syncedTimer);
  taskCounts.clear();
  state = { pending: 0, tasks: new Set(), justSynced: false, errors: [] };
}
