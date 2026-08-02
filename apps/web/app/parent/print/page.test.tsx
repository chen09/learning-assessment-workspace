import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/components/language-provider";

import PrintWorksheetPage from "./page";

const mocks = vi.hoisted(() => ({
  getParentAccessToken: vi.fn(),
  getPrintableAssignment: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getParentAccessToken: mocks.getParentAccessToken,
    getPrintableAssignment: mocks.getPrintableAssignment,
  };
});

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,fixture"),
  },
}));

function renderPage() {
  return render(
    <LanguageProvider>
      <PrintWorksheetPage />
    </LanguageProvider>,
  );
}

describe("PrintWorksheetPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getPrintableAssignment.mockReset();
    mocks.getPrintableAssignment.mockReturnValue(
      new Promise(() => undefined),
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

  it("does not render example questions while an assignment is loading", () => {
    window.history.replaceState(
      {},
      "",
      "/parent/print/?assignmentId=assignment-1",
    );

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Loading printable assignment…",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Algebra & English warm-up",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Choose the correct expansion of (a + b)(a − b)."),
    ).not.toBeInTheDocument();
  });

  it("shows a clean missing state without a selected assignment", async () => {
    window.history.replaceState({}, "", "/parent/print/");

    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "No printable assignment selected",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("LA-DEMO-001")).not.toBeInTheDocument();
  });

  it("retries a temporary printable-assignment loading failure in place", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/print/?assignmentId=assignment-1",
    );
    mocks.getPrintableAssignment
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        assignment: { id: "assignment-1" },
        title: "Recovered printable practice",
        template_version: "a4-v1",
        questions: [
          {
            id: "question-1",
            position: 1,
            type: "typed_text" as const,
            prompt: "Recovered question.",
            options: null,
            points: 1,
          },
        ],
      });

    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Printable assignment could not be loaded",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Recovered printable practice",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getPrintableAssignment).toHaveBeenCalledTimes(2);
    });
  });

  it("splits a long handwritten practice across numbered A4 sheets", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/print/?assignmentId=assignment-1",
    );
    mocks.getPrintableAssignment.mockResolvedValue({
      assignment: { id: "assignment-1" },
      title: "Handwritten English practice",
      template_version: "a4-v1",
      questions: Array.from({ length: 5 }, (_, index) => ({
        id: `question-${index + 1}`,
        position: index + 1,
        type: "handwriting" as const,
        prompt: `Write a complete sentence for question ${index + 1}.`,
        options: null,
        points: 2,
      })),
    });

    renderPage();

    expect(await screen.findByText(/Page 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2 \/ 2/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Write a complete sentence for question 5." }),
    ).toBeInTheDocument();
  });

  it("prints the worksheet metadata in the parent's saved interface language", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/print/?assignmentId=assignment-1",
    );
    mocks.getPrintableAssignment.mockResolvedValue({
      assignment: { id: "assignment-1" },
      title: "English practice",
      template_version: "a4-v1",
      questions: [
        {
          id: "question-1",
          position: 1,
          type: "typed_text" as const,
          prompt: "Complete the sentence.",
          options: null,
          points: 1,
        },
      ],
    });
    window.localStorage.setItem("luma-language:public", "zh");

    renderPage();
    await screen.findByRole("heading", { name: "English practice" });

    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
    expect(screen.getByText(/题单 assignment-1 · 第 1 \/ 1 页/)).toBeInTheDocument();
    expect(screen.getByText("姓名: ____________________")).toBeInTheDocument();
  });
});
