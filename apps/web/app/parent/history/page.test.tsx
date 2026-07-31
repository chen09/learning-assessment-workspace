import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ParentHistoryPage from "./page";

const mocks = vi.hoisted(() => ({
  getFamilyHistory: vi.fn(),
  getParentAccessToken: vi.fn(),
  stopAssignment: vi.fn(),
  withdrawAssignment: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getFamilyHistory: mocks.getFamilyHistory,
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
    mocks.getFamilyHistory.mockReset();
    mocks.getFamilyHistory.mockReturnValue(new Promise(() => undefined));
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
      },
    ]);
    mocks.withdrawAssignment.mockResolvedValue({ status: "withdrawn" });

    render(<ParentHistoryPage />);

    await screen.findByRole("heading", { name: "Unstarted worksheet" });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw assignment" }));

    await waitFor(() => {
      expect(mocks.withdrawAssignment).toHaveBeenCalledWith(
        "assignment-1",
        "parent-token",
      );
    });
    expect(await screen.findByText("withdrawn")).toBeInTheDocument();
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
    expect(await screen.findByText("stopped")).toBeInTheDocument();
  });
});
