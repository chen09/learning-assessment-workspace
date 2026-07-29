import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

const mocks = vi.hoisted(() => ({
  getActiveChildProfile: vi.fn(),
  getChildAccessToken: vi.fn(),
  updateOwnChildLanguage: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getActiveChildProfile: mocks.getActiveChildProfile,
  getChildAccessToken: mocks.getChildAccessToken,
  updateOwnChildLanguage: mocks.updateOwnChildLanguage,
}));

describe("AppShell child language", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "en");
    mocks.getActiveChildProfile.mockReset();
    mocks.getActiveChildProfile.mockReturnValue({
      child_id: "child-1",
      family_id: "family-1",
      nickname: "Emi",
      ui_language: "en",
    });
    mocks.getChildAccessToken.mockReset();
    mocks.getChildAccessToken.mockReturnValue("child-token");
    mocks.updateOwnChildLanguage.mockReset();
    mocks.updateOwnChildLanguage.mockResolvedValue({
      id: "child-1",
      family_id: "family-1",
      nickname: "Emi",
      grade_stage: "Grade 5",
      ui_language: "zh",
    });
  });

  it("lets the signed-in child switch and persist their own UI language", async () => {
    render(
      <AppShell currentPath="/child/" role="child">
        <h1>Question content stays unchanged</h1>
      </AppShell>,
    );

    expect(await screen.findByText("Emi")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "zh" },
    });

    expect(screen.getAllByRole("link", { name: "答题" })).toHaveLength(2);
    expect(
      screen.getByText("Question content stays unchanged"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("luma-language:demo-child")).toBe("zh");
    await waitFor(() => {
      expect(mocks.updateOwnChildLanguage).toHaveBeenCalledWith(
        "zh",
        "child-token",
      );
    });
  });
});
