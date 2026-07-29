import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SubmittedPage from "./page";

describe("SubmittedPage", () => {
  it("does not expose the results action before hydration", () => {
    const markup = renderToStaticMarkup(<SubmittedPage />);

    expect(markup).toContain("Preparing results");
    expect(markup).toContain('disabled=""');
  });

  it("shows the submitted state in Chinese", () => {
    window.localStorage.setItem("luma-language:demo-child", "zh");

    render(<SubmittedPage />);

    expect(
      screen.getByRole("heading", { name: "系统正在批改你的答案" }),
    ).toBeInTheDocument();
    expect(screen.getByText("通常只需几分钟")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看结果" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Your work is being checked"),
    ).not.toBeInTheDocument();
  });
});
