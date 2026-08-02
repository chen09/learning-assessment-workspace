import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildHistoryPage from "./page";

const mocks = vi.hoisted(() => ({
  getChildHistory: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getChildAccessToken: vi.fn(() => "child-token"),
    getChildHistory: mocks.getChildHistory,
  };
});

describe("ChildHistoryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "zh");
    mocks.getChildHistory.mockReset();
    mocks.getChildHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: "attempt-1",
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "Lesson 2 同レベル変形練習（インタラクティブ版）",
        status: "completed",
        submitted_at: "2026-07-30T05:00:00Z",
        awarded_points: 82,
        available_points: 100,
        correction_count: 2,
      },
    ]);
  });

  it("localizes history metadata while preserving worksheet titles", async () => {
    render(<ChildHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "学习记录" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("已完成的练习、分数和订正记录。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Lesson 2 同レベル変形練習（インタラクティブ版）",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 道待订正")).toBeInTheDocument();
    expect(screen.getByText("82 / 100")).toBeInTheDocument();
    expect(screen.queryByText("Your work")).not.toBeInTheDocument();
  });

  it("does not render example records while history is loading", () => {
    mocks.getChildHistory.mockReturnValue(new Promise(() => undefined));

    render(<ChildHistoryPage />);

    expect(screen.getByText("正在加载学习记录…")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Algebra & English warm-up",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Past tense practice" }),
    ).not.toBeInTheDocument();
  });

  it("lets a child resume an unfinished attempt instead of opening results", async () => {
    mocks.getChildHistory.mockResolvedValue([
      {
        assignment_id: "assignment-in-progress",
        attempt_id: "attempt-in-progress",
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "代数订正练习",
        status: "in_progress",
        submitted_at: null,
        awarded_points: 0,
        available_points: 20,
        correction_count: 0,
      },
    ]);

    render(<ChildHistoryPage />);

    expect(
      await screen.findByRole("link", { name: "继续 代数订正练习" }),
    ).toHaveAttribute(
      "href",
      "/child/work?attemptId=attempt-in-progress",
    );
    expect(screen.queryByText("0 / 20")).not.toBeInTheDocument();
  });

  it("refreshes history when a child returns to the open page", async () => {
    mocks.getChildHistory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          assignment_id: "assignment-new",
          attempt_id: null,
          child_id: "child-1",
          child_nickname: "肉肉",
          title: "刚安排的练习",
          status: "assigned",
          submitted_at: null,
          awarded_points: 0,
          available_points: 20,
          correction_count: 0,
        },
      ]);

    render(<ChildHistoryPage />);

    expect(await screen.findByText("目前还没有学习记录。"))
      .toBeInTheDocument();

    fireEvent.focus(window);

    await waitFor(() => {
      expect(mocks.getChildHistory).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByRole("heading", { name: "刚安排的练习" }),
    ).toBeInTheDocument();
  });
});
