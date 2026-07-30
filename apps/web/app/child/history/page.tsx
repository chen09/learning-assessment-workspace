"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

function ChildHistoryContent() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >("loading");

  useEffect(() => {
    let active = true;
    const token = getChildAccessToken();
    if (!token) {
      queueMicrotask(() => {
        if (active) {
          setLoadState("signed-out");
        }
      });
      return () => {
        active = false;
      };
    }
    void getChildHistory(token)
      .then((nextItems) => {
        if (active) {
          setItems(nextItems);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setLoadState("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
          ? items.map((item) => (
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
                {["results_ready", "correcting", "completed"].includes(
                  item.status,
                ) ? (
                  <strong>
                    {item.awarded_points} / {item.available_points}
                  </strong>
                ) : null}
                {item.attempt_id ? (
                  <Link
                    aria-label={t("history.openResults", {
                      title: item.title,
                    })}
                    href={`/child/results/?attemptId=${encodeURIComponent(
                      item.attempt_id,
                    )}`}
                  >
                    {t("history.results")}
                  </Link>
                ) : null}
              </article>
            ))
          : null}
      </section>
    </>
  );
}
