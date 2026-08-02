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
  getFamilyQuestionSets: vi.fn(),
  getFamilies: vi.fn(),
  getParentAccessToken: vi.fn(),
  getQuestionSetDraft: vi.fn(),
  importStructuredQuestionSet: vi.fn(),
  previewStructuredQuestionSet: vi.fn(),
  retryJob: vi.fn(),
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
    window.localStorage.clear();
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

  it("resumes a completed-paper review from its private recovery link", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-1",
    );
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-1",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      response_paths: ["family-1/responses/completed-paper.jpg"],
      extraction: {
        schema_version: "1.0",
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Recovered paper",
            subject: "English",
            locale: "en",
            difficulty: "standard",
            source_mode: "convert",
            estimated_minutes: 10,
          },
          knowledge_tags: [{ code: "grammar", label: "Grammar" }],
          questions: [
            {
              position: 1,
              type: "typed_text",
              prompt: "Complete: She ___ to school.",
              options: [],
              answer_key: { text: "goes" },
              rubric: { grading_mode: "exact" },
              points: 1,
              knowledge_code: "grammar",
            },
          ],
        },
        answer_regions: [
          { question_position: 1, page_numbers: [1], legibility: "clear" },
        ],
      },
      job: {
        id: "analysis-job-1",
        status: "succeeded",
        type: "analyze_completed_worksheet",
      },
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Preparing the review draft" }),
    ).toBeInTheDocument();
    expect(mocks.getCompletedWorksheetImport).toHaveBeenCalledWith(
      "completed-worksheet-1",
      "parent-token",
    );
    expect(screen.getByDisplayValue("Complete: She ___ to school.")).toBeInTheDocument();
  });

  it("retries a failed completed-paper analysis without creating a child task", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-1",
    );
    const failedImport = {
      id: "completed-worksheet-1",
      status: "failed",
      assignment_id: null,
      attempt_id: null,
      response_paths: ["family-1/responses/completed-paper.jpg"],
      job: {
        id: "analysis-job-1",
        status: "failed",
        type: "analyze_completed_worksheet",
      },
    };
    mocks.getCompletedWorksheetImport
      .mockResolvedValueOnce(failedImport)
      .mockResolvedValueOnce(failedImport)
      .mockResolvedValue({ ...failedImport, status: "processing", job: {
        ...failedImport.job,
        status: "queued",
      } });
    mocks.retryJob.mockResolvedValue({
      id: "analysis-job-1",
      status: "queued",
      type: "analyze_completed_worksheet",
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", {
        name: "The review draft needs another try",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));

    await waitFor(() => {
      expect(mocks.retryJob).toHaveBeenCalledWith(
        "analysis-job-1",
        "parent-token",
      );
    });
    expect(
      screen.getByRole("heading", { name: "Reading the paper" }),
    ).toBeInTheDocument();
  });

  it("never substitutes sample questions when a structured preview unexpectedly returns an empty draft", async () => {
    const document = {
      schema_version: "1.0" as const,
      question_set: {
        title: "Empty preview safety check",
        subject: "English",
        locale: "en" as const,
        difficulty: "standard" as const,
        source_mode: "convert" as const,
        estimated_minutes: 5,
      },
      knowledge_tags: [{ code: "grammar", label: "Grammar" }],
      questions: [
        {
          position: 1,
          type: "typed_text" as const,
          prompt: "This real question must not be replaced.",
          options: [],
          answer_key: { text: "answer" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "grammar",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: document.question_set.title,
      subject: document.question_set.subject,
      locale: document.question_set.locale,
      question_count: 0,
      total_points: 0,
      estimated_minutes: 0,
      knowledge_tag_count: 0,
      answer_keys_present: false,
      checksum: "empty-preview",
      source_summary: {},
      questions: [],
    });

    render(<CreateWorkspace />);
    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [new File([JSON.stringify(document)], "empty-preview.json")],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));

    expect(
      await screen.findByRole("heading", { name: "No confirmed questions yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing can be assigned until real questions are present in this draft.",
    );
    expect(
      screen.queryByText("Choose the sentence that uses the present simple correctly."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and assign" })).toBeDisabled();
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
    const structuredDocument = {
      schema_version: "1.0" as const,
      question_set: {
        title: "Lesson 3 practice",
        subject: "English",
        locale: "en" as const,
        difficulty: "standard" as const,
        source_mode: "similar" as const,
        estimated_minutes: 10,
        source_summary: { unit: "Lesson 3 grammar" },
      },
      knowledge_tags: [{ code: "present-simple", label: "Present simple" }],
      questions: [
        {
          position: 1,
          type: "typed_text" as const,
          prompt: "She ___ to school every day.",
          options: [],
          answer_key: { text: "walks" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "present-simple",
        },
      ],
    };
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
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Lesson 3 practice",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 10,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "source-material-checksum",
      source_summary: { unit: "Lesson 3 grammar" },
      questions: structuredDocument.questions,
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

    fireEvent.change(screen.getByLabelText("Source title"), {
      target: { value: "Lesson 3 grammar reference" },
    });
    fireEvent.change(screen.getByLabelText("Source subject"), {
      target: { value: "English" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.createQuestionSetImport).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Lesson 3 grammar reference",
          subject: "English",
        }),
        "parent-token",
        expect.any(String),
      );
    });

    expect(
      await screen.findByRole("heading", { name: "Source material saved privately" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No questions were fabricated from this material. Prepare a structured question JSON with your approved AI workflow, then review it here before assigning it.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh" },
    });
    expect(
      await screen.findByRole("heading", { name: "教材已私密保存" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("语言"), {
      target: { value: "en" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );
    expect(
      screen.getByRole("heading", { name: "Import an AI-structured question set" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(structuredDocument)], "lesson-3.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          question_set: expect.objectContaining({
            source_summary: expect.objectContaining({
              unit: "Lesson 3 grammar",
              source_material_question_set_id: "question-set-1",
              source_material_title: "Lesson 3 grammar reference",
              source_material_subject: "English",
            }),
          }),
        }),
        "parent-token",
      );
    });
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

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "ja" },
    });
    expect(
      await screen.findByRole("heading", { name: "割り当て前に確認" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI 構造化下書き")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "問題 1 を編集" }));
    expect(screen.getByLabelText("問題文")).toBeInTheDocument();
    expect(screen.getByLabelText("解答形式")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    fireEvent.change(screen.getByLabelText("言語"), {
      target: { value: "en" },
    });

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

    fireEvent.click(screen.getByRole("radio", { name: "Timed exam" }));
    fireEvent.change(screen.getByLabelText("Time limit"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("A note for your child (optional)"), {
      target: { value: "Finish this independently first." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          family_id: "family-1",
          child_id: "child-1",
          source_name: "lesson-2.json",
          assignment_mode: "exam",
          time_limit_seconds: 1800,
          parent_note: "Finish this independently first.",
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

  it("links a later AI JSON import back to an existing private source material", async () => {
    const document = {
      schema_version: "1.0",
      question_set: {
        title: "Lesson 2 follow-up",
        subject: "English",
        locale: "ja",
        difficulty: "standard",
        source_mode: "similar",
        estimated_minutes: 15,
        source_summary: { unit: "Lesson 2" },
      },
      knowledge_tags: [{ code: "lesson-2", label: "Lesson 2" }],
      questions: [
        {
          position: 1,
          type: "typed_text",
          prompt: "Complete the sentence.",
          options: [],
          answer_key: { text: "walks" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "lesson-2",
        },
      ],
    };
    mocks.getFamilyQuestionSets.mockResolvedValue([
      {
        id: "source-set-1",
        family_id: "family-1",
        title: "Lesson 2 textbook photos",
        subject: "English",
        status: "needs_review",
        question_count: 0,
        source_summary: {
          artifact_kind: "private_source_material",
          reference_file_count: 27,
        },
      },
      {
        id: "practice-set-1",
        family_id: "family-1",
        title: "Earlier practice",
        subject: "English",
        status: "confirmed",
        question_count: 10,
        source_summary: { artifact_kind: "ai_generated_practice" },
      },
    ]);
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Lesson 2 follow-up",
      subject: "English",
      locale: "ja",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 15,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "source-link-checksum",
      source_summary: { unit: "Lesson 2" },
      questions: document.questions,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );

    const sourceSelector = await screen.findByRole("combobox", {
      name: "Private source material (optional)",
    });
    expect(sourceSelector).toHaveTextContent("Lesson 2 textbook photos");
    expect(sourceSelector).not.toHaveTextContent("Earlier practice");
    fireEvent.change(sourceSelector, { target: { value: "source-set-1" } });
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(document)], "lesson-2-follow-up.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          question_set: expect.objectContaining({
            source_summary: expect.objectContaining({
              source_material_question_set_id: "source-set-1",
              source_material_title: "Lesson 2 textbook photos",
              source_material_subject: "English",
            }),
          }),
        }),
        "parent-token",
      );
    });
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

  it("uploads private audio before assigning a listening question", async () => {
    const document = {
      schema_version: "1.0" as const,
      question_set: {
        title: "Listening check",
        subject: "English",
        locale: "en" as const,
        difficulty: "standard" as const,
        source_mode: "convert" as const,
        estimated_minutes: 5,
      },
      knowledge_tags: [{ code: "listening", label: "Listening" }],
      questions: [
        {
          position: 1,
          type: "listening" as const,
          prompt: "Listen and choose.",
          options: ["School", "Library"],
          answer_key: { choice: 0 },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "listening",
          listening: {
            replay_limit: 1,
            transcript: "I go to school.",
            transcript_policy: "after_submission" as const,
          },
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Listening check",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "listening-preview",
      source_summary: {},
      questions: document.questions,
    });
    mocks.createUploadIntent.mockResolvedValue({
      bucket: "audio",
      path: "family-1/audio/listening.mp3",
      upload_url: "fixture://audio-upload",
      expires_in: 300,
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "listening-set",
      assignment_id: "listening-assignment",
      status: "confirmed",
      reused_existing: false,
    });
    window.history.replaceState(
      {},
      "",
      "/parent/create/?familyId=family-1&childId=child-1",
    );

    render(<CreateWorkspace />);
    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Import AI question JSON" }));
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: { files: [new File([JSON.stringify(document)], "listening.json")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));
    await screen.findByRole("heading", { name: "Review before assigning" });
    fireEvent.change(screen.getByLabelText("Audio for question 1"), {
      target: { files: [new File(["audio"], "lesson.mp3", { type: "audio/mpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.createUploadIntent).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "audio", content_type: "audio/mpeg" }),
        "parent-token",
        expect.stringContaining("listening-audio-"),
      );
      expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                listening: expect.objectContaining({
                  audio_path: "family-1/audio/listening.mp3",
                }),
              }),
            ],
          }),
        }),
        "parent-token",
        expect.any(String),
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
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "Fixture child",
        grade_stage: "Junior high 1",
        ui_language: "zh",
      },
    ]);
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
      knowledge_tags: [
        { code: "factorisation", label: "Factorisation" },
        { code: "present-simple", label: "Present simple" },
      ],
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
        {
          position: 2,
          type: "typed_text",
          prompt: "Complete: She ___ to school every day.",
          options: [],
          answer_key: { text: "goes" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "present-simple",
        },
        {
          position: 3,
          type: "single_choice",
          prompt: "Choose the correct sentence.",
          options: ["She walk to school.", "She walks to school."],
          answer_key: { choice: 1 },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "present-simple",
        },
        {
          position: 4,
          type: "multiple_choice",
          prompt: "Select both correct present-simple forms.",
          options: ["She walks to school.", "They walk to school.", "He walk to school."],
          answer_key: { choices: [0, 1] },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "present-simple",
        },
        {
          position: 5,
          type: "word_order",
          prompt: "Put the words in order.",
          options: ["She", "walks", "to", "school."],
          answer_key: { tokens: ["walks", "She", "school.", "to"] },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "present-simple",
        },
      ],
    };
    mocks.createUploadIntent.mockImplementation((payload) =>
      Promise.resolve({
        bucket: payload.bucket,
        path: `family-1/completed-paper/${payload.bucket}-${payload.filename}`,
        token: "upload-token",
        signed_url: "https://storage.example/upload",
      }),
    );
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.createCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-1",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      response_paths: ["family-1/completed-paper/responses-completed-paper.jpg"],
      extraction: {
        schema_version: "1.0",
        status: "needs_parent_confirmation",
        document,
        answer_regions: [
          {
            question_position: 1,
            page_numbers: [1],
            regions: [{ x: 0.12, y: 0.45, width: 0.7, height: 0.2 }],
            transcription: "(x - 4)(x + 4)",
            legibility: "clear",
          },
          {
            question_position: 2,
            page_numbers: [1],
            transcription: "goes",
            legibility: "clear",
          },
          {
            question_position: 3,
            page_numbers: [1],
            transcription: "She walks to school.",
            legibility: "clear",
          },
          {
            question_position: 4,
            page_numbers: [1],
            transcription: "She walks to school. They walk to school.",
            legibility: "clear",
          },
          {
            question_position: 5,
            page_numbers: [1],
            transcription: "She walks to school.",
            legibility: "clear",
          },
        ],
        confidence: 0.9,
        warnings: [],
      },
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
    fireEvent.change(screen.getByLabelText("Worksheet language"), {
      target: { value: "en" },
    });
    fireEvent.change(screen.getByLabelText("Completed worksheet scans"), {
      target: {
        files: [
          new File(["scan"], "completed-paper.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Answer key (private, optional)"), {
      target: {
        files: [
          new File(["answers"], "completed-paper-answers.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.change(
      screen.getByLabelText("Original material or examples (private, optional)"),
      {
        target: {
          files: [
            new File(["reference"], "lesson-reference.pdf", {
              type: "application/pdf",
            }),
          ],
        },
      },
    );
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
        document_language: "en",
        feedback_language: "zh",
        response_paths: ["family-1/completed-paper/responses-completed-paper.jpg"],
        answer_source_paths: [
          "family-1/completed-paper/sources-completed-paper-answers.pdf",
        ],
        reference_source_paths: [
          "family-1/completed-paper/sources-lesson-reference.pdf",
        ],
      }),
      "parent-token",
      expect.stringContaining("completed-worksheet-"),
    );

    expect(
      screen.getByText(
        "A private AI draft is ready. Review every question and answer region before confirming.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review ready · questions: 5 · answer regions: 5"),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Question 1 wording"),
      { target: { value: "Factorise x² − 25." } },
    );
    fireEvent.change(screen.getByLabelText("Reference answer for question 1"), {
      target: { value: "(x - 5)(x + 5)" },
    });
    fireEvent.change(screen.getByLabelText("Accepted answer for question 2"), {
      target: { value: "walks" },
    });
    fireEvent.change(screen.getByLabelText("Correct choice for question 3"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByLabelText("Correct choice 1 for question 4"));
    fireEvent.click(screen.getByLabelText("Correct choice 3 for question 4"));
    fireEvent.change(screen.getByLabelText("Correct word order for question 5"), {
      target: { value: "She\nwalks\nto\nschool." },
    });
    fireEvent.change(screen.getByLabelText("Answer page numbers for question 1"), {
      target: { value: "not a page" },
    });
    fireEvent.change(screen.getByLabelText("Answer transcription for question 1"), {
      target: { value: "(x - 5)(x + 5)" },
    });
    expect(screen.getByDisplayValue("Factorise x² − 25.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was assigned",
    );
    expect(mocks.confirmCompletedWorksheetImport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Answer page numbers for question 1"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Correct word order for question 5"), {
      target: { value: "She\nwalks\nto" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was assigned",
    );
    expect(mocks.confirmCompletedWorksheetImport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Correct word order for question 5"), {
      target: { value: "She\nwalks\nto\nschool." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove question 5" }));
    expect(
      screen.queryByLabelText("Correct word order for question 5"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add handwritten question" }));
    fireEvent.change(screen.getByLabelText("Question 5 wording"), {
      target: { value: "Explain your factorisation." },
    });
    fireEvent.change(screen.getByLabelText("Reference answer for question 5"), {
      target: { value: "Show the two factors." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );

    await waitFor(() => {
      expect(mocks.confirmCompletedWorksheetImport).toHaveBeenCalledWith(
        "completed-worksheet-1",
        {
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                prompt: "Factorise x² − 25.",
                answer_key: { reference: "(x - 5)(x + 5)" },
              }),
              expect.objectContaining({
                answer_key: { text: "walks" },
              }),
              expect.objectContaining({
                answer_key: { choice: 0 },
              }),
              expect.objectContaining({
                answer_key: { choices: [1, 2] },
              }),
              expect.objectContaining({
                prompt: "Explain your factorisation.",
                answer_key: { reference: "Show the two factors." },
              }),
            ],
          }),
          responses: [
            {
              question_position: 1,
              kind: "photo",
              answer: {
                source_paths: [
                  "family-1/completed-paper/responses-completed-paper.jpg",
                ],
                page_numbers: [2],
                regions: [{ x: 0.12, y: 0.45, width: 0.7, height: 0.2 }],
                transcription: "(x - 5)(x + 5)",
                legibility: "clear",
              },
            },
            {
              question_position: 2,
              kind: "photo",
              answer: {
                source_paths: [
                  "family-1/completed-paper/responses-completed-paper.jpg",
                ],
                page_numbers: [1],
                transcription: "goes",
                legibility: "clear",
              },
            },
            {
              question_position: 3,
              kind: "photo",
              answer: {
                source_paths: [
                  "family-1/completed-paper/responses-completed-paper.jpg",
                ],
                page_numbers: [1],
                transcription: "She walks to school.",
                legibility: "clear",
              },
            },
            {
              question_position: 4,
              kind: "photo",
              answer: {
                source_paths: [
                  "family-1/completed-paper/responses-completed-paper.jpg",
                ],
                page_numbers: [1],
                transcription: "She walks to school. They walk to school.",
                legibility: "clear",
              },
            },
            {
              question_position: 5,
              kind: "photo",
              answer: {
                source_paths: [
                  "family-1/completed-paper/responses-completed-paper.jpg",
                ],
                page_numbers: [1],
                legibility: "uncertain",
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

  it("shows the complete manual authoring flow in the parent's selected language", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "孩子" });
    fireEvent.click(screen.getByRole("button", { name: "手工创建题单" }));

    expect(
      screen.getByRole("heading", { name: "创建结构化题单" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("练习名称")).toBeInTheDocument();
    expect(screen.getByLabelText("题目语言")).toBeInTheDocument();
    expect(screen.getByLabelText("作答方式")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加题目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "创建审核草稿" }),
    ).toBeInTheDocument();
  });

  it("shows the learning-material import choices in the parent's selected language", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "孩子" });
    fireEvent.click(screen.getByRole("button", { name: "导入教材" }));

    expect(
      screen.getByRole("heading", { name: "导入教材或现有题单" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "根据教材或练习生成新题目" }),
    ).toBeChecked();
    expect(screen.getByLabelText("教材标题")).toBeInTheDocument();
    expect(screen.getByLabelText("教材与练习" )).toBeInTheDocument();
  });

  it("translates the completed-paper entry in the parent's selected language", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "孩子" });
    fireEvent.click(screen.getByRole("button", { name: "批改已完成的试卷" }));

    expect(
      screen.getByRole("heading", { name: "上传孩子已经做完的试卷" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("已完成试卷扫描件")).toBeInTheDocument();
    expect(screen.getByText(/手写内容保持私密/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传供审核" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Grade completed paper" }),
    ).not.toBeInTheDocument();
  });
});
