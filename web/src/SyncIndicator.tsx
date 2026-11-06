import { dismissSyncError, useSync } from "./sync";

/** 頂端列的同步狀態（#53） */
export function SyncIndicator() {
  const s = useSync();
  if (s.error) {
    return (
      <span className="sync sync-error" role="alert">
        <span className="sync-msg" title={s.error.message}>
          ⚠ {s.error.message}
        </span>
        <button className="btn small" onClick={s.error.retry}>
          重試
        </button>
        <button className="icon" onClick={dismissSyncError} aria-label="關閉">
          ✕
        </button>
      </span>
    );
  }
  if (s.pending > 0) {
    return (
      <span className="sync sync-busy" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        同步中…
      </span>
    );
  }
  if (s.justSynced) {
    return (
      <span className="sync sync-done" role="status" aria-live="polite">
        ✓ 已同步
      </span>
    );
  }
  return null;
}
