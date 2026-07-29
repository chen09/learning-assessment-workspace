import { expect, test } from "@playwright/test";

test("an unauthenticated legacy parent link redirects to sign in", async ({
  page,
}) => {
  await page.goto("/parent/?code=legacy-code-fixture");

  await expect(page).toHaveURL(/\/login\/$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to your family workspace" }),
  ).toBeVisible();
  expect(page.url()).not.toContain("code=");
});
