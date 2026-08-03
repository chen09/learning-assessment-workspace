import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const defaultCreateObjectURL = URL.createObjectURL;
const defaultRevokeObjectURL = URL.revokeObjectURL;

vi.mock("@/lib/api-client", () => mocks);

describe("CreateWorkspace", () => {
  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: defaultCreateObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: defaultRevokeObjectURL,
      writable: true,
    });
  });

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

  it("retries loading the family and child assignment target in place", async () => {
    mocks.getFamilies
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce([{ id: "family-1", name: "Fixture family" }]);

    render(<CreateWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request could not be completed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("combobox", { name: "Family" }),
    ).toHaveValue("family-1");
    expect(screen.getByRole("combobox", { name: "Child" })).toHaveValue(
      "child-1",
    );
    await waitFor(() => {
      expect(mocks.getFamilies).toHaveBeenCalledTimes(2);
    });
  });

  it("opens a completed-paper recovery link after browser navigation", async () => {
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-2",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      filenames: ["completed-paper.jpg"],
      response_paths: ["family-1/responses/completed-paper.jpg"],
      job: {
        id: "analysis-job-2",
        status: "succeeded",
        type: "analyze_completed_worksheet",
      },
    });

    render(<CreateWorkspace />);

    expect(await screen.findByRole("combobox", { name: "Family" })).toBeInTheDocument();
    window.history.pushState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-2",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(
      await screen.findByRole("heading", { name: "Preparing the review draft" }),
    ).toBeInTheDocument();
    expect(mocks.getCompletedWorksheetImport).toHaveBeenCalledWith(
      "completed-worksheet-2",
      "parent-token",
    );
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
      filenames: ["completed-paper-front.jpg", "completed-paper-back.jpg"],
      response_paths: [
        "family-1/responses/completed-paper-front.jpg",
        "family-1/responses/completed-paper-back.jpg",
      ],
      response_preview_urls: [
        "https://storage.example.test/signed/completed-paper-front.jpg?short-lived=true",
        "https://storage.example.test/signed/completed-paper-back.jpg?short-lived=true",
      ],
      extraction: {
        schema_version: "1.0",
        status: "needs_parent_confirmation",
        source_page_count: 2,
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
    expect(
      screen.getByRole("img", { name: "Completed worksheet page 1" }),
    ).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/completed-paper-front.jpg?short-lived=true",
    );
    expect(
      screen.getByRole("img", { name: "Completed worksheet page 2" }),
    ).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/completed-paper-back.jpg?short-lived=true",
    );
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open original Page 1 of 2" }),
    ).toHaveAttribute(
      "href",
      "https://storage.example.test/signed/completed-paper-front.jpg?short-lived=true",
    );
    expect(screen.getByText("completed-paper-front.jpg")).toBeInTheDocument();
    expect(screen.getByText("completed-paper-back.jpg")).toBeInTheDocument();
    expect(
      screen.queryByText("family-1/responses/completed-paper.jpg"),
    ).not.toBeInTheDocument();
  });

  it("matches completed-paper answer regions by question position", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-out-of-order",
    );
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-out-of-order",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      filenames: ["completed-paper.jpg"],
      response_paths: ["family-1/responses/completed-paper.jpg"],
      extraction: {
        schema_version: "1.0",
        source_page_count: 2,
        document: {
          schema_version: "1.0",
          question_set: { title: "Recovered paper", subject: "English", locale: "en", difficulty: "standard", source_mode: "convert", estimated_minutes: 10 },
          knowledge_tags: [{ code: "grammar", label: "Grammar" }],
          questions: [
            { position: 1, type: "typed_text", prompt: "First", options: [], answer_key: { text: "one" }, rubric: { grading_mode: "exact" }, points: 1, knowledge_code: "grammar" },
            { position: 2, type: "typed_text", prompt: "Second", options: [], answer_key: { text: "two" }, rubric: { grading_mode: "exact" }, points: 1, knowledge_code: "grammar" },
          ],
        },
        answer_regions: [
          { question_position: 2, page_numbers: [1], legibility: "clear" },
          { question_position: 1, page_numbers: [2], legibility: "clear" },
        ],
      },
      job: { id: "analysis-job-out-of-order", status: "completed", type: "analyze_completed_worksheet" },
    });

    render(<CreateWorkspace />);

    expect(await screen.findByDisplayValue("2")).toHaveAttribute(
      "aria-label",
      "Answer page numbers for question 1",
    );
    expect(screen.getByDisplayValue("1")).toHaveAttribute(
      "aria-label",
      "Answer page numbers for question 2",
    );
  });

  it("refreshes the private paper preview when processing finishes", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-1",
    );
    mocks.getCompletedWorksheetImport
      .mockResolvedValueOnce({
        id: "completed-worksheet-1",
        status: "processing",
        assignment_id: null,
        attempt_id: null,
        filenames: ["completed-paper.jpg"],
        response_paths: ["family-1/responses/completed-paper.jpg"],
        job: {
          id: "analysis-job-1",
          status: "running",
          type: "analyze_completed_worksheet",
        },
      })
      .mockResolvedValueOnce({
        id: "completed-worksheet-1",
        status: "needs_review",
        assignment_id: null,
        attempt_id: null,
        filenames: ["completed-paper.jpg"],
        response_paths: ["family-1/responses/completed-paper.jpg"],
        response_preview_urls: [
          "https://storage.example.test/signed/completed-paper.jpg?short-lived=true",
        ],
        extraction: {
          schema_version: "1.0",
          document: {
            schema_version: "1.0",
            question_set: {
              title: "Completed paper",
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

    expect(await screen.findByText("Analysis in progress")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "Completed worksheet page 1" }),
    ).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/completed-paper.jpg?short-lived=true",
    );
  });

  it("restores the clean A4 print link after a completed paper is graded", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-1",
    );
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-1",
      status: "results_ready",
      assignment_id: "assignment-1",
      attempt_id: "attempt-1",
      filenames: ["completed-paper.jpg"],
      response_paths: ["family-1/responses/completed-paper.jpg"],
      job: {
        id: "grading-job-1",
        status: "succeeded",
        type: "grade_submission",
      },
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("link", { name: "Print a clean A4 copy" }),
    ).toHaveAttribute("href", "/parent/print?assignmentId=assignment-1");
    expect(
      screen.getByRole("link", { name: "Open grading results" }),
    ).toHaveAttribute("href", "/parent/results?attemptId=attempt-1");
  });

  it("accepts review regions from the second page of one uploaded PDF", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-pdf-1",
    );
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-pdf-1",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      filenames: ["two-page-completed-paper.pdf"],
      response_paths: ["family-1/responses/two-page-completed-paper.pdf"],
      response_preview_urls: [
        "https://storage.example.test/signed/two-page-completed-paper.pdf?short-lived=true",
      ],
      extraction: {
        schema_version: "1.0",
        source_page_count: 2,
        document: {
          schema_version: "1.0",
          question_set: {
            title: "Two page paper",
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
          { question_position: 1, page_numbers: [2], legibility: "clear" },
        ],
      },
      job: {
        id: "analysis-job-pdf-1",
        status: "succeeded",
        type: "analyze_completed_worksheet",
      },
    });
    mocks.confirmCompletedWorksheetImport.mockResolvedValue({
      completed_worksheet: { id: "completed-pdf-1", status: "grading" },
      question_set_id: "question-set-pdf-1",
      assignment: { id: "assignment-pdf-1", status: "grading" },
      attempt: { id: "attempt-pdf-1", submitted_at: "2026-08-02T00:00:00Z" },
      grading_job: {
        id: "grading-job-pdf-1",
        status: "queued",
        type: "grade_submission",
      },
    });

    render(<CreateWorkspace />);

    await screen.findByRole("heading", { name: "Preparing the review draft" });
    expect(
      screen.getByRole("link", {
        name: "Page 1 of 2two-page-completed-paper.pdfOpen original",
      }),
    ).toHaveAttribute(
      "href",
      "https://storage.example.test/signed/two-page-completed-paper.pdf?short-lived=true",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );

    await waitFor(() => {
      expect(mocks.confirmCompletedWorksheetImport).toHaveBeenCalledWith(
        "completed-pdf-1",
        expect.objectContaining({
          responses: [
            expect.objectContaining({
              answer: expect.objectContaining({ page_numbers: [2] }),
            }),
          ],
        }),
        "parent-token",
        "confirm-completed-completed-pdf-1",
      );
    });
  });

  it("resumes an imported question-set review from its private recovery link", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?questionSetId=imported-question-set-1",
    );
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: { id: "imported-question-set-1", status: "needs_review" },
      questions: [
        {
          id: "imported-question-1",
          position: 1,
          type: "typed_text",
          prompt: "Complete: They ___ ready.",
          options: null,
          answer_key: { text: "are" },
          points: 1,
          listening: null,
        },
      ],
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    expect(mocks.getQuestionSetDraft).toHaveBeenCalledWith(
      "imported-question-set-1",
      "parent-token",
    );
    expect(screen.getByText("Complete: They ___ ready.")).toBeInTheDocument();
  });

  it("returns a material-only import to its private source workflow", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?questionSetId=source-material-set-1",
    );
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: {
        id: "source-material-set-1",
        title: "Lesson 2 textbook pages",
        subject: "English",
        status: "needs_review",
        source_summary: { artifact_kind: "private_source_material" },
      },
      questions: [],
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", {
        name: "Source material saved privately",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Lesson 2 textbook pages is stored only for this family/),
    ).toBeInTheDocument();
  });

  it("opens a confirmed question set as a new variant request without changing the original", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?variantOfQuestionSetId=confirmed-set-1",
    );
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: {
        id: "confirmed-set-1",
        title: "Lesson 2 grammar practice",
        subject: "English",
        status: "confirmed",
        source_summary: {},
      },
      questions: [
        {
          id: "question-1",
          position: 1,
          type: "typed_text",
          prompt: "Complete: She ___ to school.",
          options: null,
          answer_key: { text: "goes" },
          points: 1,
          listening: null,
        },
      ],
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Create a new variant" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Lesson 2 grammar practice stays unchanged/),
    ).toBeInTheDocument();
    expect(mocks.getQuestionSetDraft).toHaveBeenCalledWith(
      "confirmed-set-1",
      "parent-token",
    );
  });

  it("copies a privacy-safe variant prompt with the chosen difficulty", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?variantOfQuestionSetId=confirmed-set-1",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: {
        id: "confirmed-set-1",
        title: "Lesson 2 grammar practice",
        subject: "English",
        status: "confirmed",
        source_summary: {},
      },
      questions: [
        {
          id: "question-1",
          position: 1,
          type: "typed_text",
          prompt: "Complete: She ___ to school.",
          options: null,
          answer_key: { text: "goes" },
          points: 1,
          listening: null,
        },
      ],
    });

    render(<CreateWorkspace />);

    await screen.findByRole("heading", { name: "Create a new variant" });
    fireEvent.change(screen.getByLabelText("Target difficulty"), {
      target: { value: "challenge" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy variant JSON prompt" }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("Target difficulty: challenge"),
      );
    });
    expect(writeText.mock.calls[0]?.[0]).toContain(
      "Complete: She ___ to school.",
    );
    expect(writeText.mock.calls[0]?.[0]).toContain(
      "Use photo for work written on paper",
    );
    expect(writeText.mock.calls[0]?.[0]).toContain(
      "use LaTeX wrapped in \\( ... \\) inline",
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain("Fixture child");
  });

  it("links imported variant JSON to the confirmed source set and selected difficulty", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?variantOfQuestionSetId=confirmed-set-1",
    );
    const document = {
      schema_version: "1.0",
      question_set: {
        title: "Lesson 2 challenge practice",
        subject: "English",
        locale: "en",
        difficulty: "challenge",
        source_mode: "similar",
        estimated_minutes: 15,
        source_summary: { unit: "Lesson 2 grammar" },
      },
      knowledge_tags: [{ code: "lesson-2", label: "Lesson 2" }],
      questions: [
        {
          position: 1,
          type: "typed_text",
          prompt: "Complete: If it ___ tomorrow, we will stay home.",
          options: [],
          answer_key: { text: "rains" },
          rubric: { grading_mode: "exact_match" },
          points: 1,
          knowledge_code: "lesson-2",
        },
      ],
    };
    mocks.getQuestionSetDraft.mockResolvedValue({
      question_set: {
        id: "confirmed-set-1",
        title: "Lesson 2 grammar practice",
        subject: "English",
        status: "confirmed",
        source_summary: {},
      },
      questions: [
        {
          id: "question-1",
          position: 1,
          type: "typed_text",
          prompt: "Complete: She ___ to school.",
          options: null,
          answer_key: { text: "goes" },
          points: 1,
          listening: null,
        },
      ],
    });
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: document.question_set.title,
      subject: document.question_set.subject,
      locale: document.question_set.locale,
      question_count: 1,
      total_points: 1,
      estimated_minutes: 15,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "variant-checksum",
      source_summary: document.question_set.source_summary,
      questions: document.questions,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("heading", { name: "Create a new variant" });
    fireEvent.change(screen.getByLabelText("Target difficulty"), {
      target: { value: "challenge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import variant JSON" }));
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(document)], "lesson-2-variant.json", {
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
              variant_of_question_set_id: "confirmed-set-1",
              variant_of_title: "Lesson 2 grammar practice",
              variant_of_subject: "English",
              variant_difficulty: "challenge",
            }),
          }),
        }),
        "parent-token",
      );
    });
  });

  it("shows a failed source import and retries without exposing the source", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?questionSetId=failed-source-set-1",
    );
    const failedDraft = {
      question_set: {
        id: "failed-source-set-1",
        title: "Private textbook pages",
        subject: "English",
        status: "processing",
        source_summary: {},
      },
      import_job: {
        id: "source-job-1",
        status: "failed",
        type: "extract_source",
      },
      questions: [],
    };
    mocks.getQuestionSetDraft
      .mockResolvedValueOnce(failedDraft)
      .mockResolvedValue({
        ...failedDraft,
        import_job: {
          ...failedDraft.import_job,
          status: "queued",
        },
      });
    mocks.retryJob.mockResolvedValue({
      id: "source-job-1",
      status: "queued",
      type: "extract_source",
    });

    render(<CreateWorkspace />);

    expect(
      await screen.findByRole("heading", {
        name: "The source draft needs another try",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private textbook pages")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry processing" }));

    await waitFor(() => {
      expect(mocks.retryJob).toHaveBeenCalledWith(
        "source-job-1",
        "parent-token",
      );
    });
    expect(
      screen.getByRole("heading", { name: "Preparing your question draft" }),
    ).toBeInTheDocument();
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
        error_code: "pdf_too_many_pages",
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
    expect(
      screen.getByText(
        "This PDF has more than 100 pages. Upload a shorter PDF or page images, then try again.",
      ),
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

  it("returns to the completed-paper uploader for a scan that needs replacing", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/create/?completedWorksheetId=completed-worksheet-1",
    );
    mocks.getCompletedWorksheetImport.mockResolvedValue({
      id: "completed-worksheet-1",
      status: "failed",
      assignment_id: null,
      attempt_id: null,
      response_paths: ["family-1/responses/completed-paper.pdf"],
      job: {
        id: "analysis-job-1",
        status: "failed",
        type: "analyze_completed_worksheet",
        error_code: "pdf_too_many_pages",
      },
    });

    render(<CreateWorkspace />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Upload a replacement" }),
    );

    expect(
      await screen.findByRole("button", { name: "Upload for review" }),
    ).toBeInTheDocument();
    expect(window.location.search).not.toContain("completedWorksheetId");
  });

  it("rejects a completed-paper file above the worker analysis limit before upload", async () => {
    render(<CreateWorkspace />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(screen.getByLabelText("Completed worksheet scans"), {
      target: {
        files: [
          new File(
            [new Uint8Array(15_000_001)],
            "too-large-paper.pdf",
            { type: "application/pdf" },
          ),
        ],
      },
    });

    expect(
      screen.getByText(
        "Each paper file must be 15 MB or smaller. Choose a smaller file before uploading.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload for review" }),
    ).toBeDisabled();
  });

  it("keeps selected completed-paper pages in a reviewable upload order", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:selected-${file.name}`),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

    render(<CreateWorkspace />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(screen.getByLabelText("Completed worksheet scans"), {
      target: {
        files: [
          new File(["front"], "front.jpg", { type: "image/jpeg" }),
          new File(["back"], "back.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    const selectedPages = screen.getByRole("list", {
      name: "Selected pages (upload order)",
    });
    expect(
      within(selectedPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["front.jpg", "back.jpg"]);
    expect(
      await screen.findByRole("img", { name: "Preview of Page 1 of 2" }),
    ).toHaveAttribute("src", "blob:selected-front.jpg");
    expect(
      screen.getByRole("img", { name: "Preview of Page 2 of 2" }),
    ).toHaveAttribute("src", "blob:selected-back.jpg");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open full-size preview of Page 1 of 2",
      }),
    );
    const previewDialog = screen.getByRole("dialog", {
      name: "Preview of Page 1 of 2",
    });
    expect(previewDialog).toBeVisible();
    expect(previewDialog).toHaveFocus();
    expect(
      previewDialog.querySelector("img"),
    ).toHaveAttribute("src", "blob:selected-front.jpg");
    fireEvent.keyDown(previewDialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Preview of Page 1 of 2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open full-size preview of Page 1 of 2",
      }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Move page 1 later" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move page 2 earlier" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Move page 2 earlier" }),
    );

    expect(
      within(selectedPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["back.jpg", "front.jpg"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove page 1" }));

    expect(
      within(selectedPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["front.jpg"]);
  });

  it("keeps private answer-key pages in a reviewable upload order", async () => {
    render(<CreateWorkspace />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(screen.getByLabelText("Answer key (private, optional)"), {
      target: {
        files: [
          new File(["first"], "answer-front.jpg", { type: "image/jpeg" }),
          new File(["second"], "answer-back.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    const selectedAnswerPages = screen.getByRole("list", {
      name: "Answer key pages (upload order)",
    });
    expect(
      within(selectedAnswerPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["answer-front.jpg", "answer-back.jpg"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Move answer key page 2 earlier" }),
    );
    expect(
      within(selectedAnswerPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["answer-back.jpg", "answer-front.jpg"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove answer key page 1" }),
    );
    expect(
      within(selectedAnswerPages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["answer-front.jpg"]);
  });

  it("keeps private original-material pages in a reviewable upload order", async () => {
    render(<CreateWorkspace />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(
      screen.getByLabelText("Original material or examples (private, optional)"),
      {
        target: {
          files: [
            new File(["first"], "lesson-front.jpg", { type: "image/jpeg" }),
            new File(["second"], "lesson-back.jpg", { type: "image/jpeg" }),
          ],
        },
      },
    );

    const selectedReferencePages = screen.getByRole("list", {
      name: "Original material pages (upload order)",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move original material page 2 earlier",
      }),
    );
    expect(
      within(selectedReferencePages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["lesson-back.jpg", "lesson-front.jpg"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove original material page 1" }),
    );
    expect(
      within(selectedReferencePages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["lesson-front.jpg"]);
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
    expect(window.location.search).toContain("questionSetId=question-set-1");
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
    fireEvent.click(screen.getByRole("radio", { name: "時間制限テスト" }));
    expect(screen.getByRole("option", { name: "10分" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "練習" }));
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
    expect(
      screen.getByRole("link", { name: "Open child sign-in" }),
    ).toHaveAttribute(
      "href",
      "/child/login?childId=child-1&assignmentId=assignment-1",
    );
  });

  it("typesets a mathematical prompt while a parent reviews an AI JSON draft", async () => {
    const structuredDocument = {
      schema_version: "1.0",
      question_set: {
        title: "Algebra practice",
        subject: "Mathematics",
        locale: "en",
        difficulty: "standard",
        source_mode: "similar",
        estimated_minutes: 10,
        source_summary: { unit: "Factorisation" },
      },
      knowledge_tags: [{ code: "difference-of-squares", label: "Difference of squares" }],
      questions: [
        {
          position: 1,
          type: "typed_text",
          prompt: "Factorise \\(x^2 - 25\\).",
          options: [],
          answer_key: { text: "(x - 5)(x + 5)" },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "difference-of-squares",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Algebra practice",
      subject: "Mathematics",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 10,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "formula-preview-checksum",
      source_summary: { unit: "Factorisation" },
      questions: structuredDocument.questions,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Import AI question JSON" }),
    );
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [
          new File([JSON.stringify(structuredDocument)], "algebra.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));

    await waitFor(() => {
      expect(document.querySelector(".draft-question-list .katex")).toBeInTheDocument();
    });
  });

  it("keeps a reviewed word-order question as word order", async () => {
    const document = {
      schema_version: "1.0",
      question_set: {
        title: "Word order review",
        subject: "English",
        locale: "en",
        difficulty: "standard",
        source_mode: "convert",
        estimated_minutes: 5,
      },
      knowledge_tags: [{ code: "word-order", label: "Word order" }],
      questions: [
        {
          position: 1,
          type: "word_order",
          prompt: "Put the words in order.",
          options: ["tomorrow", "We", "will", "travel"],
          answer_key: { tokens: ["We", "will", "travel", "tomorrow"] },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "word-order",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Word order review",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "word-order-review",
      source_summary: {},
      questions: document.questions,
    });
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "word-order-set",
      assignment_id: "word-order-assignment",
      status: "confirmed",
      reused_existing: false,
    });

    render(<CreateWorkspace />);
    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Import AI question JSON" }));
    fireEvent.change(screen.getByLabelText("AI question JSON"), {
      target: {
        files: [new File([JSON.stringify(document)], "word-order.json", { type: "application/json" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));
    await screen.findByRole("heading", { name: "Put the words in order." });

    fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
    expect(screen.getByLabelText("Response type")).toHaveValue("word_order");
    expect(
      screen.getByLabelText("Correct word order, one token per line"),
    ).toHaveValue("We\nwill\ntravel\ntomorrow");
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                type: "word_order",
                options: ["tomorrow", "We", "will", "travel"],
                answer_key: { tokens: ["We", "will", "travel", "tomorrow"] },
              }),
            ],
          }),
        }),
        "parent-token",
        expect.any(String),
      );
    });
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

  it("lets a parent author a multiple-choice question with several correct choices", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Weekend plans",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 2,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-multiple-choice",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "multiple_choice",
          prompt: "Choose every sentence about a weekend plan.",
          options: [
            "I am going camping.",
            "She goes to school every day.",
            "We will visit a museum.",
          ],
          answer_key: { choices: [0, 2] },
          rubric: { grading_mode: "exact" },
          points: 2,
          knowledge_code: "manual-practice",
        },
      ],
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Weekend plans" },
    });
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "multiple_choice" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Choose every sentence about a weekend plan." },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: {
        value:
          "I am going camping.\nShe goes to school every day.\nWe will visit a museum.",
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "I am going camping." }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "We will visit a museum." }),
    );
    fireEvent.change(screen.getByLabelText("Points"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [
            expect.objectContaining({
              type: "multiple_choice",
              options: [
                "I am going camping.",
                "She goes to school every day.",
                "We will visit a museum.",
              ],
              answer_key: { choices: [0, 2] },
              rubric: { grading_mode: "exact" },
              points: 2,
            }),
          ],
        }),
        "parent-token",
      );
    });
  });

  it("lets a parent author a word-order question from reusable tokens", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Time clauses",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 2,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-word-order",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "word_order",
          prompt: "Put the words in the correct order.",
          options: ["tomorrow", "We", "will", "travel"],
          answer_key: { tokens: ["We", "will", "travel", "tomorrow"] },
          rubric: { grading_mode: "exact" },
          points: 2,
          knowledge_code: "manual-practice",
        },
      ],
    });

    render(<CreateWorkspace />);
    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Time clauses" },
    });
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "word_order" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Put the words in the correct order." },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "tomorrow\nWe\nwill\ntravel" },
    });

    for (const token of ["We", "will", "travel", "tomorrow"]) {
      fireEvent.click(screen.getByRole("button", { name: `Add ${token}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [
            expect.objectContaining({
              type: "word_order",
              options: ["tomorrow", "We", "will", "travel"],
              answer_key: {
                tokens: ["We", "will", "travel", "tomorrow"],
              },
            }),
          ],
        }),
        "parent-token",
      );
    });
  });

  it("keeps a parent-review guide when a parent creates a photo-answer question", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Paper calculation",
      subject: "Mathematics",
      locale: "en",
      question_count: 1,
      total_points: 2,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-photo-1234",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "photo",
          prompt: "Solve on paper, then take a clear photo of your work.",
          options: [],
          answer_key: { reference: "x = 4" },
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
      target: { value: "Paper calculation" },
    });
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "photo" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Solve on paper, then take a clear photo of your work." },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "x = 4" },
    });
    fireEvent.change(screen.getByLabelText("Points"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [
            expect.objectContaining({
              type: "photo",
              options: [],
              answer_key: { reference: "x = 4" },
              rubric: { grading_mode: "parent_review" },
              points: 2,
            }),
          ],
        }),
        "parent-token",
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

  it("lets a parent author a listening choice and attach its private audio during review", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Morning announcement",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-listening-preview",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "listening",
          prompt: "Listen and choose where the class will meet.",
          options: ["The library", "The gym"],
          answer_key: { choice: 0 },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "manual-practice",
          listening: {
            replay_limit: 2,
            transcript: "Please meet in the library after school.",
            transcript_policy: "after_submission",
          },
        },
      ],
    });
    mocks.createUploadIntent.mockResolvedValue({
      bucket: "audio",
      path: "family-1/audio/morning-announcement.mp3",
      upload_url: "fixture://audio-upload",
      expires_in: 300,
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "manual-listening-set",
      assignment_id: "manual-listening-assignment",
      status: "confirmed",
      reused_existing: false,
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Morning announcement" },
    });
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "listening" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Listen and choose where the class will meet." },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "The library\nThe gym" },
    });
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "The library" },
    });
    fireEvent.change(screen.getByLabelText("Maximum replays"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Transcript (optional)"), {
      target: { value: "Please meet in the library after school." },
    });
    fireEvent.change(screen.getByLabelText("When to show transcript"), {
      target: { value: "after_submission" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [
            expect.objectContaining({
              type: "listening",
              options: ["The library", "The gym"],
              answer_key: { choice: 0 },
              listening: {
                replay_limit: 2,
                transcript: "Please meet in the library after school.",
                transcript_policy: "after_submission",
              },
            }),
          ],
        }),
        "parent-token",
      );
    });
    expect(
      await screen.findByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Audio for question 1"), {
      target: {
        files: [
          new File(["audio"], "morning-announcement.mp3", {
            type: "audio/mpeg",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                type: "listening",
                listening: expect.objectContaining({
                  audio_path: "family-1/audio/morning-announcement.mp3",
                }),
              }),
            ],
          }),
        }),
        "parent-token",
        expect.stringContaining("manual-"),
      );
    });
  });

  it("lets a parent author a typed listening answer without choices", async () => {
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Library announcement",
      subject: "English",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "manual-listening-text-preview",
      source_summary: { source_kind: "manual" },
      questions: [
        {
          position: 1,
          type: "listening",
          prompt: "Listen and type the destination.",
          options: [],
          answer_key: { texts: ["the library", "library"] },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "manual-practice",
          listening: {
            replay_limit: 2,
            transcript: null,
            transcript_policy: "never",
          },
        },
      ],
    });

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(screen.getByRole("button", { name: "Start simple" }));
    fireEvent.change(screen.getByLabelText("Practice title"), {
      target: { value: "Library announcement" },
    });
    fireEvent.change(screen.getByLabelText("Response type"), {
      target: { value: "listening" },
    });
    fireEvent.change(screen.getByLabelText("Listening answer type"), {
      target: { value: "text" },
    });
    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Listen and type the destination." },
    });
    expect(screen.queryByLabelText("Choices, one per line")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Answer or grading guide"), {
      target: { value: "the library" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    await waitFor(() => {
      expect(mocks.previewStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [
            expect.objectContaining({
              type: "listening",
              options: [],
              answer_key: { text: "the library" },
            }),
          ],
        }),
        "parent-token",
      );
    });
  });

  it("uploads a private figure before assigning a question", async () => {
    const document = {
      schema_version: "1.0" as const,
      question_set: {
        title: "Diagram check",
        subject: "Mathematics",
        locale: "en" as const,
        difficulty: "standard" as const,
        source_mode: "convert" as const,
        estimated_minutes: 5,
      },
      knowledge_tags: [{ code: "difference-squares", label: "Difference of squares" }],
      questions: [
        {
          position: 1,
          type: "single_choice" as const,
          prompt: "Choose the expression shown in the diagram.",
          options: ["a² − b²", "a² + b²"],
          answer_key: { choice: 0 },
          rubric: { grading_mode: "exact" },
          points: 1,
          knowledge_code: "difference-squares",
        },
      ],
    };
    mocks.previewStructuredQuestionSet.mockResolvedValue({
      title: "Diagram check",
      subject: "Mathematics",
      locale: "en",
      question_count: 1,
      total_points: 1,
      estimated_minutes: 5,
      knowledge_tag_count: 1,
      answer_keys_present: true,
      checksum: "figure-preview",
      source_summary: {},
      questions: document.questions,
    });
    mocks.createUploadIntent.mockResolvedValue({
      bucket: "sources",
      path: "family-1/sources/difference-squares.png",
      upload_url: "fixture://figure-upload",
      expires_in: 300,
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.importStructuredQuestionSet.mockResolvedValue({
      question_set_id: "figure-set",
      assignment_id: "figure-assignment",
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
      target: { files: [new File([JSON.stringify(document)], "diagram.json")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview questions" }));
    await screen.findByRole("heading", { name: "Review before assigning" });
    fireEvent.change(screen.getByLabelText("Figure for question 1"), {
      target: { files: [new File(["image"], "diagram.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and assign" }));

    await waitFor(() => {
      expect(mocks.createUploadIntent).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "sources", content_type: "image/png" }),
        "parent-token",
        expect.stringContaining("question-figure-"),
      );
      expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
      expect(mocks.importStructuredQuestionSet).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            questions: [
              expect.objectContaining({
                figure: expect.objectContaining({
                  image_path: "family-1/sources/difference-squares.png",
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

  it("keeps selected completed-paper files and reuses their private upload session after a failed upload", async () => {
    mocks.createUploadIntent.mockImplementation((payload, _token, key) =>
      Promise.resolve({
        bucket: payload.bucket,
        path: `family-1/${payload.bucket}/${payload.filename}`,
        signed_url: `https://storage.example/${key}`,
      }),
    );
    mocks.uploadToSignedUrl.mockRejectedValueOnce(new Error("offline"));
    const completedWorksheetImport = {
      id: "completed-worksheet-retry",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      filenames: ["completed-paper.jpg"],
      response_paths: ["family-1/responses/completed-paper.jpg"],
    };
    mocks.createCompletedWorksheetImport.mockResolvedValue(completedWorksheetImport);
    mocks.getCompletedWorksheetImport.mockResolvedValue(completedWorksheetImport);

    render(<CreateWorkspace />);

    await screen.findByRole("combobox", { name: "Child" });
    fireEvent.click(
      screen.getByRole("button", { name: "Grade completed paper" }),
    );
    fireEvent.change(screen.getByLabelText("Completed worksheet scans"), {
      target: {
        files: [
          new File(["scan"], "completed-paper.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload for review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The upload paused. Your selected pages are still here",
    );
    expect(screen.getAllByText("completed-paper.jpg")).not.toHaveLength(0);
    expect(mocks.createCompletedWorksheetImport).not.toHaveBeenCalled();
    const firstUploadKey = mocks.createUploadIntent.mock.calls[0][2] as string;

    fireEvent.click(screen.getByRole("button", { name: "Upload for review" }));

    expect(
      await screen.findByRole("heading", { name: "Preparing the review draft" }),
    ).toBeInTheDocument();
    const retryUploadKey = mocks.createUploadIntent.mock.calls[1][2] as string;
    expect(retryUploadKey).toBe(firstUploadKey);
    expect(mocks.createCompletedWorksheetImport).toHaveBeenCalledWith(
      expect.any(Object),
      "parent-token",
      `completed-worksheet-${firstUploadKey.replace("completed-response-", "").replace(/-0$/, "")}`,
    );
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
    const completedWorksheetImport = {
      id: "completed-worksheet-1",
      status: "needs_review",
      assignment_id: null,
      attempt_id: null,
      filenames: ["completed-paper.jpg"],
      response_paths: ["family-1/completed-paper/responses-completed-paper.jpg"],
      response_preview_urls: [
        "https://storage.example.test/signed/completed-paper.jpg?short-lived=true",
      ],
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
    };
    mocks.createCompletedWorksheetImport.mockResolvedValue(completedWorksheetImport);
    mocks.getCompletedWorksheetImport.mockResolvedValue(completedWorksheetImport);
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
    expect(
      screen.getByLabelText("Answer area for question 1 on page 1"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide answer regions" }),
    );
    expect(
      screen.queryByLabelText("Answer area for question 1 on page 1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show answer regions" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Show answer regions" }),
    );
    expect(
      screen.getByLabelText("Answer area for question 1 on page 1"),
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
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start grading" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This upload has 1 page(s). Each answer page must be between 1 and 1.",
    );
    expect(mocks.confirmCompletedWorksheetImport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Answer page numbers for question 1"), {
      target: { value: "1" },
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
                page_numbers: [1],
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
