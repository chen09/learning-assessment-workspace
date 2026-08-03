import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParentDashboard } from "@/components/parent-dashboard";

const mocks = vi.hoisted(() => ({
  getChildren: vi.fn(),
  getParentAttemptReview: vi.fn(),
  getFamilyHistory: vi.fn(),
  getFamilies: vi.fn(),
  getParentAccessToken: vi.fn(),
  replace: vi.fn(),
}));

const router = { replace: mocks.replace };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/api-client", () => ({
  getChildren: mocks.getChildren,
  getParentAttemptReview: mocks.getParentAttemptReview,
  getFamilyHistory: mocks.getFamilyHistory,
  getFamilies: mocks.getFamilies,
  getParentAccessToken: mocks.getParentAccessToken,
}));

describe("ParentDashboard", () => {
  beforeEach(() => {
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getFamilies.mockReset();
    mocks.getFamilies.mockResolvedValue([]);
    mocks.getChildren.mockReset();
    mocks.getChildren.mockResolvedValue([]);
    mocks.getFamilyHistory.mockReset();
    mocks.getFamilyHistory.mockResolvedValue([]);
    mocks.getParentAttemptReview.mockReset();
    mocks.getParentAttemptReview.mockResolvedValue({ pending_review_count: 0 });
    mocks.replace.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/parent/");
  });

  it("sends a newly signed-in parent to real family setup", async () => {
    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open family setup" }),
    ).toHaveAttribute("href", "/parent/family");
    expect(screen.queryByText("Maya")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });

  it("shows a real family overview instead of onboarding when a family exists", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);

    render(<ParentDashboard />);

    expect(await screen.findByRole("heading", { name: "肉肉如意" }))
      .toBeInTheDocument();
    expect(screen.getByText("肉肉", { selector: "strong" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "创建练习" })).toHaveAttribute(
      "href",
      "/parent/create?familyId=family-1&childId=child-1",
    );
    expect(
      screen.queryByRole("heading", { name: "设置家庭学习空间" }),
    ).not.toBeInTheDocument();
  });

  it("shows each child's current assigned work on the family dashboard", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: "attempt-1",
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "Lesson 2 同レベル変形練習（インタラクティブ版）",
        status: "grading",
        submitted_at: "2026-08-02T00:00:00Z",
        awarded_points: 0,
        available_points: 100,
        correction_count: 0,
        source_material_title: null,
        source_material_subject: null,
      },
    ]);

    render(<ParentDashboard />);

    expect(
      await screen.findByText("Lesson 2 同レベル変形練習（インタラクティブ版）"),
    ).toBeInTheDocument();
    expect(screen.getByText("正在批阅")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看结果" })).toHaveAttribute(
      "href",
      "/parent/results?attemptId=attempt-1",
    );
  });

  it("refreshes grading work without reloading the parent workspace", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    const gradingWork = [
      {
        assignment_id: "assignment-1",
        attempt_id: "attempt-1",
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "手写英文练习",
        status: "grading",
        submitted_at: "2026-08-02T00:00:00Z",
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
        source_material_title: null,
        source_material_subject: null,
      },
    ];
    const completedWork = [
      {
        ...gradingWork[0],
        status: "results_ready",
        awarded_points: 8,
      },
    ];
    mocks.getFamilyHistory.mockResolvedValue(gradingWork);
    mocks.getParentAttemptReview.mockResolvedValue({ pending_review_count: 1 });

    render(<ParentDashboard />);

    expect(await screen.findByText("正在批阅")).toBeInTheDocument();
    const historyCallsBeforeRefresh = mocks.getFamilyHistory.mock.calls.length;
    const familyCallsBeforeRefresh = mocks.getFamilies.mock.calls.length;
    const childCallsBeforeRefresh = mocks.getChildren.mock.calls.length;
    mocks.getFamilyHistory.mockResolvedValueOnce(completedWork);

    await new Promise((resolve) => window.setTimeout(resolve, 5_050));

    expect(mocks.getFamilyHistory).toHaveBeenCalledTimes(
      historyCallsBeforeRefresh + 1,
    );
    expect(mocks.getFamilies).toHaveBeenCalledTimes(familyCallsBeforeRefresh);
    expect(mocks.getChildren).toHaveBeenCalledTimes(childCallsBeforeRefresh);
    expect(await screen.findByText("可查看结果")).toBeInTheDocument();
    expect(screen.getByText("有 1 道手写题等待您确认")).toBeInTheDocument();
  }, 10_000);

  it("refreshes assigned work when a child starts answering on another device", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    const assignedWork = [
      {
        assignment_id: "assignment-1",
        attempt_id: null,
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "英语填空练习",
        status: "assigned",
        submitted_at: null,
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
        source_material_title: null,
        source_material_subject: null,
      },
    ];
    const inProgressWork = [
      {
        ...assignedWork[0],
        attempt_id: "attempt-1",
        status: "in_progress",
      },
    ];
    mocks.getFamilyHistory.mockResolvedValue(assignedWork);

    render(<ParentDashboard />);

    expect(await screen.findByText("已布置")).toBeInTheDocument();
    const historyCallsBeforeRefresh = mocks.getFamilyHistory.mock.calls.length;
    mocks.getFamilyHistory.mockResolvedValueOnce(inProgressWork);

    await vi.waitFor(
      () => {
        expect(mocks.getFamilyHistory.mock.calls.length).toBeGreaterThan(
          historyCallsBeforeRefresh,
        );
      },
      { timeout: 6_000 },
    );
    expect(await screen.findByText("正在作答")).toBeInTheDocument();
  }, 10_000);

  it("opens child sign-in for an assigned worksheet that has not started", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: null,
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "英语填空练习",
        status: "assigned",
        submitted_at: null,
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
        source_material_title: null,
        source_material_subject: null,
      },
    ]);

    render(<ParentDashboard />);

    expect(
      await screen.findByRole("link", { name: "打开孩子登录页" }),
    ).toHaveAttribute(
      "href",
      "/child/login?childId=child-1&assignmentId=assignment-1",
    );
  });

  it("copies a PIN-protected child sign-in link for use on another device", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: null,
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "英语填空练习",
        status: "assigned",
        submitted_at: null,
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
        source_material_title: null,
        source_material_subject: null,
      },
    ]);

    render(<ParentDashboard />);

    fireEvent.click(
      await screen.findByRole("button", { name: "复制孩子登录链接" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/child/login?childId=child-1&assignmentId=assignment-1`,
    );
    expect(await screen.findByText("链接已复制")).toBeInTheDocument();
  });

  it("switches the homepage to another family without mixing child data", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
      { id: "family-2", name: "第二个家庭" },
    ]);
    mocks.getChildren.mockImplementation((familyId: string) =>
      Promise.resolve([
        {
          id: `${familyId}-child`,
          family_id: familyId,
          nickname: familyId === "family-1" ? "肉肉" : "小明",
          grade_stage: "Junior high 1",
          ui_language: "zh",
        },
      ]),
    );

    render(<ParentDashboard />);

    expect(await screen.findByRole("heading", { name: "肉肉如意" }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("当前家庭"), {
      target: { value: "family-2" },
    });

    expect(await screen.findByRole("heading", { name: "第二个家庭" }))
      .toBeInTheDocument();
    expect(screen.getByText("小明", { selector: "strong" }))
      .toBeInTheDocument();
    expect(mocks.getChildren).toHaveBeenLastCalledWith("family-2", "parent-token");
  });

  it("calls out handwriting answers that need a parent decision", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: "attempt-1",
        child_id: "child-1",
        child_nickname: "肉肉",
        title: "手写英文练习",
        status: "results_ready",
        submitted_at: "2026-08-02T00:00:00Z",
        awarded_points: 8,
        available_points: 10,
        correction_count: 1,
        source_material_title: null,
        source_material_subject: null,
      },
    ]);
    mocks.getParentAttemptReview.mockResolvedValue({ pending_review_count: 2 });

    render(<ParentDashboard />);

    expect(
      await screen.findByText("有 2 道手写题等待您确认"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去确认" })).toHaveAttribute(
      "href",
      "/parent/results?attemptId=attempt-1",
    );
  });

  it("translates the complete onboarding screen into Chinese", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", { name: "设置家庭学习空间" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "创建或加入家庭" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "进入家庭设置" }),
    ).toHaveAttribute("href", "/parent/family");
    expect(screen.getByText("家长", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("Parent workspace")).not.toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor without showing the parent page", async () => {
    mocks.getParentAccessToken.mockResolvedValue(null);

    render(<ParentDashboard />);

    await vi.waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/login/");
    });
    expect(
      screen.queryByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).not.toBeInTheDocument();
  });

  it("removes a legacy authentication code from the address bar", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/?code=expired-auth-code&source=email",
    );

    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/parent/");
    expect(window.location.search).toBe("?source=email");
  });
});
