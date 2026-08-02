"use client";

import { useEffect } from "react";

type RuntimeLogEvent =
  | "client_runtime_error"
  | "client_unhandled_rejection";

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:8000"
  );
}

function reportRuntimeEvent(event: RuntimeLogEvent, errorCode: string) {
  const payload = {
    event,
    page: window.location.pathname,
    error_code: errorCode,
    occurred_at: new Date().toISOString(),
  };

  void fetch(`${apiBaseUrl()}/v1/client-logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Client diagnostics must never affect the learner's session.
  });
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = () => {
      reportRuntimeEvent("client_runtime_error", "window_error");
    };
    const onUnhandledRejection = () => {
      reportRuntimeEvent(
        "client_unhandled_rejection",
        "unhandled_rejection",
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
