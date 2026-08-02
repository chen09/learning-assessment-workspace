import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "@/app/parent/library/page";

const mocks = vi.hoisted(() => ({
  assignQuestionSet: vi.fn(),
  createLibrarySubmission: vi.fn(),
  getChildren: vi.fn(),
  getFamilies: vi.fn(),
  getFamilyLibrarySubmissions: vi.fn(),
  getFamilyQuestionSets: vi.fn(),
  getLibraryReviewerAccess: vi.fn(),
  withdrawLibrarySubmission: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  assignQuestionSet: mocks.assignQuestionSet,
  createLibrarySubmission: mocks.createLibrarySubmission,
  getChildren: mocks.getChildren,
  getFamilies: mocks.getFamilies,
  getFamilyLibrarySubmissions: mocks.getFamilyLibrarySubmissions,
  getFamilyQuestionSets: mocks.getFamilyQuestionSets,
  getLibraryReviewerAccess: mocks.getLibraryReviewerAccess,
  withdrawLibrarySubmission: mocks.withdrawLibrarySubmission,
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
}));

describe("LibraryPage", () => {
  beforeEach(() => {
    mocks.assignQuestionSet.mockReset();
    mocks.assignQuestionSet.mockResolvedValue({ id: "assignment-1", status: "assigned" });
    mocks.createLibrarySubmission.mockReset();
    mocks.createLibrarySubmission.mockResolvedValue({
      id: "submission-1",
      family_id: "family-1",
      question_set_id: "set-ready",
      status: "pending_review",
      created_at: "2026-08-02T00:00:00Z",
      published_at: null,
    });
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
    mocks.getFamilyLibrarySubmissions.mockReset();
    mocks.getFamilyLibrarySubmissions.mockResolvedValue([]);
    mocks.getLibraryReviewerAccess.mockReset();
    mocks.getLibraryReviewerAccess.mockResolvedValue({ is_reviewer: false });
    mocks.getFamilyQuestionSets.mockReset();
    mocks.withdrawLibrarySubmission.mockReset();
    mocks.withdrawLibrarySubmission.mockResolvedValue({
      id: "submission-1",
      family_id: "family-1",
      question_set_id: "set-ready",
      status: "withdrawn",
      created_at: "2026-08-02T00:00:00Z",
      published_at: null,
    });
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
          source_material_title: "Lesson 1 textbook",
          source_material_subject: "English",
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
    expect(
      screen.getByText("基于教材：Lesson 1 textbook · English"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "继续审核题单" }),
    ).toHaveAttribute(
      "href",
      "/parent/create?questionSetId=set-1",
    );
    expect(mocks.getFamilyQuestionSets).toHaveBeenCalledWith(
      "family-1",
      "parent-token",
    );
    expect(mocks.getFamilyLibrarySubmissions).toHaveBeenCalledWith(
      "family-1",
      "parent-token",
    );

    fireEvent.change(screen.getByLabelText("搜索家庭题库"), {
      target: { value: "textbook" },
    });
    expect(
      screen.getByRole("heading", { name: "Lesson 1 同レベル変形練習" }),
    ).toBeInTheDocument();
  });

  it("lets a parent retry loading the private family question library", async () => {
    mocks.getFamilies
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([{ id: "family-1", name: "肉肉如意" }]);

    render(<LibraryPage />);

    expect(await screen.findByText("无法加载家庭题库。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByRole("heading", {
        name: "Lesson 1 同レベル変形練習",
      }),
    ).toBeInTheDocument();
    expect(mocks.getFamilies).toHaveBeenCalledTimes(2);
  });

  it("labels a private textbook as material for creating a new question set", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-textbook",
        family_id: "family-1",
        title: "Lesson 1 textbook",
        subject: "English",
        status: "needs_review",
        question_count: 0,
        source_summary: {
          artifact_kind: "private_source_material",
          reference_file_count: 27,
        },
      },
    ]);

    render(<LibraryPage />);

    expect(
      await screen.findByRole("link", { name: "基于这份教材出题" }),
    ).toHaveAttribute(
      "href",
      "/parent/create?questionSetId=set-textbook",
    );
    expect(
      screen.queryByRole("link", { name: "继续审核题单" }),
    ).not.toBeInTheDocument();
  });

  it("starts a separate variant request from a confirmed question set", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-confirmed",
        family_id: "family-1",
        title: "Lesson 2 grammar practice",
        subject: "English",
        status: "confirmed",
        question_count: 10,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);

    expect(
      await screen.findByRole("link", { name: "创建变式题单" }),
    ).toHaveAttribute(
      "href",
      "/parent/create?variantOfQuestionSetId=set-confirmed",
    );
  });

  it("lets a parent resume a source import that is still processing", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-processing",
        family_id: "family-1",
        title: "Scanned maths worksheet",
        subject: "Math",
        status: "processing",
        question_count: 0,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);

    expect(
      await screen.findByRole("link", { name: "查看导入进度" }),
    ).toHaveAttribute(
      "href",
      "/parent/create?questionSetId=set-processing",
    );
  });

  it("marks a failed source import as retryable in the family library", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-failed-import",
        family_id: "family-1",
        title: "Scanned maths worksheet",
        subject: "Math",
        status: "processing",
        import_job_status: "failed",
        question_count: 0,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);

    expect(await screen.findByText("导入失败，可重新处理")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重新处理导入" })).toHaveAttribute(
      "href",
      "/parent/create?questionSetId=set-failed-import",
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
    expect(screen.getByRole("link", { name: "打开孩子登录页" })).toHaveAttribute(
      "href",
      "/child/login?childId=child-1&assignmentId=assignment-1",
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

  it("requires rights and privacy confirmations before submitting a set for public review", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-ready",
        family_id: "family-1",
        title: "Generated Lesson 2 practice",
        subject: "English",
        status: "confirmed",
        question_count: 10,
        source_summary: {},
      },
    ]);

    render(<LibraryPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "提交到公共题库审核" }),
    );
    expect(
      await screen.findByRole("heading", { name: "提交「Generated Lesson 2 practice」" }),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "提交审核" });
    expect(submit).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText("我确认拥有分享这份生成题单的权利。"),
    );
    fireEvent.click(
      screen.getByLabelText("我确认题单不包含孩子作答、个人信息或私有原始资料。"),
    );
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.createLibrarySubmission).toHaveBeenCalledWith(
        {
          family_id: "family-1",
          question_set_id: "set-ready",
          rights_confirmed: true,
          privacy_confirmed: true,
        },
        "parent-token",
        expect.any(String),
      );
    });
    expect(await screen.findByText("已提交到公共题库，等待审核。"))
      .toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("keeps a submitted set visibly awaiting review after the page reloads", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-ready",
        title: "Generated Lesson 2 practice",
        subject: "English",
        status: "confirmed",
        question_count: 4,
        source_summary: {},
      },
    ]);
    mocks.getFamilyLibrarySubmissions.mockResolvedValueOnce([
      {
        id: "submission-1",
        family_id: "family-1",
        question_set_id: "set-ready",
        status: "pending_review",
        created_at: "2026-08-02T00:00:00Z",
        published_at: null,
      },
    ]);

    render(<LibraryPage />);

    expect(await screen.findByText("等待审核")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "提交到公共题库审核" }),
    ).not.toBeInTheDocument();
  });

  it("lets a parent withdraw their own pending public-library submission", async () => {
    mocks.getFamilyQuestionSets.mockResolvedValueOnce([
      {
        id: "set-ready",
        family_id: "family-1",
        title: "Generated Lesson 2 practice",
        subject: "English",
        status: "confirmed",
        question_count: 4,
        source_summary: {},
      },
    ]);
    mocks.getFamilyLibrarySubmissions.mockResolvedValueOnce([
      {
        id: "submission-1",
        family_id: "family-1",
        question_set_id: "set-ready",
        status: "pending_review",
        created_at: "2026-08-02T00:00:00Z",
        published_at: null,
      },
    ]);

    render(<LibraryPage />);

    fireEvent.click(await screen.findByRole("button", { name: "撤回投稿" }));
    await waitFor(() => {
      expect(mocks.withdrawLibrarySubmission).toHaveBeenCalledWith(
        "submission-1",
        "parent-token",
      );
    });
    expect(await screen.findByText("已撤回投稿。题单仍保持私有。"))
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "提交到公共题库审核" }),
    ).toBeInTheDocument();
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
