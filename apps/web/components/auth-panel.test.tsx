import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPanel } from "@/components/auth-panel";

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
        emailRedirectTo: `${window.location.origin}/auth/callback/?next=%2Fparent%2F`,
        shouldCreateUser: true,
      },
    });
  });
});
