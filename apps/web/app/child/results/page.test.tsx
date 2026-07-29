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
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "en");
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

  it("shows result and correction states in Chinese", async () => {
    window.localStorage.setItem("luma-language:demo-child", "zh");

    render(<ChildResultsPage />);

    expect(
      await screen.findByRole("heading", { name: "做得好，Alex" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "再试一次" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "等待家长确认" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "订正这些题" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Good work, Alex")).not.toBeInTheDocument();
  });
});
