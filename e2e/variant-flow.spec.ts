import { expect, test } from "@playwright/test";

test("a confirmed question set starts a separate parent-reviewed variant", async ({
  page,
}) => {
  await page.route("**/v1/question-sets/confirmed-variant", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        question_set: {
          id: "confirmed-variant",
          title: "Lesson 2 grammar practice",
          subject: "English",
          status: "confirmed",
          source_summary: {},
        },
        questions: [
          {
            id: "question-1",
            position: 1,
            type: "typed_text",
            prompt: "Complete: She ___ to school.",
            options: null,
            answer_key: { text: "goes" },
            points: 1,
            listening: null,
          },
        ],
      }),
    });
  });

  await page.goto("/parent/create/?variantOfQuestionSetId=confirmed-variant");

  await expect(
    page.getByRole("heading", { name: "Create a new variant" }),
  ).toBeVisible();
  await expect(
    page.getByText("Lesson 2 grammar practice stays unchanged."),
  ).toBeVisible();
  await expect(page.getByLabel("Target difficulty")).toHaveValue("standard");
  await expect(
    page.getByRole("button", { name: "Import variant JSON" }),
  ).toBeVisible();
});
