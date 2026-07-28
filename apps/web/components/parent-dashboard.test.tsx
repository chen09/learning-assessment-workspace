import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ParentDashboard } from "@/components/parent-dashboard";

describe("ParentDashboard", () => {
  it("leads with child status and the actions that need attention", () => {
    render(<ParentDashboard />);

    expect(
      screen.getByRole("heading", { name: "Good afternoon, Maya" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("2 items need you")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review uncertain answers" }),
    ).toHaveAttribute("href", "/parent/results");
  });
});
