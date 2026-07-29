import { beforeEach, describe, expect, it, vi } from "vitest";

import { setManagementPin } from "@/lib/api-client";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

function jwt(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

describe("parent API session refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getSupabaseBrowserClient).mockReset();
  });

  it("retries an expired parent request with the current Supabase session", async () => {
    const expiredToken = jwt({ exp: 1, sub: "parent-1" });
    const currentToken = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "parent-1",
    });
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: currentToken,
              user: { id: "parent-1" },
            },
          },
        }),
      },
    } as never);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "A valid parent session is required." }),
          {
            headers: { "Content-Type": "application/json" },
            status: 401,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await setManagementPin("family-1", "000000", expiredToken);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${expiredToken}`,
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${currentToken}`,
    });
  });

  it("reports a final API error without copying the PIN, token, or query", async () => {
    window.history.replaceState(
      {},
      "",
      "/parent/family/?code=secret-login-code",
    );
    const currentToken = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "parent-1",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "PIN 000000 failed unexpectedly" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 500,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      setManagementPin("family-1", "000000", currentToken),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8000/v1/client-logs",
    );
    const report = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(report).toMatchObject({
      error_code: "http_500",
      event: "api_request_failed",
      page: "/parent/family/",
      request_method: "PUT",
      request_path: "/v1/families/family-1/management-pin",
      status_code: 500,
    });
    expect(JSON.stringify(report)).not.toContain("000000");
    expect(JSON.stringify(report)).not.toContain(currentToken);
    expect(JSON.stringify(report)).not.toContain("secret-login-code");
  });
});
