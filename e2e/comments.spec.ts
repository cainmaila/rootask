import { expect, test, type Page } from "@playwright/test";
import { openProject, reset, row } from "./helpers";

// 留言編輯、刪除（#50）：只有作者本人和 repo 管理者能改；刪除前在原地確認
async function openDesign(page: Page) {
  await openProject(page);
  await row(page, "官網改版").locator(".twisty").click();
  await row(page, "首頁設計").locator(".node-title").click();
  return page.locator("aside.detail");
}

const comment = (page: Page, text: string) => page.locator("aside.detail .comments > li", { hasText: text });

async function serverComments(page: Page) {
  const s = await (await page.request.get("/__state")).json();
  const i = (s.repos["demo/website"].issues as { title: string; comments: { body: string }[] }[]).find((x) => x.title === "首頁設計")!;
  return i.comments.map((c) => c.body);
}

test.describe("留言編輯、刪除", () => {
  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("編輯自己的留言，顯示（已編輯）", async ({ page }) => {
    await openDesign(page);
    // 進入編輯後原文字不在畫面上，用位置找（第二則是 cain 的）
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await expect(mine).toContainText("收到，我週五前回覆");
    await mine.getByRole("button", { name: "編輯" }).click();
    await mine.locator("textarea").fill("改成週四前回覆。");
    await mine.getByRole("button", { name: "儲存" }).click();
    await expect(comment(page, "改成週四前回覆")).toContainText("（已編輯）");
    await expect.poll(() => serverComments(page)).toContain("改成週四前回覆。");
  });

  test("刪除前在原地確認，取消不會刪", async ({ page }) => {
    await openDesign(page);
    const mine = comment(page, "收到，我週五前回覆");
    await mine.getByRole("button", { name: "刪除" }).click();
    const confirm = mine.getByRole("group", { name: "確認刪除留言" });
    await expect(confirm).toContainText("無法復原");
    await confirm.getByRole("button", { name: "取消" }).click();
    await expect(confirm).toHaveCount(0);
    await mine.getByRole("button", { name: "刪除" }).click();
    await mine.getByRole("button", { name: "確定刪除" }).click();
    await expect(comment(page, "收到，我週五前回覆")).toHaveCount(0);
    await expect.poll(() => serverComments(page)).not.toContain("收到，我週五前回覆。");
  });

  test("一般成員只能改自己的留言", async ({ page }) => {
    await page.request.post("/__as?login=ben&role=write");
    const panel = await openDesign(page);
    await expect(comment(page, "初稿已上傳").getByRole("button", { name: "編輯" })).toHaveCount(0);
    await expect(comment(page, "收到，我週五前回覆").getByRole("button", { name: "刪除" })).toHaveCount(0);
    await panel.getByPlaceholder(/寫下留言/).fill("ben 的留言");
    await panel.getByRole("button", { name: "送出" }).click();
    await expect(comment(page, "ben 的留言").getByRole("button", { name: "編輯" })).toBeVisible();
  });

  test("唯讀成員也能改自己的留言", async ({ page }) => {
    await page.request.post("/__as?login=amy&role=read");
    await openDesign(page);
    await expect(comment(page, "初稿已上傳").getByRole("button", { name: "編輯" })).toBeVisible();
    await expect(comment(page, "收到，我週五前回覆").getByRole("button", { name: "編輯" })).toHaveCount(0);
  });

  test("編輯失敗：還原、內容留在編輯框，按重試成功後編輯框關閉", async ({ page }) => {
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/comments/");
    await openDesign(page);
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await mine.getByRole("button", { name: "編輯" }).click();
    await mine.locator("textarea").fill("沒存到的修改");
    await mine.getByRole("button", { name: "儲存" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("編輯留言");
    await expect(mine.locator("textarea")).toHaveValue("沒存到的修改");
    await expect(mine).toContainText("留言沒有存到");
    await alert.getByRole("button", { name: "重試" }).click();
    await expect(mine.locator("textarea")).toHaveCount(0);
    await expect(mine).toContainText("沒存到的修改");
    await expect(mine).toContainText("（已編輯）");
  });

  test("刪除失敗：留言回來", async ({ page }) => {
    await page.request.post("/__fail?times=1&method=DELETE&path=/issues/comments/");
    await openDesign(page);
    const mine = comment(page, "收到，我週五前回覆");
    await mine.getByRole("button", { name: "刪除" }).click();
    await mine.getByRole("button", { name: "確定刪除" }).click();
    await expect(page.getByRole("alert")).toContainText("刪除留言");
    await expect(comment(page, "收到，我週五前回覆")).toBeVisible();
  });
});
