import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FamilySettingsPage from "@/app/parent/family/page";

vi.mock("@/lib/api-client", () => ({
  acceptFamilyInvitation: vi.fn(),
  createChild: vi.fn(),
  createFamily: vi.fn(),
  createFamilyInvitation: vi.fn(),
  getChildren: vi.fn().mockResolvedValue([]),
  getFamilies: vi.fn().mockResolvedValue([]),
  getManagementPinStatus: vi.fn().mockResolvedValue({ configured: false }),
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
  getPendingInvitations: vi.fn().mockResolvedValue([]),
  setManagementPin: vi.fn(),
  unlockFamilyManagement: vi.fn(),
  updateChildPin: vi.fn(),
}));

describe("FamilySettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });

  it("keeps the parent's Chinese preference throughout family setup", async () => {
    render(<FamilySettingsPage />);

    expect(
      await screen.findByRole("heading", { name: "创建您的家庭" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "孩子档案与 PIN" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "邀请另一位家长" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Family workspace")).not.toBeInTheDocument();
  });
});
