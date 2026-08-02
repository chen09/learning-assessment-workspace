import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthCallback } from "@/components/auth-callback";
import { LanguageProvider } from "@/components/language-provider";

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => null,
}));

describe("AuthCallback", () => {
  it("keeps an unavailable sign-in link localized without exposing technical text", async () => {
    window.localStorage.setItem("luma-language:public", "zh");

    render(
      <LanguageProvider>
        <AuthCallback />
      </LanguageProvider>,
    );

    expect(await screen.findByText("安全的家庭访问")).toBeInTheDocument();
    expect(screen.getByText("此网站尚未配置登录服务。")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "重新获取登录链接" }),
    ).toBeInTheDocument();
  });
});
