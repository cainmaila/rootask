import { dismissSyncError, useSync } from "./sync";

/** 頂端列的同步狀態（#53）；失敗時一個操作一列，各自可以重試或關掉（#67） */
export function SyncIndicator() {
  const s = useSync();
  if (s.errors.length > 0) {
    return (
      <div className="sync sync-error" role="alert">
        {s.errors.map((e) => (
          <div className="sync-row" key={e.key}>
            <span className="sync-msg" title={e.message}>
              ⚠ {e.message}
            </span>
            {e.retry && (
              <button className="btn small" onClick={e.retry}>
                重試
              </button>
            )}
            <button className="icon" onClick={() => dismissSyncError(e.key)} aria-label="關閉">
              ✕
            </button>
          </div>
        ))}
      </div>
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
