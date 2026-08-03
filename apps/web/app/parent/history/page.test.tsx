import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ParentHistoryPage from "./page";

const mocks = vi.hoisted(() => ({
  getCompletedWorksheetImports: vi.fn(),
  getFamilyHistory: vi.fn(),
  getFamilies: vi.fn(),
  getParentAccessToken: vi.fn(),
  stopAssignment: vi.fn(),
  withdrawAssignment: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getCompletedWorksheetImports: mocks.getCompletedWorksheetImports,
    getFamilyHistory: mocks.getFamilyHistory,
    getFamilies: mocks.getFamilies,
    getParentAccessToken: mocks.getParentAccessToken,
    stopAssignment: mocks.stopAssignment,
    withdrawAssignment: mocks.withdrawAssignment,
  };
});

describe("ParentHistoryPage", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/parent/history/?familyId=family-1",
    );
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getFamilies.mockReset();
    mocks.getFamilies.mockResolvedValue([{ id: "family-1", name: "Family one" }]);
    window.localStorage.clear();
    mocks.getFamilyHistory.mockReset();
    mocks.getFamilyHistory.mockReturnValue(new Promise(() => undefined));
    mocks.getCompletedWorksheetImports.mockReset();
    mocks.getCompletedWorksheetImports.mockResolvedValue([]);
    mocks.stopAssignment.mockReset();
    mocks.withdrawAssignment.mockReset();
  });

  it("does not render example family records while history is loading", () => {
    render(<ParentHistoryPage />);

    expect(screen.getByText("Loading family history…")).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.queryByText("Emi")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Algebra & English warm-up",
      }),
    ).not.toBeInTheDocument();
  });

  it("uses the parent's selected Chinese language for the real family record", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    mocks.getFamilyHistory.mockResolvedValue([]);

    render(<ParentHistoryPage />);

    expect(await screen.findByRole("heading", { name: "学习记录" })).toBeInTheDocument();
    expect(screen.getByText("已完成、批改中和已归档的家庭练习。"))
      .toBeInTheDocument();
    expect(await screen.findByText("目前还没有家庭学习记录。"))
      .toBeInTheDocument();
    expect(screen.queryByText("Completed, grading, and archived work for every child in this family.")).not.toBeInTheDocument();
  });

  it("formats submitted history dates in the parent's selected language", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "ja");
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-ja-date",
        attempt_id: "attempt-ja-date",
        child_id: "child-1",
        child_nickname: "Maya",
        title: "Japanese date practice",
        status: "results_ready",
        submitted_at: "2026-08-03T12:00:00Z",
        awarded_points: 8,
        available_points: 10,
        correction_count: 0,
      },
    ]);

    render(<ParentHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "Japanese date practice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" && element.textContent === "Maya · 8月3日",
      ),
    ).toBeInTheDocument();
  });

  it("refreshes an in-progress grading record without reloading the family selector", async () => {
    const gradingRecord = [
      {
        assignment_id: "assignment-poll",
        attempt_id: "attempt-poll",
        child_id: "child-1",
        child_nickname: "Maya",
        title: "Handwritten algebra",
        status: "grading",
        submitted_at: "2026-08-03T12:00:00Z",
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
      },
    ];
    mocks.getFamilyHistory.mockResolvedValue(gradingRecord);

    render(<ParentHistoryPage />);

    expect(await screen.findByText("Being checked")).toBeInTheDocument();
    const historyCallsBeforeRefresh = mocks.getFamilyHistory.mock.calls.length;
    const familyCallsBeforeRefresh = mocks.getFamilies.mock.calls.length;
    mocks.getFamilyHistory.mockResolvedValueOnce([
      { ...gradingRecord[0], status: "results_ready", awarded_points: 8 },
    ]);

    await new Promise((resolve) => window.setTimeout(resolve, 5_050));

    expect(mocks.getFamilyHistory).toHaveBeenCalledTimes(
      historyCallsBeforeRefresh + 1,
    );
    expect(mocks.getFamilies).toHaveBeenCalledTimes(familyCallsBeforeRefresh);
    expect(await screen.findByText("Results ready")).toBeInTheDocument();
  }, 10_000);

  it("links a reviewed paper scan to its real grading results", async () => {
    mocks.getFamilyHistory.mockResolvedValue([]);
    mocks.getCompletedWorksheetImports.mockResolvedValue([
      {
        id: "paper-1",
        family_id: "family-1",
        child_id: "child-1",
        child_nickname: "Maya",
        title: "Factorisation day 4",
        subject: "Mathematics",
        status: "results_ready",
        job_status: "succeeded",
        assignment_id: "assignment-1",
        attempt_id: "attempt-1",
      },
    ]);

    render(<ParentHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "Submitted paper grading" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Results ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open paper results" })).toHaveAttribute(
      "href",
      "/parent/results?attemptId=attempt-1",
    );
  });

  it("applies the child filter to pending and submitted paper scans", async () => {
    mocks.getFamilyHistory.mockResolvedValue([]);
    mocks.getCompletedWorksheetImports.mockResolvedValue([
      {
        id: "paper-child-1",
        family_id: "family-1",
        child_id: "child-1",
        child_nickname: "Maya",
        title: "Maya pending paper",
        subject: "Mathematics",
        status: "needs_review",
        job_status: "succeeded",
        assignment_id: null,
        attempt_id: null,
      },
      {
        id: "paper-child-2",
        family_id: "family-1",
        child_id: "child-2",
        child_nickname: "Leo",
        title: "Leo submitted paper",
        subject: "English",
        status: "results_ready",
        job_status: "succeeded",
        assignment_id: "assignment-2",
        attempt_id: "attempt-2",
      },
    ]);

    render(<ParentHistoryPage />);

    await screen.findByRole("heading", { name: "Paper uploads to review" });
    fireEvent.click(screen.getByRole("button", { name: "Maya" }));

    expect(screen.getByRole("heading", { name: "Maya pending paper" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Leo submitted paper" })).not.toBeInTheDocument();
  });

  it("opens the first family when history is opened from the sidebar", async () => {
    window.history.replaceState({}, "", "/parent/history/");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "Family one" },
      { id: "family-2", name: "Family two" },
    ]);
    mocks.getFamilyHistory.mockResolvedValue([]);

    render(<ParentHistoryPage />);

    expect(
      await screen.findByText("No family learning history yet."),
    ).toBeInTheDocument();
    expect(mocks.getFamilyHistory).toHaveBeenCalledWith("family-1", "parent-token");
    fireEvent.change(screen.getByLabelText("Current family"), {
      target: { value: "family-2" },
    });
    await waitFor(() => {
      expect(mocks.getFamilyHistory).toHaveBeenLastCalledWith(
        "family-2",
        "parent-token",
      );
    });
    expect(window.location.search).toBe("?familyId=family-2");
  });

  it("clears the previous family history while browser navigation opens another family", async () => {
    let releaseSecondFamily!: (
      value: Parameters<typeof mocks.getFamilyHistory.mockResolvedValue>[0],
    ) => void;
    const secondFamilyHistory = new Promise<Parameters<
      typeof mocks.getFamilyHistory.mockResolvedValue
    >[0]>((resolve) => {
      releaseSecondFamily = resolve;
    });
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "Family one" },
      { id: "family-2", name: "Family two" },
    ]);
    mocks.getFamilyHistory.mockImplementation((familyId: string) =>
      familyId === "family-1"
        ? Promise.resolve([
            {
              assignment_id: "first-assignment",
              attempt_id: null,
              child_id: "child-1",
              child_nickname: "First family child",
              title: "First family history",
              status: "assigned",
              submitted_at: null,
              awarded_points: 0,
              available_points: 10,
              correction_count: 0,
            },
          ])
        : secondFamilyHistory,
    );

    render(<ParentHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "First family history" }),
    ).toBeInTheDocument();

    await act(async () => {
      window.history.pushState(
        {},
        "",
        "/parent/history/?familyId=family-2",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      screen.queryByRole("heading", { name: "First family history" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Loading family history…")).toBeInTheDocument();

    await act(async () => {
      releaseSecondFamily([
        {
          assignment_id: "second-assignment",
          attempt_id: null,
          child_id: "child-2",
          child_nickname: "Second family child",
          title: "Second family history",
          status: "assigned",
          submitted_at: null,
          awarded_points: 0,
          available_points: 10,
          correction_count: 0,
        },
      ]);
    });

    expect(
      await screen.findByRole("heading", { name: "Second family history" }),
    ).toBeInTheDocument();
  });

  it("lets a parent retry a temporary family-history loading failure", async () => {
    mocks.getFamilyHistory
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([]);

    render(<ParentHistoryPage />);

    expect(
      await screen.findByText("Family history could not be loaded."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(mocks.getFamilyHistory).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByText("No family learning history yet."),
    ).toBeInTheDocument();
  });

  it("lets a parent reopen a paper upload that still needs review", async () => {
    mocks.getFamilyHistory.mockResolvedValue([]);
    mocks.getCompletedWorksheetImports.mockResolvedValue([
      {
        id: "completed-paper-1",
        family_id: "family-1",
        child_id: "child-1",
        child_nickname: "Alex",
        title: "Scanned factorisation practice",
        subject: "Mathematics",
        status: "needs_review",
        job_status: "succeeded",
      },
    ]);

    render(<ParentHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "Paper uploads to review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Scanned factorisation practice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue paper review" }),
    ).toHaveAttribute(
      "href",
      "/parent/create?completedWorksheetId=completed-paper-1",
    );
  });

  it("lets a parent withdraw work that has not started", async () => {
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-1",
        attempt_id: null,
        child_id: "child-1",
        child_nickname: "Alex",
        title: "Unstarted worksheet",
        status: "assigned",
        submitted_at: null,
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
        source_material_title: "Lesson 1 textbook",
        source_material_subject: "English",
      },
    ]);
    mocks.withdrawAssignment.mockResolvedValue({ status: "withdrawn" });

    render(<ParentHistoryPage />);

    await screen.findByRole("heading", { name: "Unstarted worksheet" });
    expect(
      screen.getByText(
        "Based on private material: Lesson 1 textbook · English",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw assignment" }));

    await waitFor(() => {
      expect(mocks.withdrawAssignment).toHaveBeenCalledWith(
        "assignment-1",
        "parent-token",
      );
    });
    expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
  });

  it("lets a parent stop work that is in progress", async () => {
    mocks.getFamilyHistory.mockResolvedValue([
      {
        assignment_id: "assignment-2",
        attempt_id: null,
        child_id: "child-1",
        child_nickname: "Alex",
        title: "Started worksheet",
        status: "in_progress",
        submitted_at: null,
        awarded_points: 0,
        available_points: 10,
        correction_count: 0,
      },
    ]);
    mocks.stopAssignment.mockResolvedValue({ status: "stopped" });

    render(<ParentHistoryPage />);

    await screen.findByRole("heading", { name: "Started worksheet" });
    fireEvent.click(screen.getByRole("button", { name: "Stop assignment" }));

    await waitFor(() => {
      expect(mocks.stopAssignment).toHaveBeenCalledWith(
        "assignment-2",
        "parent-token",
      );
    });
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
  });
});
