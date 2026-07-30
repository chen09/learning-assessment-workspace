import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("PrintWorksheetPage", () => {
  beforeEach(() => {
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getPrintableAssignment.mockReset();
    mocks.getPrintableAssignment.mockReturnValue(
      new Promise(() => undefined),
    );
  });

  it("does not render example questions while an assignment is loading", () => {
    window.history.replaceState(
      {},
      "",
      "/parent/print/?assignmentId=assignment-1",
    );

    render(<PrintWorksheetPage />);

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

    render(<PrintWorksheetPage />);

    expect(
      await screen.findByRole("heading", {
        name: "No printable assignment selected",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("LA-DEMO-001")).not.toBeInTheDocument();
  });
});
