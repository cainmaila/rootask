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
    expect(getSyncState()).toMatchObject({ pending: 0, justSynced: true, errors: [] });
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
    expect(s.errors.map((e) => e.message)).toEqual(["調整順序（#5）失敗：網路中斷"]);
    expect(s.justSynced).toBe(false);
    expect(s.tasks.has(5)).toBe(false);
    s.errors[0].retry!();
    await vi.runAllTimersAsync();
    expect(calls).toBe(2);
    expect(getSyncState().errors).toEqual([]);
  });

  it("權限不足等 4xx 錯誤不提供重試，5xx 與網路錯誤可以重試", async () => {
    const { ApiError } = await import("../web/src/api");
    await expect(track("改狀態", () => Promise.reject(new ApiError(403, "沒有寫入權限")), [3])).rejects.toThrow();
    expect(getSyncState().errors[0]).toMatchObject({ message: "改狀態（#3）失敗：沒有寫入權限", retry: null });
    await expect(track("改狀態", () => Promise.reject(new ApiError(503, "暫時無法服務")), [4])).rejects.toThrow();
    expect(getSyncState().errors[1].retry).toBeTypeOf("function");
    await expect(track("改狀態", () => Promise.reject(new ApiError(429, "太多請求")), [5])).rejects.toThrow();
    expect(getSyncState().errors[2].retry).toBeTypeOf("function");
  });

  it("#67 接連失敗時每一則都保留；同一個操作再失敗只留最新的", async () => {
    await expect(track("更新說明", () => Promise.reject(new Error("a")), [1])).rejects.toThrow();
    await expect(track("改狀態", () => Promise.reject(new Error("b")), [2])).rejects.toThrow();
    expect(getSyncState().errors.map((e) => e.message)).toEqual(["更新說明（#1）失敗：a", "改狀態（#2）失敗：b"]);
    await expect(track("改狀態", () => Promise.reject(new Error("c")), [2])).rejects.toThrow();
    expect(getSyncState().errors.map((e) => e.message)).toEqual(["更新說明（#1）失敗：a", "改狀態（#2）失敗：c"]);
    // 其他操作成功不會清掉還沒處理的錯誤，也不顯示「已同步」
    await track("更新標題", async () => {}, [3]);
    expect(getSyncState()).toMatchObject({ justSynced: false });
    expect(getSyncState().errors).toHaveLength(2);
  });

  it("#70 可以指定重試要做什麼", async () => {
    const retry = vi.fn();
    await expect(track("改狀態", () => Promise.reject(new Error("x")), [2], { retry })).rejects.toThrow();
    getSyncState().errors[0].retry!();
    expect(retry).toHaveBeenCalledOnce();
  });
});
