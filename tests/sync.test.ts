import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSyncState, resetSyncForTest, track } from "../web/src/sync";

beforeEach(() => {
  vi.useFakeTimers();
  resetSyncForTest();
});

describe("同步狀態（#53）", () => {
  it("執行中標示任務與數量，完成後短暫顯示已同步", async () => {
    let done!: () => void;
    const p = track("改狀態", () => new Promise<void>((r) => (done = r)), [7]);
    expect(getSyncState().pending).toBe(1);
    expect(getSyncState().tasks.has(7)).toBe(true);
    done();
    await p;
    expect(getSyncState()).toMatchObject({ pending: 0, justSynced: true, error: null });
    expect(getSyncState().tasks.has(7)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(getSyncState().justSynced).toBe(false);
  });

  it("同一張任務有兩個操作時，兩個都結束才解除", async () => {
    let a!: () => void;
    let b!: () => void;
    const pa = track("x", () => new Promise<void>((r) => (a = r)), [3]);
    const pb = track("y", () => new Promise<void>((r) => (b = r)), [3]);
    a();
    await pa;
    expect(getSyncState().tasks.has(3)).toBe(true);
    b();
    await pb;
    expect(getSyncState().tasks.has(3)).toBe(false);
  });

  it("失敗時保留錯誤、可以重試，重試成功後清除錯誤", async () => {
    let calls = 0;
    const fn = async () => {
      if (++calls === 1) throw new Error("網路中斷");
    };
    await expect(track("調整順序", fn, [5])).rejects.toThrow("網路中斷");
    const s = getSyncState();
    expect(s.error?.message).toBe("調整順序失敗：網路中斷");
    expect(s.justSynced).toBe(false);
    expect(s.tasks.has(5)).toBe(false);
    s.error!.retry();
    await vi.runAllTimersAsync();
    expect(calls).toBe(2);
    expect(getSyncState().error).toBeNull();
  });
});
