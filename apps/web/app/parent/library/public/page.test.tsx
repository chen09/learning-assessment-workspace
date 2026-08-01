import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PublicLibraryPage from "@/app/parent/library/public/page";

const mocks = vi.hoisted(() => ({
  copyPublicLibraryItem: vi.fn(),
  getFamilies: vi.fn(),
  getParentAccessToken: vi.fn(),
  getPublicLibraryItems: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  copyPublicLibraryItem: mocks.copyPublicLibraryItem,
  getFamilies: mocks.getFamilies,
  getParentAccessToken: mocks.getParentAccessToken,
  getPublicLibraryItems: mocks.getPublicLibraryItems,
}));

describe("PublicLibraryPage", () => {
  beforeEach(() => {
    mocks.copyPublicLibraryItem.mockReset();
    mocks.copyPublicLibraryItem.mockResolvedValue({
      library_item_id: "library-1",
      library_revision: 1,
      question_set_id: "copied-set-1",
      family_id: "family-1",
      question_count: 12,
      reused_existing: false,
    });
    mocks.getFamilies.mockReset();
    mocks.getFamilies.mockResolvedValue([{ id: "family-1", name: "肉肉如意" }]);
    mocks.getParentAccessToken.mockReset();
    mocks.getParentAccessToken.mockResolvedValue("parent-token");
    mocks.getPublicLibraryItems.mockReset();
    mocks.getPublicLibraryItems.mockResolvedValue([
      {
        id: "library-1",
        title: "Factorisation basics",
        subject: "Mathematics",
        question_count: 12,
        revision: 1,
        published_at: "2026-08-02T00:00:00Z",
      },
    ]);
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });

  it("shows only anonymous metadata and copies an item into the selected family", async () => {
    render(<PublicLibraryPage />);

    expect(
      await screen.findByRole("heading", { name: "Factorisation basics" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("12 questions · revision 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy to my family" }));
    await waitFor(() => {
      expect(mocks.copyPublicLibraryItem).toHaveBeenCalledWith(
        "library-1",
        "family-1",
        "parent-token",
        expect.any(String),
      );
    });
    expect(await screen.findByText("Copied to 肉肉如意's family library."))
      .toBeInTheDocument();
  });
});
