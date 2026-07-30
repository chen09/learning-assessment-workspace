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

  const importResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${apiBaseUrl}/v1/question-sets/imports/structured` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm and assign" }).click();
  const assignmentId = (
    (await (await importResponse).json()) as { assignment_id: string }
  ).assignment_id;
  await expect(page.getByText("Confirmed and assigned")).toBeVisible();

  await page.goto(
    `/child/login/?childId=${encodeURIComponent(child.id)}&assignmentId=${encodeURIComponent(assignmentId)}`,
  );
  for (const digit of ["1", "2", "3", "4", "5", "6"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Open my work" }).click();
  await expect(page.getByText("0/1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is 2 + 2?" }),
  ).toBeVisible();

  await page.goto("/child/work/");
  await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
  await expect(
    page.getByRole("heading", { name: "Uploaded JSON practice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is 2 + 2?" }),
  ).toBeVisible();
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
    page.getByRole("heading", { name: "Responsive assigned practice" }),
  ).toBeVisible();
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
    testInfo.project.name !== "desktop",
    "The shared fixture API flow runs once; responsive UI is covered separately.",
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
