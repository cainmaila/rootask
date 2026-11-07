import { expect, test } from "@playwright/test";
import { issue, openProject, reset, row } from "./helpers";

// 同步時的回饋（#53）
test.beforeEach(async ({ page }) => {
  await reset(page, { latency: 700 });
  await openProject(page);
});

test("改狀態時顯示同步中，完成後顯示已同步", async ({ page }) => {
  await row(page, "整理專案文件").locator(".node-title").click();
  await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
  await expect(page.getByRole("status").filter({ hasText: "同步中" })).toBeVisible();
  await expect(row(page, "整理專案文件")).toHaveClass(/syncing/);
  await expect(page.getByText("✓ 已同步")).toBeVisible();
  expect((await issue(page, 13)).labels).toContain("status:doing");
});

test("寫入失敗時提示，按重試後成功", async ({ page }) => {
  await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
  await row(page, "整理專案文件").locator(".node-title").click();
  await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("改狀態失敗");
  expect((await issue(page, 13)).labels).toContain("status:todo");
  await alert.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("✓ 已同步")).toBeVisible();
  expect((await issue(page, 13)).labels).toContain("status:doing");
});

test("新增任務失敗時保留輸入的標題", async ({ page }) => {
  await page.request.post("/__fail?times=1&method=POST&path=/issues");
  await page.getByPlaceholder("新增任務…").fill("不會不見的標題");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("新增任務失敗");
  await expect(page.getByPlaceholder("新增任務…")).toHaveValue("不會不見的標題");
});
