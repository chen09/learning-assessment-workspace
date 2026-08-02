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
