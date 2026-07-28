"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
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
  const [items, setItems] = useState(demoHistory);

  useEffect(() => {
    const token = getChildAccessToken();
    if (!token) {
      return;
    }
    void getChildHistory(token).then(setItems).catch(() => undefined);
  }, []);

  return (
    <AppShell currentPath="/child/history/" role="child">
      <header className="page-header">
        <div>
          <p className="eyebrow">Your work</p>
          <h1>History</h1>
          <p className="lede">Finished sets, scores, and corrections.</p>
        </div>
      </header>
      <section className="history-list">
        {items.map((item) => (
          <article key={item.assignment_id}>
            <span>
              {item.submitted_at
                ? new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    day: "numeric",
                  }).format(new Date(item.submitted_at))
                : "Assigned"}
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>
                {item.correction_count > 0
                  ? `${item.correction_count} corrections`
                  : item.status.replaceAll("_", " ")}
              </p>
            </div>
            <strong>
              {item.awarded_points} / {item.available_points}
            </strong>
            {item.attempt_id ? (
              <Link
                aria-label={`Open results for ${item.title}`}
                href={`/child/results/?attemptId=${encodeURIComponent(
                  item.attempt_id,
                )}`}
              >
                Results
              </Link>
            ) : null}
          </article>
        ))}
      </section>
    </AppShell>
  );
}
