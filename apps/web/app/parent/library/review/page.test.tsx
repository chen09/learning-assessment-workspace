import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryReviewPage from "@/app/parent/library/review/page";

const mocks = vi.hoisted(() => ({
  getLibraryReviewerAccess: vi.fn(),
  getLibraryReviewSubmissions: vi.fn(),
  reviewLibrarySubmission: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getLibraryReviewerAccess: mocks.getLibraryReviewerAccess,
  getLibraryReviewSubmissions: mocks.getLibraryReviewSubmissions,
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
  reviewLibrarySubmission: mocks.reviewLibrarySubmission,
}));

describe("LibraryReviewPage", () => {
  beforeEach(() => {
    mocks.getLibraryReviewerAccess.mockReset();
    mocks.getLibraryReviewerAccess.mockResolvedValue({ is_reviewer: true });
    mocks.getLibraryReviewSubmissions.mockReset();
    mocks.getLibraryReviewSubmissions.mockResolvedValue([
      {
        id: "submission-1",
        question_set_id: "set-1",
        title: "Grammar practice",
        subject: "English",
        question_count: 12,
        created_at: "2026-08-02T00:00:00Z",
      },
    ]);
    mocks.reviewLibrarySubmission.mockReset();
    mocks.reviewLibrarySubmission.mockResolvedValue({
      id: "submission-1",
      status: "published",
    });
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });

  it("only presents reviewer-safe metadata and approves once", async () => {
    render(<LibraryReviewPage />);

    expect(await screen.findByText("Grammar practice")).toBeInTheDocument();
    expect(screen.getByText("English · 12 道题")).toBeInTheDocument();
    expect(screen.queryByText("answer_key")).not.toBeInTheDocument();
    expect(screen.queryByText("source_summary")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("审核说明（可选）"), {
      target: { value: "适合公开。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "批准发布" }));

    await waitFor(() => {
      expect(mocks.reviewLibrarySubmission).toHaveBeenCalledWith(
        "submission-1",
        { decision: "approve", note: "适合公开。" },
        "parent-token",
        expect.any(String),
      );
    });
    expect(await screen.findByText("已批准发布。"))
      .toBeInTheDocument();
    expect(screen.queryByText("Grammar practice")).not.toBeInTheDocument();
  });

  it("does not reveal the review queue to an ordinary parent", async () => {
    mocks.getLibraryReviewerAccess.mockResolvedValue({ is_reviewer: false });

    render(<LibraryReviewPage />);

    expect(await screen.findByText("你没有审核权限。"))
      .toBeInTheDocument();
    expect(mocks.getLibraryReviewSubmissions).not.toHaveBeenCalled();
  });
});
