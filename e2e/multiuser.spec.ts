import { expect, test, type Page } from "@playwright/test";
import { openProject, reset, row, rows } from "./helpers";

// 多人同步（#49）：畫面開著時定時檢查，別人的修改不用切換視窗就看得到
// 測試把檢查間隔調成 400ms（正式是 30 秒）
test.describe("多人同步", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test.beforeEach(async ({ page }) => {
    await reset(page);
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "400"));
  });

  /** 模擬別人直接在 GitHub 上改（不經過這個畫面） */
  const other = (page: Page) => ({
    patch: (n: number, data: object) => page.request.patch(`/api/gh/repos/demo/website/issues/${n}`, { data }),
    create: (title: string) =>
      page.request.post("/api/gh/repos/demo/website/issues", { data: { title, labels: ["status:todo"] } }),
    comment: (n: number, body: string) =>
      page.request.post(`/api/gh/repos/demo/website/issues/${n}/comments`, { data: { body } }),
  });

  test("別人改了標題、狀態、開了新任務，幾秒內就出現", async ({ page }) => {
    await openProject(page);
    await other(page).patch(13, { title: "別人改的標題" });
    await expect(row(page, "別人改的標題")).toBeVisible({ timeout: 5000 });
    await other(page).patch(13, { labels: ["status:doing"] });
    await expect(row(page, "別人改的標題").locator(".pill")).toHaveText("進行中", { timeout: 5000 });
    await other(page).create("別人開的任務");
    await expect.poll(() => rows(page), { timeout: 5000 }).toContain("別人開的任務");
  });

  test("沒有變動時用條件式請求（304），不重讀任務", async ({ page }) => {
    await openProject(page);
    await page.waitForTimeout(600); // 第一次檢查拿到 ETag
    await page.request.get("/__requests");
    await page.waitForTimeout(1500);
    const reqs = (await (await page.request.get("/__requests")).json()) as string[];
    const polls = reqs.filter((r) => /^GET \/repos\/demo\/website\/issues(\/events)?( |$)/.test(r));
    expect(polls.filter((r) => r.includes("/events")).length).toBeGreaterThanOrEqual(2);
    expect(polls.filter((r) => !r.includes("/events")).length).toBeGreaterThanOrEqual(2);
    expect(polls.every((r) => r.endsWith("→ 304")), polls.join("\n")).toBe(true);
    expect(reqs.filter((r) => r === "POST /graphql")).toEqual([]);
  });

  test("有變動時只重新讀取變了的任務", async ({ page }) => {
    await openProject(page);
    await page.waitForTimeout(600);
    await page.request.get("/__requests"); // 清掉進入專案時的請求
    await other(page).patch(13, { title: "只讀這張" });
    await expect(row(page, "只讀這張")).toBeVisible({ timeout: 5000 });
    const reqs = (await (await page.request.get("/__requests")).json()) as string[];
    // 整棵樹的查詢、設定、成員、權限都沒有重讀
    expect(reqs.filter((r) => /contents|assignees|^GET \/user$|^GET \/repos\/demo\/website$/.test(r))).toEqual([]);
    expect(reqs.filter((r) => r === "POST /graphql").length).toBe(1);
  });

  test("別人把任務移到別的父任務底下（GitHub 只留事件、不改更新時間）", async ({ page }) => {
    await openProject(page);
    await page.waitForTimeout(600); // 第一次檢查記下目前最新的事件
    const child = (await (await page.request.get("/api/gh/repos/demo/website/issues/13")).json()) as { id: number };
    const all = (await (await page.request.get("/__state")).json()).repos["demo/website"].issues as { number: number; title: string }[];
    const mkt = all.find((i) => i.title === "行銷活動")!.number;
    await page.request.post(`/api/gh/repos/demo/website/issues/${mkt}/sub_issues`, {
      data: { sub_issue_id: child.id, replace_parent: true },
    });
    // 「整理專案文件」離開最上層，「行銷活動」底下多一個
    await expect.poll(() => rows(page), { timeout: 5000 }).not.toContain("整理專案文件");
    await row(page, "行銷活動").locator(".twisty").click();
    await expect.poll(() => rows(page)).toContain("整理專案文件");
  });

  test("正在打標題時，別人改了標題不會蓋掉打到一半的字", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const title = page.locator("aside.detail .title-input");
    await title.fill("我正在打的標題");
    await other(page).patch(13, { title: "別人同時改的" });
    await expect(row(page, "別人同時改的")).toBeVisible({ timeout: 5000 });
    await expect(title).toHaveValue("我正在打的標題");
    await expect(title).toBeFocused();
    await title.blur();
    await expect(row(page, "我正在打的標題")).toBeVisible();
  });

  test("正在寫說明時，別人改了任務不會關掉編輯框", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await panel.getByRole("button", { name: /加上說明/ }).click();
    await panel.locator("textarea").first().fill("寫到一半");
    await other(page).patch(13, { labels: ["status:doing"] });
    await expect(panel.getByLabel("狀態", { exact: true })).toHaveValue("doing", { timeout: 5000 });
    await expect(panel.locator("textarea").first()).toHaveValue("寫到一半");
  });

  test("打開的任務有人留言，留言自動出現", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    await other(page).comment(13, "別人的留言");
    await expect(page.locator("aside.detail .comments")).toContainText("別人的留言", { timeout: 5000 });
  });

  test("別人把任務改成完成：照 #63 留在清單上", async ({ page }) => {
    await openProject(page);
    await other(page).patch(13, { labels: ["status:done"], state: "closed", state_reason: "completed" });
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("完成", { timeout: 5000 });
    await page.reload();
    await expect.poll(() => rows(page)).not.toContain("整理專案文件");
  });
});
