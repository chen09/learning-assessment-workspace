import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";

const mocks = vi.hoisted(() => ({
  getActiveChildProfile: vi.fn(),
  getChildAccessToken: vi.fn(),
  getOwnParentLanguage: vi.fn(),
  getParentAccessToken: vi.fn(),
  updateOwnParentLanguage: vi.fn(),
  updateOwnChildLanguage: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  getActiveChildProfile: mocks.getActiveChildProfile,
  getChildAccessToken: mocks.getChildAccessToken,
  getOwnParentLanguage: mocks.getOwnParentLanguage,
  getParentAccessToken: mocks.getParentAccessToken,
  updateOwnParentLanguage: mocks.updateOwnParentLanguage,
  updateOwnChildLanguage: mocks.updateOwnChildLanguage,
}));

describe("AppShell language preferences", () => {
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
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getOwnParentLanguage.mockReset();
    mocks.getOwnParentLanguage.mockResolvedValue({ ui_language: "ja" });
    mocks.updateOwnParentLanguage.mockReset();
    mocks.updateOwnParentLanguage.mockResolvedValue({ ui_language: "ja" });
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

  it("does not identify an unknown child as Alex before the profile is ready", () => {
    mocks.getActiveChildProfile.mockReturnValue(null);

    render(
      <AppShell currentPath="/child/" role="child">
        <h1>Loading child data</h1>
      </AppShell>,
    );

    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.getAllByText("Child mode")).not.toHaveLength(0);
  });

  it("loads and saves the parent's own language preference", async () => {
    window.localStorage.removeItem("luma-language:demo-parent");

    render(
      <AppShell currentPath="/parent/" role="parent">
        <LanguageSwitcher />
      </AppShell>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "ホーム" })).toHaveLength(2);
    });

    fireEvent.change(screen.getByRole("combobox", { name: "言語" }), {
      target: { value: "zh" },
    });

    await waitFor(() => {
      expect(mocks.updateOwnParentLanguage).toHaveBeenCalledWith(
        "zh",
        "parent-token",
      );
    });
  });
});
