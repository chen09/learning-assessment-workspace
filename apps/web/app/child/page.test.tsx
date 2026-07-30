import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildHomePage from "@/app/child/page";

const assignment = {
  id: "assignment-1",
  title: "Algebra & English warm-up",
  status: "assigned",
  mode: "practice",
  time_limit_seconds: null,
  question_count: 3,
  latest_attempt_id: null,
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
  });
});
