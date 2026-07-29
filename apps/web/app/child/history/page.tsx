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

const demoHistory: HistoryItem[] = [
  {
    assignment_id: "demo-today",
    attempt_id: null,
    child_id: "demo-child",
    child_nickname: "Alex",
    title: "Algebra & English warm-up",
    status: "results_ready",
    submitted_at: new Date().toISOString(),
    awarded_points: 6,
    available_points: 8,
    correction_count: 2,
  },
  {
    assignment_id: "demo-past",
    attempt_id: null,
    child_id: "demo-child",
    child_nickname: "Alex",
    title: "Past tense practice",
    status: "completed",
    submitted_at: "2026-07-26T09:00:00Z",
    awarded_points: 9,
    available_points: 10,
    correction_count: 0,
  },
];

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
  const [items, setItems] = useState(demoHistory);

  useEffect(() => {
    const token = getChildAccessToken();
    if (!token) {
      return;
    }
    void getChildHistory(token).then(setItems).catch(() => undefined);
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
      <section className="history-list">
        {items.map((item) => (
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
            <strong>
              {item.awarded_points} / {item.available_points}
            </strong>
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
        ))}
      </section>
    </>
  );
}
