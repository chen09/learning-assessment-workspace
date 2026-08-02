import { expect, test } from "@playwright/test";

test("browser navigation never shows a previous attempt's result while the next one loads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "A single desktop browser regression covers URL result switching.",
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("luma-language:demo-child", "en");
    window.localStorage.setItem("luma-child-session", "child-token");
    window.localStorage.setItem(
      "luma-child-profile",
      JSON.stringify({
        child_id: "child-1",
        family_id: "family-1",
        nickname: "Result child",
        ui_language: "en",
      }),
    );
  });

  await page.route("**/v1/attempts/first-attempt/results", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        complete: true,
        results: [
          {
            id: "first-result",
            question_id: "question-1",
            outcome: "correct",
            awarded_points: 1,
            confidence: 1,
            feedback: { summary: "First attempt feedback." },
          },
        ],
      }),
    });
  });

  let releaseSecondResult: (() => void) | undefined;
  const secondResultGate = new Promise<void>((resolve) => {
    releaseSecondResult = resolve;
  });
  await page.route("**/v1/attempts/second-attempt/results", async (route) => {
    await secondResultGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ complete: false, results: [] }),
    });
  });

  await page.goto("/child/results/?attemptId=first-attempt");
  await expect(page.getByText("First attempt feedback.")).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState({}, "", "/child/results/?attemptId=second-attempt");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await expect(page.getByRole("heading", { name: "Almost ready" })).toBeVisible();
  await expect(page.getByText("First attempt feedback.")).toHaveCount(0);

  releaseSecondResult?.();
});
