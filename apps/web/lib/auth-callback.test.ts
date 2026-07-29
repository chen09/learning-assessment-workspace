import { describe, expect, it, vi } from "vitest";

import { completeAuthCallback } from "@/lib/auth-callback";

describe("completeAuthCallback", () => {
  it("exchanges the PKCE code and returns the requested internal path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });

    await expect(
      completeAuthCallback(
        { auth: { exchangeCodeForSession } },
        new URL(
          "https://study.hypnochunk.com/auth/callback/?code=auth-code&next=%2Fparent%2F",
        ),
      ),
    ).resolves.toBe("/parent/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
  });

  it("rejects missing codes and external redirect targets", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });

    await expect(
      completeAuthCallback(
        { auth: { exchangeCodeForSession } },
        new URL(
          "https://study.hypnochunk.com/auth/callback/?next=https%3A%2F%2Fevil.example",
        ),
      ),
    ).rejects.toThrow("Missing authentication code");

    await expect(
      completeAuthCallback(
        { auth: { exchangeCodeForSession } },
        new URL(
          "https://study.hypnochunk.com/auth/callback/?code=auth-code&next=https%3A%2F%2Fevil.example",
        ),
      ),
    ).resolves.toBe("/parent/");
  });
});
