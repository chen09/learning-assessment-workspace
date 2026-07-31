import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateWorkspace } from "@/components/create-workspace";

const mocks = vi.hoisted(() => ({
  assignQuestionSet: vi.fn(),
  confirmCompletedWorksheetImport: vi.fn(),
  confirmQuestionSet: vi.fn(),
  createCompletedWorksheetImport: vi.fn(),
  createQuestionSetImport: vi.fn(),
  createUploadIntent: vi.fn(),
  getChildren: vi.fn(),
  getCompletedWorksheetImport: vi.fn(),
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
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("preview-import-key")
      .mockReturnValueOnce("edited-import-key");
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

    fireEvent.click(
      screen.getByRole("button", { name: "Edit question 1" }),
    );
    fireEvent.change(screen.getByLabelText("Question wording"), {
      target: { value: "If it rains, stay home." },
    });
    fireEvent.change(screen.getByLabelText("Points"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "When\nIf\nBecause" },
    });
    fireEvent.change(screen.getByLabelText("Correct answer"), {
      target: { value: "When" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    expect(
      screen.getByRole("heading", { name: "If it rains, stay home." }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          family_id: "family-1",
          child_id: "child-1",
          source_name: "lesson-2.json",
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                prompt: "If it rains, stay home.",
                points: 2,
                options: ["When", "If", "Because"],
                answer_key: { choice: 0 },
              }),
            ],
          }),
        }),
        "parent-token",
        "structured-edited-import-key-child-1",
      );
    });
    randomUUID.mockRestore();
    expect(
      await screen.findByText("Confirmed and assigned"),
    ).toBeInTheDocument();
  });

  it("turns one parent-authored question into a reviewed and assigned set", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Weather check",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 2,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual12345678",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "typed_text",
          prompt: "Complete: If it ___ tomorrow, we will stay home.",
          options: [],
          answer_key: { text: "rains" },
          rubric: { grading_mode: "exact" },
          points: 2,
          knowledge_code: "manual-practice",
        },
      ],
    });
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "manual-question-set-1",
      assignment_id: "manual-assignment-1",
      status: "confirmed",
      reused_existing: false,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Weather check" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Complete: If it ___ tomorrow, we will stay home." },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "rains" },
    });
    fireEvent.change(screen.getByLabelText("Points"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    expect(
      await screen.findByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Complete: If it ___ tomorrow, we will stay home.",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));
    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          family_id: "family-1",
          child_id: "child-1",
          source_name: "Manual question",
          document: expect.objectContaining({
            question_set: expect.objectContaining({
              title: "Weather check",
              source_mode: "manual",
            }),
            questions: [
              expect.objectContaining({
                type: "typed_text",
                answer_key: { text: "rains" },
                points: 2,
              }),
            ],
          }),
        }),
        "parent-token",
        expect.stringContaining("manual-"),
      );
    });
  });

  it("lets a parent collect several authored questions before opening the review draft", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Two question check",
      subject: "English",
      locale: "en",
      question_count: 2,
      total_points: 3,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-two-questions",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "typed_text",
          prompt: "Complete: I ___ ready.",
          options: [],
          answer_key: { text: "am" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "manual-practice",
        },
        {
          position: 2,
          type: "handwriting",
          prompt: "Write one sentence about your weekend.",
          options: [],
          answer_key: { reference: "Any complete sentence about a weekend." },
          rubric: { grading_mode: "parent_review" },
          points: 2,
          knowledge_code: "manual-practice",
        },
      ],
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Two question check" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Complete: I ___ ready." },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "am" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    expect(screen.getByText("Question 1 ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "handwriting" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Write one sentence about your weekend." },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "Any complete sentence about a weekend." },
    });
    fireEvent.change(screen.getByLabelText("Points"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          question_set: expect.objectContaining({ title: "Two question check" }),
          questions: [
            expect.objectContaining({
              position: 1,
              prompt: "Complete: I ___ ready.",
              answer_key: { text: "am" },
            }),
            expect.objectContaining({
              position: 2,
              type: "handwriting",
              prompt: "Write one sentence about your weekend.",
              answer_key: {
                reference: "Any complete sentence about a weekend.",
              },
              points: 2,
            }),
          ],
        }),
        "parent-token",
      );
    });
  });

  it("copies, reorders, and removes AI questions before assignment", async () => {
    const document = {
      schema_version: "1.0" as const,
      question_set: {
        title: "Short review",
        subject: "English",
        locale: "en" as const,
        difficulty: "standard" as const,
        source_mode: "convert" as const,
        estimated_minutes: 5,
      },
      knowledge_tags: [{ code: "review", label: "Review" }],
      questions: [
        {
          position: 1,
          type: "typed_text" as const,
          prompt: "Keep this question.",
          options: [],
          answer_key: { text: "keep" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "review",
        },
        {
          position: 2,
          type: "typed_text" as const,
          prompt: "Remove this mistaken extraction.",
          options: [],
          answer_key: { text: "remove" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "review",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Short review",
      subject: "English",
      locale: "en",
      question_count: 2,
      total_points: 2,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "delete12345678",
      source_summary: {},
      questions: document.questions,
    });
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "question-set-2",
      assignment_id: "assignment-2",
      status: "confirmed",
      reused_existing: false,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(document)], "short-review.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));
    await screen.findByRole("heading", { name: "Remove this mistaken extraction." });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate question 1" }));
    expect(
      screen.getByRole("heading", { name: "Keep this question. (copy)" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move question 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove question 2" }));
    expect(
      screen.queryByRole("heading", { name: "Remove this mistaken extraction." }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("2 questions · validated JSON · answers stay private"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));
    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                position: 1,
                prompt: "Keep this question.",
              }),
              expect.objectContaining({
                position: 2,
                prompt: "Keep this question. (copy)",
              }),
            ],
          }),
        }),
        "parent-token",
        expect.stringContaining("structured-"),
      );
    });
  });

  it("requires a parent-authored choice answer to match one listed option", async () => {
    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "single_choice" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Choose a greeting." },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "Hello\nGoodbye" },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "Welcome" },
    });
    expect(
      screen.getByRole("button", { name: "Create review draft" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "Hello" },
    });
    expect(
      screen.getByRole("button", { name: "Create review draft" }),
    ).toBeEnabled();
  });

  it("keeps a completed paper private until the reviewed JSON creates its submitted attempt", async () => {
    const document = {
      schema_version: "1.0",
      question_set: {
        title: "Completed factorisation paper",
        subject: "Math",
        locale: "ja",
        difficulty: "standard",
        source_mode: "convert",
        estimated_minutes: 10,
        source_summary: { unit: "factorisation" },
      },
      knowledge_tags: [{ code: "factorisation", label: "Factorisation" }],
      questions: [
        {
          position: 1,
          type: "handwriting",
          prompt: "Factorise x² − 16.",
          options: [],
          answer_key: { reference: "(x - 4)(x + 4)" },
          rubric: { grading_mode: "parent_review" },
          points: 1,
          knowledge_code: "factorisation",
        },
      ],
    };
    mocks.createUploadIntent.mockResolvedValue({
      bucket: "responses",
      path: "family-1/completed-paper/page-1.jpg",
      token: "upload-token",
      signed_url: "https://storage.example/upload",
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.createCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-1",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      response_paths: ["family-1/completed-paper/page-1.jpg"],
      job: { id: "analysis-job-1", status: "completed", type: "analyze_completed_worksheet" },
    });
    mocks.confirmCompletedWorksheetImport.mockResolvedValue({
      completed_worksheet: { id: "completed-worksheet-1", status: "grading" },
      question_set_id: "question-set-1",
      assignment: { id: "assignment-1", status: "grading" },
      attempt: { id: "attempt-1", submitted_at: "2026-07-31T00:00:00Z" },
      grading_job: { id: "grading-job-1", status: "queued", type: "grade_submission" },
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(screen.getByLabelText("Completed worksheet scans"), {
      target: {
        files: [
          new File(["scan"], "completed-paper.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload for review" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Preparing the review draft" }),
    ).toBeInTheDocument();
    expect(mocks.createCompletedWorksheetImport).toHaveBeenCalledWith(
      expect.objectContaining({
        family_id: "family-1",
        child_id: "child-1",
        response_paths: ["family-1/completed-paper/page-1.jpg"],
      }),
      "parent-token",
      expect.stringContaining("completed-worksheet-"),
    );

    const review = {
      document,
      answer_regions: [
        {
          question_position: 1,
          page_numbers: [1],
          regions: [{ x: 0.12, y: 0.45, width: 0.7, height: 0.2 }],
          transcription: "(x - 4)(x + 4)",
          legibility: "clear",
        },
      ],
    };
    expect(
      screen.getByRole("button", { name: "Copy local AI prompt" }),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Reviewed completed worksheet JSON"),
      {
        target: {
          files: [
            new File([JSON.stringify(review)], "reviewed-paper.json", {
              type: "application/json",
            }),
          ],
        },
      },
    );
    expect(
      await screen.findByText("Review ready: 1 question and 1 answer region"),
    ).toBeInTheDocument();
    expect(screen.getByText("Factorise x² − 16.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );

    await waitFor(() => {
      expect(mocks.confirmCompletedWorksheetImport).toHaveBeenCalledWith(
        "completed-worksheet-1",
        {
          document,
          responses: [
            {
              question_position: 1,
              kind: "photo",
              answer: {
                source_paths: ["family-1/completed-paper/page-1.jpg"],
                page_numbers: [1],
                regions: [{ x: 0.12, y: 0.45, width: 0.7, height: 0.2 }],
                transcription: "(x - 4)(x + 4)",
                legibility: "clear",
              },
            },
          ],
        },
        "parent-token",
        "confirm-completed-completed-worksheet-1",
      );
    });
    expect(
      await screen.findByRole("link", { name: "Open grading results" }),
    ).toHaveAttribute("href", "/parent/results?attemptId=attempt-1");
  });
});
