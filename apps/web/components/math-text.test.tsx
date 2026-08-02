import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MathText } from "@/components/math-text";

describe("MathText", () => {
  it("keeps ordinary question text while typesetting inline TeX", () => {
    render(
      <MathText>
        {"Factorise \\(x^2 - 16\\) before choosing your answer."}
      </MathText>,
    );

    expect(
      screen.getByText("Factorise", { exact: false }),
    ).toBeInTheDocument();
    expect(document.querySelector(".math-text-inline .katex")).toBeInTheDocument();
    expect(
      screen.getByText("before choosing your answer.", { exact: false }),
    ).toBeInTheDocument();
  });

  it("keeps an unmatched delimiter as ordinary text", () => {
    render(<MathText>{"Explain \\(x^2 + 1"}</MathText>);

    expect(screen.getByText("Explain \\(x^2 + 1")).toBeInTheDocument();
    expect(document.querySelector(".katex")).not.toBeInTheDocument();
  });

  it("renders a display formula as its own readable block", () => {
    render(<MathText>{"Solve:\\n\\[x = \\frac{12}{3}\\]"}</MathText>);

    expect(document.querySelector(".math-text-display .katex-display")).toBeInTheDocument();
  });
});
