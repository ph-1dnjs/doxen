import { test, expect } from "@playwright/test";

test("tabs, relative links, Korean heading deep links and refresh work under a hosting subpath", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator("article h1")).toHaveText("팀의 지식을 한곳에");
  await page
    .getByRole("navigation", { name: "문서 탭" })
    .getByRole("link", { name: "레퍼런스" })
    .click();
  await expect(page.locator("article h1")).toHaveText("설정 레퍼런스");
  await page
    .getByRole("navigation", { name: "문서 탭" })
    .getByRole("link", { name: "시작하기" })
    .click();
  await page
    .locator("article")
    .getByRole("link", { name: "작성 가이드" })
    .click();
  await expect(page.locator("article h1")).toHaveText("문서 작성 가이드");
  await page
    .locator("article")
    .getByRole("link", { name: "설정 레퍼런스" })
    .click();
  await expect(page).toHaveURL(/%ED%83%AD-%EC%84%A4%EC%A0%95/);
  await page.reload();
  await expect(page.locator("article h1")).toHaveText("설정 레퍼런스");
  await expect(page.locator("#tabs [aria-current]")).toHaveText("레퍼런스");
  expect(errors).toEqual([]);
});

test("global Korean search locates a section and highlights matching content", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#open-search").click();
  await page.getByRole("searchbox", { name: "전체 문서 검색" }).fill("산출물");
  await expect(page.locator("#results .result")).toHaveCount(1);
  await expect(page.locator("#results .result strong")).toHaveText("용어 사전");
  await page.locator("#global-search").press("ArrowDown");
  await expect(page.locator("#results .result")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#search-dialog")).not.toBeVisible();
  await expect(page.locator("article mark")).toHaveText("산출물");
  await expect(page.locator("#page-search")).toHaveCount(0);
  await expect(page).toHaveURL(/%EC%9A%A9%EC%96%B4-%EC%82%AC%EC%A0%84/);
  await page.locator("#open-search").click();
  await page.locator("#global-search").fill("존재하지않는검색어");
  await expect(page.locator("#results .result")).toHaveCount(0);
  await expect(page.locator("#search-count")).toHaveText(
    "일치하는 내용이 없습니다.",
  );
  // Search inputs consume the first Escape to clear their value in Chromium.
  await page.locator("#global-search").fill("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#search-dialog")).not.toBeVisible();
});

test("table searches are automatic and keep filters independent", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".document-find")).toHaveCount(0);
  await expect(page.locator("[data-table-search]")).toHaveCount(2);
  const tables = page.locator("article table");
  const first = page.getByRole("searchbox", { name: "문서를 연결하는 방법 표 검색" });
  const second = page.getByRole("searchbox", { name: "팀 용어 빠르게 찾기" });
  await first.fill("검색");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await second.fill("산출물");
  await expect(first).toHaveValue("검색");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await expect(tables.nth(1).locator("tbody tr:visible")).toHaveCount(1);
  await expect(tables.nth(1).locator("tbody tr:visible")).toContainText("산출물");
  await second.fill("");
  await expect(tables.nth(1).locator("tbody tr:visible")).toHaveCount(4);
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await first.fill("없는검색어");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(0);
  await expect(tables.nth(0).locator("thead")).toBeVisible();
  await first.fill("   ");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(3);
  await page.locator("article").getByRole("link", { name: "작성 가이드" }).click();
  await expect(page.locator("[data-table-search]")).toHaveCount(0);
});

test("desktop and mobile layouts stay within the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await expect(page.locator("article h1")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article h1")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.locator("#open-search").click();
  await expect(page.locator("#global-search")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("section tables filter by any cell and restore rows on clear", async ({ page }) => {
  await page.goto("./#/guide%2F03-section-template");
  await expect(page.locator("article h2")).toHaveCount(4);
  await expect(page.locator("[data-table-search]")).toHaveCount(3);
  await expect(page.locator(".section-tools + table")).toHaveCount(3);
  const section = page.locator(".search-section").nth(0);
  const input = page.getByRole("searchbox", { name: "문서 준비 검색", exact: true });
  await expect(section.locator("tbody tr:visible")).toHaveCount(6);
  await input.fill("문서");
  await expect(section.locator("tbody tr:visible")).toHaveCount(3);
  await expect(section.locator("thead")).toBeVisible();
  await expect(page.locator(".search-section").nth(1).locator("tbody tr:visible")).toHaveCount(5);
  await input.fill("markdown");
  await expect(section.locator("tbody tr:visible")).toHaveCount(2);
  await input.fill("번호 추가");
  await expect(section.locator("tbody tr:visible")).toHaveCount(1);
  await input.fill("없는검색어");
  await expect(section.locator("tbody tr:visible")).toHaveCount(0);
  await input.fill("");
  await expect(section.locator("tbody tr:visible")).toHaveCount(6);
});
