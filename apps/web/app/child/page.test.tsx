import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildHomePage from "@/app/child/page";

const assignment = {
  id: "assignment-1",
  title: "Algebra & English warm-up",
  status: "assigned",
  mode: "practice",
  time_limit_seconds: null,
  parent_note: "先独立完成，再一起检查。",
  question_count: 3,
  latest_attempt_id: null,
};

const inProgressAssignment = {
  id: "assignment-2",
  title: "Lesson 2 sentence writing",
  status: "in_progress",
  mode: "exam",
  time_limit_seconds: 900,
  parent_note: null,
  question_count: 8,
  latest_attempt_id: "attempt-2",
};

const mocks = vi.hoisted(() => ({
  getChildAssignments: vi.fn(),
  getTodayReviews: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getActiveChildProfile: () => ({
    child_id: "child-1",
    family_id: "family-1",
    nickname: "Alex",
    ui_language: "zh",
  }),
  getChildAccessToken: () => "child-token",
  getChildAssignments: mocks.getChildAssignments,
  getTodayReviews: mocks.getTodayReviews,
  updateOwnChildLanguage: vi.fn(),
}));

describe("ChildHomePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "zh");
    mocks.getChildAssignments.mockReset();
    mocks.getChildAssignments.mockResolvedValue([assignment]);
    mocks.getTodayReviews.mockReset();
    mocks.getTodayReviews.mockResolvedValue([]);
  });

  it("localizes the complete child home while preserving assignment content", async () => {
    render(<ChildHomePage />);

    expect(
      screen.getByRole("heading", { name: "准备好取得一个小进步了吗？" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 份练习，0 道复习题。")).toBeInTheDocument();
    expect(screen.getByText("练习模式")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Algebra & English warm-up" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 道题")).toBeInTheDocument();
    expect(screen.getByText("不限时")).toBeInTheDocument();
    expect(screen.getByText("先独立完成，再一起检查。")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /打开练习/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("今日复习")).toBeInTheDocument();
    expect(
      screen.getByText("今天可以跳过。未完成的复习会自动平缓顺延。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ready for a small win?")).not.toBeInTheDocument();
  });

  it("does not show a synthetic assignment while real data is loading", () => {
    mocks.getChildAssignments.mockReturnValue(new Promise(() => {}));
    mocks.getTodayReviews.mockReturnValue(new Promise(() => {}));

    render(<ChildHomePage />);

    expect(
      screen.queryByRole("heading", { name: "Algebra & English warm-up" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("0 份练习，0 道复习题。")).not.toBeInTheDocument();
    expect(screen.getByText("正在读取今天的学习安排…")).toBeInTheDocument();
  });

  it("keeps every pending assignment reachable from the child home", async () => {
    mocks.getChildAssignments.mockResolvedValue([
      assignment,
      inProgressAssignment,
    ]);

    render(<ChildHomePage />);

    expect(await screen.findByText("2 份练习，0 道复习题。")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "更多待完成练习" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Lesson 2 sentence writing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("考试模式 · 8 道题 · 15 分钟")).toBeInTheDocument();

    const continueLink = screen.getByRole("link", {
      name: /继续练习：Lesson 2 sentence writing/,
    });
    expect(continueLink).toHaveAttribute(
      "href",
      "/child/work?attemptId=attempt-2",
    );
  });

  it("refreshes the plan when a child returns to the open page", async () => {
    mocks.getChildAssignments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([assignment]);

    render(<ChildHomePage />);

    expect(
      await screen.findByText("目前没有待完成的练习。"),
    ).toBeInTheDocument();

    fireEvent.focus(window);

    await waitFor(() => {
      expect(mocks.getChildAssignments).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByRole("heading", { name: "Algebra & English warm-up" }),
    ).toBeInTheDocument();
  });

  it("lets a child refresh an empty plan after a parent assigns new work", async () => {
    mocks.getChildAssignments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([assignment]);

    render(<ChildHomePage />);

    expect(
      await screen.findByText("目前没有待完成的练习。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新练习" }));

    await waitFor(() => {
      expect(mocks.getChildAssignments).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByRole("heading", { name: "Algebra & English warm-up" }),
    ).toBeInTheDocument();
  });
});
