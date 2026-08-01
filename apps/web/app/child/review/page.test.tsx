import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildReviewPage from "./page";

const { completeReview, skipTodayReviews } = vi.hoisted(() => ({
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
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    completeReview,
    skipTodayReviews,
    getChildAccessToken: vi.fn(() => "child-token"),
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
  };
});

describe("ChildReviewPage", () => {
  beforeEach(() => {
    completeReview.mockClear();
    skipTodayReviews.mockClear();
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

  it("postpones every visible review for today without changing its interval", async () => {
    render(<ChildReviewPage />);

    await screen.findByText("What is 7 × 8?");
    fireEvent.click(screen.getByRole("button", { name: "今日はスキップ" }));

    expect(await screen.findByText(/次の復習/)).toBeInTheDocument();
    expect(skipTodayReviews).toHaveBeenCalledWith("child-token");
  });
});
