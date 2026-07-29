import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "@/app/parent/library/page";

const mocks = vi.hoisted(() => ({
  getFamilies: vi.fn(),
  getFamilyQuestionSets: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getFamilies: mocks.getFamilies,
  getFamilyQuestionSets: mocks.getFamilyQuestionSets,
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
}));

describe("LibraryPage", () => {
  beforeEach(() => {
    mocks.getFamilies.mockReset();
    mocks.getFamilyQuestionSets.mockReset();
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getFamilyQuestionSets.mockResolvedValue([
      {
        id: "set-1",
        title: "Lesson 1 同レベル変形練習",
        subject: "English",
        status: "needs_review",
        question_count: 49,
        source_summary: {
          artifact_kind: "ai_generated_practice",
          reference_file_count: 27,
        },
      },
    ]);
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });

  it("shows the real private family question library in Chinese", async () => {
    render(<LibraryPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Lesson 1 同レベル変形練習",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("49 道题")).toBeInTheDocument();
    expect(screen.getByText("待家长确认")).toBeInTheDocument();
    expect(screen.getByText("来自 27 份原教材资料")).toBeInTheDocument();
    expect(mocks.getFamilyQuestionSets).toHaveBeenCalledWith(
      "family-1",
      "parent-token",
    );
  });
});
