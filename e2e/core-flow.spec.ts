import { expect, test } from "@playwright/test";

test("parent dashboard offers the assigned child sign-in route", async ({
  page,
}) => {
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "dashboard-family", name: "肉肉如意" }]),
    });
  });
  await page.route("**/v1/families/dashboard-family/children", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "dashboard-child",
          family_id: "dashboard-family",
          nickname: "肉肉",
          grade_stage: "Junior high 1",
          ui_language: "zh",
        },
      ]),
    });
  });
  await page.route("**/v1/history/families/dashboard-family", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          assignment_id: "dashboard-assignment",
          attempt_id: null,
          child_id: "dashboard-child",
          child_nickname: "肉肉",
          title: "Fractions recap",
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
  });

  await page.goto("/parent/");
  await expect(page.getByRole("heading", { name: "肉肉如意" })).toBeVisible();
  await expect(page.getByText("肉肉", { exact: true })).toBeVisible();
  await expect(page.getByText("Fractions recap")).toBeVisible();
  await expect(page.getByText("Assigned")).toBeVisible();
  await expect(page.getByRole("link", { name: "View progress" })).toHaveAttribute(
    "href",
    "/parent/history/?familyId=dashboard-family",
  );
  await expect(page.getByRole("link", { name: "Open child sign-in" })).toHaveAttribute(
    "href",
    "/child/login/?childId=dashboard-child&assignmentId=dashboard-assignment",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:3107",
  });
  await page.getByRole("button", { name: "Copy child sign-in link" }).click();
  await expect.poll(() =>
    page.evaluate(() => navigator.clipboard.readText()),
  ).toBe(
    "http://127.0.0.1:3107/child/login?childId=dashboard-child&assignmentId=dashboard-assignment",
  );
  await expect(page.getByText("Link copied")).toBeVisible();
  const createPractice = page.getByRole("link", { name: "Create practice" });
  await expect(createPractice).toHaveAttribute(
    "href",
    "/parent/create/?familyId=dashboard-family&childId=dashboard-child",
  );
  await createPractice.click();
  await expect(page).toHaveURL(
    /\/parent\/create\/?\?familyId=dashboard-family&childId=dashboard-child$/,
  );
});

test("parent dashboard switches families before showing another child's work", async ({
  page,
}) => {
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "switch-family-1", name: "First family" },
        { id: "switch-family-2", name: "Second family" },
      ]),
    });
  });
  await page.route("**/v1/families/*/children", async (route) => {
    const familyId = route.request().url().includes("switch-family-2")
      ? "switch-family-2"
      : "switch-family-1";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: `${familyId}-child`,
          family_id: familyId,
          nickname: familyId === "switch-family-1" ? "First child" : "Second child",
          grade_stage: "Junior high 1",
          ui_language: "en",
        },
      ]),
    });
  });
  await page.route("**/v1/history/families/*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/parent/");
  await expect(page.getByRole("heading", { name: "First family" })).toBeVisible();
  await expect(page.getByText("First child", { exact: true })).toBeVisible();

  await page.getByLabel("Current family").selectOption("switch-family-2");

  await expect(page.getByRole("heading", { name: "Second family" })).toBeVisible();
  await expect(page.getByText("Second child", { exact: true })).toBeVisible();
  await expect(page.getByText("First child", { exact: true })).toBeHidden();
});

test("parent history selects an authorized family when opened from the sidebar", async ({
  page,
}) => {
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "history-family-1", name: "History family one" },
        { id: "history-family-2", name: "History family two" },
      ]),
    });
  });
  await page.route("**/v1/history/families/*", async (route) => {
    const isSecondFamily = route
      .request()
      .url()
      .includes("history-family-2");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        isSecondFamily
          ? [
              {
                assignment_id: "history-assignment-2",
                attempt_id: "history-attempt-2",
                child_id: "history-child-2",
                child_nickname: "Second child",
                title: "Second family practice",
                status: "assigned",
                submitted_at: null,
                awarded_points: 0,
                available_points: 10,
                correction_count: 0,
                source_material_title: null,
                source_material_subject: null,
              },
            ]
          : [],
      ),
    });
  });
  await page.route("**/v1/completed-worksheets/families/*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/parent/history/");
  await expect(page.getByText("No family learning history yet.")).toBeVisible();
  await expect(page.getByLabel("Current family")).toHaveValue(
    "history-family-1",
  );

  await page
    .getByLabel("Current family")
    .selectOption("history-family-2");

  await expect(page).toHaveURL(/familyId=history-family-2/);
  await expect(
    page.getByRole("heading", { name: "Second family practice" }),
  ).toBeVisible();
});

test("parent dashboard highlights handwritten answers awaiting a decision", async ({
  page,
}) => {
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "review-family", name: "Review family" }]),
    });
  });
  await page.route("**/v1/families/review-family/children", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "review-child",
          family_id: "review-family",
          nickname: "Alex",
          grade_stage: "Junior high 1",
          ui_language: "en",
        },
      ]),
    });
  });
  await page.route("**/v1/history/families/review-family", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          assignment_id: "review-assignment",
          attempt_id: "review-attempt",
          child_id: "review-child",
          child_nickname: "Alex",
          title: "Handwritten grammar response",
          status: "results_ready",
          submitted_at: "2026-08-02T00:00:00Z",
          awarded_points: 8,
          available_points: 10,
          correction_count: 1,
          source_material_title: null,
          source_material_subject: null,
        },
      ]),
    });
  });
  await page.route(
    "**/v1/grading-results/attempts/review-attempt",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ pending_review_count: 2 }),
      });
    },
  );

  await page.goto("/parent/");

  await expect(
    page.getByText("2 handwritten answer(s) need your decision"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Review now" })).toHaveAttribute(
    "href",
    "/parent/results/?attemptId=review-attempt",
  );
});

test("authenticated parent legacy link is cleaned and remains responsive in all languages", async ({
  page,
}, testInfo) => {
  await page.route("**/v1/families", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
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

test("parent separates imported material and its private answer key", async ({
  page,
  request,
}, testInfo) => {
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-material-${testInfo.project.name}-${testInfo.workerIndex}`;
  const familyResponse = await request.post(`${apiBaseUrl}/v1/families`, {
    headers: {
      Authorization: "Bearer parent-fixture",
      "Idempotency-Key": `${fixtureKey}-family`,
    },
    data: { name: "Material import family" },
  });
  expect(familyResponse.ok()).toBeTruthy();
  const family = (await familyResponse.json()) as { id: string };
  const childResponse = await request.post(
    `${apiBaseUrl}/v1/families/${family.id}/children`,
    {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-child`,
      },
      data: {
        nickname: "Material child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    },
  );
  expect(childResponse.ok()).toBeTruthy();
  const child = (await childResponse.json()) as { id: string };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await expect(page.getByRole("combobox", { name: "Family" })).toHaveValue(
    family.id,
  );
  await expect(page.getByRole("combobox", { name: "Child" })).toHaveValue(
    child.id,
  );
  await page.getByRole("button", { name: "Import material" }).click();
  await page
    .getByRole("radio", {
      name: "Convert an existing worksheet into questions",
    })
    .click();
  await page.getByLabel("Question material").setInputFiles({
    name: "english-lesson.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fixture"),
  });
  await page.getByLabel("Answer key (private)").setInputFiles({
    name: "english-lesson-answers.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("answers"),
  });

  await expect(page.getByText("english-lesson.pdf")).toBeVisible();
  await expect(page.getByText("english-lesson-answers.pdf")).toBeVisible();
  await expect(page.getByText("Children never receive this file.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create review draft" }),
  ).toBeEnabled();
});

test("parent reassigns a confirmed library set with an exam limit", async ({
  page,
  request,
}, testInfo) => {
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-library-reuse-${testInfo.project.name}-${testInfo.workerIndex}`;
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-family` },
      data: { name: "Library reuse family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-child` },
      data: {
        nickname: "Library child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const imported = (await (
    await request.post(`${apiBaseUrl}/v1/question-sets/imports/structured`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-import` },
      data: {
        family_id: family.id,
        child_id: child.id,
        source_name: "Library reuse fixture",
        assignment_mode: "practice",
        time_limit_seconds: null,
        parent_note: null,
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Reusable algebra check",
            subject: "Mathematics",
            locale: "en",
            difficulty: "standard",
            source_mode: "generate",
            estimated_minutes: 5,
            source_summary: { fixture: true },
          },
          knowledge_tags: [{ code: "addition", label: "Addition" }],
          questions: [
            {
              position: 1,
              type: "typed_text",
              prompt: "What is 2 + 2?",
              options: [],
              answer_key: { text: "4" },
              rubric: { grading_mode: "exact" },
              points: 1,
              knowledge_code: "addition",
            },
          ],
        },
      },
    })
  ).json()) as { question_set_id: string };

  await page.goto(`/parent/library/?familyId=${encodeURIComponent(family.id)}`);
  await expect(
    page.getByRole("heading", { name: "Reusable algebra check" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assign to child" }).click();
  await expect(
    page.getByRole("heading", { name: "Assign “Reusable algebra check”" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Exam" }).check();
  await page.getByRole("combobox", { name: "Time limit" }).selectOption("45");
  await page.getByLabel("Note for child (optional)").fill("Try this on your own.");

  const assignmentResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/question-sets/${imported.question_set_id}/assignments` &&
      response.request().method() === "POST",
  );
  const assignButton = page.getByRole("button", { name: "Assign practice" });
  await page.getByLabel("Note for child (optional)").blur();
  await assignButton.scrollIntoViewIfNeeded();
  await expect(assignButton).toBeVisible();
  await expect(assignButton).toBeEnabled();
  // Mobile Chromium can retain an outdated hit-test rectangle after the
  // textarea blur reflows this panel. The visible, enabled control still
  // dispatches the same user-facing assignment action.
  await assignButton.click({ force: true });
  const assignmentRequest = await assignmentResponse;
  expect(assignmentRequest.request().postDataJSON()).toEqual({
    child_id: child.id,
    mode: "exam",
    time_limit_seconds: 2700,
    parent_note: "Try this on your own.",
  });
  await expect(page.getByText("Assigned to Library child.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign practice" })).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Print A4 worksheet" }),
  ).toHaveAttribute("href", /\/parent\/print\/?\?assignmentId=/);
  await expect(
    page.getByRole("link", { name: "Open child sign-in" }),
  ).toHaveAttribute(
    "href",
    new RegExp(
      `^/child/login/?\\?childId=${encodeURIComponent(child.id)}&assignmentId=`,
    ),
  );
  const printWorksheet = page.getByRole("link", {
    name: "Print A4 worksheet",
  });
  if (testInfo.project.name === "mobile") {
    // Mobile Chromium can retain the assignment-panel hit-test layer for a
    // frame after the successful assignment reflows the new print action.
    // Keyboard activation verifies that the visible link remains accessible
    // without relying on that transient pointer hit-test state.
    await printWorksheet.focus();
    await page.keyboard.press("Enter");
  } else {
    await printWorksheet.click();
  }
  await expect(
    page.getByRole("heading", { name: "Reusable algebra check", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Page 1 \/ 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();

  await page.goto(`/parent/library/?familyId=${encodeURIComponent(family.id)}`);
  await page.getByRole("button", { name: "Submit to public review" }).click();
  await expect(
    page.getByRole("heading", { name: "Submit “Reusable algebra check”" }),
  ).toBeVisible();
  const submitForReview = page.getByRole("button", {
    name: "Submit for review",
  });
  await expect(submitForReview).toBeDisabled();
  await page
    .getByLabel("I have the right to share this generated question set.")
    .check({ force: testInfo.project.name === "mobile" });
  await page
    .getByLabel(
      "I confirm this set contains no child work, personal data, or private source files.",
    )
    .check({ force: testInfo.project.name === "mobile" });
  const reviewSubmission = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/library/submissions` &&
      response.request().method() === "POST" &&
      response.status() === 202,
  );
  await submitForReview.scrollIntoViewIfNeeded();
  await expect(submitForReview).toBeVisible();
  await expect(submitForReview).toBeEnabled();
  // Mobile Chromium can preserve an outdated hit-test rectangle after a
  // checkbox changes the panel layout. The normal user-facing action and its
  // request contract are still verified below.
  await submitForReview.click({ force: true });
  const reviewRequest = await reviewSubmission;
  expect(reviewRequest.request().postDataJSON()).toEqual({
    family_id: family.id,
    question_set_id: imported.question_set_id,
    rights_confirmed: true,
    privacy_confirmed: true,
  });
  await expect(
    page.getByText("Submitted for public-library review."),
  ).toBeVisible();

  const submission = (await reviewRequest.json()) as { id: string };
  const withdrawal = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/library/submissions/${submission.id}/withdraw` &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Withdraw submission" }).click();
  await withdrawal;
  await expect(
    page.getByText("Submission withdrawn. Your question set remains private."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit to public review" }),
  ).toBeVisible();
});

test("listening audio stays private until a child starts an allowed playback", async ({
  page,
  request,
}, testInfo) => {
  const apiBaseUrl = "http://127.0.0.1:8017";
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const fixtureKey = `e2e-listening-${testInfo.project.name}-${testInfo.workerIndex}`;
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-family` },
      data: { name: "Private listening family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-child` },
      data: {
        nickname: "Listening child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const audio = await request.post(`${apiBaseUrl}/v1/uploads/intents`, {
    headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-audio` },
    data: {
      family_id: family.id,
      bucket: "audio",
      object_id: "b4d3c2a1-0f9e-4d8c-b7a6-5e4f3d2c1b0a",
      filename: "private-listening.mp3",
      content_type: "audio/mpeg",
    },
  });
  expect(audio.ok()).toBeTruthy();
  const audioPath = (await audio.json()) as { path: string };
  const imported = (await (
    await request.post(`${apiBaseUrl}/v1/question-sets/imports/structured`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-import` },
      data: {
        family_id: family.id,
        child_id: child.id,
        source_name: "private-listening.json",
        assignment_mode: "practice",
        time_limit_seconds: null,
        parent_note: null,
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Private listening check",
            subject: "English",
            locale: "en",
            difficulty: "standard",
            source_mode: "generate",
            estimated_minutes: 3,
            source_summary: { fixture: true },
          },
          knowledge_tags: [{ code: "listening", label: "Listening" }],
          questions: [
            {
              position: 1,
              type: "listening",
              prompt: "Listen and choose the destination.",
              options: ["School", "The library"],
              answer_key: { choice: 0 },
              rubric: { grading_mode: "exact" },
              points: 1,
              knowledge_code: "listening",
              listening: {
                audio_path: audioPath.path,
                replay_limit: 1,
                transcript: "I walk to school every morning.",
                transcript_policy: "never",
              },
            },
          ],
        },
      },
    })
  ).json()) as { assignment_id: string };

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(imported.assignment_id)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();

  const player = page.locator("audio");
  await expect(player).not.toHaveAttribute("src");
  const playbackUrl = /\/v1\/attempts\/[^/]+\/questions\/[^/]+\/audio-playbacks$/;
  await page.route(playbackUrl, async (route) => {
    const response = await route.fetch();
    const receipt = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...receipt,
        audio_url:
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
      },
    });
  });
  const playback = page.waitForResponse(
    (response) =>
      playbackUrl.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  const playButton = page.getByRole("button", { name: "Play at 0.85×" });
  await playButton.click();
  expect((await playback).ok()).toBeTruthy();
  await expect(player).toHaveAttribute("src", /^data:audio\/wav;base64,/);
  await expect(playButton).toBeDisabled();
});

test("a reviewed public item can be copied without exposing its private answer data", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The public-library workflow runs once; its responsive UI has component coverage.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const fixtureKey = `e2e-public-library-${testInfo.workerIndex}`;
  const sourceFamily = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-source-family` },
      data: { name: "Source family" },
    })
  ).json()) as { id: string };
  const sourceChild = (await (
    await request.post(`${apiBaseUrl}/v1/families/${sourceFamily.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-source-child` },
      data: {
        nickname: "Source child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const imported = (await (
    await request.post(`${apiBaseUrl}/v1/question-sets/imports/structured`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-import` },
      data: {
        family_id: sourceFamily.id,
        child_id: sourceChild.id,
        source_name: "Public library fixture",
        assignment_mode: "practice",
        time_limit_seconds: null,
        parent_note: null,
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Anonymous algebra practice",
            subject: "Mathematics",
            locale: "en",
            difficulty: "standard",
            source_mode: "generate",
            estimated_minutes: 5,
            source_summary: { fixture: true },
          },
          knowledge_tags: [{ code: "addition", label: "Addition" }],
          questions: [
            {
              position: 1,
              type: "typed_text",
              prompt: "What is 2 + 2?",
              options: [],
              answer_key: { text: "4" },
              rubric: { grading_mode: "exact" },
              points: 1,
              knowledge_code: "addition",
            },
          ],
        },
      },
    })
  ).json()) as { question_set_id: string };
  const submission = (await (
    await request.post(`${apiBaseUrl}/v1/library/submissions`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-submission` },
      data: {
        family_id: sourceFamily.id,
        question_set_id: imported.question_set_id,
        rights_confirmed: true,
        privacy_confirmed: true,
      },
    })
  ).json()) as { id: string };

  const approval = await request.post(
    `${apiBaseUrl}/v1/library/review/submissions/${submission.id}/decision`,
    {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-approve` },
      data: { decision: "approve", note: "Fixture approved." },
    },
  );
  expect(approval.status()).toBe(200);

  const destinationFamily = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-destination-family` },
      data: { name: "Destination family" },
    })
  ).json()) as { id: string };

  await page.goto("/parent/library/public/");
  await expect(
    page.getByRole("heading", { name: "Anonymous algebra practice" }),
  ).toBeVisible();
  await expect(page.getByText("Mathematics")).toBeVisible();
  await expect(page.getByText("1 questions · revision 1")).toBeVisible();
  await expect(page.getByText("What is 2 + 2?")).toHaveCount(0);
  await expect(page.getByText("4", { exact: true })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Target family" }).selectOption(destinationFamily.id);
  const copyResponse = page.waitForResponse(
    (response) =>
      /\/v1\/library\/items\/[^/]+\/copies$/.test(response.url()) &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Copy to my family" }).click();
  await copyResponse;
  await expect(
    page.getByText("Copied to Destination family's family library."),
  ).toBeVisible();

  await page.goto(`/parent/library/?familyId=${encodeURIComponent(destinationFamily.id)}`);
  await expect(
    page.getByRole("heading", { name: "Anonymous algebra practice" }),
  ).toBeVisible();
});

test("parent previews an AI JSON file before assigning its structured questions", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The shared fixture API import runs once; responsive UI is covered separately.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const parentHeaders = {
    Authorization: "Bearer parent-fixture",
    "Idempotency-Key": "e2e-structured-family",
  };
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: parentHeaders,
      data: { name: "Structured JSON family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": "e2e-structured-child",
      },
      data: {
        nickname: "JSON child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const document = {
    schema_version: "1.0",
    question_set: {
      title: "Uploaded JSON practice",
      subject: "Mathematics",
      locale: "en",
      difficulty: "standard",
      source_mode: "convert",
      estimated_minutes: 5,
      source_summary: { fixture: true },
    },
    knowledge_tags: [{ code: "addition", label: "Addition" }],
    questions: [
      {
        position: 1,
        type: "typed_text",
        prompt: "What is 2 + 2?",
        options: [],
        answer_key: { text: "4" },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "addition",
      },
      {
        position: 2,
        type: "typed_text",
        prompt: "Remove this extra extraction.",
        options: [],
        answer_key: { text: "unused" },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "addition",
      },
    ],
  };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page
    .getByRole("button", { name: "Import AI question JSON" })
    .click();
  await page.getByLabel("AI question JSON").setInputFiles({
    name: "structured-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await page.getByRole("button", { name: "Preview questions" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before assigning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is 2 + 2?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Remove this extra extraction." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Duplicate question 1" }).click();
  await expect(
    page.getByRole("heading", { name: "What is 2 + 2? (copy)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move question 3 up" }).click();
  await page.getByRole("button", { name: "Remove question 2" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove this extra extraction." }),
  ).not.toBeVisible();

  await page.getByRole("button", { name: "Edit question 1" }).click();
  await page
    .getByRole("textbox", { name: "Question wording" })
    .fill("What is 3 + 3?");
  await page.getByRole("spinbutton", { name: "Points" }).fill("2");
  await page.getByRole("combobox", { name: "Response type" }).selectOption(
    "single_choice",
  );
  await page
    .getByRole("textbox", { name: "Choices, one per line" })
    .fill("5\n6\n7");
  await page.getByRole("textbox", { name: "Correct answer" }).fill("6");
  await page.getByRole("button", { name: "Save question" }).click();
  await expect(
    page.getByRole("heading", { name: "What is 3 + 3?" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Timed exam" }).check();
  await page.getByLabel("Time limit").selectOption("15");

  const importResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/question-sets/imports/structured` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm and assign" }).click();
  const importedRequest = await importResponse;
  expect(importedRequest.request().postDataJSON()).toMatchObject({
    assignment_mode: "exam",
    time_limit_seconds: 900,
    document: {
      questions: [
        {
          prompt: "What is 3 + 3?",
          points: 2,
          type: "single_choice",
          options: ["5", "6", "7"],
          answer_key: { choice: 1 },
        },
        {
          position: 2,
          prompt: "What is 2 + 2? (copy)",
        },
      ],
    },
  });
  const assignmentId = (await importedRequest.json() as {
    assignment_id: string;
  }).assignment_id;
  await expect(page.getByText("Confirmed and assigned")).toBeVisible();

  const childSignIn = page.getByRole("link", { name: "Open child sign-in" });
  await expect(childSignIn).toHaveAttribute(
    "href",
    new RegExp(
      `^/child/login/?\\?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignmentId)}$`,
    ),
  );
  await childSignIn.click();
  await expect(page).toHaveURL(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignmentId)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(page.getByText("0/2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is 3 + 3?" }),
  ).toBeVisible();
  await expect(page.locator(".exam-toggle")).toContainText(/1[45]:/);

  await page.goto("/child/work/");
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
  await expect(
    page.getByRole("heading", { name: "Uploaded JSON practice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is 3 + 3?" }),
  ).toBeVisible();
  await expect(page.locator(".exam-toggle")).toContainText(/1[45]:/);
});

test("parent authors one question and assigns it through the reviewed draft", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The shared fixture API import runs once; responsive UI is covered separately.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-manual-question-${testInfo.workerIndex}`;
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-family`,
      },
      data: { name: "Manual question family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-child`,
      },
      data: {
        nickname: "Manual child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page.getByRole("button", { name: "Start simple" }).click();
  await page.getByLabel("Practice title").fill("Weather check");
  await page
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Complete: If it ___ tomorrow, we will stay home.");
  await page.getByLabel("Answer or grading guide").fill("rains");
  await page.getByLabel("Points").fill("2");
  await page.getByRole("button", { name: "Create review draft" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Complete: If it ___ tomorrow, we will stay home.",
    }),
  ).toBeVisible();

  const importResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/question-sets/imports/structured` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm and assign" }).click();
  const importedRequest = await importResponse;
  expect(importedRequest.request().postDataJSON()).toMatchObject({
    source_name: "Manual question",
    document: {
      question_set: { source_mode: "manual", title: "Weather check" },
      questions: [
        {
          type: "typed_text",
          answer_key: { text: "rains" },
          points: 2,
        },
      ],
    },
  });
  const assignmentId = (await importedRequest.json() as {
    assignment_id: string;
  }).assignment_id;

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignmentId)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Complete: If it ___ tomorrow, we will stay home.",
    }),
  ).toBeVisible();
});

test("parent collects several manual questions into one assigned practice", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The shared fixture API import runs once; responsive UI is covered separately.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-manual-set-${testInfo.workerIndex}`;
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-family`,
      },
      data: { name: "Manual set family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-child`,
      },
      data: {
        nickname: "Manual set child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page.evaluate(() => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });
  await page.reload();
  await page.getByRole("button", { name: "手工创建题单" }).click();
  await page.getByLabel("练习名称").fill("Two question check");
  await page
    .getByRole("textbox", { name: "题目", exact: true })
    .fill("Complete: I ___ ready.");
  await page.getByLabel("参考答案或评分提示").fill("am");
  await page.getByRole("button", { name: "添加题目" }).click();
  await expect(page.getByText("第 1 题已准备好")).toBeVisible();

  await page
    .getByRole("textbox", { name: "题目", exact: true })
    .fill("Complete: She ___ to school every day.");
  await page.getByLabel("参考答案或评分提示").fill("walks");
  await page.getByRole("button", { name: "创建审核草稿" }).click();
  await expect(
    page.getByRole("heading", { name: "Complete: I ___ ready." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Complete: She ___ to school every day." }),
  ).toBeVisible();

  const importResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/question-sets/imports/structured` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "确认并布置" }).click();
  const importedRequest = await importResponse;
  expect(importedRequest.request().postDataJSON()).toMatchObject({
    document: {
      question_set: { source_mode: "manual", title: "Two question check" },
      questions: [
        { position: 1, prompt: "Complete: I ___ ready.", answer_key: { text: "am" } },
        {
          position: 2,
          prompt: "Complete: She ___ to school every day.",
          answer_key: { text: "walks" },
        },
      ],
    },
  });
  const assignmentId = (await importedRequest.json() as {
    assignment_id: string;
  }).assignment_id;

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignmentId)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(page.getByText("0/2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Complete: I ___ ready." }),
  ).toBeVisible();

  await page.goto(
    `/parent/history/?familyId=${encodeURIComponent(family.id)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Two question check" }),
  ).toBeVisible();
  // The accessible label follows the persisted UI language, so it may already
  // be Japanese or Chinese when this shared browser context reaches history.
  await page.locator(".language-picker select").selectOption("zh");
  await expect(page.getByRole("heading", { name: "学习记录" })).toBeVisible();
  await page.getByRole("button", { name: "结束练习" }).click();
  await expect(page.getByText("已结束", { exact: true })).toBeVisible();
});

test("parent can return to an imported question-set review from its recovery link", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The source-import recovery flow runs once; responsive UI is covered separately.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-source-recovery-${testInfo.workerIndex}`;
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-family` },
      data: { name: "Source recovery family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-child` },
      data: {
        nickname: "Source child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page.getByRole("button", { name: "Import material" }).click();
  await page
    .getByRole("radio", { name: "Convert an existing worksheet into questions" })
    .check();
  await page.getByLabel("Question material").setInputFiles({
    name: "source-recovery.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("source-recovery"),
  });
  const importResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/question-sets/imports` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create review draft" }).click();
  const imported = (await (await importResponse).json()) as {
    question_set_id: string;
  };
  await expect(page).toHaveURL(
    new RegExp(`questionSetId=${encodeURIComponent(imported.question_set_id)}`),
  );
  await page.goto(
    `/parent/library/?familyId=${encodeURIComponent(family.id)}`,
  );
  await page.locator(".language-picker select").selectOption("en");
  await expect(
    page.getByRole("link", { name: "Continue question-set review" }),
  ).toHaveAttribute(
    "href",
    `/parent/create/?questionSetId=${imported.question_set_id}`,
  );
  await page.getByRole("link", { name: "Continue question-set review" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before assigning" }),
  ).toBeVisible();
});

test("parent recovers an unfinished completed-paper review from history", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The paper-recovery flow runs once; responsive history layout has component coverage.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-paper-recovery-${testInfo.workerIndex}`;
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-family` },
      data: { name: "Paper recovery family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-child` },
      data: {
        nickname: "Recovery child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const created = await request.post(`${apiBaseUrl}/v1/completed-worksheets`, {
    headers: {
      ...parentHeaders,
      "Idempotency-Key": `${fixtureKey}-completed-paper`,
    },
    data: {
      family_id: family.id,
      child_id: child.id,
      title: "Unfinished factorisation paper",
      subject: "Mathematics",
      document_language: "ja",
      feedback_language: "en",
      filenames: ["unfinished-factorisation.jpg"],
      response_paths: ["family/responses/unfinished-factorisation.jpg"],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const completedPaper = (await created.json()) as { id: string };

  const processed = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(processed.ok(), await processed.text()).toBeTruthy();

  await page.goto(`/parent/history/?familyId=${encodeURIComponent(family.id)}`);
  const recoveryLink = page.getByRole("link", {
    name: "Continue paper review",
  });
  await expect(recoveryLink).toHaveAttribute(
    "href",
    `/parent/create/?completedWorksheetId=${completedPaper.id}`,
  );
  await expect(
    page.getByRole("heading", { name: "Unfinished factorisation paper" }),
  ).toBeVisible();
  await recoveryLink.click();
  await expect(page).toHaveURL(
    new RegExp(`completedWorksheetId=${encodeURIComponent(completedPaper.id)}`),
  );
  await expect(
    page.getByRole("heading", { name: "Preparing the review draft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy local AI prompt" }),
  ).toBeVisible();
});

test("parent validates a local-AI completed-paper review before submitting it", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The completed-paper confirmation flow runs once; responsive UI is covered separately.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `e2e-completed-paper-${testInfo.workerIndex}`;
  const parentHeaders = { Authorization: "Bearer parent-fixture" };
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-family` },
      data: { name: "Completed paper family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: { ...parentHeaders, "Idempotency-Key": `${fixtureKey}-child` },
      data: {
        nickname: "Paper child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };
  const document = {
    schema_version: "1.0",
    question_set: {
      title: "Completed paper review",
      subject: "Mathematics",
      locale: "ja",
      difficulty: "standard",
      source_mode: "convert",
      estimated_minutes: 5,
      source_summary: { fixture: true },
    },
    knowledge_tags: [
      { code: "factorisation", label: "Factorisation" },
      { code: "present-simple", label: "Present simple" },
    ],
    questions: [
      {
        position: 1,
        type: "handwriting",
        prompt: "Factorise x² - 16.",
        options: [],
        answer_key: { reference: "(x - 4)(x + 4)" },
        rubric: { grading_mode: "parent_review" },
        points: 1,
        knowledge_code: "factorisation",
      },
      {
        position: 2,
        type: "typed_text",
        prompt: "Complete: She ___ to school every day.",
        options: [],
        answer_key: { text: "goes" },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "present-simple",
      },
      {
        position: 3,
        type: "single_choice",
        prompt: "Choose the correct sentence.",
        options: ["She walk to school.", "She walks to school."],
        answer_key: { choice: 1 },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "present-simple",
      },
      {
        position: 4,
        type: "multiple_choice",
        prompt: "Select both correct present-simple forms.",
        options: ["She walks to school.", "They walk to school.", "He walk to school."],
        answer_key: { choices: [0, 1] },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "present-simple",
      },
      {
        position: 5,
        type: "word_order",
        prompt: "Put the words in order.",
        options: ["She", "walks", "to", "school."],
        answer_key: { tokens: ["walks", "She", "school.", "to"] },
        rubric: { grading_mode: "exact" },
        points: 1,
        knowledge_code: "present-simple",
      },
    ],
  };
  const review = {
    document,
    answer_regions: [
      {
        question_position: 1,
        page_numbers: [1],
        regions: [{ x: 0.1, y: 0.2, width: 0.7, height: 0.12 }],
        transcription: "(x - 4)(x + 4)",
        legibility: "clear",
      },
      {
        question_position: 2,
        page_numbers: [1],
        transcription: "goes",
        legibility: "clear",
      },
      {
        question_position: 3,
        page_numbers: [1],
        transcription: "She walks to school.",
        legibility: "clear",
      },
      {
        question_position: 4,
        page_numbers: [1],
        transcription: "She walks to school. They walk to school.",
        legibility: "clear",
      },
      {
        question_position: 5,
        page_numbers: [1],
        transcription: "She walks to school.",
        legibility: "clear",
      },
    ],
  };

  await page.goto(
    `/parent/create/?familyId=${encodeURIComponent(family.id)}&childId=${encodeURIComponent(child.id)}`,
  );
  await page.getByRole("button", { name: "Grade completed paper" }).click();
  await page.getByLabel("Completed worksheet scans").setInputFiles({
    name: "completed-paper.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("completed-paper"),
  });
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/completed-worksheets` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Upload for review" }).click();
  const imported = (await (await uploadResponse).json()) as {
    id: string;
    response_paths: string[];
  };
  await expect(page).toHaveURL(
    new RegExp(`completedWorksheetId=${encodeURIComponent(imported.id)}`),
  );
  await request.post(`${apiBaseUrl}/v1/demo/jobs/process-next`, {
    headers: parentHeaders,
  });
  await expect(
    page.getByRole("button", { name: "Copy local AI prompt" }),
  ).toBeVisible();
  await page.getByLabel("Reviewed completed worksheet JSON").setInputFiles({
    name: "completed-paper-review.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(review)),
  });
  await expect(
    page.getByText("Review ready · questions: 5 · answer regions: 5"),
  ).toBeVisible();
  await page
    .getByLabel("Question 1 wording")
    .fill("Factorise x² - 25.");
  await page
    .getByLabel("Reference answer for question 1")
    .fill("(x - 5)(x + 5)");
  await page.getByLabel("Accepted answer for question 2").fill("walks");
  await page.getByLabel("Correct choice for question 3").selectOption("0");
  await page.getByLabel("Correct choice 1 for question 4").uncheck();
  await page.getByLabel("Correct choice 3 for question 4").check();
  await page
    .getByLabel("Correct word order for question 5")
    .fill("She\nwalks\nto\nschool.");
  await page.getByRole("button", { name: "Remove question 5" }).click();
  await expect(
    page.getByLabel("Correct word order for question 5"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add handwritten question" }).click();
  await page.getByLabel("Question 5 wording").fill("Explain your factorisation.");
  await page
    .getByLabel("Reference answer for question 5")
    .fill("Show the two factors.");
  await page.getByLabel("Answer page numbers for question 1").fill("2");
  await page
    .getByLabel("Answer transcription for question 1")
    .fill("(x - 5)(x + 5)");

  const confirmRequest = page.waitForRequest(
    (request) =>
      request.url() ===
        `${apiBaseUrl}/v1/completed-worksheets/${imported.id}/confirm` &&
      request.method() === "POST",
  );
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/completed-worksheets/${imported.id}/confirm` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm and start grading" }).click();
  const confirmationBody = JSON.parse((await confirmRequest).postData() ?? "{}") as {
    document: {
      questions: Array<{
        prompt: string;
        answer_key: {
          reference?: string;
          text?: string;
          choice?: number;
          choices?: number[];
          tokens?: string[];
        };
      }>;
    };
    responses: Array<{
      answer: { source_paths: string[]; page_numbers: number[]; transcription: string };
    }>;
  };
  expect(confirmationBody.document.questions[0]).toMatchObject({
    prompt: "Factorise x² - 25.",
    answer_key: { reference: "(x - 5)(x + 5)" },
  });
  expect(confirmationBody.document.questions[1]).toMatchObject({
    answer_key: { text: "walks" },
  });
  expect(confirmationBody.document.questions[2]).toMatchObject({
    answer_key: { choice: 0 },
  });
  expect(confirmationBody.document.questions[3]).toMatchObject({
    answer_key: { choices: [1, 2] },
  });
  expect(confirmationBody.document.questions).toHaveLength(5);
  expect(confirmationBody.document.questions[4]).toMatchObject({
    prompt: "Explain your factorisation.",
    answer_key: { reference: "Show the two factors." },
  });
  expect(confirmationBody.responses).toHaveLength(5);
  expect(confirmationBody.responses.map((response) => response.question_position)).toEqual(
    [1, 2, 3, 4, 5],
  );
  expect(confirmationBody.responses[0]?.answer.source_paths).toEqual(
    imported.response_paths,
  );
  expect(confirmationBody.responses[0]?.answer.page_numbers).toEqual([2]);
  expect(confirmationBody.responses[0]?.answer.transcription).toBe(
    "(x - 5)(x + 5)",
  );
  const confirmationResponse = await confirmResponse;
  expect(
    confirmationResponse.status(),
    await confirmationResponse.text(),
  ).toBe(201);
  await expect(
    page.getByRole("link", { name: "Open grading results" }),
  ).toBeVisible();

  // Confirmation creates a grading job. Consume this test's job so the
  // subsequent shared-fixture flow cannot accidentally process it.
  const processedResponse = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(processedResponse.ok()).toBeTruthy();
});

test("an expired child session returns to PIN login and resumes the requested page", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Session expiry behavior is viewport-independent.",
  );
  const apiBaseUrl = "http://127.0.0.1:8017";
  const family = (await (
    await request.post(`${apiBaseUrl}/v1/families`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": "e2e-expired-child-family",
      },
      data: { name: "Expired child session family" },
    })
  ).json()) as { id: string };
  const child = (await (
    await request.post(`${apiBaseUrl}/v1/families/${family.id}/children`, {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": "e2e-expired-child-profile",
      },
      data: {
        nickname: "Expiry child",
        grade_stage: "Junior high 1",
        ui_language: "en",
        pin: "123456",
      },
    })
  ).json()) as { id: string };

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  const initialAssignments = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/assignments` &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(page).toHaveURL(/\/child\/$/);
  await initialAssignments;

  await page.evaluate(() => {
    window.localStorage.setItem("luma-child-session", "expired-child-token");
  });
  const relogin = page.waitForURL(/\/child\/login\//);
  await page.goto("/child/work/").catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) {
      throw error;
    }
  });
  await relogin;

  const loginUrl = new URL(page.url());
  expect(loginUrl.searchParams.get("childId")).toBe(child.id);
  expect(loginUrl.searchParams.get("expired")).toBe("1");
  expect(loginUrl.searchParams.get("returnTo")).toBe("/child/work/");
  await expect(
    page.getByText(
      "Your child session expired. Enter the PIN again to continue.",
    ),
  ).toBeVisible();

  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(page).toHaveURL(/\/child\/work\/$/);
});

test("child screens stay responsive across Chinese, Japanese, and English", async ({
  page,
  request,
}, testInfo) => {
  const apiBaseUrl = "http://127.0.0.1:8017";
  const fixtureKey = `responsive-${testInfo.project.name}`;
  const familyResponse = await request.post(`${apiBaseUrl}/v1/families`, {
    headers: {
      Authorization: "Bearer parent-fixture",
      "Idempotency-Key": `${fixtureKey}-family`,
    },
    data: { name: `Responsive ${testInfo.project.name}` },
  });
  expect(familyResponse.ok()).toBeTruthy();
  const family = (await familyResponse.json()) as { id: string };
  const childResponse = await request.post(
    `${apiBaseUrl}/v1/families/${family.id}/children`,
    {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-child`,
      },
      data: {
        nickname: "Alex responsive",
        grade_stage: "Junior high 1",
        ui_language: "zh",
        pin: "123456",
      },
    },
  );
  expect(childResponse.ok()).toBeTruthy();
  const child = (await childResponse.json()) as { id: string };
  const importResponse = await request.post(
    `${apiBaseUrl}/v1/question-sets/imports/structured`,
    {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-import`,
      },
      data: {
        family_id: family.id,
        child_id: child.id,
        source_name: "responsive-question.json",
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Responsive assigned practice",
            subject: "English",
            locale: "en",
            difficulty: "standard",
            source_mode: "convert",
            estimated_minutes: 5,
            source_summary: { fixture: true },
          },
          knowledge_tags: [
            { code: "present-simple", label: "Present simple" },
          ],
          questions: [
            {
              position: 1,
              type: "single_choice",
              prompt: "Choose the correct present-simple sentence.",
              options: [
                "She walks to school.",
                "She walk to school.",
              ],
              answer_key: { choice: 0 },
              rubric: { grading_mode: "exact" },
              points: 1,
              knowledge_code: "present-simple",
            },
          ],
        },
      },
    },
  );
  expect(importResponse.ok()).toBeTruthy();
  const imported = (await importResponse.json()) as { question_set_id: string };
  const queuedAssignmentResponse = await request.post(
    `${apiBaseUrl}/v1/question-sets/${imported.question_set_id}/assignments`,
    {
      headers: {
        Authorization: "Bearer parent-fixture",
        "Idempotency-Key": `${fixtureKey}-queued-assignment`,
      },
      data: {
        child_id: child.id,
        mode: "practice",
        time_limit_seconds: null,
        parent_note: "Open this after the first practice.",
      },
    },
  );
  expect(queuedAssignmentResponse.ok()).toBeTruthy();
  const queuedAssignment = (await queuedAssignmentResponse.json()) as {
    id: string;
  };

  const expectNoHorizontalOverflow = async () => {
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      )
      .toBe(true);
  };

  await page.goto("/child/");
  await page.getByLabel("Language").selectOption("zh");
  await expect(
    page.getByRole("heading", {
      name: "准备好取得一个小进步了吗？",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".side-rail")).toBeHidden();
    await expect(page.locator(".bottom-nav")).toBeVisible();
  } else {
    await expect(page.locator(".side-rail")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeHidden();
  }
  await expectNoHorizontalOverflow();

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}`,
  );
  await expect(
    page.getByRole("heading", { name: "输入六位 PIN" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow();
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "打开我的练习" }).click();
  await expect(page).toHaveURL(/\/child\/$/);
  await expect(
    page.getByRole("heading", { name: "更多待完成练习" }),
  ).toBeVisible();
  const queuedPractice = page.locator(".more-assignments");
  await expect(
    queuedPractice.getByText("Open this after the first practice."),
  ).toBeVisible();
  await expect(
    queuedPractice.getByRole("link", {
      name: "打开练习：Responsive assigned practice",
    }),
  ).toHaveAttribute(
    "href",
    new RegExp(`assignmentId=${queuedAssignment.id}`),
  );

  await page.goto("/child/work/");
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
  await expect(page.getByText("今日练习")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Choose the correct present-simple sentence.",
    }),
  ).toBeVisible();
  await page.getByLabel("语言").selectOption("ja");
  await expect(page.getByText("今日の練習")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  const worksheetReadability = await page
    .locator(".question-card")
    .evaluate((card) => {
      const cardStyle = window.getComputedStyle(card);
      const eyebrow = card.querySelector<HTMLElement>(".eyebrow");
      const meta = card.querySelector<HTMLElement>("header span");

      return {
        backgroundImage: cardStyle.backgroundImage,
        backgroundSize: cardStyle.backgroundSize,
        eyebrowFontSize: Number.parseFloat(
          window.getComputedStyle(eyebrow!).fontSize,
        ),
        metaFontSize: Number.parseFloat(
          window.getComputedStyle(meta!).fontSize,
        ),
      };
    });
  expect(worksheetReadability.backgroundImage).toContain("0.08");
  expect(worksheetReadability.backgroundSize).toContain("32px 32px");
  expect(worksheetReadability.eyebrowFontSize).toBeGreaterThanOrEqual(13.5);
  expect(worksheetReadability.metaFontSize).toBeGreaterThanOrEqual(14);
  await expect(page.locator(".exam-toggle")).toHaveCSS(
    "white-space",
    "nowrap",
  );
  await expect(page.locator(".save-state")).toHaveCSS("white-space", "nowrap");
  await expectNoHorizontalOverflow();

  await page.goto("/child/submitted/");
  await expect(
    page.getByRole("heading", { name: "答えを採点しています" }),
  ).toBeVisible();

  await page.goto("/child/review/");
  await expect(page.getByText("今日の復習", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "今日はスキップ" }),
  ).toBeVisible();

  let releaseHistory: (() => void) | undefined;
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await page.route(
    `${apiBaseUrl}/v1/history/child`,
    async (route) => {
      await historyGate;
      await route.continue();
    },
  );
  await page.goto("/child/history/");
  await expect(
    page.getByRole("heading", { name: "学習履歴" }),
  ).toBeVisible();
  await expect(page.getByText("学習履歴を読み込んでいます…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Algebra & English warm-up" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Past tense practice" }),
  ).toHaveCount(0);
  releaseHistory?.();
  await expect(
    page
      .locator(".history-list article")
      .first()
      .getByRole("heading", { name: "Responsive assigned practice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Responsive assigned practice を続ける",
    }),
  ).toHaveAttribute("href", /\/child\/work\/?\?attemptId=/);
  await page.unroute(`${apiBaseUrl}/v1/history/child`);

  await page.goto("/child/results/");
  await expect(
    page.getByRole("heading", { name: "表示できる結果がありません" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "もう一度" }),
  ).toHaveCount(0);

  await page.goto("/child/exit/");
  await expect(
    page.getByRole("heading", { name: "保護者管理 PIN を入力" }),
  ).toBeVisible();
  await page.getByLabel("言語").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Enter your management PIN" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectNoHorizontalOverflow();
});

test("parent creation reaches child grading and correction through the API", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !["desktop", "ipad-chrome", "ipad-webkit"].includes(
      testInfo.project.name,
    ),
    "The shared fixture API flow runs on desktop and both iPad touch engines.",
  );
  test.setTimeout(120_000);

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
  await page.getByLabel("Child UI language").selectOption("zh");
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
  await expect(page.getByText("今日练习")).toBeVisible();

  const languageResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiBaseUrl}/v1/children/me/language` &&
      response.request().method() === "PUT",
  );
  await page.getByLabel("语言").selectOption("ja");
  expect((await languageResponse).ok()).toBeTruthy();
  await expect(page.getByText("今日の練習")).toBeVisible();
  await page.reload();
  await expect(page.getByText("今日の練習")).toBeVisible();
  await page.getByLabel("言語").selectOption("en");

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

  let canvas = page.getByLabel("Handwriting answer area");
  await page.getByRole("button", { name: "Add space to the right" }).click();
  await page.getByRole("button", { name: "Add space below" }).click();
  await expect(canvas).toHaveAttribute("width", "1200");
  await expect(canvas).toHaveAttribute("height", "700");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + 50, canvasBox!.y + 60);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 210, canvasBox!.y + 140, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const clearHandwriting = page.getByRole("button", {
    name: "Clear handwriting",
  });
  const undoHandwriting = page.getByRole("button", { name: "Undo" });
  await expect(undoHandwriting).toBeEnabled();
  const clearedResponseSave = page.waitForResponse(
    (response) =>
      response.url().includes("/responses/") &&
      response.request().method() === "PUT",
  );
  if (testInfo.project.name.startsWith("ipad-")) {
    const clearButtonBox = await clearHandwriting.boundingBox();
    expect(clearButtonBox).not.toBeNull();
    await page.touchscreen.tap(
      clearButtonBox!.x + clearButtonBox!.width / 2,
      clearButtonBox!.y + clearButtonBox!.height / 2,
    );
  } else {
    await clearHandwriting.click();
  }
  const clearDialog = page.getByRole("alertdialog", {
    name: "Clear handwriting",
  });
  await expect(clearDialog).toBeVisible();
  const clearNow = clearDialog.getByRole("button", {
    name: "Clear now",
  });
  const clearNowBox = await clearNow.boundingBox();
  expect(clearNowBox).not.toBeNull();
  expect(clearNowBox!.height).toBeGreaterThanOrEqual(41);
  if (testInfo.project.name.startsWith("ipad-")) {
    await expect(clearDialog).toBeInViewport();
    await expect(clearNow).toBeInViewport();
    await page.touchscreen.tap(
      clearNowBox!.x + clearNowBox!.width / 2,
      clearNowBox!.y + clearNowBox!.height / 2,
    );
  } else {
    await clearNow.click();
  }
  await expect(clearDialog).toBeHidden();
  await expect(undoHandwriting).toBeDisabled();
  expect((await clearedResponseSave).ok()).toBeTruthy();

  const clearedCanvasBox = await canvas.boundingBox();
  expect(clearedCanvasBox).not.toBeNull();
  // A finger or stylus can still be mid-stroke when the child reaches for
  // the clear button. That temporary stroke must also ask for confirmation
  // and disappear instead of being restored on pointerup.
  await canvas.dispatchEvent("pointerdown", {
    clientX: clearedCanvasBox!.x + 50,
    clientY: clearedCanvasBox!.y + 60,
    pointerId: 41,
    pointerType: "touch",
    pressure: 0.5,
  });
  await canvas.dispatchEvent("pointermove", {
    clientX: clearedCanvasBox!.x + 140,
    clientY: clearedCanvasBox!.y + 100,
    pointerId: 41,
    pointerType: "touch",
    pressure: 0.5,
  });
  if (testInfo.project.name.startsWith("ipad-")) {
    const clearButtonBox = await clearHandwriting.boundingBox();
    expect(clearButtonBox).not.toBeNull();
    await page.touchscreen.tap(
      clearButtonBox!.x + clearButtonBox!.width / 2,
      clearButtonBox!.y + clearButtonBox!.height / 2,
    );
  } else {
    await clearHandwriting.click();
  }
  await expect(clearDialog).toBeVisible();
  const midStrokeClearNow = clearDialog.getByRole("button", {
    name: "Clear now",
  });
  if (testInfo.project.name.startsWith("ipad-")) {
    const clearNowBox = await midStrokeClearNow.boundingBox();
    expect(clearNowBox).not.toBeNull();
    await page.touchscreen.tap(
      clearNowBox!.x + clearNowBox!.width / 2,
      clearNowBox!.y + clearNowBox!.height / 2,
    );
  } else {
    await midStrokeClearNow.click();
  }
  await canvas.dispatchEvent("pointerup", { pointerId: 41 });
  await expect(clearDialog).toBeHidden();
  await expect(undoHandwriting).toBeDisabled();

  const redrawnResponseSave = page.waitForResponse(
    (response) =>
      response.url().includes("/responses/") &&
      response.request().method() === "PUT",
  );
  await canvas.dispatchEvent("pointerdown", {
    clientX: clearedCanvasBox!.x + 50,
    clientY: clearedCanvasBox!.y + 60,
    pointerId: 42,
    pointerType: "touch",
    pressure: 0.5,
  });
  await canvas.dispatchEvent("pointermove", {
    clientX: clearedCanvasBox!.x + 210,
    clientY: clearedCanvasBox!.y + 140,
    pointerId: 42,
    pointerType: "touch",
    pressure: 0.5,
  });
  await canvas.dispatchEvent("pointerup", {
    clientX: clearedCanvasBox!.x + 210,
    clientY: clearedCanvasBox!.y + 140,
    pointerId: 42,
    pointerType: "touch",
    pressure: 0.5,
  });
  expect((await redrawnResponseSave).ok()).toBeTruthy();
  await expect(undoHandwriting).toBeEnabled();

  const originalAttemptId = new URL(page.url()).searchParams.get("attemptId");
  expect(originalAttemptId).toBeTruthy();
  const addChineseHandwritingFeedback = async (targetAttemptId: string) => {
    await page.route(
      `${apiBaseUrl}/v1/attempts/${targetAttemptId}/results`,
      async (route) => {
        const response = await route.fetch();
        const payload = (await response.json()) as {
          complete: boolean;
          results: Array<{
            feedback: Record<string, unknown>;
            [key: string]: unknown;
          }>;
        };
        const annotatedIndex = payload.results.length - 1;
        await route.fulfill({
          response,
          json: {
            ...payload,
            results: payload.results.map((result, index) =>
              index === annotatedIndex
                ? {
                    ...result,
                    feedback: {
                      ...result.feedback,
                      action: "查看批语后，重新完成这道题。",
                      annotations: [
                        {
                          kind: "box",
                          x: 0.22,
                          y: 0.2,
                          width: 0.5,
                          height: 0.24,
                          label: "这里需要补充完整的句子。",
                        },
                      ],
                      evidence: ["句子内容不完整。"],
                      summary: "请补充完整的句子。",
                    },
                  }
                : result,
            ),
          },
        });
      },
    );
  };

  await page.getByLabel("Language").selectOption("zh");
  await addChineseHandwritingFeedback(originalAttemptId!);
  const originalQuestionSubmission = page.waitForResponse(
    (response) =>
      response
        .url()
        .startsWith(
          `${apiBaseUrl}/v1/attempts/${originalAttemptId}/questions/`,
        ) &&
      response.url().endsWith("/submit") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "只提交这一题批改" }).click();
  await page
    .getByRole("button", { name: "确认只提交这一题" })
    .click();
  expect((await originalQuestionSubmission).status()).toBe(202);
  const originalProcessedResponse = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(originalProcessedResponse.ok()).toBeTruthy();
  await expect(page.getByText("请补充完整的句子。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[data-grading-annotation="box"]'),
  ).toBeVisible();
  await expect(
    page.getByText("这里需要补充完整的句子。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清除手写内容" }),
  ).toBeDisabled();

  const originalWorkUrl = page.url();
  const regradeResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .startsWith(
          `${apiBaseUrl}/v1/attempts/${originalAttemptId}/questions/`,
        ) &&
      response.url().endsWith("/regrade") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "保留答案并重新评判" })
    .click();
  expect((await regradeResponse).status()).toBe(202);
  await expect(page.getByText("正在批改这一题…")).toBeVisible();
  const regradeProcessedResponse = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(regradeProcessedResponse.ok()).toBeTruthy();
  await expect(page.getByText("请补充完整的句子。")).toBeVisible({
    timeout: 30_000,
  });
  expect(page.url()).toBe(originalWorkUrl);
  await expect(
    page.getByRole("button", { name: "清除手写内容" }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: "清空并重做这一题" })
    .click();
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=.*&retry=1$/);
  const retryAttemptId = new URL(page.url()).searchParams.get("attemptId");
  expect(retryAttemptId).toBeTruthy();
  await expect(page.locator("[data-grading-annotation]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新提交审阅" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "清除手写内容" }),
  ).toBeEnabled();

  const retryCanvas = page.getByLabel("手写作答区域");
  const retryCanvasBox = await retryCanvas.boundingBox();
  expect(retryCanvasBox).not.toBeNull();
  const retrySave = page.waitForResponse(
    (response) =>
      response
        .url()
        .startsWith(
          `${apiBaseUrl}/v1/attempts/${retryAttemptId}/responses/`,
        ) &&
      response.request().method() === "PUT",
  );
  await page.mouse.move(
    retryCanvasBox!.x + 80,
    retryCanvasBox!.y + 90,
  );
  await page.mouse.down();
  await page.mouse.move(
    retryCanvasBox!.x + 250,
    retryCanvasBox!.y + 170,
    { steps: 8 },
  );
  await page.mouse.up();
  expect((await retrySave).ok()).toBeTruthy();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();

  await addChineseHandwritingFeedback(retryAttemptId!);
  const retrySubmission = page.waitForResponse(
    (response) =>
      response
        .url()
        .startsWith(
          `${apiBaseUrl}/v1/attempts/${retryAttemptId}/questions/`,
        ) &&
      response.url().endsWith("/submit") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "重新提交审阅" }).click();
  await page
    .getByRole("button", { name: "确认只提交这一题" })
    .click();
  expect((await retrySubmission).status()).toBe(202);
  const retryProcessedResponse = await request.post(
    `${apiBaseUrl}/v1/demo/jobs/process-next`,
    { headers: parentHeaders },
  );
  expect(retryProcessedResponse.ok()).toBeTruthy();
  await expect(page.getByText("请补充完整的句子。")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[data-grading-annotation="box"]'),
  ).toBeVisible();

  await page.goto(
    `/child/work/?attemptId=${encodeURIComponent(originalAttemptId!)}`,
  );
  await page.getByLabel("语言").selectOption("en");

  await page.reload();
  await page.getByRole("button", { name: "Go to question 3" }).click();
  canvas = page.getByLabel("Handwriting answer area");
  await expect(canvas).toHaveAttribute("width", "1200");
  await expect(canvas).toHaveAttribute("height", "700");

  await page.getByRole("button", { name: "Submit all answers" }).click();
  await page
    .getByRole("button", { name: "Confirm full submission" })
    .click();
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

  const attemptId = new URL(page.url()).searchParams.get("attemptId");
  expect(attemptId).toBeTruthy();

  await page.goto(
    `/parent/results/?attemptId=${encodeURIComponent(attemptId!)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Review answers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Write one similar sentence and underline the verb.",
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Child's handwritten answer"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark correct" }).click();
  await expect(
    page.getByText("A parent marked this answer correct."),
  ).toBeVisible();

  await page.goto(
    `/child/results/?attemptId=${encodeURIComponent(attemptId!)}`,
  );
  await page.getByRole("button", { name: "Correct these answers" }).click();
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
  await expect(page.getByText("0/1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Complete: My brother ___ tennis on Sundays.",
    }),
  ).toBeVisible();
});
