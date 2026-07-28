import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("verified parent completes the family assignment flow on PostgreSQL", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const email = `playwright-${randomUUID()}@example.test`;
  const password = `E2e-${randomUUID()}-9a`;
  let userId: string | null = null;
  let familyId: string | null = null;

  try {
    const userResponse = await request.post(
      `${supabaseUrl}/auth/v1/admin/users`,
      {
        data: {
          email,
          email_confirm: true,
          password,
          user_metadata: { display_name: "Playwright parent" },
        },
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    expect(userResponse.ok()).toBeTruthy();
    userId = ((await userResponse.json()) as { id: string }).id;

    await page.goto("/login/");
    await page
      .getByRole("button", { name: "Password", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/parent\/$/);

    await page.goto("/parent/family/");
    await expect(
      page.getByRole("textbox", { name: "New family name" }),
    ).toBeVisible();
    const familyResponse = page.waitForResponse(
      (response) =>
        response.url() === "http://127.0.0.1:8018/v1/families" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("textbox", { name: "New family name" })
      .fill("PostgreSQL family");
    await page.getByRole("button", { name: "Add family" }).click();
    familyId = ((await (await familyResponse).json()) as { id: string }).id;

    const childResponse = page.waitForResponse(
      (response) =>
        response.url() ===
          `http://127.0.0.1:8018/v1/families/${familyId}/children` &&
        response.request().method() === "POST",
    );
    await page.getByRole("textbox", { name: "Child name" }).fill("Alex DB");
    await page.getByRole("textbox", { name: "Grade" }).fill("Junior high 1");
    await page.getByRole("textbox", { name: "Six-digit PIN" }).fill("123456");
    await page.getByRole("button", { name: "Add child" }).click();
    const childId = (
      (await (await childResponse).json()) as { id: string }
    ).id;

    await page.goto(
      `/parent/create/?familyId=${encodeURIComponent(familyId)}&childId=${encodeURIComponent(childId)}`,
    );
    await page.getByRole("button", { name: "Create review draft" }).click();
    await expect(
      page.getByRole("heading", { name: "Review before assigning" }),
    ).toBeVisible({ timeout: 30_000 });

    const assignmentResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/assignments") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirm and assign" }).click();
    const assignmentId = (
      (await (await assignmentResponse).json()) as { id: string }
    ).id;
    await expect(page.getByText("Confirmed and assigned")).toBeVisible();

    await page.goto(
      `/child/login/?childId=${encodeURIComponent(childId)}&assignmentId=${encodeURIComponent(assignmentId)}`,
    );
    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.getByRole("button", { name: "Open my work" }).click();
    await expect(page.getByText("0/3", { exact: true })).toBeVisible();

    await page
      .getByRole("radio", {
        name: "She walks to school every day.",
      })
      .click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByLabel("Your answer").fill("play");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next question" }).click();

    const canvas = page.getByLabel("Handwriting answer area");
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.move(canvasBox!.x + 50, canvasBox!.y + 60);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + 210, canvasBox!.y + 140, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Submit all answers" }).click();
    await expect(
      page.getByRole("heading", { name: "Your work is being checked" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View results" }).click();
    await expect(page.getByText("Try once more")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Waiting for a parent")).toBeVisible();

    await page.getByRole("button", { name: "Correct these answers" }).click();
    await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
    await expect(page.getByText("0/2", { exact: true })).toBeVisible();
  } finally {
    if (familyId) {
      await request.delete(
        `${supabaseUrl}/rest/v1/families?id=eq.${familyId}`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        },
      );
    }
    if (userId) {
      await request.delete(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
    }
  }
});
