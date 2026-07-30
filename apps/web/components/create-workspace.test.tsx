import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateWorkspace } from "@/components/create-workspace";

const mocks = vi.hoisted(() => ({
  assignQuestionSet: vi.fn(),
  confirmQuestionSet: vi.fn(),
  createQuestionSetImport: vi.fn(),
  createUploadIntent: vi.fn(),
  getChildren: vi.fn(),
  getFamilies: vi.fn(),
  getParentAccessToken: vi.fn(),
  getQuestionSetDraft: vi.fn(),
  importStructuredQuestionSet: vi.fn(),
  previewStructuredQuestionSet: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("@/lib/api-client", () => mocks);

describe("CreateWorkspace", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "Fixture family" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "Fixture child",
        grade_stage: "Junior high 1",
        ui_language: "en",
      },
    ]);
    window.history.replaceState({}, "", "/parent/create/");
  });

  it("loads a real family and child target when opened from the main Create navigation", async () => {
    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("combobox", { name: "Family" }),
    ).toHaveValue("family-1");
    expect(screen.getByRole("combobox", { name: "Child" })).toHaveValue(
      "child-1",
    );
    expect(screen.getByText("Fixture child")).toBeInTheDocument();
  });

  it("keeps draft creation disabled until a real family and child are loaded", async () => {
    let releaseFamilies:
      | ((families: Array<{ id: string; name: string }>) => void)
      | undefined;
    mocks.getFamilies.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFamilies = resolve;
        }),
    );

    render(<CreateWorkspace />);

    expect(
      screen.getByRole("button", { name: "Create review draft" }),
    ).toBeDisabled();

    await waitFor(() => {
      expect(mocks.getFamilies).toHaveBeenCalled();
    });
    releaseFamilies?.([{ id: "family-1", name: "Fixture family" }]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create review draft" }),
      ).toBeEnabled();
    });
  });

  it("keeps question material and its private answer key separate", async () => {
    mocks.createUploadIntent.mockResolvedValue({
      bucket: "sources",
      path: "family-1/import-1/english-lesson.pdf",
      token: "upload-token",
      signed_url: "https://storage.example/upload",
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.createQuestionSetImport.mockResolvedValue({
      question_set_id: "question-set-1",
      job_id: "job-1",
      status: "needs_review",
    });
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: { status: "needs_review" },
      questions: [],
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Import material" }));
    expect(
      screen.getByRole("radio", {
        name: "Generate new questions from textbook or exercises",
      }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "Convert an existing worksheet into questions",
      }),
    );
    expect(
      screen.getByRole("radio", {
        name: "Convert an existing worksheet into questions",
      }),
    ).toBeChecked();
    fireEvent.change(screen.getByLabelText("Question material"), {
      target: {
        files: [
          new File(["worksheet"], "english-lesson.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Answer key (private)"), {
      target: {
        files: [
          new File(["answers"], "english-lesson-answers.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    expect(screen.getByText("english-lesson.pdf")).toBeInTheDocument();
    expect(screen.getByText("english-lesson-answers.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("Children never receive this file."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Original material or examples (optional)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create review draft" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    expect(
      await screen.findByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft · not visible to children")).toBeInTheDocument();
  });

  it("previews an AI JSON file before the confirmed data is imported and assigned", async () => {
    const document = {
      schema_version: "1.0",
      question_set: {
        title: "Lesson 2 interactive practice",
        subject: "English",
        locale: "ja",
        difficulty: "standard",
        source_mode: "convert",
        estimated_minutes: 20,
        source_summary: { unit: "Lesson 2" },
      },
      knowledge_tags: [{ code: "if-condition", label: "if condition" }],
      questions: [
        {
          position: 1,
          type: "single_choice",
          prompt: "___ it rains, stay home.",
          options: ["If", "Because"],
          answer_key: { choice: 0 },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "if-condition",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Lesson 2 interactive practice",
      subject: "English",
      locale: "ja",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 20,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "abc123456789",
      source_summary: { unit: "Lesson 2" },
      questions: document.questions,
    });
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "question-set-1",
      assignment_id: "assignment-1",
      status: "confirmed",
      reused_existing: false,
    });
    window.history.replaceState(
      {},
      "",
      "/parent/create/?familyId=family-1&childId=child-1",
    );

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("combobox", { name: "Child" }),
    ).toHaveValue("child-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(document)], "lesson-2.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));

    expect(
      await screen.findByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
      document,
      "parent-token",
    );
    expect(mocks.importStructuredQuestionSet).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "___ it rains, stay home." }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          family_id: "family-1",
          child_id: "child-1",
          source_name: "lesson-2.json",
          document,
        }),
        "parent-token",
        expect.stringContaining("structured-"),
      );
    });
    expect(
      await screen.findByText("Confirmed and assigned"),
    ).toBeInTheDocument();
  });
});
