import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetWorkbench } from "@/components/worksheet-workbench";

const mocks = vi.hoisted(() => ({
  createChildUploadIntent: vi.fn(),
  getAttemptWork: vi.fn(),
  getChildAssignments: vi.fn(),
  saveAttemptResponse: vi.fn(),
  startAssignment: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  createChildUploadIntent: mocks.createChildUploadIntent,
  getAttemptWork: mocks.getAttemptWork,
  getChildAccessToken: () => "child-token",
  getChildAssignments: mocks.getChildAssignments,
  saveAttemptResponse: mocks.saveAttemptResponse,
  startAssignment: mocks.startAssignment,
  uploadToSignedUrl: mocks.uploadToSignedUrl,
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
  attempt: { id: "attempt-1" },
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
};

describe("WorksheetWorkbench", () => {
  beforeEach(() => {
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
    mocks.saveAttemptResponse.mockReset();
    mocks.saveAttemptResponse.mockResolvedValue({ version: 1 });
    mocks.startAssignment.mockReset();
    mocks.startAssignment.mockResolvedValue(assignmentWork);
    mocks.uploadToSignedUrl.mockReset();
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
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
    expect(uploadedImages).toHaveTextContent(
      "1. answer-page.jpg2. draft-page.jpg",
    );
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
