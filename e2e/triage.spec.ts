import { expect, test } from "@playwright/test";
import { issue, openProject, reset, row, rows } from "./helpers";

// triage 成員（#65，Cain 決定 B）：可以改狀態、指派、新增任務與子任務；標題、說明、日期、順序、父任務不能改
test.describe("triage 成員", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test.beforeEach(async ({ page }) => {
    await reset(page);
    await page.request.post("/__as?login=amy&role=triage");
  });

  test("看得出能做什麼：有新增、沒有手把，詳情只開放狀態與分配人", async ({ page }) => {
    await openProject(page);
    await expect(page.getByRole("note")).toContainText("分類（triage）權限");
    await expect(page.locator(".grip")).toHaveCount(0);
    await expect(page.getByPlaceholder("新增任務…")).toBeVisible();
    await expect(row(page, "官網改版").getByTitle("新增子任務")).toBeVisible();

    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await expect(panel.getByLabel("狀態", { exact: true })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "amy" })).toBeEnabled();
    await expect(panel.getByLabel("父任務")).toBeDisabled();
    await expect(panel.locator(".title-input")).toHaveAttribute("readonly", "");
    await expect(panel.getByLabel("開始")).toBeDisabled();
    await expect(panel.getByRole("button", { name: "↑ 上移" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "編輯" })).toHaveCount(0);
  });

  test("可以改狀態、指派、新增任務與子任務", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await expect.poll(async () => (await issue(page, 13)).labels).toContain("status:doing");

    await panel.getByRole("button", { name: "ben" }).click();
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByPlaceholder("新增任務…").fill("triage 開的任務");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect.poll(() => rows(page)).toContain("triage 開的任務");

    await row(page, "行銷活動").getByTitle("新增子任務").click();
    await page.getByPlaceholder("子任務名稱…").fill("triage 的子任務");
    await page.getByRole("button", { name: "新增", exact: true }).last().click();
    await expect.poll(() => rows(page)).toContain("triage 的子任務");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
