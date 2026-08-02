import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FamilySettingsPage from "@/app/parent/family/page";

const mocks = vi.hoisted(() => ({
  createChild: vi.fn(),
  createDeletionRequest: vi.fn(),
  getChildren: vi.fn(),
  getFamilies: vi.fn(),
  getRecoverableDeletions: vi.fn(),
  restoreDeletionRequest: vi.fn(),
  setManagementPin: vi.fn(),
  unlockFamilyManagement: vi.fn(),
  updateChildLanguage: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  acceptFamilyInvitation: vi.fn(),
  createChild: mocks.createChild,
  createDeletionRequest: mocks.createDeletionRequest,
  createFamily: vi.fn(),
  createFamilyInvitation: vi.fn(),
  getChildren: mocks.getChildren,
  getFamilies: mocks.getFamilies,
  getRecoverableDeletions: mocks.getRecoverableDeletions,
  getManagementPinStatus: vi.fn().mockResolvedValue({ configured: false }),
  getParentAccessToken: vi.fn().mockResolvedValue("parent-token"),
  getPendingInvitations: vi.fn().mockResolvedValue([]),
  setManagementPin: mocks.setManagementPin,
  restoreDeletionRequest: mocks.restoreDeletionRequest,
  unlockFamilyManagement: mocks.unlockFamilyManagement,
  updateChildLanguage: mocks.updateChildLanguage,
  updateChildPin: vi.fn(),
}));

describe("FamilySettingsPage", () => {
  beforeEach(() => {
    mocks.createChild.mockReset();
    mocks.createDeletionRequest.mockReset();
    mocks.getChildren.mockReset();
    mocks.getChildren.mockResolvedValue([]);
    mocks.getFamilies.mockReset();
    mocks.getFamilies.mockResolvedValue([]);
    mocks.getRecoverableDeletions.mockReset();
    mocks.getRecoverableDeletions.mockResolvedValue([]);
    mocks.restoreDeletionRequest.mockReset();
    mocks.setManagementPin.mockReset();
    mocks.unlockFamilyManagement.mockReset();
    mocks.setManagementPin.mockResolvedValue(undefined);
    mocks.unlockFamilyManagement.mockResolvedValue({
      access_token: "management-unlock",
      token_type: "bearer",
      expires_in: 600,
    });
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

  it("clears the previous family while browser history opens another family", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
      { id: "family-2", name: "另一家庭" },
    ]);
    const secondFamilyChildren = [
      {
        id: "child-2",
        family_id: "family-2",
        nickname: "Bea",
        grade_stage: "初二",
        ui_language: "ja",
      },
    ];
    let releaseSecondFamily: ((value: typeof secondFamilyChildren) => void) | undefined;
    const secondFamilyGate = new Promise<typeof secondFamilyChildren>((resolve) => {
      releaseSecondFamily = resolve;
    });
    mocks.getChildren.mockImplementation((requestedFamilyId) =>
      requestedFamilyId === "family-2"
        ? secondFamilyGate
        : Promise.resolve([
            {
              id: "child-1",
              family_id: "family-1",
              nickname: "Alex",
              grade_stage: "初一",
              ui_language: "zh",
            },
          ]),
    );
    window.history.replaceState({}, "", "/parent/family/?familyId=family-1");

    render(<FamilySettingsPage />);

    expect(await screen.findByText("Alex")).toBeInTheDocument();

    await act(async () => {
      window.history.pushState({}, "", "/parent/family/?familyId=family-2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.queryByText("Alex")).not.toBeInTheDocument();

    releaseSecondFamily?.(secondFamilyChildren);

    expect(await screen.findByText("Bea")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "另一家庭" }),
    ).toBeInTheDocument();
  });

  it("requires management unlock and explicit confirmation before removing a child, then offers a restore", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
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
      .mockResolvedValueOnce([
        {
          id: "child-1",
          family_id: "family-1",
          nickname: "Alex",
          grade_stage: "初一",
          ui_language: "zh",
        },
      ]);
    mocks.createDeletionRequest.mockResolvedValue({
      id: "deletion-1",
      family_id: "family-1",
      target_type: "child",
      target_id: "child-1",
      requested_at: "2026-08-03T00:00:00.000Z",
      purge_after: "2026-09-02T00:00:00.000Z",
      restored_at: null,
    });
    mocks.restoreDeletionRequest.mockResolvedValue({
      id: "deletion-1",
      family_id: "family-1",
      target_type: "child",
      target_id: "child-1",
      requested_at: "2026-08-03T00:00:00.000Z",
      purge_after: "2026-09-02T00:00:00.000Z",
      restored_at: "2026-08-03T00:01:00.000Z",
    });

    render(<FamilySettingsPage />);

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 Alex" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("家长管理 PIN"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置管理 PIN" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "移除 Alex" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "移除 Alex" }));
    expect(
      screen.getByRole("button", { name: "确认移除 Alex" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认移除 Alex" }));

    await waitFor(() => {
      expect(mocks.createDeletionRequest).toHaveBeenCalledWith(
        "family-1",
        "child",
        "child-1",
        "parent-token",
        expect.stringMatching(/^delete-child-/),
      );
    });
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复 Alex" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复 Alex" }));
    await waitFor(() => {
      expect(mocks.restoreDeletionRequest).toHaveBeenCalledWith(
        "deletion-1",
        "parent-token",
      );
    });
    expect(await screen.findByText("Alex")).toBeInTheDocument();
  });

  it("keeps a recoverable child available after a family settings reload", async () => {
    mocks.getFamilies.mockResolvedValue([
      { id: "family-1", name: "肉肉如意" },
    ]);
    mocks.getRecoverableDeletions.mockResolvedValue([
      {
        id: "deletion-1",
        family_id: "family-1",
        target_type: "child",
        target_id: "child-1",
        target_label: "Alex",
        requested_at: "2026-08-03T00:00:00.000Z",
        purge_after: "2026-09-02T00:00:00.000Z",
        restored_at: null,
      },
    ]);

    render(<FamilySettingsPage />);

    expect(
      await screen.findByRole("button", { name: "恢复 Alex" }),
    ).toBeInTheDocument();
  });
});
