import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParentDashboard } from "@/components/parent-dashboard";

const mocks = vi.hoisted(() => ({
  getParentAccessToken: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/api-client", () => ({
  getParentAccessToken: mocks.getParentAccessToken,
}));

describe("ParentDashboard", () => {
  beforeEach(() => {
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.replace.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/parent/");
  });

  it("sends a newly signed-in parent to real family setup", async () => {
    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open family setup" }),
    ).toHaveAttribute("href", "/parent/family");
    expect(screen.queryByText("Maya")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });

  it("translates the complete onboarding screen into Chinese", async () => {
    window.localStorage.setItem("luma-language:demo-parent", "zh");

    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", { name: "设置家庭学习空间" }),
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

  it("redirects an unauthenticated visitor without showing the parent page", async () => {
    mocks.getParentAccessToken.mockResolvedValue(null);

    render(<ParentDashboard />);

    await vi.waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/login/");
    });
    expect(
      screen.queryByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).not.toBeInTheDocument();
  });

  it("removes a legacy authentication code from the address bar", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/?code=expired-auth-code&source=email",
    );

    render(<ParentDashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Set up your family workspace",
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/parent/");
    expect(window.location.search).toBe("?source=email");
  });
});
