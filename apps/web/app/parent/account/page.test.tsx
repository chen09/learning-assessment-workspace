import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountSettingsPage from "./page";

const { getSupabaseBrowserClient } = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowserClient }));

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    getSupabaseBrowserClient.mockReset();
    getSupabaseBrowserClient.mockReturnValue(null);
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-parent", "zh");
  });

  it("uses the parent's selected language for password and sign-in settings", () => {
    render(<AccountSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "我的账户" }),
    ).toBeInTheDocument();
    expect(screen.getByText("设置或更改密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存密码" })).toBeInTheDocument();
    expect(screen.getByText("已连接的登录方式")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "safepassword" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "保存密码" }).closest("form")!);

    expect(screen.getByRole("status")).toHaveTextContent(
      "本地演示模式：未发送账户修改。",
    );
  });
});
