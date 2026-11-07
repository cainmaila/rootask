import { expect, test } from "@playwright/test";
import { openProject, reset, rows } from "./helpers";

// 隱藏已完成（#46）與搜尋篩選（#47）
test.beforeEach(async ({ page }) => {
  await reset(page);
  await openProject(page);
});

test("預設隱藏已完成，勾選後出現", async ({ page }) => {
  expect(await rows(page)).not.toContain("舊版網站下線");
  await page.getByLabel(/顯示已完成/).check();
  await expect.poll(() => rows(page)).toContain("舊版網站下線");
});

test("子任務數包含沒載入的已完成子任務", async ({ page }) => {
  await page.locator(".node", { hasText: "官網改版" }).locator(".twisty").click();
  await expect(page.locator(".node", { hasText: "首頁設計" }).getByTitle(/^已完成/)).toHaveText("1/3");
});

test("搜尋：帶出上層並展開，上層淡化", async ({ page }) => {
  await page.getByLabel("搜尋任務").fill("hero");
  await expect.poll(() => rows(page)).toEqual(["(官網改版)", "(首頁設計)", "Hero 主視覺"]);
  await expect(page.getByText("符合 1 項")).toBeVisible();
});

test("搜尋說明內文與 #編號", async ({ page }) => {
  await page.getByLabel("搜尋任務").fill("svg");
  await expect.poll(() => rows(page)).toContain("Hero 主視覺");
  await page.getByLabel("搜尋任務").fill("#13");
  await expect.poll(() => rows(page)).toEqual(["整理專案文件"]);
});

test("分配給我＋逾期", async ({ page }) => {
  await page.getByLabel("依分配人篩選").selectOption("@me");
  await expect.poll(() => rows(page)).toEqual(["(官網改版)", "首頁設計", expect.stringContaining("非常非常長")]);
  await page.getByText("逾期", { exact: true }).click();
  await expect.poll(() => rows(page)).toEqual(["(官網改版)", "首頁設計"]);
});

test("逾期：跨不同上層", async ({ page }) => {
  await page.getByText("逾期", { exact: true }).click();
  await expect.poll(() => rows(page)).toEqual(["(官網改版)", "首頁設計", "(後台 API)", "文章列表 API"]);
});

test("清除篩選回到原本", async ({ page }) => {
  const before = await rows(page);
  await page.getByLabel("搜尋任務").fill("hero");
  await page.getByRole("button", { name: "清除篩選" }).click();
  await expect.poll(() => rows(page)).toEqual(before);
});

test("沒有符合時提示，已完成被隱藏時提醒", async ({ page }) => {
  await page.getByLabel("依狀態篩選").selectOption("done");
  await expect(page.getByText("沒有符合的任務")).toBeVisible();
  await expect(page.locator(".empty").getByRole("button", { name: "顯示已完成" })).toBeVisible();
});

test("內容不超出右邊界", async ({ page }) => {
  await page.getByLabel("搜尋任務").fill("非常");
  const edge = await page.evaluate(() => ({
    max: Math.max(...[...document.querySelectorAll(".add-row, .filter-bar, .node")].map((e) => e.getBoundingClientRect().right)),
    limit: window.innerWidth - 15,
  }));
  expect(edge.max).toBeLessThanOrEqual(edge.limit);
});
