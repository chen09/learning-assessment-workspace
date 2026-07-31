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
  stopAssignment,
  withdrawAssignment,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "missing" | "error";

export default function ParentHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [childFilter, setChildFilter] = useState("all");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [actionAssignmentId, setActionAssignmentId] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

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

  const updateAssignmentStatus = async (
    item: HistoryItem,
    action: "withdraw" | "stop",
  ) => {
    setActionAssignmentId(item.assignment_id);
    setActionError(null);
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("missing parent session");
      }
      const assignment =
        action === "withdraw"
          ? await withdrawAssignment(item.assignment_id, token)
          : await stopAssignment(item.assignment_id, token);
      setItems((current) =>
        current.map((candidate) =>
          candidate.assignment_id === item.assignment_id
            ? { ...candidate, status: assignment.status }
            : candidate,
        ),
      );
    } catch {
      setActionError("The assignment status could not be updated. Please retry.");
    } finally {
      setActionAssignmentId(null);
    }
  };

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
        {actionError ? <p role="alert">{actionError}</p> : null}
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
                {item.status === "assigned" ? (
                  <button
                    className="record-action"
                    disabled={actionAssignmentId === item.assignment_id}
                    onClick={() => void updateAssignmentStatus(item, "withdraw")}
                    type="button"
                  >
                    Withdraw assignment
                  </button>
                ) : null}
                {item.status === "in_progress" ? (
                  <button
                    className="record-action"
                    disabled={actionAssignmentId === item.assignment_id}
                    onClick={() => void updateAssignmentStatus(item, "stop")}
                    type="button"
                  >
                    Stop assignment
                  </button>
                ) : null}
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
