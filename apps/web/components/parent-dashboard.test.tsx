import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ParentDashboard } from "@/components/parent-dashboard";

describe("ParentDashboard", () => {
  it("sends a newly signed-in parent to real family setup", () => {
    render(<ParentDashboard />);

    expect(
      screen.getByRole("heading", { name: "Set up your family workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open family setup" }),
    ).toHaveAttribute("href", "/parent/family");
    expect(screen.queryByText("Maya")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });
});
