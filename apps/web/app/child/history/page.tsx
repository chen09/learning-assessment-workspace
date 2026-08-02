"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import {
  getChildAccessToken,
  getChildHistory,
  type HistoryItem,
} from "@/lib/api-client";

export default function ChildHistoryPage() {
  return (
    <AppShell currentPath="/child/history/" role="child">
      <ChildHistoryContent />
    </AppShell>
  );
}

const historyStatusKeys = {
  draft: "history.status.draft",
  confirmed: "history.status.confirmed",
  assigned: "history.status.assigned",
  in_progress: "history.status.inProgress",
  submitted: "history.status.submitted",
  grading: "history.status.grading",
  results_ready: "history.status.resultsReady",
  correcting: "history.status.correcting",
  completed: "history.status.completed",
} as const;

const resultStatuses = new Set([
  "submitted",
  "grading",
  "results_ready",
  "completed",
]);

const resumableStatuses = new Set(["assigned", "in_progress", "correcting"]);

function ChildHistoryContent() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >("loading");
  const latestHistoryRequest = useRef(0);

  const refreshHistory = useCallback(async () => {
    const request = latestHistoryRequest.current + 1;
    latestHistoryRequest.current = request;
    const token = getChildAccessToken();
    if (!token) {
      if (latestHistoryRequest.current !== request) {
        return;
      }
      setItems([]);
      setLoadState("signed-out");
      return;
    }
    try {
      const nextItems = await getChildHistory(token);
      if (latestHistoryRequest.current !== request) {
        return;
      }
      setItems(nextItems);
      setLoadState("ready");
    } catch {
      if (latestHistoryRequest.current !== request) {
        return;
      }
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshHistory();
    }, 0);
    const refreshWhenReturning = () => {
      void refreshHistory();
    };
    window.addEventListener("focus", refreshWhenReturning);
    return () => {
      latestHistoryRequest.current += 1;
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refreshWhenReturning);
    };
  }, [refreshHistory]);

  const dateLocale = { en: "en-US", ja: "ja-JP", zh: "zh-CN" }[language];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("history.eyebrow")}</p>
          <h1>{t("history.title")}</h1>
          <p className="lede">{t("history.description")}</p>
        </div>
      </header>
      <section aria-live="polite" className="history-list">
        {loadState === "loading" ? (
          <p className="form-notice">{t("history.loading")}</p>
        ) : null}
        {loadState === "ready" && items.length === 0 ? (
          <p className="form-notice">{t("history.empty")}</p>
        ) : null}
        {loadState === "signed-out" || loadState === "error" ? (
          <p className="form-error">{t("history.error")}</p>
        ) : null}
        {loadState === "ready"
          ? items.map((item) => {
              const canResume = resumableStatuses.has(item.status);
              const canOpenResults =
                resultStatuses.has(item.status) && Boolean(item.attempt_id);
              const href =
                item.status === "assigned"
                  ? `/child/work/?assignmentId=${encodeURIComponent(
                      item.assignment_id,
                    )}`
                  : canResume && item.attempt_id
                    ? `/child/work/?attemptId=${encodeURIComponent(item.attempt_id)}`
                    : canOpenResults && item.attempt_id
                      ? `/child/results/?attemptId=${encodeURIComponent(
                          item.attempt_id,
                        )}`
                      : null;
              return (
                <article key={item.assignment_id}>
                  <span>
                    {item.submitted_at
                      ? new Intl.DateTimeFormat(dateLocale, {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(item.submitted_at))
                      : t("history.assigned")}
                  </span>
                  <div>
                    <h2>{item.title}</h2>
                    <p>
                      {item.correction_count > 0
                        ? t(
                            item.correction_count === 1
                              ? "history.correctionOne"
                              : "history.correctionMany",
                            { count: item.correction_count },
                          )
                        : t(
                            historyStatusKeys[
                              item.status as keyof typeof historyStatusKeys
                            ] ?? "history.status.other",
                          )}
                    </p>
                  </div>
                  {resultStatuses.has(item.status) ? (
                    <strong>
                      {item.awarded_points} / {item.available_points}
                    </strong>
                  ) : null}
                  {href ? (
                    <Link
                      aria-label={t(
                        canResume
                          ? item.status === "assigned"
                            ? "history.startTitle"
                            : "history.resumeTitle"
                          : "history.openResults",
                        { title: item.title },
                      )}
                      href={href}
                    >
                      {t(
                        canResume
                          ? item.status === "assigned"
                            ? "history.start"
                            : "history.resume"
                          : "history.results",
                      )}
                    </Link>
                  ) : null}
                </article>
              );
            })
          : null}
      </section>
    </>
  );
}
