import { describe, expect, it } from "vitest";
import { isDate, isOverdue, mergeMeta, metaError, parseMeta, todayLocal, writeMeta } from "../shared/meta";

describe("任務日期的隱藏區塊", () => {
  it("沒有區塊時原樣回傳", () => {
    expect(parseMeta("說明文字")).toEqual({ text: "說明文字", meta: {} });
    expect(parseMeta(null)).toEqual({ text: "", meta: {} });
  });

  it("寫入後可以讀回，內文不變", () => {
    const body = writeMeta("要做的事\n- 第一步", { start: "2026-11-10", due: "2026-11-20" });
    expect(body).toBe('要做的事\n- 第一步\n\n<!-- rootask:meta {"start":"2026-11-10","due":"2026-11-20"} -->');
    expect(parseMeta(body)).toEqual({ text: "要做的事\n- 第一步", meta: { start: "2026-11-10", due: "2026-11-20" } });
  });

  it("空內文也能存日期", () => {
    const body = writeMeta("", { due: "2026-12-01" });
    expect(body).toBe('<!-- rootask:meta {"due":"2026-12-01"} -->');
    expect(parseMeta(body)).toEqual({ text: "", meta: { due: "2026-12-01" } });
  });

  it("清空日期時移除區塊", () => {
    const body = writeMeta("內文", { due: "2026-12-01" });
    expect(writeMeta(parseMeta(body).text, {})).toBe("內文");
  });

  it("重複寫入不會疊加多個區塊", () => {
    const once = writeMeta("內文", { due: "2026-12-01" });
    const twice = writeMeta(once, { due: "2026-12-02" });
    expect(twice.match(/rootask:meta/g)).toHaveLength(1);
    expect(parseMeta(twice).meta.due).toBe("2026-12-02");
  });

  it("壞掉的 JSON 或不合法日期不會弄丟內文", () => {
    const broken = "內文\n<!-- rootask:meta {not json} -->";
    expect(parseMeta(broken)).toEqual({ text: broken, meta: {} });
    expect(parseMeta('x\n<!-- rootask:meta {"due":"2026-02-30"} -->').meta).toEqual({});
  });

  it("日期驗證與逾期判斷", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026/02/28")).toBe(false);
    expect(metaError({ start: "2026-11-20", due: "2026-11-10" })).toBeTruthy();
    expect(metaError({ start: "2026-11-10", due: "2026-11-10" })).toBeNull();
    expect(isOverdue("2026-11-04", "2026-11-05")).toBe(true);
    expect(isOverdue("2026-11-05", "2026-11-05")).toBe(false);
    expect(isOverdue(undefined, "2026-11-05")).toBe(false);
    expect(todayLocal(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("排序值可以單獨存在，也能和日期並存", () => {
    expect(parseMeta(writeMeta("x", { rank: 2.5 })).meta).toEqual({ rank: 2.5 });
    expect(parseMeta(writeMeta("x", { due: "2026-12-01", rank: -1 })).meta).toEqual({ due: "2026-12-01", rank: -1 });
    expect(parseMeta('x\n<!-- rootask:meta {"rank":"abc"} -->').meta).toEqual({});
  });

  it("部分更新只改指定欄位，undefined 代表刪除", () => {
    const cur = { start: "2026-11-01", due: "2026-11-04", rank: 3.5 };
    expect(mergeMeta(cur, { due: "2026-11-09" })).toEqual({ start: "2026-11-01", due: "2026-11-09", rank: 3.5 });
    expect(mergeMeta(cur, { start: undefined, due: undefined })).toEqual({ rank: 3.5 });
    expect(mergeMeta(cur, { rank: 1 })).toEqual({ start: "2026-11-01", due: "2026-11-04", rank: 1 });
  });
});
