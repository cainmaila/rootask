import { expect, test, type Page } from "@playwright/test";
import { reset } from "./helpers";

// 看板（#43、#82）：欄位＝自訂狀態，卡片＝任務，欄內照任務樹順序
const BOARD = "/#/p/demo/website/board";

const col = (page: Page, name: string) => page.locator(".board-col", { has: page.locator(".board-col-head", { hasText: name }) });
const cards = (page: Page, name: string) => col(page, name).locator(".board-title").allInnerTexts();
const card = (page: Page, title: string) => page.locator(".board-card", { has: page.locator(".board-title", { hasText: title }) }).first();

async function openBoard(page: Page) {
  await page.goto(BOARD);
  await expect(page.locator(".board-card").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("從分頁切到看板，網址記住目前的視圖", async ({ page }) => {
  await page.goto("/#/p/demo/website");
  await page.getByRole("button", { name: "看板" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-col")).toHaveCount(5);
  await page.reload();
  await expect(page.locator(".board-card").first()).toBeVisible();
  await page.getByRole("button", { name: "任務樹" }).click();
  await expect(page.locator(".node-title").first()).toBeVisible();
});

test("每個狀態一欄，欄內照任務樹的順序，卡片顯示上層任務", async ({ page }) => {
  await openBoard(page);
  expect(await page.locator(".board-col-head .pill").allInnerTexts()).toEqual(["待處理", "進行中", "待審核", "完成", "放棄"]);
  expect(await cards(page, "進行中")).toEqual(["官網改版", "首頁設計", "後台 API"]);
  const todo = await cards(page, "待處理");
  expect(todo.slice(0, 3)).toEqual(["Hero 主視覺", "文章列表 API", "上傳圖片 API"]);
  await expect(card(page, "Hero 主視覺").locator(".board-crumb")).toHaveText("官網改版 › 首頁設計");
  await expect(col(page, "進行中").locator(".board-col-head")).toContainText("3");
});

test("只看最底層任務：有子任務的卡片不顯示，重新整理後還記得", async ({ page }) => {
  await openBoard(page);
  await page.getByText("只看最底層任務").click();
  expect(await cards(page, "進行中")).toEqual([]);
  expect(await cards(page, "待處理")).not.toContain("行銷活動");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "只看最底層任務" })).toBeChecked();
  expect(await cards(page, "進行中")).toEqual([]);
});

test("和任務樹共用篩選：只放符合的卡片", async ({ page }) => {
  await openBoard(page);
  await page.getByLabel("依分配人篩選").selectOption("ben");
  for (const t of await page.locator(".board-card").all()) {
    await expect(t.locator('img[alt="ben"]')).toBeVisible();
  }
  await page.getByLabel("搜尋任務").fill("不存在的字");
  await expect(page.locator(".board-card")).toHaveCount(0);
  await expect(page.locator(".board-tools")).toContainText("沒有符合的任務");
});

test("完成欄照「隱藏已完成」設定；改成完成的卡片照 #63 留著", async ({ page }) => {
  await openBoard(page);
  expect(await cards(page, "完成")).toEqual([]);
  await card(page, "上傳圖片 API").locator(".board-card-main").click();
  await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("done");
  await expect.poll(() => cards(page, "完成")).toEqual(["上傳圖片 API"]);
  await page.locator("aside.detail").getByRole("button", { name: "關閉" }).click(); // 手機上面板會蓋住篩選列
  await page.getByText(/顯示已完成/).click();
  await expect.poll(async () => (await cards(page, "完成")).length).toBeGreaterThan(1);
});

test("點卡片開任務詳情；展開成整頁再關閉會回到看板", async ({ page }) => {
  await openBoard(page);
  await card(page, "Hero 主視覺").locator(".board-card-main").click();
  const panel = page.locator("aside.detail");
  await expect(panel.locator(".title-input")).toHaveValue("Hero 主視覺");
  await panel.getByRole("button", { name: "展開成整頁" }).click();
  await expect(page).toHaveURL(/\/board\/t\/\d+$/);
  await page.getByRole("button", { name: "回到任務列表" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-card").first()).toBeVisible();
});

test("別人改了狀態，卡片自動換欄（多人同步）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "400"));
  await openBoard(page);
  await page.request.patch("/api/gh/repos/demo/website/issues/13", { data: { labels: ["status:review"] } });
  await expect.poll(() => cards(page, "待審核"), { timeout: 5000 }).toContain("整理專案文件");
});

test("手機：欄位在看板裡橫向滑動，頁面本身不會左右捲", async ({ page, isMobile }) => {
  test.skip(!isMobile, "只在手機");
  await openBoard(page);
  const board = page.locator(".board");
  expect(await board.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await card(page, "Hero 主視覺").locator(".board-card-main").tap();
  await expect(page.locator("aside.detail .title-input")).toHaveValue("Hero 主視覺");
});
