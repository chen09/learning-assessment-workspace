import { expect, test } from "@playwright/test";

const workFor = (attemptId: string, prompt: string) => ({
  title: attemptId === "first-attempt" ? "First assigned practice" : "Second assigned practice",
  assignment: {
    id: `assignment-${attemptId}`,
    family_id: "family-1",
    mode: "practice",
    time_limit_seconds: null,
    status: "in_progress",
  },
  attempt: { id: attemptId, started_at: "2026-08-03T00:00:00.000Z" },
  questions: [
    {
      id: `${attemptId}-question`,
      position: 1,
      type: "typed_text",
      prompt,
      options: null,
      points: 1,
    },
  ],
  responses: [],
  submitted_question_ids: [],
});

test("browser navigation hides the previous practice until the requested attempt loads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers URL practice switching.",
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("luma-language:demo-child", "en");
    window.localStorage.setItem("luma-child-session", "child-token");
    window.localStorage.setItem(
      "luma-child-profile",
      JSON.stringify({
        child_id: "child-1",
        family_id: "family-1",
        nickname: "Navigation child",
        ui_language: "en",
      }),
    );
  });

  await page.route("**/v1/attempts/first-attempt/work", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        workFor("first-attempt", "First attempt question."),
      ),
    });
  });

  let releaseSecondAttempt: (() => void) | undefined;
  const secondAttemptGate = new Promise<void>((resolve) => {
    releaseSecondAttempt = resolve;
  });
  await page.route("**/v1/attempts/second-attempt/work", async (route) => {
    await secondAttemptGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        workFor("second-attempt", "Second attempt question."),
      ),
    });
  });

  await page.goto("/child/work/?attemptId=first-attempt");
  await expect(
    page.getByRole("heading", { name: "First attempt question." }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState({}, "", "/child/work/?attemptId=second-attempt");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(
    page.getByRole("heading", { name: "Opening your assigned practice…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First attempt question." }),
  ).toHaveCount(0);

  releaseSecondAttempt?.();
  await expect(
    page.getByRole("heading", { name: "Second attempt question." }),
  ).toBeVisible();
});

test("browser navigation opens a completed-paper review from the parent create page", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers parent recovery navigation.",
  );

  await page.route("**/v1/families", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "family-1", name: "Navigation family" }]),
    });
  });
  await page.route("**/v1/families/family-1/children", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "child-1",
          family_id: "family-1",
          nickname: "Navigation child",
          grade_stage: "Junior high 1",
          ui_language: "en",
        },
      ]),
    });
  });
  await page.route(
    "**/v1/completed-worksheets/parent-navigation-paper",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "parent-navigation-paper",
          status: "needs_review",
          assignment_id: null,
          attempt_id: null,
          filenames: ["completed-paper.jpg"],
          response_paths: ["family-1/responses/completed-paper.jpg"],
          job: {
            id: "parent-navigation-job",
            status: "succeeded",
            type: "analyze_completed_worksheet",
          },
        }),
      });
    },
  );

  await page.goto("/parent/create/");
  await expect(page.getByRole("combobox", { name: "Family" })).toHaveValue(
    "family-1",
  );

  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/parent/create/?completedWorksheetId=parent-navigation-paper",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(
    page.getByRole("heading", { name: "Preparing the review draft" }),
  ).toBeVisible();
});
