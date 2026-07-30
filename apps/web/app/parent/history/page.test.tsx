import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ParentHistoryPage from "./page";

const mocks = vi.hoisted(() => ({
  getFamilyHistory: vi.fn(),
  getParentAccessToken: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getFamilyHistory: mocks.getFamilyHistory,
    getParentAccessToken: mocks.getParentAccessToken,
  };
});

describe("ParentHistoryPage", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/parent/history/?familyId=family-1",
    );
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getFamilyHistory.mockReset();
    mocks.getFamilyHistory.mockReturnValue(new Promise(() => undefined));
  });

  it("does not render example family records while history is loading", () => {
    render(<ParentHistoryPage />);

    expect(screen.getByText("Loading family history…")).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.queryByText("Emi")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Algebra & English warm-up",
      }),
    ).not.toBeInTheDocument();
  });
});
