import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetWorkbench } from "@/components/worksheet-workbench";

const mocks = vi.hoisted(() => ({
  createChildUploadIntent: vi.fn(),
  createQuestionRetry: vi.fn(),
  getAttemptResults: vi.fn(),
  getAttemptWork: vi.fn(),
  getChildAssignments: vi.fn(),
  getQuestionGradingJob: vi.fn(),
  regradeQuestion: vi.fn(),
  recordListeningPlayback: vi.fn(),
  saveAttemptResponse: vi.fn(),
  startAssignment: vi.fn(),
  submitAttempt: vi.fn(),
  submitQuestion: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  cropAnswerImage: vi.fn(),
  rotateAnswerImage: vi.fn(),
  syncPendingDrafts: vi.fn(),
  getPendingDraftsByPrefix: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  createChildUploadIntent: mocks.createChildUploadIntent,
  createQuestionRetry: mocks.createQuestionRetry,
  getAttemptResults: mocks.getAttemptResults,
  getAttemptWork: mocks.getAttemptWork,
  getChildAccessToken: () => "child-token",
  getChildAssignments: mocks.getChildAssignments,
  getQuestionGradingJob: mocks.getQuestionGradingJob,
  regradeQuestion: mocks.regradeQuestion,
  recordListeningPlayback: mocks.recordListeningPlayback,
  saveAttemptResponse: mocks.saveAttemptResponse,
  startAssignment: mocks.startAssignment,
  submitAttempt: mocks.submitAttempt,
  submitQuestion: mocks.submitQuestion,
  uploadToSignedUrl: mocks.uploadToSignedUrl,
}));

vi.mock("@/lib/draft-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/draft-queue")>()),
  getPendingDraftsByPrefix: mocks.getPendingDraftsByPrefix,
  syncPendingDrafts: mocks.syncPendingDrafts,
}));

vi.mock("@/lib/photo-rotation", () => ({
  rotateAnswerImage: mocks.rotateAnswerImage,
}));

vi.mock("@/lib/photo-crop", () => ({
  cropAnswerImage: mocks.cropAnswerImage,
}));

const assignmentWork = {
  title: "Assigned mixed practice",
  assignment: {
    id: "assignment-1",
    family_id: "family-1",
    mode: "practice" as const,
    time_limit_seconds: null,
    status: "in_progress",
  },
  attempt: { id: "attempt-1", started_at: new Date().toISOString() },
  questions: [
    {
      id: "algebra-choice",
      position: 1,
      type: "single_choice" as const,
      prompt: "Choose the correct expansion of (a + b)(a − b).",
      options: ["a² − b²", "a² + b²", "a² − 2ab + b²"],
      points: 1,
    },
    {
      id: "english-fill",
      position: 2,
      type: "typed_text" as const,
      prompt: "Complete: She ___ to school every day.",
      options: null,
      points: 1,
    },
    {
      id: "algebra-proof",
      position: 3,
      type: "handwriting" as const,
      prompt: "Show why (a + b)(a − b) = a² − b².",
      options: null,
      points: 2,
    },
    {
      id: "math-photo",
      position: 4,
      type: "photo" as const,
      prompt: "Solve 3(x − 2) = 12 on paper, then photograph your work.",
      options: null,
      points: 2,
    },
    {
      id: "english-listening",
      position: 5,
      type: "listening" as const,
      prompt: "Listen and choose where the speaker goes every morning.",
      options: ["The library", "School", "The station"],
      points: 1,
    },
  ],
  responses: [],
  submitted_question_ids: [],
};

describe("WorksheetWorkbench", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((file: File) => `blob:preview/${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
    window.history.replaceState({}, "", "/child/work/?assignmentId=assignment-1");
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "en");
    mocks.createChildUploadIntent.mockReset();
    mocks.createChildUploadIntent.mockResolvedValue({
      bucket: "responses",
      path: "family-1/attempt-1/answer.png",
      upload_url: "https://storage.example.test/upload",
      expires_in: 300,
    });
    mocks.createQuestionRetry.mockReset();
    mocks.createQuestionRetry.mockResolvedValue({
      ...assignmentWork,
      attempt: {
        id: "retry-attempt-1",
        started_at: new Date().toISOString(),
      },
      questions: [assignmentWork.questions[2]],
      responses: [],
      submitted_question_ids: [],
    });
    mocks.getAttemptWork.mockReset();
    mocks.getAttemptWork.mockResolvedValue(assignmentWork);
    mocks.getChildAssignments.mockReset();
    mocks.getChildAssignments.mockResolvedValue([
      {
        id: "assignment-1",
        title: assignmentWork.title,
        status: "assigned",
        mode: "practice",
        time_limit_seconds: null,
        question_count: assignmentWork.questions.length,
        latest_attempt_id: null,
      },
    ]);
    mocks.getQuestionGradingJob.mockReset();
    mocks.getQuestionGradingJob.mockResolvedValue({
      id: "regrade-job-1",
      status: "succeeded",
    });
    mocks.regradeQuestion.mockReset();
    mocks.regradeQuestion.mockResolvedValue({
      attempt_id: "attempt-1",
      question_id: "algebra-proof",
      job: { id: "regrade-job-1", status: "queued" },
    });
    mocks.recordListeningPlayback.mockReset();
    mocks.recordListeningPlayback.mockResolvedValue({
      question_id: "english-listening",
      play_count: 1,
      replay_limit: 1,
      audio_url: "https://storage.example/private-listening-refreshed.mp3",
    });
    mocks.saveAttemptResponse.mockReset();
    mocks.saveAttemptResponse.mockResolvedValue({ version: 1 });
    mocks.startAssignment.mockReset();
    mocks.startAssignment.mockResolvedValue(assignmentWork);
    mocks.submitQuestion.mockReset();
    mocks.submitQuestion.mockResolvedValue({
      question_id: "algebra-choice",
      job: { id: "job-1", status: "queued" },
    });
    mocks.submitAttempt.mockReset();
    mocks.submitAttempt.mockResolvedValue({
      job: { id: "job-all", status: "queued" },
    });
    mocks.getAttemptResults.mockReset();
    mocks.getAttemptResults.mockResolvedValue({
      attempt_id: "attempt-1",
      complete: false,
      results: [
        {
          id: "result-1",
          question_id: "algebra-choice",
          outcome: "correct",
          awarded_points: 1,
          confidence: 0.99,
          feedback: { summary: "Correct." },
        },
      ],
    });
    mocks.uploadToSignedUrl.mockReset();
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
    mocks.rotateAnswerImage.mockReset();
    mocks.rotateAnswerImage.mockResolvedValue(
      new File(["rotated"], "answer-page-rotated-90.jpg", {
        type: "image/jpeg",
      }),
    );
    mocks.cropAnswerImage.mockReset();
    mocks.cropAnswerImage.mockResolvedValue(
      new File(["cropped"], "answer-page-cropped.jpg", {
        type: "image/jpeg",
      }),
    );
    mocks.syncPendingDrafts.mockReset();
    mocks.syncPendingDrafts.mockResolvedValue(0);
    mocks.getPendingDraftsByPrefix.mockReset();
    mocks.getPendingDraftsByPrefix.mockResolvedValue([]);
  });

  it("autosaves an answer and lets the child move to the next question", async () => {
    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "a² − b²" }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    expect(
      screen.getByRole("heading", {
        name: "Complete: She ___ to school every day.",
      }),
    ).toBeInTheDocument();
  });

  it("keeps an autosave queued when the child moves to another question", async () => {
    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "a² − b²" }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.change(
      await screen.findByLabelText("Your answer"),
      { target: { value: "goes" } },
    );

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        "algebra-choice",
        expect.objectContaining({ answer: { choices: [0] } }),
        "child-token",
      );
      expect(mocks.saveAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        "english-fill",
        expect.objectContaining({ answer: { text: "goes" } }),
        "child-token",
      );
    });
  });

  it("restores an answer saved on this device when the same practice is reopened", async () => {
    mocks.getPendingDraftsByPrefix.mockResolvedValueOnce([
      {
        key: "attempt-1:english-fill",
        answer: { text: "goes" },
        syncRequest: {
          attemptId: "attempt-1",
          questionId: "english-fill",
          payload: {
            kind: "text",
            answer: { text: "goes" },
            expected_version: 0,
          },
        },
        savedAt: "2026-08-03T00:00:00.000Z",
        expiresAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Your answer")).toHaveValue("goes");
      expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    });
  });

  it("lets a child reorder or remove selected sentence words before saving", async () => {
    mocks.startAssignment.mockResolvedValueOnce({
      ...assignmentWork,
      questions: [
        {
          id: "word-order",
          position: 1,
          type: "word_order" as const,
          prompt: "Put the words in order.",
          options: ["She", "school.", "walks", "to"],
          points: 1,
        },
      ],
    });

    render(<WorksheetWorkbench />);

    await screen.findByRole("heading", { name: "Put the words in order." });
    for (const token of ["She", "school.", "walks", "to"]) {
      fireEvent.click(screen.getByRole("button", { name: token }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Move school. earlier" }));
    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "word-order",
        expect.objectContaining({
          answer: { tokens: ["school.", "She", "walks", "to"] },
        }),
        "child-token",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove school." }));
    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "word-order",
        expect.objectContaining({
          answer: { tokens: ["She", "walks", "to"] },
        }),
        "child-token",
      );
    });
  });

  it("serializes consecutive word-order saves with the latest response version", async () => {
    mocks.startAssignment.mockResolvedValueOnce({
      ...assignmentWork,
      questions: [
        {
          id: "word-order",
          position: 1,
          type: "word_order" as const,
          prompt: "Put the words in order.",
          options: ["She", "school.", "walks", "to"],
          points: 1,
        },
      ],
    });
    let resolveFirstSave: ((value: { version: number }) => void) | undefined;
    const firstSave = new Promise<{ version: number }>((resolve) => {
      resolveFirstSave = resolve;
    });
    mocks.saveAttemptResponse
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ version: 2 });

    render(<WorksheetWorkbench />);

    await screen.findByRole("heading", { name: "Put the words in order." });
    for (const token of ["She", "school.", "walks", "to"]) {
      fireEvent.click(screen.getByRole("button", { name: token }));
    }
    await waitFor(() => expect(mocks.saveAttemptResponse).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Move school. earlier" }));
    resolveFirstSave?.({ version: 1 });

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenNthCalledWith(
        2,
        "attempt-1",
        "word-order",
        expect.objectContaining({
          answer: { tokens: ["school.", "She", "walks", "to"] },
          expected_version: 1,
        }),
        "child-token",
      );
    });
  });

  it("typesets imported mathematics in the child question surface", async () => {
    mocks.startAssignment.mockResolvedValueOnce({
      ...assignmentWork,
      questions: [
        {
          ...assignmentWork.questions[0],
          prompt: "Factorise \\(x^2 - 16\\).",
        },
      ],
    });

    render(<WorksheetWorkbench />);

    expect(await screen.findByText("Factorise", { exact: false })).toBeInTheDocument();
    expect(document.querySelector(".question-card .math-text-inline .katex")).toBeInTheDocument();
  });

  it("opens a private question figure at a readable size", async () => {
    mocks.startAssignment.mockResolvedValueOnce({
      ...assignmentWork,
      questions: [
        {
          ...assignmentWork.questions[0],
          figure: {
            image_url: "https://storage.example.test/question-figure.png",
            alt_text: "A difference of squares diagram",
          },
        },
      ],
    });

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("img", {
        name: "A difference of squares diagram",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand figure" }));

    expect(
      screen.getByRole("dialog", { name: "Question figure" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("img", {
        name: "A difference of squares diagram",
      }),
    ).toHaveAttribute(
      "src",
      "https://storage.example.test/question-figure.png",
    );
  });

  it("lets a child manually retry syncing a locally saved answer", async () => {
    mocks.saveAttemptResponse.mockRejectedValueOnce(new Error("offline"));
    mocks.syncPendingDrafts.mockResolvedValue(0);

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    expect(
      await screen.findByText("Saved on this device"),
    ).toBeInTheDocument();

    mocks.syncPendingDrafts.mockResolvedValue(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Sync saved answer" }),
    );

    expect(await screen.findByText("Saved", { exact: true })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.syncPendingDrafts.mock.calls.at(-1)?.[0]).toBe("child-token");
    });
  });

  it("uses the reconnected draft's server version for the next autosave", async () => {
    const reconnectedRequest = {
      attemptId: "attempt-1",
      questionId: "algebra-choice",
      payload: {
        kind: "choice" as const,
        answer: { choices: [0] },
        expected_version: 0,
      },
    };
    mocks.saveAttemptResponse.mockRejectedValueOnce(new Error("offline"));
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    await screen.findByText("Saved on this device");
    mocks.syncPendingDrafts.mockImplementationOnce(
      async (_token, _now, onSynced) => {
        onSynced?.(reconnectedRequest, 4);
        return 1;
      },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sync saved answer" }),
    );
    await screen.findByText("Saved", { exact: true });
    fireEvent.click(screen.getByRole("radio", { name: "a² + b²" }));

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "algebra-choice",
        { kind: "choice", answer: { choices: [1] }, expected_version: 4 },
        "child-token",
      );
    });
  });

  it("keeps the device-only state if background sync fails after reconnecting", async () => {
    render(<WorksheetWorkbench />);

    await screen.findByRole("heading", {
      name: "Choose the correct expansion of (a + b)(a − b).",
    });
    mocks.syncPendingDrafts.mockRejectedValueOnce(new Error("offline"));

    window.dispatchEvent(new Event("online"));

    expect(
      await screen.findByText("Saved on this device"),
    ).toBeInTheDocument();
  });

  it("retries loading the assigned work after a transient request failure", async () => {
    mocks.startAssignment
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(assignmentWork);

    render(<WorksheetWorkbench />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not open this practice.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();
    expect(mocks.startAssignment).toHaveBeenCalledTimes(2);
  });

  it("uses the parent-selected exam timer and does not let the child change it", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      assignment: {
        ...assignmentWork.assignment,
        mode: "exam",
        time_limit_seconds: 900,
      },
      attempt: {
        ...assignmentWork.attempt,
        started_at: new Date(Date.now() - 121_000).toISOString(),
      },
    });

    render(<WorksheetWorkbench />);

    expect(await screen.findByText(/^12:/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^12:/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps an expired exam on this device when an answer is still unsynced", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      assignment: {
        ...assignmentWork.assignment,
        mode: "exam",
        time_limit_seconds: 1,
      },
      attempt: {
        ...assignmentWork.attempt,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      },
    });
    mocks.getPendingDraftsByPrefix.mockResolvedValue([
      {
        key: "attempt-1:algebra-choice",
        answer: { choices: [0] },
        savedAt: "2026-08-03T00:00:00.000Z",
        expiresAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    render(<WorksheetWorkbench />);

    expect(await screen.findByText("Saved on this device")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Time is up. Your answers are saved on this device and will submit when a connection returns.",
      ),
    ).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(mocks.submitAttempt).not.toHaveBeenCalled();
  });

  it("automatically submits an expired exam once its device-only answer reconnects", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      assignment: {
        ...assignmentWork.assignment,
        mode: "exam",
        time_limit_seconds: 1,
      },
      attempt: {
        ...assignmentWork.attempt,
        started_at: new Date(Date.now() - 10_000).toISOString(),
      },
    });
    mocks.getPendingDraftsByPrefix.mockResolvedValue([
      {
        key: "attempt-1:algebra-choice",
        answer: { choices: [0] },
        savedAt: "2026-08-03T00:00:00.000Z",
        expiresAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    render(<WorksheetWorkbench />);

    expect(await screen.findByText("Saved on this device")).toBeInTheDocument();
    mocks.getPendingDraftsByPrefix.mockResolvedValue([]);
    mocks.syncPendingDrafts.mockResolvedValue(1);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      expect(mocks.submitAttempt).toHaveBeenCalledWith(
        "attempt-1",
        "child-token",
        "submit-attempt-1-time-limit",
      );
    });
  });

  it("plays private listening audio only after the server records a replay", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      questions: assignmentWork.questions.map((question) =>
        question.id === "english-listening"
          ? {
              ...question,
              listening: {
                audio_url: null,
                replay_limit: 1,
                play_count: 0,
                transcript: null,
              },
            }
          : question,
      ),
    });

    render(<WorksheetWorkbench />);
    await screen.findByRole("heading", {
      name: "Choose the correct expansion of (a + b)(a − b).",
    });
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    }

    const playButton = await screen.findByRole("button", {
      name: "Play at 0.85×",
    });
    expect(document.querySelector("audio")).not.toHaveAttribute("src");
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mocks.recordListeningPlayback).toHaveBeenCalledWith(
        "attempt-1",
        "english-listening",
        "child-token",
      );
    });
    expect(play).toHaveBeenCalled();
    await waitFor(() => expect(playButton).toBeDisabled());
    expect(document.querySelector("audio")).toHaveAttribute(
      "src",
      "https://storage.example/private-listening-refreshed.mp3",
    );
  });

  it("saves a typed answer for a listening question without choices", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      questions: [
        {
          id: "listening-text",
          position: 1,
          type: "listening",
          prompt: "Listen and type the destination.",
          options: [],
          points: 1,
          listening: {
            audio_url: null,
            replay_limit: 2,
            play_count: 0,
            transcript: null,
          },
        },
      ],
    });

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Listen and type the destination.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "The library" },
    });

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        "listening-text",
        { kind: "text", answer: { text: "The library" }, expected_version: 0 },
        "child-token",
      );
    });
  });

  it("submits only the current answer and keeps the rest of the attempt open", async () => {
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    await screen.findByText("Saved");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit this answer for grading",
      }),
    );
    expect(
      screen.getByText(
        "Only question 1 will be submitted. You can continue the other questions, but this answer cannot be changed.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm single-answer submission",
      }),
    );

    await waitFor(() => {
      expect(mocks.submitQuestion).toHaveBeenCalledWith(
        "attempt-1",
        "algebra-choice",
        "child-token",
        "submit-attempt-1-algebra-choice",
      );
    });
    expect(await screen.findByText("Correct.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "This answer has been submitted",
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(
      screen.getByRole("heading", {
        name: "Complete: She ___ to school every day.",
      }),
    ).toBeInTheDocument();
  });

  it("lets a child refresh an unavailable single-question grading result without submitting it again", async () => {
    mocks.getAttemptResults.mockRejectedValueOnce(
      new Error("temporary grading result failure"),
    );
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    await screen.findByText("Saved");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit this answer for grading",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm single-answer submission",
      }),
    );

    expect(
      await screen.findByText(
        "We could not check the grading status. Your submitted answer is safe.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check grading status" }),
    );

    expect(await screen.findByText("Correct.")).toBeInTheDocument();
    expect(mocks.submitQuestion).toHaveBeenCalledTimes(1);
  });

  it("lets a child refresh grading status after reopening a submitted answer whose first result read fails", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      submitted_question_ids: ["algebra-choice"],
    });
    mocks.getAttemptResults.mockRejectedValueOnce(
      new Error("temporary reopened result failure"),
    );
    render(<WorksheetWorkbench />);

    expect(
      await screen.findByText(
        "We could not check the grading status. Your submitted answer is safe.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check grading status" }),
    );

    expect(await screen.findByText("Correct.")).toBeInTheDocument();
    expect(mocks.submitQuestion).not.toHaveBeenCalled();
  });

  it("does not submit one answer for grading while its device-only draft remains unsynced", async () => {
    mocks.saveAttemptResponse.mockRejectedValueOnce(new Error("offline"));
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    await screen.findByText("Saved on this device");
    mocks.syncPendingDrafts.mockResolvedValue(0);
    mocks.getPendingDraftsByPrefix.mockResolvedValue([
      {
        key: "attempt-1:algebra-choice",
        answer: { choices: [0] },
        syncRequest: {
          attemptId: "attempt-1",
          questionId: "algebra-choice",
          payload: {
            kind: "choice",
            answer: { choices: [0] },
            expected_version: 0,
          },
        },
        savedAt: "2026-08-03T00:00:00.000Z",
        expiresAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Submit this answer for grading" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm single-answer submission" }),
    );

    expect(
      await screen.findByText("Saved on this device"),
    ).toBeInTheDocument();
    expect(mocks.submitQuestion).not.toHaveBeenCalled();
  });

  it("localizes the post-grading action instead of showing the API fallback language", async () => {
    window.localStorage.setItem("luma-language:demo-child", "ja");
    mocks.getAttemptResults.mockResolvedValue({
      attempt_id: "attempt-1",
      complete: false,
      results: [
        {
          id: "result-1",
          question_id: "algebra-choice",
          outcome: "correct",
          awarded_points: 1,
          confidence: 0.99,
          feedback: {
            summary: "正解です。",
            action: "Continue to the next question.",
          },
        },
      ],
    });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "a² − b²" }),
    );
    await screen.findByText("保存済み");
    fireEvent.click(
      screen.getByRole("button", {
        name: "この答えだけ採点に出す",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "1問だけ提出する",
      }),
    );

    expect(
      await screen.findByText("次の問題へ進んでください。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Continue to the next question."),
    ).not.toBeInTheDocument();
  });

  it("warns that unanswered questions become incorrect before full submission", async () => {
    render(<WorksheetWorkbench />);

    await screen.findByRole("heading", {
      name: "Choose the correct expansion of (a + b)(a − b).",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit all answers" }),
    );
    expect(
      screen.getByText(
        "5 unanswered questions will be marked incorrect. No answer can be changed after the entire practice is submitted.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm full submission" }),
    );
    await waitFor(() => {
      expect(mocks.submitAttempt).toHaveBeenCalledWith(
        "attempt-1",
        "child-token",
        "submit-attempt-1-completed",
      );
    });
  });

  it("does not submit the whole practice while a device-only answer remains unsynced", async () => {
    render(<WorksheetWorkbench />);

    await screen.findByRole("heading", {
      name: "Choose the correct expansion of (a + b)(a − b).",
    });
    mocks.syncPendingDrafts.mockResolvedValue(0);
    mocks.getPendingDraftsByPrefix.mockResolvedValue([
      {
        key: "attempt-1:algebra-choice",
        answer: { choices: [0] },
        syncRequest: {
          attemptId: "attempt-1",
          questionId: "algebra-choice",
          payload: {
            kind: "choice",
            answer: { choices: [0] },
            expected_version: 0,
          },
        },
        savedAt: "2026-08-03T00:00:00.000Z",
        expiresAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Submit all answers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm full submission" }),
    );

    expect(
      await screen.findByText("Saved on this device"),
    ).toBeInTheDocument();
    expect(mocks.submitAttempt).not.toHaveBeenCalled();
  });

  it("keeps multiple response photos in the selected shooting order", async () => {
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );

    const answerInput = screen.getByLabelText(
      /Take a photo or choose images/,
    );
    const answerPage = new File(["answer"], "answer-page.jpg", {
      type: "image/jpeg",
    });
    const draftPage = new File(["draft"], "draft-page.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(answerInput, {
      target: { files: [answerPage, draftPage] },
    });

    const uploadedImages = await screen.findByRole("list", {
      name: "Uploaded answer images",
    });
    expect(
      within(uploadedImages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".photo-file-name")?.textContent),
    ).toEqual(["1. answer-page.jpg", "2. draft-page.jpg"]);
    expect(
      screen.getByRole("img", { name: "Preview: answer-page.jpg" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Preview: draft-page.jpg" }),
    ).toBeInTheDocument();
    await screen.findByText("Saved");
    expect(
      screen.getByLabelText("Add more answer images"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Move answer-page.jpg later" }),
    );
    expect(
      within(uploadedImages)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".photo-file-name")?.textContent),
    ).toEqual(["1. draft-page.jpg", "2. answer-page.jpg"]);
    expect(
      within(uploadedImages)
        .getAllByRole("img")
        .map((image) => image.getAttribute("alt")),
    ).toEqual(["Preview: draft-page.jpg", "Preview: answer-page.jpg"]);
    await screen.findByText("Saved");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove draft-page.jpg" }),
    );
    expect(
      within(uploadedImages).getByRole("listitem"),
    ).toHaveTextContent("1. answer-page.jpg");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:preview/draft-page.jpg",
    );
    expect(
      screen.queryByRole("button", { name: "Remove draft-page.jpg" }),
    ).not.toBeInTheDocument();
  });

  it("warns before submission when a response photo is probably too small to grade", async () => {
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["x"], "tiny-answer.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    expect(
      await screen.findByText(
        "This image may be too small to read clearly. Retake it if the preview is blurry.",
      ),
    ).toBeInTheDocument();
    expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
  });

  it("locks additional photo selection until the current ordered upload finishes", async () => {
    let finishUpload: (() => void) | undefined;
    mocks.uploadToSignedUrl.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUpload = resolve;
        }),
    );
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    const answerInput = screen.getByLabelText(/Take a photo or choose images/);
    fireEvent.change(answerInput, {
      target: {
        files: [
          new File(["first"], "first-answer.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());
    expect(answerInput).toBeDisabled();
    expect(screen.getByText("Uploading answer images…")).toBeInTheDocument();

    finishUpload?.();

    await waitFor(() => expect(answerInput).not.toBeDisabled());
  });

  it("keeps a failed answer-photo upload out of the answer until the child retries it", async () => {
    mocks.uploadToSignedUrl
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["answer"], "retry-answer.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    expect(
      await screen.findByText(
        "1 answer image could not be uploaded. Retry it before submitting.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Uploaded answer images" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit all answers" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(/Take a photo or choose images/),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry failed uploads" }),
    );

    await waitFor(() => {
      expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole("list", { name: "Uploaded answer images" }),
    ).toHaveTextContent("retry-answer.jpg");
    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: { paths: ["family-1/attempt-1/answer.png"] },
          expected_version: 0,
        },
        "child-token",
      );
    });
  });

  it("keeps successful photos when a later photo upload fails, then retries only the failed file", async () => {
    mocks.createChildUploadIntent
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/first-answer.jpg",
        upload_url: "https://storage.example.test/upload/first",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/second-answer.jpg",
        upload_url: "https://storage.example.test/upload/second",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/second-answer-retry.jpg",
        upload_url: "https://storage.example.test/upload/second-retry",
        expires_in: 300,
      });
    mocks.uploadToSignedUrl
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["first"], "first-answer.jpg", { type: "image/jpeg" }),
          new File(["second"], "second-answer.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    expect(
      await screen.findByText(
        "1 answer image could not be uploaded. Retry it before submitting.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Uploaded answer images" }),
    ).toHaveTextContent("first-answer.jpg");
    expect(
      screen.getByRole("list", { name: "Uploaded answer images" }),
    ).not.toHaveTextContent("second-answer.jpg");

    fireEvent.click(
      screen.getByRole("button", { name: "Retry failed uploads" }),
    );

    await waitFor(() => {
      expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(3);
    });
    expect(
      await screen.findByRole("list", { name: "Uploaded answer images" }),
    ).toHaveTextContent("second-answer.jpg");
    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: {
            paths: [
              "family-1/attempt-1/first-answer.jpg",
              "family-1/attempt-1/second-answer-retry.jpg",
            ],
          },
          expected_version: 0,
        },
        "child-token",
      );
    });
    expect(
      screen.getByRole("button", { name: "Submit all answers" }),
    ).not.toBeDisabled();
  });

  it("replaces one uploaded response photo without overwriting the original object", async () => {
    mocks.createChildUploadIntent
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/original-answer.jpg",
        upload_url: "https://storage.example.test/upload/original",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/replacement-answer.jpg",
        upload_url: "https://storage.example.test/upload/replacement",
        expires_in: 300,
      });
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["original"], "original-answer.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    await screen.findByLabelText("Replace original-answer.jpg");
    await screen.findByText("Saved");

    fireEvent.change(
      screen.getByLabelText("Replace original-answer.jpg"),
      {
        target: {
          files: [
            new File(["replacement"], "replacement-answer.jpg", {
              type: "image/jpeg",
            }),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: {
            paths: ["family-1/attempt-1/replacement-answer.jpg"],
          },
          expected_version: 1,
        },
        "child-token",
      );
    });
    expect(mocks.uploadToSignedUrl).toHaveBeenLastCalledWith(
      {
        bucket: "responses",
        path: "family-1/attempt-1/replacement-answer.jpg",
        upload_url: "https://storage.example.test/upload/replacement",
        expires_in: 300,
      },
      expect.objectContaining({ name: "replacement-answer.jpg" }),
    );
  });

  it("keeps a failed replacement photo ready to retry without changing the original", async () => {
    mocks.createChildUploadIntent
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/original-answer.jpg",
        upload_url: "https://storage.example.test/upload/original",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/replacement-answer.jpg",
        upload_url: "https://storage.example.test/upload/replacement",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/replacement-answer-retry.jpg",
        upload_url: "https://storage.example.test/upload/replacement-retry",
        expires_in: 300,
      });
    mocks.uploadToSignedUrl
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["original"], "original-answer.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    await screen.findByLabelText("Replace original-answer.jpg");
    await screen.findByText("Saved");

    fireEvent.change(
      screen.getByLabelText("Replace original-answer.jpg"),
      {
        target: {
          files: [
            new File(["replacement"], "replacement-answer.jpg", {
              type: "image/jpeg",
            }),
          ],
        },
      },
    );

    expect(
      await screen.findByText(
        "The replacement image could not be uploaded. Retry it or keep the original image.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Uploaded answer images" }),
    ).toHaveTextContent("original-answer.jpg");
    expect(
      screen.getByRole("list", { name: "Uploaded answer images" }),
    ).not.toHaveTextContent("replacement-answer.jpg");
    expect(
      screen.getByRole("button", { name: "Submit all answers" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry replacement upload" }),
    );

    await waitFor(() => {
      expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: {
            paths: [
              "family-1/attempt-1/replacement-answer-retry.jpg",
            ],
          },
          expected_version: 1,
        },
        "child-token",
      );
    });
    expect(
      await screen.findByRole("list", { name: "Uploaded answer images" }),
    ).toHaveTextContent("replacement-answer.jpg");
    expect(
      screen.queryByText(
        "The replacement image could not be uploaded. Retry it or keep the original image.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit all answers" }),
    ).not.toBeDisabled();
  });

  it("rotates an uploaded response photo into a new private answer object", async () => {
    mocks.createChildUploadIntent
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/original-answer.jpg",
        upload_url: "https://storage.example.test/upload/original",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/answer-page-rotated-90.jpg",
        upload_url: "https://storage.example.test/upload/rotated",
        expires_in: 300,
      });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["original"], "original-answer.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    await screen.findByRole("button", {
      name: "Rotate original-answer.jpg clockwise",
    });
    await screen.findByText("Saved");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Rotate original-answer.jpg clockwise",
      }),
    );

    await waitFor(() => {
      expect(mocks.rotateAnswerImage).toHaveBeenCalledWith(
        "blob:preview/original-answer.jpg",
        "original-answer.jpg",
      );
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: {
            paths: ["family-1/attempt-1/answer-page-rotated-90.jpg"],
          },
          expected_version: 1,
        },
        "child-token",
      );
    });

    expect(
      mocks.uploadToSignedUrl,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        upload_url: "https://storage.example.test/upload/rotated",
      }),
      expect.objectContaining({ name: "answer-page-rotated-90.jpg" }),
    );
  });

  it("crops an uploaded response photo into a new private answer object", async () => {
    mocks.createChildUploadIntent
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/original-answer.jpg",
        upload_url: "https://storage.example.test/upload/original",
        expires_in: 300,
      })
      .mockResolvedValueOnce({
        bucket: "responses",
        path: "family-1/attempt-1/answer-page-cropped.jpg",
        upload_url: "https://storage.example.test/upload/cropped",
        expires_in: 300,
      });

    render(<WorksheetWorkbench />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );
    fireEvent.change(screen.getByLabelText(/Take a photo or choose images/), {
      target: {
        files: [
          new File(["original"], "original-answer.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    await screen.findByRole("button", { name: "Crop original-answer.jpg" });
    await screen.findByText("Saved");

    fireEvent.click(
      screen.getByRole("button", { name: "Crop original-answer.jpg" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Crop answer image" });
    fireEvent.change(within(dialog).getByLabelText("Trim top"), {
      target: { value: "10" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save crop" }));

    await waitFor(() => {
      expect(mocks.cropAnswerImage).toHaveBeenCalledWith(
        "blob:preview/original-answer.jpg",
        "original-answer.jpg",
        { bottom: 0, left: 0, right: 0, top: 0.1 },
      );
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: {
            paths: ["family-1/attempt-1/answer-page-cropped.jpg"],
          },
          expected_version: 1,
        },
        "child-token",
      );
    });

    expect(mocks.uploadToSignedUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        upload_url: "https://storage.example.test/upload/cropped",
      }),
      expect.objectContaining({ name: "answer-page-cropped.jpg" }),
    );
  });

  it("clears the previous practice while browser navigation opens another attempt", async () => {
    let resolveSecondAttempt!: (work: typeof assignmentWork) => void;
    const secondAttempt = {
      ...assignmentWork,
      title: "Second assigned practice",
      attempt: { id: "attempt-2", started_at: new Date().toISOString() },
      questions: [
        {
          ...assignmentWork.questions[1],
          id: "second-fill",
          prompt: "Complete: They ___ ready.",
        },
      ],
    };
    const secondAttemptRequest = new Promise<typeof assignmentWork>((resolve) => {
      resolveSecondAttempt = resolve;
    });
    mocks.getAttemptWork.mockImplementation((attemptId: string) =>
      attemptId === "attempt-2" ? secondAttemptRequest : Promise.resolve(assignmentWork),
    );

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();

    window.history.pushState({}, "", "/child/work/?attemptId=attempt-2");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(
      await screen.findByRole("heading", {
        name: "Opening your assigned practice…",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.getAttemptWork).toHaveBeenCalledWith("attempt-2", "child-token");

    resolveSecondAttempt(secondAttempt);

    expect(
      await screen.findByRole("heading", { name: "Complete: They ___ ready." }),
    ).toBeInTheDocument();
  });

  it("persists removing the final response photo as an empty photo answer", async () => {
    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );

    const answerPage = new File(["answer"], "answer-page.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(
      screen.getByLabelText(/Take a photo or choose images/),
      { target: { files: [answerPage] } },
    );
    await screen.findByRole("button", { name: "Remove answer-page.jpg" });
    await screen.findByText("Saved");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove answer-page.jpg" }),
    );

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenLastCalledWith(
        "attempt-1",
        "math-photo",
        {
          kind: "photo",
          answer: { paths: [] },
          expected_version: 1,
        },
        "child-token",
      );
    });
  });

  it("restores signed private response-photo previews after reopening work", async () => {
    const reopenedWork = {
      ...assignmentWork,
      responses: [
        {
          id: "response-photo-1",
          question_id: "math-photo",
          kind: "photo",
          answer: {
            paths: [
              "family-1/attempt-1/first-page.jpg",
              "family-1/attempt-1/second-page.jpg",
            ],
          },
          photo_urls: [
            "https://storage.example.test/signed/first-page",
            "https://storage.example.test/signed/second-page",
          ],
          version: 2,
        },
      ],
    };
    mocks.getAttemptWork.mockResolvedValue(reopenedWork);
    window.history.replaceState({}, "", "/child/work/?attemptId=attempt-1");

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 4" }),
    );

    const uploadedImages = await screen.findByRole("list", {
      name: "Uploaded answer images",
    });
    expect(
      within(uploadedImages).getAllByRole("img").map((image) => image.getAttribute("src")),
    ).toEqual([
      "https://storage.example.test/signed/first-page",
      "https://storage.example.test/signed/second-page",
    ]);
    expect(mocks.getAttemptWork).toHaveBeenCalledWith("attempt-1", "child-token");
  });

  it("restores and resaves an expanded handwriting canvas", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      responses: [
        {
          id: "response-1",
          question_id: "algebra-proof",
          kind: "strokes",
          answer: {
            strokes: [
              {
                points: [
                  { x: 20, y: 30, pressure: 0.5 },
                  { x: 80, y: 90, pressure: 0.5 },
                ],
                width: 2.5,
                eraser: false,
              },
            ],
            canvas_size: { width: 1200, height: 700 },
          },
          version: 3,
        },
      ],
    });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 3" }),
    );
    const canvas = screen.getByLabelText("Handwriting answer area");
    expect(canvas).toHaveAttribute("width", "1200");
    expect(canvas).toHaveAttribute("height", "700");

    fireEvent.click(
      screen.getByRole("button", { name: "Add space below" }),
    );

    await waitFor(() => {
      expect(mocks.saveAttemptResponse).toHaveBeenCalledWith(
        "attempt-1",
        "algebra-proof",
        {
          kind: "strokes",
          answer: {
            strokes: expect.any(Array),
            canvas_size: { width: 1200, height: 980 },
          },
          expected_version: 3,
        },
        "child-token",
      );
    });
  });

  it("renders the AI red markup over a submitted handwriting answer", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      submitted_question_ids: ["algebra-proof"],
      responses: [
        {
          id: "response-1",
          question_id: "algebra-proof",
          kind: "strokes",
          answer: {
            strokes: [
              {
                points: [
                  { x: 20, y: 30, pressure: 0.5 },
                  { x: 80, y: 90, pressure: 0.5 },
                ],
                width: 2.5,
                eraser: false,
              },
            ],
            canvas_size: { width: 900, height: 420 },
          },
          version: 3,
        },
      ],
    });
    mocks.getAttemptResults.mockResolvedValue({
      attempt_id: "attempt-1",
      complete: false,
      results: [
        {
          id: "result-proof",
          question_id: "algebra-proof",
          outcome: "incorrect",
          awarded_points: 0,
          confidence: 0.96,
          feedback: {
            summary: "The last algebra term is incorrect.",
            annotations: [
              {
                kind: "box",
                x: 0.55,
                y: 0.4,
                width: 0.2,
                height: 0.16,
                label: "Check this term.",
              },
            ],
          },
        },
      ],
    });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 3" }),
    );

    expect(await screen.findByText("Check this term.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear handwriting" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This submitted answer is locked. Use Clear and redo this question below to make a new answer.",
      ),
    ).toBeInTheDocument();
  });

  it("lets a child clear and redo a submitted handwriting answer while grading is pending", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      submitted_question_ids: ["algebra-proof"],
      responses: [
        {
          id: "response-1",
          question_id: "algebra-proof",
          kind: "strokes",
          answer: {
            strokes: [
              {
                points: [
                  { x: 20, y: 30, pressure: 0.5 },
                  { x: 80, y: 90, pressure: 0.5 },
                ],
                width: 2.5,
                eraser: false,
              },
            ],
            canvas_size: { width: 900, height: 420 },
          },
          version: 1,
        },
      ],
    });
    mocks.getAttemptResults.mockResolvedValue({
      attempt_id: "attempt-1",
      complete: false,
      results: [],
    });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 3" }),
    );

    expect(
      screen.getByRole("button", { name: "Clear handwriting" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Clear and redo this question",
      }),
    ).toBeEnabled();
  });

  it("regrades the same locked answer and replaces stale feedback", async () => {
    window.localStorage.setItem("luma-language:demo-child", "zh");
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      submitted_question_ids: ["algebra-proof"],
      responses: [
        {
          id: "response-1",
          question_id: "algebra-proof",
          kind: "strokes",
          answer: {
            strokes: [
              {
                points: [
                  { x: 20, y: 30, pressure: 0.5 },
                  { x: 80, y: 90, pressure: 0.5 },
                ],
                width: 2.5,
                eraser: false,
              },
            ],
            canvas_size: { width: 900, height: 420 },
          },
          version: 3,
        },
      ],
    });
    mocks.getAttemptResults
      .mockResolvedValueOnce({
        attempt_id: "attempt-1",
        complete: false,
        results: [
          {
            id: "result-proof",
            question_id: "algebra-proof",
            outcome: "needs_parent_review",
            awarded_points: null,
            confidence: 0.72,
            feedback: {
              summary: "A parent review is needed.",
              annotations: [],
            },
          },
        ],
      })
      .mockResolvedValue({
        attempt_id: "attempt-1",
        complete: false,
        results: [
          {
            id: "result-proof",
            question_id: "algebra-proof",
            outcome: "incorrect",
            awarded_points: 0,
            confidence: 0.94,
            feedback: {
              summary: "句子中缺少必要的目的地。",
              annotations: [],
            },
          },
        ],
      });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "前往第 3 题" }),
    );
    expect(
      await screen.findByText("A parent review is needed."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "保留答案并重新评判",
      }),
    );

    await waitFor(() => {
      expect(mocks.regradeQuestion).toHaveBeenCalledWith(
        "attempt-1",
        "algebra-proof",
        "child-token",
        expect.stringMatching(/^regrade-attempt-1-algebra-proof-/),
      );
    });
    expect(mocks.getQuestionGradingJob).toHaveBeenCalledWith(
      "attempt-1",
      "algebra-proof",
      "regrade-job-1",
      "child-token",
    );
    expect(
      await screen.findByText("句子中缺少必要的目的地。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A parent review is needed."),
    ).not.toBeInTheDocument();
    expect(mocks.createQuestionRetry).not.toHaveBeenCalled();
    expect(window.location.search).toContain("attemptId=attempt-1");
    expect(
      screen.getByRole("button", { name: "清除手写内容" }),
    ).toBeDisabled();
  });

  it("clears one graded answer into a new attempt and can request review again", async () => {
    mocks.startAssignment.mockResolvedValue({
      ...assignmentWork,
      submitted_question_ids: ["algebra-proof"],
      responses: [
        {
          id: "response-1",
          question_id: "algebra-proof",
          kind: "strokes",
          answer: {
            strokes: [
              {
                points: [
                  { x: 20, y: 30, pressure: 0.5 },
                  { x: 80, y: 90, pressure: 0.5 },
                ],
                width: 2.5,
                eraser: false,
              },
            ],
            canvas_size: { width: 900, height: 420 },
          },
          version: 3,
        },
      ],
    });
    mocks.getAttemptResults.mockResolvedValue({
      attempt_id: "attempt-1",
      complete: false,
      results: [
        {
          id: "result-proof",
          question_id: "algebra-proof",
          outcome: "incorrect",
          awarded_points: 0,
          confidence: 0.96,
          feedback: {
            summary: "The last algebra term is incorrect.",
            annotations: [],
          },
        },
      ],
    });

    render(<WorksheetWorkbench />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to question 3" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Clear and redo this question",
      }),
    );

    await waitFor(() => {
      expect(mocks.createQuestionRetry).toHaveBeenCalledWith(
        "attempt-1",
        "algebra-proof",
        "child-token",
        "retry-attempt-1-algebra-proof",
      );
    });
    expect(
      screen.getByRole("button", { name: "Clear handwriting" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Submit again for review" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("The last algebra term is incorrect."),
    ).not.toBeInTheDocument();
    expect(window.location.search).toContain(
      "attemptId=retry-attempt-1",
    );
    expect(window.location.search).toContain("retry=1");
  });

  it("localizes worksheet controls without translating question content", () => {
    window.localStorage.setItem("luma-language:demo-child", "ja");

    render(<WorksheetWorkbench />);

    return waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Choose the correct expansion of (a + b)(a − b).",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "次の問題" }),
      ).toBeInTheDocument();
      expect(screen.getByText("自動保存")).toBeInTheDocument();
      expect(screen.getByText("回答済み")).toBeInTheDocument();
      expect(screen.queryByText("Next question")).not.toBeInTheDocument();
    });
  });

  it("opens the child's current assignment when work has no route id", async () => {
    window.history.replaceState({}, "", "/child/work/");

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "Assigned mixed practice",
      }),
    ).toBeInTheDocument();
    expect(mocks.getChildAssignments).toHaveBeenCalledWith("child-token");
    expect(mocks.startAssignment).toHaveBeenCalledWith(
      "assignment-1",
      "child-token",
    );
  });

  it("shows an empty state instead of synthetic questions when nothing is assigned", async () => {
    window.history.replaceState({}, "", "/child/work/");
    mocks.getChildAssignments.mockResolvedValue([]);

    render(<WorksheetWorkbench />);

    expect(
      await screen.findByRole("heading", {
        name: "No assigned work is waiting.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Algebra & English warm-up"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Complete: She ___ to school every day."),
    ).not.toBeInTheDocument();
    expect(mocks.startAssignment).not.toHaveBeenCalled();
  });
});
