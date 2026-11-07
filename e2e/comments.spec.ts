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

  // ---------- QA 回報（#80、#81） ----------
  const cainComment = async (page: Page) => {
    const st = await (await page.request.get("/__state")).json();
    const i = (st.repos["demo/website"].issues as { title: string; comments: { id: number; body: string }[] }[]).find(
      (x) => x.title === "首頁設計",
    )!;
    return i.comments.find((c) => c.body.startsWith("收到"))!.id;
  };

  test("#80 正在編輯的留言被同事刪掉：打好的字保住，可以放到新留言", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "400"));
    const panel = await openDesign(page);
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await mine.getByRole("button", { name: "編輯" }).click();
    await mine.locator("textarea").fill("打到一半的修改");
    await page.request.delete(`/api/gh/repos/demo/website/issues/comments/${await cainComment(page)}`);
    const orphan = panel.locator(".orphan-draft");
    await expect(orphan).toContainText("已經被別人刪除", { timeout: 5000 });
    await expect(orphan).toContainText("打到一半的修改");
    await orphan.getByRole("button", { name: "放到新留言" }).click();
    await expect(panel.getByPlaceholder(/寫下留言/)).toHaveValue("打到一半的修改");
    await expect(orphan).toHaveCount(0);
  });

  test("#80 檢查之前就按儲存：不顯示 Not Found，打好的字一樣保住", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "600000"));
    const panel = await openDesign(page);
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await mine.getByRole("button", { name: "編輯" }).click();
    await mine.locator("textarea").fill("存不進去的修改");
    await page.request.delete(`/api/gh/repos/demo/website/issues/comments/${await cainComment(page)}`);
    await mine.getByRole("button", { name: "儲存" }).click();
    await expect(panel.locator(".orphan-draft")).toContainText("存不進去的修改");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#80 刪除同事已經刪掉的留言：不算失敗", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "600000"));
    await openDesign(page);
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await page.request.delete(`/api/gh/repos/demo/website/issues/comments/${await cainComment(page)}`);
    await mine.getByRole("button", { name: "刪除" }).click();
    await mine.getByRole("button", { name: "確定刪除" }).click();
    await expect(comment(page, "收到，我週五前回覆")).toHaveCount(0);
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#81 留言時間與（已編輯）不被拆成好幾行", async ({ page }) => {
    await openDesign(page);
    const mine = page.locator("aside.detail .comments > li").nth(1);
    await mine.getByRole("button", { name: "編輯" }).click();
    await mine.locator("textarea").fill("改一下");
    await mine.getByRole("button", { name: "儲存" }).click();
    const time = comment(page, "改一下").locator(".comment-time");
    await expect(time).toContainText("（已編輯）");
    const lineHeight = await time.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 18);
    expect((await time.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
  });
});
