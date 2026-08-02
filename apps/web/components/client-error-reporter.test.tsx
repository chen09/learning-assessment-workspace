import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientErrorReporter } from "@/components/client-error-reporter";

describe("ClientErrorReporter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("records a runtime error without leaking query values or error content", async () => {
    window.history.replaceState(
      {},
      "",
      "/child/work/?token=private-token&answer=private-answer",
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(<ClientErrorReporter />);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "PIN 000000 and a private answer must never be logged",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(body).toMatchObject({
      event: "client_runtime_error",
      page: "/child/work/",
      error_code: "window_error",
    });
    expect(JSON.stringify(body)).not.toContain("private-token");
    expect(JSON.stringify(body)).not.toContain("private-answer");
    expect(JSON.stringify(body)).not.toContain("000000");
  });

  it("records an unhandled rejection as a safe event type", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(<ClientErrorReporter />);
    window.dispatchEvent(new Event("unhandledrejection"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      event: "client_unhandled_rejection",
      error_code: "unhandled_rejection",
    });
  });
});
