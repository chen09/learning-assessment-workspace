import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FamilySettingsPage from "@/app/parent/family/page";

const mocks = vi.hoisted(() => ({
  createChild: vi.fn(),
  getChildren: vi.fn(),
  getFamilies: vi.fn(),
  updateChildLanguage: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  acceptFamilyInvitation: vi.fn(),
  createChild: mocks.createChild,
  createFamily: vi.fn(),
  createFamilyInvitation: vi.fn(),
  getChildren: mocks.getChildren,
  getFamilies: mocks.getFamilies,
  getManagementPinStatus: vi.fn().mockResolvedValue({ configured: false }),
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
  getPendingInvitations: vi.fn().mockResolvedValue([]),
  setManagementPin: vi.fn(),
  unlockFamilyManagement: vi.fn(),
  updateChildLanguage: mocks.updateChildLanguage,
  updateChildPin: vi.fn(),
}));

describe("FamilySettingsPage", () => {
  beforeEach(() => {
    mocks.createChild.mockReset();
    mocks.getChildren.mockReset();
    mocks.getChildren.mockResolvedValue([]);
    mocks.getFamilies.mockReset();
    mocks.getFamilies.mockResolvedValue([]);
    mocks.updateChildLanguage.mockReset();
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

  it("lets a parent retry a temporary family workspace loading failure", async () => {
    mocks.getFamilies
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([]);

    render(<FamilySettingsPage />);

    expect(
      await screen.findByText("无法加载家庭空间，请检查网络后重试。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByRole("heading", { name: "创建您的家庭" }),
    ).toBeInTheDocument();
    expect(mocks.getFamilies).toHaveBeenCalledTimes(2);
  });

  it("lets a parent choose the child's default UI language", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.createChild.mockResolvedValue({
      id: "child-1",
      family_id: "family-1",
      nickname: "Alex",
      grade_stage: "初一",
      ui_language: "ja",
    });

    render(<FamilySettingsPage />);

    fireEvent.change(await screen.findByLabelText("孩子姓名"), {
      target: { value: "Alex" },
    });
    fireEvent.change(screen.getByLabelText("年级"), {
      target: { value: "初一" },
    });
    fireEvent.change(screen.getByLabelText("六位 PIN"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("孩子界面语言"), {
      target: { value: "ja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加孩子" }));

    await waitFor(() => {
      expect(mocks.createChild).toHaveBeenCalledWith(
        "family-1",
        expect.objectContaining({
          nickname: "Alex",
          grade_stage: "初一",
          pin: "123456",
          ui_language: "ja",
        }),
        "parent-token",
        expect.stringMatching(/^child-/),
      );
    });
  });

  it("lets a parent change an existing child's UI language", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getChildren.mockResolvedValue([
      {
        id: "child-1",
        family_id: "family-1",
        nickname: "Alex",
        grade_stage: "初一",
        ui_language: "en",
      },
    ]);
    mocks.updateChildLanguage.mockResolvedValue({
      id: "child-1",
      family_id: "family-1",
      nickname: "Alex",
      grade_stage: "初一",
      ui_language: "zh",
    });

    render(<FamilySettingsPage />);

    fireEvent.change(
      await screen.findByLabelText("Alex 的界面语言"),
      { target: { value: "zh" } },
    );

    await waitFor(() => {
      expect(mocks.updateChildLanguage).toHaveBeenCalledWith(
        "child-1",
        "zh",
        "parent-token",
      );
    });
    expect(screen.getByLabelText("Alex 的界面语言")).toHaveValue("zh");
  });

  it("does not keep the prior family's children visible after a failed switch", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
      { id: "family-2", name: "另一家庭" },
    ]);
    mocks.getChildren
      .mockResolvedValueOnce([
        {
          id: "child-1",
          family_id: "family-1",
          nickname: "Alex",
          grade_stage: "初一",
          ui_language: "zh",
        },
      ])
      .mockRejectedValueOnce(new Error("network unavailable"));

    render(<FamilySettingsPage />);

    await screen.findByText("Alex");
    fireEvent.change(screen.getByLabelText("当前家庭"), {
      target: { value: "family-2" },
    });

    expect(
      await screen.findByText("无法保存更改。请检查填写内容后重试。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前家庭")).toHaveValue("family-1");
  });
});
