"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  type ChildAssignmentSummary,
  getChildAccessToken,
  getChildAssignments,
  getTodayReviews,
} from "@/lib/api-client";

const demoAssignment: ChildAssignmentSummary = {
  id: "demo",
  title: "Algebra & English warm-up",
  status: "in_progress",
  mode: "practice",
  time_limit_seconds: null,
  question_count: 3,
  latest_attempt_id: null,
};

function assignmentHref(assignment: ChildAssignmentSummary) {
  if (
    assignment.latest_attempt_id &&
    ["grading", "results_ready", "submitted", "completed"].includes(
      assignment.status,
    )
  ) {
    return `/child/results/?attemptId=${encodeURIComponent(assignment.latest_attempt_id)}`;
  }
  if (assignment.latest_attempt_id) {
    return `/child/work/?attemptId=${encodeURIComponent(assignment.latest_attempt_id)}`;
  }
  return `/child/work/?assignmentId=${encodeURIComponent(assignment.id)}`;
}

export default function ChildHomePage() {
  const [assignments, setAssignments] = useState<ChildAssignmentSummary[]>([
    demoAssignment,
  ]);
  const [reviewCount, setReviewCount] = useState(3);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const childToken = getChildAccessToken();
    if (!childToken) {
      return;
    }
    void Promise.all([
      getChildAssignments(childToken),
      getTodayReviews(childToken),
    ])
      .then(([loadedAssignments, reviews]) => {
        setAssignments(loadedAssignments);
        setReviewCount(reviews.length);
        setConnected(true);
      })
      .catch(() => {
        setConnected(false);
      });
  }, []);

  const current = assignments[0];

  return (
    <AppShell currentPath="/child/" role="child">
      <header className="child-welcome">
        <div>
          <p className="eyebrow">Today</p>
          <h1>Ready for a small win?</h1>
          <p>
            {assignments.length} assignment{assignments.length === 1 ? "" : "s"}{" "}
            and {reviewCount} review question{reviewCount === 1 ? "" : "s"}.
          </p>
        </div>
        <span className="child-mascot" aria-hidden="true">
          A
        </span>
      </header>

      {current ? (
        <section className="continue-card">
          <div className="continue-copy">
            <span className="status-pill warm">
              {current.status === "assigned" ? "Start" : current.status}
            </span>
            <p>{current.mode === "exam" ? "Exam mode" : "Practice mode"}</p>
            <h2>{current.title}</h2>
            <div className="continue-meta">
              <span>
                <BookOpen size={16} /> {current.question_count} questions
              </span>
              <span>
                <Clock3 size={16} />{" "}
                {current.time_limit_seconds
                  ? `${Math.ceil(current.time_limit_seconds / 60)} min`
                  : "no timer"}
              </span>
            </div>
            <Link className="button primary large" href={assignmentHref(current)}>
              {["grading", "results_ready", "submitted", "completed"].includes(
                current.status,
              )
                ? "View status"
                : "Open work"}{" "}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="continue-art" aria-hidden="true">
            <span>(a + b)</span>
            <i>×</i>
            <span>(a − b)</span>
          </div>
        </section>
      ) : (
        <section className="continue-card">
          <div className="continue-copy">
            <span className="status-pill">All clear</span>
            <h2>No assigned work is waiting.</h2>
            <p>A parent can assign the next practice from the family workspace.</p>
          </div>
        </section>
      )}

      <section className="today-review">
        <div className="review-orb">
          <Sparkles size={22} />
        </div>
        <div>
          <p className="eyebrow">Today&apos;s review</p>
          <h2>{reviewCount} short questions</h2>
          <p>You can skip today. Missed work will be rescheduled gently.</p>
        </div>
        <Link className="button ghost" href="/child/review/">
          {reviewCount > 0 ? "Start review" : "View review"}
        </Link>
      </section>
      {!connected ? (
        <p className="settings-note">
          Showing the local demo until a child signs in with a real profile.
        </p>
      ) : null}
    </AppShell>
  );
}
