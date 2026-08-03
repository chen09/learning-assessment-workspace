import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ParentResultsPage from "./page";

const mocks = vi.hoisted(() => ({
  decideParentReview: vi.fn(),
  getParentAttemptReview: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    decideParentReview: mocks.decideParentReview,
    getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
    getParentAttemptReview: mocks.getParentAttemptReview,
  };
});

describe("ParentResultsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mocks.decideParentReview.mockReset();
    mocks.getParentAttemptReview.mockReset();
    mocks.getParentAttemptReview.mockResolvedValue({
      attempt_id: "attempt-1",
      child_nickname: "Alex",
      title: "代数练习",
      source_material_title: "Lesson 1 textbook",
      source_material_subject: "English",
      complete: true,
      awarded_points: 1,
      available_points: 4,
      correct_count: 1,
      correction_count: 1,
      pending_review_count: 1,
      response_revisions: [],
      reviews: [
        {
          result_id: "result-1",
          question_id: "question-3",
          question_position: 3,
          question_prompt: "请写出平方差公式的推导过程。",
          question_type: "handwriting",
          question_points: 2,
          response_kind: "strokes",
          response_answer: {
            canvas_size: { width: 1200, height: 700 },
            strokes: [
              {
                points: [
                  [10, 20],
                  [100, 80],
                ],
                width: 2,
              },
            ],
          },
          automated_outcome: "needs_parent_review",
          automated_feedback: {
            summary: "Waiting for a parent to review.",
            action: "A parent can mark this answer correct or incorrect.",
            annotations: [
              {
                kind: "underline",
                x: 0.42,
                y: 0.56,
                width: 0.24,
                height: 0.08,
                label: "请检查这里的符号。",
              },
            ],
          },
        },
      ],
    });
    mocks.decideParentReview.mockResolvedValue({
      parent_outcome: "correct",
      parent_awarded_points: 2,
    });
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
    window.history.replaceState(
      {},
      "",
      "/parent/results/?attemptId=attempt-1",
    );
  });

  it("loads a real handwriting review and lets the parent decide", async () => {
    render(<ParentResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "确认作答结果" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("请写出平方差公式的推导过程。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("基于教材：Lesson 1 textbook · English"),
    ).toBeInTheDocument();
    const handwritingPreview =
      screen.getByLabelText("孩子的手写答案");
    expect(handwritingPreview).toBeInTheDocument();
    expect(handwritingPreview.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 1200 700",
    );
    expect(
      handwritingPreview.querySelector(
        '[data-grading-annotation="underline"]',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("请检查这里的符号。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "判为正确" }));

    await waitFor(() => {
      expect(mocks.decideParentReview).toHaveBeenCalledWith(
        "result-1",
        {
          outcome: "correct",
          awarded_points: 2,
          comment: null,
        },
        "parent-token",
        expect.stringMatching(/^parent-review-/),
      );
    });
    expect(
      await screen.findByText("这道题已由家长判为正确。"),
    ).toBeInTheDocument();
  });

  it("typesets imported LaTeX prompts in a parent review", async () => {
    mocks.getParentAttemptReview.mockResolvedValue({
      ...(await mocks.getParentAttemptReview()),
      reviews: [
        {
          ...(await mocks.getParentAttemptReview()).reviews[0],
          question_prompt: "Factorise \\(x^2 - 25\\).",
        },
      ],
    });

    render(<ParentResultsPage />);

    await screen.findByRole("heading", { name: "确认作答结果" });
    expect(document.querySelector(".parent-review-card .katex")).toBeInTheDocument();
  });

  it("sends an optional child-visible note with a parent correction decision", async () => {
    render(<ParentResultsPage />);

    await screen.findByRole("heading", { name: "确认作答结果" });
    fireEvent.change(screen.getByLabelText("给孩子的说明（可选）"), {
      target: { value: "请检查平方差的两个括号。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "需要订正" }));

    await waitFor(() => {
      expect(mocks.decideParentReview).toHaveBeenCalledWith(
        "result-1",
        {
          outcome: "incorrect",
          awarded_points: 0,
          comment: "请检查平方差的两个括号。",
        },
        "parent-token",
        expect.stringMatching(/^parent-review-/),
      );
    });
    expect(
      await screen.findByText("给孩子的说明：请检查平方差的两个括号。"),
    ).toBeInTheDocument();
  });

  it("keeps polling while the grading transaction is incomplete", async () => {
    vi.useFakeTimers();
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview
      .mockReset()
      .mockResolvedValueOnce({
        ...completeReview,
        complete: false,
        awarded_points: 0,
        available_points: 0,
        correct_count: 0,
        correction_count: 0,
        pending_review_count: 0,
        reviews: [],
      })
      .mockResolvedValueOnce(completeReview);

    render(<ParentResultsPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText("评卷结果正在整理，页面会自动更新。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("所有需要确认的答案都已处理。"),
    ).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mocks.getParentAttemptReview).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("请写出平方差公式的推导过程。"),
    ).toBeInTheDocument();
  });

  it("lets a parent retry a temporary review-loading failure", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview
      .mockReset()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(completeReview);

    render(<ParentResultsPage />);

    expect(
      await screen.findByText("无法加载结果，请返回学习记录后重试。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByText("请写出平方差公式的推导过程。"),
    ).toBeInTheDocument();
    expect(mocks.getParentAttemptReview).toHaveBeenCalledTimes(2);
  });

  it("replaces an already-open parent review after browser history changes", async () => {
    const firstReview = await mocks.getParentAttemptReview();
    const secondReview = {
      ...firstReview,
      attempt_id: "attempt-2",
      child_nickname: "Bea",
      title: "几何练习",
      reviews: [
        {
          ...firstReview.reviews[0],
          result_id: "result-2",
          question_id: "question-8",
          question_position: 8,
          question_prompt: "请证明三角形内角和为 180°。",
        },
      ],
    };
    let releaseSecondReview: ((value: typeof secondReview) => void) | undefined;
    const secondReviewGate = new Promise<typeof secondReview>((resolve) => {
      releaseSecondReview = resolve;
    });
    mocks.getParentAttemptReview.mockReset().mockImplementation((attemptId) =>
      attemptId === "attempt-2"
        ? secondReviewGate
        : Promise.resolve(firstReview),
    );

    render(<ParentResultsPage />);

    expect(
      await screen.findByText("请写出平方差公式的推导过程。"),
    ).toBeInTheDocument();

    await act(async () => {
      window.history.pushState({}, "", "/parent/results/?attemptId=attempt-2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByText("请写出平方差公式的推导过程。"),
    ).not.toBeInTheDocument();

    releaseSecondReview?.(secondReview);

    expect(
      await screen.findByText("请证明三角形内角和为 180°。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("请写出平方差公式的推导过程。"),
    ).not.toBeInTheDocument();
  });

  it("renders short-lived photo previews for a parent", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            paths: ["family-id/attempt-id/answer.png"],
          },
          photo_urls: [
            "https://storage.example.test/signed/answer.png?token=short-lived",
          ],
        },
      ],
    });

    render(<ParentResultsPage />);

    const preview = await screen.findByRole("img", {
      name: "已上传的答案照片 1",
    });
    expect(preview).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/answer.png?token=short-lived",
    );
    expect(
      screen.getByRole("link", { name: "打开原始作答照片：answer.png" }),
    ).toHaveAttribute(
      "href",
      "https://storage.example.test/signed/answer.png?token=short-lived",
    );
  });

  it("labels each uploaded answer photo in its saved shooting order", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            paths: [
              "family-id/attempt-id/first-page.png",
              "family-id/attempt-id/second-page.png",
            ],
          },
          photo_urls: [
            "https://storage.example.test/signed/first-page.png?token=short-lived",
            "https://storage.example.test/signed/second-page.png?token=short-lived",
          ],
        },
      ],
    });

    render(<ParentResultsPage />);

    expect(
      await screen.findByText("第 1 页，共 2 页"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 2 页，共 2 页")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "已上传的答案照片 1" })).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/first-page.png?token=short-lived",
    );
    expect(screen.getByRole("img", { name: "已上传的答案照片 2" })).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/second-page.png?token=short-lived",
    );
  });

  it("keeps each answer page's saved order visible while photo previews are unavailable", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            paths: [
              "family-id/attempt-id/first-page.png",
              "family-id/attempt-id/second-page.png",
            ],
          },
          photo_urls: [],
        },
      ],
    });

    render(<ParentResultsPage />);

    expect(
      await screen.findByText("第 1 页，共 2 页"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 2 页，共 2 页")).toBeInTheDocument();
    expect(screen.getByText("first-page.png")).toBeInTheDocument();
    expect(screen.getByText("second-page.png")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /打开原始作答照片/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps a paper photo unchanged until a parent chooses to reveal AI red-pencil marks", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            paths: ["family-id/attempt-id/factorisation-page.png"],
          },
          photo_urls: [
            "https://storage.example.test/signed/factorisation-page.png?token=short-lived",
          ],
          automated_feedback: {
            summary: "平方のかかる範囲を確認",
            action: "保護者が確認してください。",
            annotations: [
              {
                kind: "underline",
                page_index: 0,
                x: 0.22,
                y: 0.61,
                width: 0.31,
                height: 0.04,
                label: "平方のかかる範囲を確認",
              },
            ],
          },
        },
      ],
    });

    render(<ParentResultsPage />);

    await screen.findByRole("img", { name: "已上传的答案照片 1" });
    expect(
      screen.getByRole("button", { name: "显示 AI 红笔标注" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("red-pencil-mark")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "显示 AI 红笔标注" }),
    );

    expect(screen.getAllByTestId("red-pencil-mark")).toHaveLength(1);
    expect(screen.getByText("平方のかかる範囲を確認")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "隐藏 AI 红笔标注" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "隐藏 AI 红笔标注" }),
    );
    expect(screen.queryByTestId("red-pencil-mark")).not.toBeInTheDocument();
  });

  it("opens a completed PDF privately instead of treating it as a photo preview", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            source_paths: ["family-id/attempt-id/factorisation-paper.pdf"],
          },
          photo_urls: [
            "https://storage.example.test/signed/factorisation-paper.pdf?token=short-lived",
          ],
          automated_feedback: {
            summary: "符号を確認",
            action: "保護者が確認してください。",
          },
        },
      ],
    });

    render(<ParentResultsPage />);

    const originalPdf = await screen.findByRole("link", {
      name: "打开原始 PDF：factorisation-paper.pdf",
    });
    expect(originalPdf).toHaveAttribute(
      "href",
      "https://storage.example.test/signed/factorisation-paper.pdf?token=short-lived",
    );
    expect(
      screen.queryByRole("img", { name: "已上传的答案照片 1" }),
    ).not.toBeInTheDocument();
  });

  it("downloads a separate red-pencil overlay without changing the original paper photo", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      reviews: [
        {
          ...completeReview.reviews[0],
          question_type: "photo",
          response_kind: "photo",
          response_answer: {
            paths: ["family-id/attempt-id/factorisation-page.png"],
          },
          photo_urls: [
            "https://storage.example.test/signed/factorisation-page.png?token=short-lived",
          ],
          automated_feedback: {
            summary: "平方のかかる範囲を確認",
            action: "保護者が確認してください。",
            annotations: [
              {
                kind: "underline",
                page_index: 0,
                x: 0.22,
                y: 0.61,
                width: 0.31,
                height: 0.04,
                label: "平方のかかる範囲を確認",
              },
            ],
          },
        },
      ],
    });
    const createObjectURL = vi.fn(() => "blob:annotation-download");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const downloadedNames: string[] = [];
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function captureDownload(this: HTMLAnchorElement) {
        downloadedNames.push(this.download);
      });

    render(<ParentResultsPage />);

    const originalPhoto = await screen.findByRole("img", {
      name: "已上传的答案照片 1",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "下载 AI 红笔标注图层" }),
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(downloadedNames).toEqual(["factorisation-page-red-pencil.svg"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:annotation-download");
    expect(originalPhoto).toHaveAttribute(
      "src",
      "https://storage.example.test/signed/factorisation-page.png?token=short-lived",
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it("shows a path-free photo revision timeline to the parent", async () => {
    const completeReview = await mocks.getParentAttemptReview();
    mocks.getParentAttemptReview.mockReset().mockResolvedValue({
      ...completeReview,
      response_revisions: [
        {
          question_id: "question-3",
          question_position: 3,
          response_version: 2,
          change: "photo_removed",
          previous_page_count: 1,
          page_count: 0,
          saved_at: "2026-08-02T09:00:00Z",
        },
      ],
    });

    render(<ParentResultsPage />);

    expect(await screen.findByText("作答照片记录")).toBeInTheDocument();
    expect(screen.getByText("移除了 1 张作答照片")).toBeInTheDocument();
    expect(screen.getByText(/保存版本 2/)).toBeInTheDocument();
    expect(
      screen.queryByText(/first-photo\.png/i),
    ).not.toBeInTheDocument();
  });
});
