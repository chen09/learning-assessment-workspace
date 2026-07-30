"use client";

import { ArrowRight, Clock3, FileCheck2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  getFamilyHistory,
  type HistoryItem,
  getParentAccessToken,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "missing" | "error";

export default function ParentHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [childFilter, setChildFilter] = useState("all");
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;
    const familyId = new URLSearchParams(window.location.search).get(
      "familyId",
    );
    if (!familyId) {
      queueMicrotask(() => {
        if (active) {
          setLoadState("missing");
        }
      });
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const token = await getParentAccessToken();
        if (!token) {
          if (active) {
            setLoadState("error");
          }
          return;
        }
        const historyItems = await getFamilyHistory(familyId, token);
        if (active) {
          setItems(historyItems);
          setLoadState("ready");
        }
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const children = Array.from(
    new Map(items.map((item) => [item.child_id, item.child_nickname])),
  );
  const visibleItems =
    childFilter === "all"
      ? items
      : items.filter((item) => item.child_id === childFilter);

  return (
    <AppShell currentPath="/parent/history/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Learning record</p>
          <h1>History</h1>
          <p className="lede">
            Completed, grading, and archived work for every child in this
            family.
          </p>
        </div>
        <LanguageSwitcher />
      </header>
      <section className="filter-row" aria-label="History filters">
        <button
          className={childFilter === "all" ? "active" : ""}
          onClick={() => setChildFilter("all")}
          type="button"
        >
          All children
        </button>
        {children.map(([id, name]) => (
          <button
            className={childFilter === id ? "active" : ""}
            key={id}
            onClick={() => setChildFilter(id)}
            type="button"
          >
            {name}
          </button>
        ))}
      </section>
      <section className="record-table">
        {loadState === "loading" ? <p>Loading family history…</p> : null}
        {loadState === "missing" ? (
          <p>Select a family to view its history.</p>
        ) : null}
        {loadState === "error" ? (
          <p>Family history could not be loaded.</p>
        ) : null}
        {loadState === "ready" && visibleItems.length === 0 ? (
          <p>No family history yet.</p>
        ) : null}
        {loadState === "ready"
          ? visibleItems.map((item) => (
              <article key={item.assignment_id}>
                <span className="record-icon">
                  {item.status === "grading" ? <Clock3 /> : <FileCheck2 />}
                </span>
                <div>
                  <p>
                    {item.child_nickname} ·{" "}
                    {item.submitted_at
                      ? new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(item.submitted_at))
                      : "Assigned"}
                  </p>
                  <h2>{item.title}</h2>
                  <span>
                    {["results_ready", "correcting", "completed"].includes(
                      item.status,
                    )
                      ? `${item.awarded_points} / ${item.available_points} points · `
                      : ""}
                    {item.correction_count} corrections
                  </span>
                </div>
                <span
                  className={
                    item.correction_count > 0
                      ? "status-pill warm"
                      : "status-pill"
                  }
                >
                  {item.status.replaceAll("_", " ")}
                </span>
                {item.attempt_id ? (
                  <Link
                    aria-label={`Open ${item.title}`}
                    href={`/parent/results/?attemptId=${encodeURIComponent(
                      item.attempt_id,
                    )}`}
                  >
                    <ArrowRight />
                  </Link>
                ) : null}
              </article>
            ))
          : null}
      </section>
    </AppShell>
  );
}
