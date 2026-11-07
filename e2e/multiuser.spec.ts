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
    expect(reqs.filter((r) => r.startsWith("POST /graphql"))).toEqual([]);
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
    // 只讀變了的那一張（#75：假 GitHub 的列表有 updated_at 才驗得到）
    expect(reqs.filter((r) => r.startsWith("POST /graphql"))).toEqual(["POST /graphql #13"]);
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

  // ---------- QA 回報（#72～#76） ----------

  const serverIssue = async (page: Page, n: number) => {
    const st = await (await page.request.get("/__state")).json();
    return (st.repos["demo/website"].issues as { number: number; title: string; body: string; labels: string[]; assignees: string[]; state: string }[]).find(
      (i) => i.number === n,
    )!;
  };

  test("#72 點了標題欄沒改字就離開，不會把同事剛改的標題蓋回去", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const title = page.locator("aside.detail .title-input");
    await title.click();
    await other(page).patch(13, { title: "同事改的標題" });
    await expect(row(page, "同事改的標題")).toBeVisible({ timeout: 5000 });
    await title.blur();
    await expect(title).toHaveValue("同事改的標題");
    await page.waitForTimeout(800);
    expect((await serverIssue(page, 13)).title).toBe("同事改的標題");
  });

  test("#72 打開說明編輯沒改就儲存，不會把同事剛改的說明蓋回去", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await panel.getByRole("button", { name: /加上說明/ }).click();
    await other(page).patch(13, { body: "同事寫的說明" });
    await page.waitForTimeout(1200); // 等下一次檢查
    await panel.getByRole("button", { name: "儲存" }).click();
    await expect(panel.locator(".description")).toContainText("同事寫的說明");
    await page.waitForTimeout(800);
    expect((await serverIssue(page, 13)).body).toBe("同事寫的說明");
  });

  test("#73 同事剛加的分配人與標籤，改分配人、改狀態時不會被拿掉", async ({ page }) => {
    // 這個情境要在 App 還沒偵測到之前操作：把檢查間隔調很長
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "600000"));
    await openProject(page);
    await page.request.post("/api/gh/repos/demo/website/issues/13/assignees", { data: { assignees: ["amy"] } });
    await other(page).patch(13, { labels: ["status:todo", "bug"] });
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await panel.getByRole("button", { name: "ben" }).click();
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    const i = await serverIssue(page, 13);
    expect(i.assignees.sort()).toEqual(["amy", "ben"]);
    expect(i.labels.sort()).toEqual(["bug", "status:doing"]);
    // 讀回來之後畫面上也看得到同事加的 amy
    await expect(row(page, "整理專案文件").locator('img[alt="amy"]')).toBeVisible();
  });

  test("#74 同事重開沒載入的已完成任務，「顯示已完成」的數字跟著變", async ({ page }) => {
    await openProject(page);
    const label = page.getByText(/顯示已完成（\d+）/);
    const before = Number((await label.innerText()).match(/（(\d+)）/)![1]);
    const st = await (await page.request.get("/__state")).json();
    const closed = (st.repos["demo/website"].issues as { number: number; title: string }[]).find((i) => i.title === "字體與色票")!;
    await other(page).patch(closed.number, { labels: ["status:todo"], state: "open", state_reason: "reopened" });
    await expect(label).toHaveText(`顯示已完成（${before - 1}）`, { timeout: 5000 });
  });

  test("#76 標題按 Enter 存、按 Esc 取消", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const title = page.locator("aside.detail .title-input");
    await title.fill("按 Enter 存的標題");
    await title.press("Enter");
    await expect(title).not.toBeFocused();
    await expect(row(page, "按 Enter 存的標題")).toBeVisible();
    await expect.poll(async () => (await serverIssue(page, 13)).title).toBe("按 Enter 存的標題");
    await title.fill("不要的標題");
    await title.press("Escape");
    await expect(title).toHaveValue("按 Enter 存的標題");
    await page.waitForTimeout(500);
    expect((await serverIssue(page, 13)).title).toBe("按 Enter 存的標題");
  });

  test("#79 同事設了截止日、我改開始日，截止日不會被清掉", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "600000"));
    await openProject(page);
    await other(page).patch(13, { body: '<!-- rootask:meta {"due":"2030-12-31"} -->' });
    await row(page, "整理專案文件").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("開始").fill("2030-12-01");
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    const body = (await serverIssue(page, 13)).body;
    expect(body).toContain('"start":"2030-12-01"');
    expect(body).toContain('"due":"2030-12-31"');
  });

  test("#76 中文輸入法選字中按 Enter／Esc 不算存檔或取消", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const title = page.locator("aside.detail .title-input");
    await title.fill("整理專案文件ㄓㄨㄥ");
    // 模擬輸入法組字中的按鍵（瀏覽器送出的 keydown 帶 isComposing）
    for (const key of ["Enter", "Escape"]) {
      await title.evaluate((el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, isComposing: true, bubbles: true })), key);
    }
    await expect(title).toBeFocused();
    await expect(title).toHaveValue("整理專案文件ㄓㄨㄥ");
    await page.waitForTimeout(500);
    expect((await serverIssue(page, 13)).title).toBe("整理專案文件");
  });
});
