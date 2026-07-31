import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "@/app/parent/library/page";

const mocks = vi.hoisted(() => ({
  assignQuestionSet: vi.fn(),
  getChildren: vi.fn(),
  getFamilies: vi.fn(),
  getFamilyQuestionSets: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  assignQuestionSet: mocks.assignQuestionSet,
  getChildren: mocks.getChildren,
  getFamilies: mocks.getFamilies,
  getFamilyQuestionSets: mocks.getFamilyQuestionSets,
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
}));

describe("LibraryPage", () => {
  beforeEach(() => {
    mocks.assignQuestionSet.mockReset();
    mocks.assignQuestionSet.mockResolvedValue({ id: "assignment-1", status: "assigned" });
    mocks.getChildren.mockReset();
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "肉肉",
        grade_stage: "Junior high 1",
        ui_language: "ja",
      },
    ]);
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

  it("lets a parent assign a confirmed library set to a child", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-ready",
        title: "Lesson 2 同レベル変形練習",
        subject: "English",
        status: "confirmed",
        question_count: 71,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "分配给孩子" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "分配「Lesson 2 同レベル変形練習」",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "孩子" })).toHaveValue(
      "child-1",
    );

    fireEvent.change(screen.getByLabelText("给孩子的说明（可选）"), {
      target: { value: "请先自己完成。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));

    await waitFor(() => {
      expect(mocks.assignQuestionSet).toHaveBeenCalledWith(
        "set-ready",
        "child-1",
        "parent-token",
        expect.any(String),
        {
          mode: "practice",
          time_limit_seconds: null,
          parent_note: "请先自己完成。",
        },
      );
    });
    expect(await screen.findByText("已分配给肉肉。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "打印 A4 试卷" })).toHaveAttribute(
      "href",
      "/parent/print?assignmentId=assignment-1",
    );
  });

  it("keeps an optional exam time limit when assigning from the library", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-exam",
        title: "Lesson 2 test",
        subject: "English",
        status: "confirmed",
        question_count: 10,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "分配给孩子" }),
    );
    await screen.findByRole("combobox", { name: "孩子" });
    fireEvent.click(screen.getByRole("radio", { name: "考试" }));
    fireEvent.change(screen.getByRole("combobox", { name: "限时" }), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认分配" }));

    await waitFor(() => {
      expect(mocks.assignQuestionSet).toHaveBeenCalledWith(
        "set-exam",
        "child-1",
        "parent-token",
        expect.any(String),
        {
          mode: "exam",
          time_limit_seconds: 2700,
          parent_note: null,
        },
      );
    });
  });

  it("explains why a ready set cannot be assigned when the family has no children", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-no-child",
        family_id: "family-1",
        title: "Lesson without child",
        subject: "English",
        status: "confirmed",
        question_count: 1,
        source_summary: {},
      },
    ]);
    mocks.getChildren.mockResolvedValueOnce([]);

    render(<LibraryPage />);
    await screen.findByRole("button", { name: "分配给孩子" });
    fireEvent.click(screen.getByRole("button", { name: "分配给孩子" }));

    expect(await screen.findByText("请先在家庭设置中添加孩子。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
  });
});
