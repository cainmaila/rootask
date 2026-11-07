// 與 GitHub 同步的狀態（#53）。所有寫回 GitHub 的操作都用 track() 包起來，
// 頂端列與任務列就能顯示「同步中」「已同步」「同步失敗（可重試）」。
import { useSyncExternalStore } from "react";
import { ApiError } from "./api";

export interface SyncError {
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
  error: SyncError | null;
}

const SYNCED_MS = 1800;

let state: SyncState = { pending: 0, tasks: new Set(), justSynced: false, error: null };
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

/**
 * 執行一個寫回 GitHub 的操作，期間標示為同步中。
 * 失敗時記下錯誤與重試方法，並把錯誤再丟出去讓呼叫端決定要不要還原畫面。
 */
export async function track<T>(label: string, fn: () => Promise<T>, tasks: number[] = []): Promise<T> {
  clearTimeout(syncedTimer);
  set({ pending: state.pending + 1, tasks: bump(tasks, 1), justSynced: false, error: null });
  let ok = false;
  try {
    const r = await fn();
    ok = true;
    return r;
  } catch (e) {
    // 只有一張任務時標出是哪一張，同時做好幾件事時才分得清
    const which = tasks.length === 1 ? `（#${tasks[0]}）` : "";
    set({
      error: {
        message: `${label}${which}失敗：${(e as Error).message}`,
        retry: isRetryable(e) ? () => void track(label, fn, tasks).catch(() => {}) : null,
      },
    });
    throw e;
  } finally {
    const pending = state.pending - 1;
    set({ pending, tasks: bump(tasks, -1) });
    if (pending === 0 && ok && !state.error) {
      set({ justSynced: true });
      syncedTimer = setTimeout(() => set({ justSynced: false }), SYNCED_MS);
    }
  }
}

export function dismissSyncError() {
  set({ error: null });
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
  state = { pending: 0, tasks: new Set(), justSynced: false, error: null };
}
