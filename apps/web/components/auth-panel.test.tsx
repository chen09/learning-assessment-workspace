import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPanel } from "@/components/auth-panel";
import { LanguageProvider } from "@/components/language-provider";

const signInWithOtp = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      resetPasswordForEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithOtp,
      signInWithPassword: vi.fn(),
    },
  }),
}));

describe("AuthPanel", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    signInWithOtp.mockResolvedValue({ error: null });
  });

  it("sends one-time links through the PKCE callback page", async () => {
    render(<AuthPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "parent@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledOnce());
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "parent@example.com",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback/?next=%2Fparent%2Ffamily%2F`,
        shouldCreateUser: true,
      },
    });
  });

  it("switches the sign-in flow into the selected language", () => {
    render(
      <LanguageProvider>
        <AuthPanel />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "zh" },
    });

    expect(screen.getByText("家长登录")).toBeInTheDocument();
    expect(screen.getByText("邮箱一次性登录链接")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "给我发送登录链接" })).toBeInTheDocument();
  });
});
