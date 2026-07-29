import { expect, test } from "@playwright/test";

test("authenticated parent legacy link is cleaned and remains responsive in all languages", async ({
  page,
}, testInfo) => {
  await page.goto("/parent/?code=legacy-code-fixture");
  await expect(page).toHaveURL(/\/parent\/$/);
  await expect(
    page.getByRole("heading", { name: "Set up your family workspace" }),
  ).toBeVisible();

  const sideRail = page.locator(".side-rail");
  const bottomNavigation = page.locator(".bottom-nav");
  if (testInfo.project.name === "mobile") {
    await expect(sideRail).toBeHidden();
    await expect(bottomNavigation).toBeVisible();
  } else {
    await expect(sideRail).toBeVisible();
    await expect(bottomNavigation).toBeHidden();
  }

  await page.getByLabel("Language").selectOption("zh");
  await expect(
    page.getByRole("heading", { name: "设置家庭学习空间" }),
  ).toBeVisible();
  await page.getByLabel("语言").selectOption("ja");
  await expect(
    page.getByRole("heading", { name: "家族の学習スペースを設定" }),
  ).toBeVisible();
  await page.getByLabel("言語").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Set up your family workspace" }),
  ).toBeVisible();
  await page.getByLabel("Language").selectOption("zh");

  await page.getByRole("link", { name: "进入家庭设置" }).click();
  await expect(page.getByText("家庭学习空间", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "孩子档案与 PIN" }),
  ).toBeVisible();
});

test("parent imports material, reviews it, and reaches the printable set", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up your family workspace" }),
  ).toBeVisible();

  await page.goto("/parent/create/");
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

test("child completes a mixed worksheet and opens corrections", async ({
  page,
}) => {
  await page.goto("/child/work/");
  await page.getByRole("radio", { name: "a² − b²" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Your answer").fill("goes");
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Next question" }).click();
  const canvas = page.getByLabel("Handwriting answer area");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + 40, canvasBox!.y + 70);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 180, canvasBox!.y + 130, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Take a photo or choose images").setInputFiles([
    {
      name: "math-answer.png",
      mimeType: "image/png",
      buffer: Buffer.from("answer"),
    },
    {
      name: "math-draft.png",
      mimeType: "image/png",
      buffer: Buffer.from("draft"),
    },
  ]);
  await expect(
    page
      .getByRole("list", { name: "Uploaded answer images" })
      .getByRole("listitem"),
  ).toHaveText(["1. math-answer.png", "2. math-draft.png"]);
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("radio", { name: "School" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Submit all answers" }).click();

  await expect(
    page.getByRole("heading", { name: "Your work is being checked" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View results" }).click();
  await expect(
    page.getByRole("heading", { name: "Good work, Alex" }),
  ).toBeVisible();
  await expect(page.getByText("Try once more")).toBeVisible();
  await expect(page.getByText("Waiting for a parent")).toBeVisible();

  await page.getByRole("button", { name: "Correct these answers" }).click();
  await expect(page).toHaveURL(/\/child\/work\/\?correction=demo$/);
});

test("parent creation reaches child grading and correction through the API", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The shared fixture API flow runs once; responsive UI is covered separately.",
  );
  test.setTimeout(60_000);

  const apiBaseUrl = "http://127.0.0.1:8017";
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  await page.goto("/parent/family/");
  await expect(
    page.getByRole("textbox", { name: "New family name" }),
  ).toBeVisible();

  const familyResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/families` &&
      response.request().method() === "POST",
  );
  await page.getByRole("textbox", { name: "New family name" }).fill(
    "Playwright family",
  );
  await page.getByRole("button", { name: "Add family" }).click();
  const family = (await (await familyResponse).json()) as {
    id: string;
  };

  const childResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/families/${family.id}/children` &&
      response.request().method() === "POST",
  );
  await page.getByRole("textbox", { name: "Child name" }).fill("Alex API");
  await page.getByRole("textbox", { name: "Grade" }).fill("Junior high 1");
  await page.getByRole("textbox", { name: "Six-digit PIN" }).fill("123456");
  await page.getByRole("button", { name: "Add child" }).click();
  const child = (await (await childResponse).json()) as {
    id: string;
  };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page.getByRole("button", { name: "Create review draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before assigning" }),
  ).toBeVisible();

  const assignmentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/assignments") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm and assign" }).click();
  const assignment = (await (await assignmentResponse).json()) as {
    id: string;
  };
  await expect(page.getByText("Confirmed and assigned")).toBeVisible();

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignment.id)}`,
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

  const processedResponse = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(processedResponse.ok()).toBeTruthy();
  const resultsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/results") && response.status() === 200,
  );
  await page.getByRole("button", { name: "View results" }).click();
  await resultsResponse;
  await expect(page.getByText("Try once more")).toBeVisible();
  await expect(page.getByText("Waiting for a parent")).toBeVisible();

  await page.getByRole("button", { name: "Correct these answers" }).click();
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
  await expect(page.getByText("0/2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Complete: My brother ___ tennis on Sundays.",
    }),
  ).toBeVisible();
});
