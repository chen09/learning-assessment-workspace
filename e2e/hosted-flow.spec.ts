import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const nonPersonalAnswerPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type HostedCleanupState = {
  familyId: string | null;
  supabaseAdmin: ReturnType<typeof createClient>;
  uploadedResponsePaths: string[];
  userId: string | null;
};

let hostedCleanupState: HostedCleanupState | null = null;

async function cleanupHostedState(state: HostedCleanupState) {
  if (state.uploadedResponsePaths.length > 0) {
    const paths = [...state.uploadedResponsePaths];
    const { error } = await state.supabaseAdmin.storage
      .from("responses")
      .remove(paths);
    expect.soft(error, "temporary response photo cleanup").toBeNull();
    if (!error) {
      state.uploadedResponsePaths.length = 0;
    }
  }

  if (state.familyId) {
    const { error } = await state.supabaseAdmin
      .from("families")
      .delete()
      .eq("id", state.familyId);
    expect.soft(error, "temporary family cleanup").toBeNull();
    if (!error) {
      state.familyId = null;
    }
  }

  if (state.userId) {
    const { error } = await state.supabaseAdmin.auth.admin.deleteUser(
      state.userId,
    );
    expect.soft(error, "temporary user cleanup").toBeNull();
    if (!error) {
      state.userId = null;
    }
  }
}

test.afterEach(async ({}, testInfo) => {
  if (!hostedCleanupState) {
    return;
  }

  testInfo.setTimeout(30_000);
  const state = hostedCleanupState;
  hostedCleanupState = null;
  await cleanupHostedState(state);
});

test("temporary parent completes the hosted family learning flow", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);

  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const apiBaseUrl =
    process.env.HOSTED_API_URL ?? "https://api.study.hypnochunk.com";
  const runId = randomUUID();
  const email = `hosted-smoke-${runId}@example.test`;
  const password = `Hosted-${runId}-9a`;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userId: string | null = null;
  let familyId: string | null = null;
  const uploadedResponsePaths: string[] = [];
  hostedCleanupState = {
    familyId,
    supabaseAdmin,
    uploadedResponsePaths,
    userId,
  };

  try {
    await page.goto("/parent/?code=legacy-code-fixture");
    await expect(page).toHaveURL(/\/login\/$/);
    await expect(
      page.getByRole("heading", {
        name: "Welcome to your family workspace",
      }),
    ).toBeVisible();

    const healthResponse = await request.get(`${apiBaseUrl}/healthz`);
    expect(healthResponse.ok()).toBeTruthy();

    const userResponse = await request.post(
      `${supabaseUrl}/auth/v1/admin/users`,
      {
        data: {
          email,
          email_confirm: true,
          password,
          user_metadata: { display_name: "Hosted smoke parent" },
        },
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    expect(userResponse.ok()).toBeTruthy();
    userId = ((await userResponse.json()) as { id: string }).id;
    hostedCleanupState.userId = userId;

    await page.goto("/login/");
    await page
      .getByRole("button", { name: "Password", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/parent\/family\/$/);

    await page.goto("/parent/?code=legacy-code-fixture");
    await expect(page).toHaveURL(/\/parent\/$/);
    await expect(
      page.getByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).toBeVisible();

    await page.goto("/parent/family/");
    const familyResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiBaseUrl}/v1/families` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("textbox", { name: "New family name" })
      .fill("Hosted smoke family");
    await page.getByRole("button", { name: "Add family" }).click();
    familyId = (
      (await (await familyResponse).json()) as { id: string }
    ).id;
    hostedCleanupState.familyId = familyId;

    const failedFamilyName = "Must not appear in client logs";
    await page.route(`${apiBaseUrl}/v1/families`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON().name === failedFamilyName
      ) {
        await route.continue({
          postData: JSON.stringify({ name: "" }),
        });
        return;
      }
      await route.continue();
    });
    const clientLogResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiBaseUrl}/v1/client-logs` &&
        response.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page
      .getByRole("textbox", { name: "New family name" })
      .fill(failedFamilyName);
    await page.getByRole("button", { name: "Add family" }).click();
    const loggedFailure = await clientLogResponse;
    expect(loggedFailure.status()).toBe(202);
    const clientLog = loggedFailure.request().postDataJSON() as {
      page: string;
      request_path: string;
      status_code: number;
    };
    expect(clientLog).toMatchObject({
      page: "/parent/family/",
      request_path: "/v1/families",
      status_code: 422,
    });
    expect(JSON.stringify(clientLog)).not.toContain(failedFamilyName);
    await page.unroute(`${apiBaseUrl}/v1/families`);

    const managementPinResponse = page.waitForResponse(
      (response) =>
        response.url() ===
          `${apiBaseUrl}/v1/families/${familyId}/management-pin` &&
        response.request().method() === "PUT",
      { timeout: 10_000 },
    );
    const managementUnlockResponse = page.waitForResponse(
      (response) =>
        response.url() ===
          `${apiBaseUrl}/v1/families/${familyId}/management-unlock` &&
        response.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page
      .getByRole("textbox", { name: "Parent management PIN" })
      .fill("000000");
    await page.getByRole("button", { name: "Set management PIN" }).click();
    expect((await managementPinResponse).status()).toBe(204);
    expect((await managementUnlockResponse).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Management unlocked" }),
    ).toBeVisible();

    const childResponse = page.waitForResponse(
      (response) =>
        response.url() ===
          `${apiBaseUrl}/v1/families/${familyId}/children` &&
        response.request().method() === "POST",
    );
    await page.getByRole("textbox", { name: "Child name" }).fill("Alex smoke");
    await page
      .getByRole("textbox", { name: "Grade" })
      .fill("Junior high 1");
    await page.getByRole("textbox", { name: "Six-digit PIN" }).fill("123456");
    await page.getByLabel("Child UI language").selectOption("zh");
    await page.getByRole("button", { name: "Add child" }).click();
    const childId = (
      (await (await childResponse).json()) as { id: string }
    ).id;

    await page.goto(
      `/parent/create/?familyId=${encodeURIComponent(familyId)}&childId=${encodeURIComponent(childId)}`,
    );
    const importResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiBaseUrl}/v1/question-sets/imports` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create review draft" }).click();
    const questionSetId = (
      (await (await importResponse).json()) as { question_set_id: string }
    ).question_set_id;
    await expect(
      page.getByRole("heading", { name: "Review before assigning" }),
    ).toBeVisible({ timeout: 30_000 });
    const { error: photoQuestionError } = await supabaseAdmin
      .from("questions")
      .insert({
        family_id: familyId,
        question_set_id: questionSetId,
        position: 4,
        type: "photo",
        prompt: {
          en: "Solve 3(x − 2) = 12 on paper, then photograph your work.",
        },
        answer_key: { reference: "x = 6" },
        rubric: { en: "Show the equation steps and final value." },
        points: 2,
      });
    expect(photoQuestionError).toBeNull();

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
    const startAssignmentResponse = page.waitForResponse(
      (response) =>
        response.url() ===
          `${apiBaseUrl}/v1/assignments/${assignmentId}/start` &&
        response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "Open my work" }).click();
    expect((await startAssignmentResponse).ok()).toBeTruthy();
    await expect(page.getByText("0/4", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("今日练习")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");

    const childLanguageResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiBaseUrl}/v1/children/me/language` &&
        response.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await page.getByLabel("语言").selectOption("en");
    expect((await childLanguageResponse).ok()).toBeTruthy();
    await expect(page.getByText("Today's practice")).toBeVisible();

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
    await page.getByRole("button", { name: "Next question" }).click();

    const uploadIntentResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiBaseUrl}/v1/uploads/child-intents` &&
        response.request().method() === "POST",
    );
    const storageUploadResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/storage/v1/object/upload/sign/responses/") &&
        response.request().method() === "PUT",
    );
    const photoSaveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/attempts/") &&
        response.url().includes("/responses/") &&
        response.request().method() === "PUT" &&
        (response.request().postDataJSON() as { kind?: string }).kind ===
          "photo",
    );
    await page
      .getByLabel("Take a photo or choose images")
      .setInputFiles({
        name: "non-personal-answer.png",
        mimeType: "image/png",
        buffer: nonPersonalAnswerPng,
      });
    const uploadIntent = (await (await uploadIntentResponse).json()) as {
      path: string;
    };
    uploadedResponsePaths.push(uploadIntent.path);
    expect((await storageUploadResponse).ok()).toBeTruthy();
    expect((await photoSaveResponse).ok()).toBeTruthy();
    await expect(
      page
        .getByRole("list", { name: "Uploaded answer images" })
        .getByRole("listitem"),
    ).toHaveText(["1. non-personal-answer.png"]);

    const { data: storedPhoto, error: storedPhotoError } =
      await supabaseAdmin.storage
        .from("responses")
        .download(uploadIntent.path);
    expect(storedPhotoError).toBeNull();
    expect(storedPhoto?.size).toBeGreaterThan(0);
    const anonymousPhotoResponse = await request.get(
      `${supabaseUrl}/storage/v1/object/responses/${uploadIntent.path}`,
    );
    expect(anonymousPhotoResponse.ok()).toBeFalsy();

    await page.getByRole("button", { name: "Submit all answers" }).click();
    await expect(
      page.getByRole("heading", { name: "Your work is being checked" }),
    ).toBeVisible();

    const completedResults = page.waitForResponse(
      async (response) => {
        if (
          response.request().method() !== "GET" ||
          !/\/v1\/attempts\/[^/]+\/results$/.test(response.url()) ||
          response.status() !== 200
        ) {
          return false;
        }
        const payload = (await response.json()) as { complete?: boolean };
        return payload.complete === true;
      },
      { timeout: 45_000 },
    );
    await page.getByRole("button", { name: "View results" }).click();
    await completedResults;
    await expect(page).toHaveURL(/\/child\/results\/\?attemptId=/);
    await expect(page.getByText("Try once more")).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText("Waiting for a parent")).toHaveCount(2);

    const attemptId = new URL(page.url()).searchParams.get("attemptId");
    expect(attemptId).toBeTruthy();
    await page.goto(
      `/parent/results/?attemptId=${encodeURIComponent(attemptId!)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Review answers" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Child's handwritten answer"),
    ).toBeVisible();
    const photoPreview = page.getByRole("img", {
      name: "Uploaded answer photos 1",
    });
    await expect(photoPreview).toBeVisible();
    await expect
      .poll(
        () =>
          photoPreview.evaluate(
            (image) => (image as HTMLImageElement).naturalWidth,
          ),
        { message: "The private signed photo preview should load." },
      )
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Mark correct" }).first().click();
    await page.getByRole("button", { name: "Mark correct" }).first().click();
    await expect(
      page.getByText("A parent marked this answer correct."),
    ).toHaveCount(2);

    await page.goto(
      `/child/results/?attemptId=${encodeURIComponent(attemptId!)}`,
    );
    await page.getByRole("button", { name: "Correct these answers" }).click();
    await expect(page).toHaveURL(/\/child\/work\/\?attemptId=/);
    await expect(page.getByText("0/1", { exact: true })).toBeVisible();
  } finally {
    testInfo.setTimeout(testInfo.timeout + 30_000);
    if (hostedCleanupState) {
      await cleanupHostedState(hostedCleanupState);
      hostedCleanupState = null;
    }
  }
});
