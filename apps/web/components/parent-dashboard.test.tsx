import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ParentDashboard } from "@/components/parent-dashboard";

describe("ParentDashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it("translates the complete onboarding screen into Chinese", () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<ParentDashboard />);

    expect(
      screen.getByRole("heading", { name: "设置家庭学习空间" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "创建或加入家庭" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "进入家庭设置" }),
    ).toHaveAttribute("href", "/parent/family");
    expect(screen.getByText("家长", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("Parent workspace")).not.toBeInTheDocument();
  });
});
