import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildResultsPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getAttemptResults: vi.fn(
      () => new Promise<never>(() => undefined),
    ),
    getChildAccessToken: vi.fn(() => "child-token"),
  };
});

describe("ChildResultsPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/child/results/");
  });

  it("does not expose the correction action before hydration", () => {
    const markup = renderToStaticMarkup(<ChildResultsPage />);

    expect(markup).toContain("Preparing corrections");
    expect(markup).toContain('disabled=""');
  });

  it("keeps a hosted attempt in checking state until its results load", async () => {
    window.history.replaceState(
      {},
      "",
      "/child/results/?attemptId=hosted-attempt",
    );

    render(<ChildResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "Almost ready" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Correct these answers" }),
    ).not.toBeInTheDocument();
  });
});
