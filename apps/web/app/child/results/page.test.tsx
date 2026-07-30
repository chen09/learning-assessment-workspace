import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildResultsPage from "./page";

const mocks = vi.hoisted(() => ({
  getAttemptResults: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getActiveChildProfile: vi.fn(() => ({
      child_id: "child-1",
      family_id: "family-1",
      nickname: "肉肉",
      ui_language: "zh",
    })),
    getAttemptResults: mocks.getAttemptResults,
    getChildAccessToken: vi.fn(() => "child-token"),
  };
});

describe("ChildResultsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "en");
    window.history.replaceState({}, "", "/child/results/");
    mocks.getAttemptResults.mockReset();
    mocks.getAttemptResults.mockReturnValue(
      new Promise<never>(() => undefined),
    );
  });

  it("does not expose the correction action before hydration", () => {
    const markup = renderToStaticMarkup(<ChildResultsPage />);

    expect(markup).not.toContain("Correct these answers");
    expect(markup).not.toContain("Try again");
    expect(markup).not.toContain("Waiting for a parent");
  });

  it("keeps a hosted attempt in checking state until its results load", async () => {
    window.history.replaceState(
      {},
      "",
      "/child/results/?attemptId=hosted-attempt",
    );

    render(<ChildResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "Almost ready" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Correct these answers" }),
    ).not.toBeInTheDocument();
  });

  it("shows result and correction states in Chinese", async () => {
    window.localStorage.setItem("luma-language:demo-child", "zh");
    window.history.replaceState(
      {},
      "",
      "/child/results/?attemptId=hosted-attempt",
    );
    mocks.getAttemptResults.mockResolvedValue({
      complete: true,
      results: [
        {
          id: "result-correct",
          question_id: "question-1",
          outcome: "correct",
          awarded_points: 1,
          confidence: 1,
          feedback: { summary: "Correct." },
        },
        {
          id: "result-incorrect",
          question_id: "question-2",
          outcome: "incorrect",
          awarded_points: 0,
          confidence: 1,
          feedback: { summary: "Try again." },
        },
        {
          id: "result-uncertain",
          question_id: "question-3",
          outcome: "uncertain",
          awarded_points: null,
          confidence: 0.4,
          feedback: { summary: "Parent review." },
        },
      ],
    });

    render(<ChildResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "做得好，肉肉" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "再试一次" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "等待家长确认" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "订正这些题" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Good work, Alex")).not.toBeInTheDocument();
  });

  it("does not show synthetic results when no attempt was requested", async () => {
    window.localStorage.setItem("luma-language:demo-child", "zh");

    render(<ChildResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "没有可显示的结果" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("再试一次")).not.toBeInTheDocument();
    expect(screen.queryByText("等待家长确认")).not.toBeInTheDocument();
  });
});
