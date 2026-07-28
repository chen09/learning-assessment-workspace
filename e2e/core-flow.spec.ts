import { expect, test } from "@playwright/test";

test("parent imports material, reviews it, and reaches the printable set", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Good afternoon, Maya" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Create practice" }).click();
  await page.getByRole("button", { name: "Import material" }).click();
  await page.getByLabel("Learning material").setInputFiles({
    name: "english-lesson.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "Create review draft" }).click();

  await expect(
    page.getByRole("heading", { name: "Review before assigning" }),
  ).toBeVisible();
  await expect(page.getByText("Draft · not visible to children")).toBeVisible();
  await page.getByRole("link", { name: "Print A4 instead" }).click();
  await expect(
    page.getByRole("heading", { name: "Algebra & English warm-up" }),
  ).toBeVisible();
});

test("child answers choice and text questions with autosave", async ({ page }) => {
  await page.goto("/child/work/");
  await page.getByRole("radio", { name: "a² − b²" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Your answer").fill("goes");
  await expect(page.getByText("Saved")).toBeVisible();
});
