import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildReviewPage from "./page";

const { completeReview, getTodayReviews, skipTodayReviews } = vi.hoisted(() => ({
  completeReview: vi.fn(async () => ({
    item_id: "review-1",
    old_interval_days: 1,
    new_interval_days: 3,
    next_due_on: "2026-08-01",
  })),
  skipTodayReviews: vi.fn(async () => [
    {
      item_id: "review-1",
      old_interval_days: 1,
      new_interval_days: 1,
      next_due_on: "2026-08-02",
    },
  ]),
  getTodayReviews: vi.fn(async () => [
    {
      id: "review-1",
      source_question_id: "question-1",
      prompt: "What is 7 × 8?",
      type: "typed_text" as const,
      options: null,
      answer_mode: "text" as const,
      due_on: "2026-07-29",
      interval_days: 1,
      level: "standard" as const,
    },
  ]),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    completeReview,
    skipTodayReviews,
    getChildAccessToken: vi.fn(() => "child-token"),
    getTodayReviews,
  };
});

describe("ChildReviewPage", () => {
  beforeEach(() => {
    completeReview.mockReset();
    completeReview.mockResolvedValue({
      item_id: "review-1",
      old_interval_days: 1,
      new_interval_days: 3,
      next_due_on: "2026-08-01",
    });
    skipTodayReviews.mockReset();
    skipTodayReviews.mockResolvedValue([
      {
        item_id: "review-1",
        old_interval_days: 1,
        new_interval_days: 1,
        next_due_on: "2026-08-02",
      },
    ]);
    getTodayReviews.mockReset();
    getTodayReviews.mockResolvedValue([
      {
        id: "review-1",
        source_question_id: "question-1",
        prompt: "What is 7 × 8?",
        type: "typed_text",
        options: null,
        answer_mode: "text",
        due_on: "2026-07-29",
        interval_days: 1,
        level: "standard",
      },
    ]);
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "ja");
  });

  it("localizes the answer form and sends a real answer for server-side grading", async () => {
    render(<ChildReviewPage />);

    expect(await screen.findByText("What is 7 × 8?")).toBeInTheDocument();
    expect(screen.getByText("今日の復習")).toBeInTheDocument();
    expect(screen.getByText("標準")).toBeInTheDocument();
    expect(
      screen.queryByText("Today’s review"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "56" },
    });
    fireEvent.click(screen.getByRole("button", { name: "答えを確認" }));

    expect(await screen.findByText(/次の復習/)).toBeInTheDocument();
    expect(completeReview).toHaveBeenCalledWith(
      "review-1",
      { text: "56" },
      "child-token",
    );
    expect(
      screen.getByRole("button", { name: "今日はスキップ" }),
    ).toBeInTheDocument();
  });

  it("typesets an imported LaTeX review prompt", async () => {
    getTodayReviews.mockResolvedValue([
      {
        id: "review-formula",
        source_question_id: "question-formula",
        prompt: "Factorise \\(x^2 - 25\\).",
        type: "typed_text",
        options: null,
        answer_mode: "text",
        due_on: "2026-07-29",
        interval_days: 1,
        level: "standard",
      },
    ]);

    render(<ChildReviewPage />);

    await screen.findByText("今日の復習");
    await waitFor(() => {
      expect(document.querySelector(".draft-question-list .katex")).toBeInTheDocument();
    });
  });

  it("postpones every visible review for today without changing its interval", async () => {
    render(<ChildReviewPage />);

    await screen.findByText("What is 7 × 8?");
    fireEvent.click(screen.getByRole("button", { name: "今日はスキップ" }));

    expect(await screen.findByText(/次の復習/)).toBeInTheDocument();
    expect(skipTodayReviews).toHaveBeenCalledWith("child-token");
  });

  it("keeps a child's answer and offers a retry when saving a review fails", async () => {
    completeReview.mockRejectedValueOnce(new Error("offline"));

    render(<ChildReviewPage />);

    const answer = await screen.findByRole("textbox");
    fireEvent.change(answer, { target: { value: "56" } });
    fireEvent.click(screen.getByRole("button", { name: "答えを確認" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "復習を保存できませんでした。答えは残っています。もう一度お試しください。",
    );
    expect(answer).toHaveValue("56");
    expect(screen.getByRole("button", { name: "答えを確認" })).toBeEnabled();
  });

  it("shows a retryable error when skipping today's reviews fails", async () => {
    skipTodayReviews.mockRejectedValueOnce(new Error("offline"));

    render(<ChildReviewPage />);

    await screen.findByText("What is 7 × 8?");
    fireEvent.click(screen.getByRole("button", { name: "今日はスキップ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "今日の復習をスキップできませんでした。もう一度お試しください。",
    );
    expect(screen.getByRole("button", { name: "今日はスキップ" })).toBeEnabled();
  });

  it("does not mistake a failed review-plan load for an empty review day", async () => {
    getTodayReviews
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([
        {
          id: "review-retry",
          source_question_id: "question-retry",
          prompt: "Retry review prompt",
          type: "typed_text",
          options: null,
          answer_mode: "text",
          due_on: "2026-07-29",
          interval_days: 1,
          level: "standard",
        },
      ]);

    render(<ChildReviewPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "今日の復習を読み込めませんでした。",
    );
    expect(screen.queryByText("今日の復習はありません。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));

    expect(await screen.findByText("Retry review prompt")).toBeInTheDocument();
  });

  it("refreshes today\u2019s review when the child returns to the page", async () => {
    getTodayReviews
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "review-new",
          source_question_id: "question-new",
          prompt: "Complete: She ___ to school every day.",
          type: "typed_text",
          options: null,
          answer_mode: "text",
          due_on: "2026-07-29",
          interval_days: 1,
          level: "standard",
        },
      ]);

    render(<ChildReviewPage />);

    expect(await screen.findByText("今日の復習はありません。"))
      .toBeInTheDocument();

    fireEvent.focus(window);

    await waitFor(() => {
      expect(getTodayReviews).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByText("Complete: She ___ to school every day."),
    ).toBeInTheDocument();
  });
});
