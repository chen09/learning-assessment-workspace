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

const parentReviewFor = (attemptId: string, prompt: string) => ({
  attempt_id: attemptId,
  child_nickname: "Navigation child",
  title:
    attemptId === "parent-review-first"
      ? "First parent review"
      : "Second parent review",
  source_material_title: null,
  source_material_subject: null,
  complete: true,
  awarded_points: 0,
  available_points: 1,
  correct_count: 0,
  correction_count: 0,
  pending_review_count: 1,
  response_revisions: [],
  reviews: [
    {
      result_id: `${attemptId}-result`,
      question_id: `${attemptId}-question`,
      question_position: 1,
      question_prompt: prompt,
      question_type: "handwriting",
      question_points: 1,
      response_kind: "strokes",
      response_answer: {
        canvas_size: { width: 900, height: 420 },
        strokes: [],
      },
      automated_outcome: "needs_parent_review",
      automated_feedback: {
        summary: "A parent needs to review this response.",
        action: "Mark the answer correct or incorrect.",
      },
    },
  ],
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

test("browser navigation clears a stale printable worksheet before loading another", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers printable worksheet navigation.",
  );

  await page.route("**/v1/assignments/print-first/printable", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assignment: { id: "print-first" },
        title: "First printable practice",
        template_version: "a4-v1",
        questions: [
          {
            id: "first-print-question",
            position: 1,
            type: "typed_text",
            prompt: "First printable question.",
            options: null,
            points: 1,
          },
        ],
      }),
    });
  });

  let releaseSecondPrint: (() => void) | undefined;
  const secondPrintGate = new Promise<void>((resolve) => {
    releaseSecondPrint = resolve;
  });
  await page.route("**/v1/assignments/print-second/printable", async (route) => {
    await secondPrintGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assignment: { id: "print-second" },
        title: "Second printable practice",
        template_version: "a4-v1",
        questions: [
          {
            id: "second-print-question",
            position: 1,
            type: "typed_text",
            prompt: "Second printable question.",
            options: null,
            points: 1,
          },
        ],
      }),
    });
  });

  await page.goto("/parent/print/?assignmentId=print-first");
  await expect(
    page.getByRole("heading", { name: "First printable practice" }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState({}, "", "/parent/print/?assignmentId=print-second");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(
    page.getByRole("heading", { name: "Loading printable assignment…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First printable practice" }),
  ).toHaveCount(0);

  releaseSecondPrint?.();
  await expect(
    page.getByRole("heading", { name: "Second printable practice" }),
  ).toBeVisible();
});

test("browser navigation clears an open parent review before another review loads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers parent review navigation.",
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("luma-language:demo-parent", "en");
  });
  await page.route(
    "**/v1/grading-results/attempts/parent-review-first",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          parentReviewFor("parent-review-first", "First parent review question."),
        ),
      });
    },
  );
  let releaseSecondReview: (() => void) | undefined;
  const secondReviewGate = new Promise<void>((resolve) => {
    releaseSecondReview = resolve;
  });
  await page.route(
    "**/v1/grading-results/attempts/parent-review-second",
    async (route) => {
      await secondReviewGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          parentReviewFor("parent-review-second", "Second parent review question."),
        ),
      });
    },
  );

  await page.goto("/parent/results/?attemptId=parent-review-first");
  await expect(
    page.getByRole("heading", { name: "First parent review question." }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/parent/results/?attemptId=parent-review-second",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByRole("status")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First parent review question." }),
  ).toHaveCount(0);

  releaseSecondReview?.();
  await expect(
    page.getByRole("heading", { name: "Second parent review question." }),
  ).toBeVisible();
});

test("browser navigation clears the previous family before another family loads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers family settings navigation.",
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("luma-language:demo-parent", "en");
  });
  await page.route("**/v1/families", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "navigation-family-first", name: "First navigation family" },
        { id: "navigation-family-second", name: "Second navigation family" },
      ]),
    });
  });
  await page.route("**/v1/invitations/pending", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route("**/v1/families/*/management-pin", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ configured: false }),
    });
  });
  await page.route("**/v1/deletions**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route(
    "**/v1/families/navigation-family-first/children",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "navigation-child-first",
            family_id: "navigation-family-first",
            nickname: "First navigation child",
            grade_stage: "Grade 7",
            ui_language: "en",
          },
        ]),
      });
    },
  );
  let releaseSecondFamily: (() => void) | undefined;
  const secondFamilyGate = new Promise<void>((resolve) => {
    releaseSecondFamily = resolve;
  });
  await page.route(
    "**/v1/families/navigation-family-second/children",
    async (route) => {
      await secondFamilyGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "navigation-child-second",
            family_id: "navigation-family-second",
            nickname: "Second navigation child",
            grade_stage: "Grade 8",
            ui_language: "en",
          },
        ]),
      });
    },
  );

  await page.goto("/parent/family/?familyId=navigation-family-first");
  await expect(
    page.getByText("First navigation child", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/parent/family/?familyId=navigation-family-second",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(
    page.getByText("First navigation child", { exact: true }),
  ).toHaveCount(0);

  releaseSecondFamily?.();
  await expect(
    page.getByText("Second navigation child", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Second navigation family" }),
  ).toBeVisible();
});

test("browser navigation clears parent history before another family loads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers parent history navigation.",
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("luma-language:demo-parent", "en");
  });
  await page.route("**/v1/families", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "history-family-first", name: "First history family" },
        { id: "history-family-second", name: "Second history family" },
      ]),
    });
  });
  await page.route("**/v1/completed-worksheets/families/*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route(
    "**/v1/history/families/history-family-first",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            assignment_id: "history-assignment-first",
            attempt_id: null,
            child_id: "history-child-first",
            child_nickname: "First history child",
            title: "First history navigation item",
            status: "assigned",
            submitted_at: null,
            awarded_points: 0,
            available_points: 10,
            correction_count: 0,
            source_material_title: null,
            source_material_subject: null,
          },
        ]),
      });
    },
  );
  let releaseSecondHistory: (() => void) | undefined;
  const secondHistoryGate = new Promise<void>((resolve) => {
    releaseSecondHistory = resolve;
  });
  await page.route(
    "**/v1/history/families/history-family-second",
    async (route) => {
      await secondHistoryGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            assignment_id: "history-assignment-second",
            attempt_id: null,
            child_id: "history-child-second",
            child_nickname: "Second history child",
            title: "Second history navigation item",
            status: "assigned",
            submitted_at: null,
            awarded_points: 0,
            available_points: 10,
            correction_count: 0,
            source_material_title: null,
            source_material_subject: null,
          },
        ]),
      });
    },
  );

  await page.goto("/parent/history/?familyId=history-family-first");
  await expect(
    page.getByRole("heading", { name: "First history navigation item" }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/parent/history/?familyId=history-family-second",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByText("Loading family history…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First history navigation item" }),
  ).toHaveCount(0);

  releaseSecondHistory?.();
  await expect(
    page.getByRole("heading", { name: "Second history navigation item" }),
  ).toBeVisible();
});
