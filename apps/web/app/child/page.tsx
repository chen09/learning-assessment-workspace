"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import {
  type ChildAssignmentSummary,
  getChildAccessToken,
  getChildAssignments,
  getTodayReviews,
} from "@/lib/api-client";

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
  return (
    <AppShell currentPath="/child/" role="child">
      <ChildHomeContent />
    </AppShell>
  );
}

function ChildHomeContent() {
  const { t } = useLanguage();
  const [assignments, setAssignments] = useState<ChildAssignmentSummary[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      const childToken = getChildAccessToken();
      if (!childToken) {
        setLoadState("signed-out");
        return;
      }
      try {
        const [loadedAssignments, reviews] = await Promise.all([
          getChildAssignments(childToken),
          getTodayReviews(childToken),
        ]);
        if (!active) {
          return;
        }
        setAssignments(loadedAssignments);
        setReviewCount(reviews.length);
        setLoadState("ready");
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

  const current = assignments[0];
  const assignmentSummary = t(
    assignments.length === 1
      ? "childHome.assignmentOne"
      : "childHome.assignmentMany",
    { count: assignments.length },
  );
  const reviewSummary = t(
    reviewCount === 1 ? "childHome.reviewOne" : "childHome.reviewMany",
    { count: reviewCount },
  );
  const currentStatusLabel =
    current?.status === "assigned"
      ? t("childHome.start")
      : current?.status === "submitted"
        ? t("childHome.status.submitted")
        : current?.status === "grading"
          ? t("childHome.status.grading")
          : current?.status === "results_ready"
            ? t("childHome.status.resultsReady")
            : current?.status === "completed"
              ? t("childHome.status.completed")
              : t("childHome.status.inProgress");

  return (
    <>
      <header className="child-welcome">
        <div>
          <p className="eyebrow">{t("childHome.today")}</p>
          <h1>{t("childHome.title")}</h1>
          <p>
            {loadState === "ready"
              ? t("childHome.summary", {
                  assignments: assignmentSummary,
                  reviews: reviewSummary,
                })
              : loadState === "loading"
                ? t("childHome.loadingSummary")
                : t("worksheet.unavailable")}
          </p>
        </div>
        <span className="child-mascot" aria-hidden="true">
          <Sparkles size={32} />
        </span>
      </header>

      {loadState === "loading" ? (
        <section className="continue-card">
          <div className="continue-copy">
            <span className="status-pill">{t("worksheet.loading")}</span>
            <h2>{t("worksheet.loadingTitle")}</h2>
            <p>{t("worksheet.loadingBody")}</p>
          </div>
        </section>
      ) : current ? (
        <section className="continue-card">
          <div className="continue-copy">
            <span className="status-pill warm">
              {currentStatusLabel}
            </span>
            <p>
              {current.mode === "exam"
                ? t("childHome.examMode")
                : t("childHome.practiceMode")}
            </p>
            <h2>{current.title}</h2>
            {current.parent_note ? (
              <p className="assignment-parent-note">
                {current.parent_note}
              </p>
            ) : null}
            <div className="continue-meta">
              <span>
                <BookOpen size={16} />{" "}
                {t("childHome.questions", {
                  count: current.question_count,
                })}
              </span>
              <span>
                <Clock3 size={16} />{" "}
                {current.time_limit_seconds
                  ? t("childHome.minutes", {
                      count: Math.ceil(current.time_limit_seconds / 60),
                    })
                  : t("childHome.noTimer")}
              </span>
            </div>
            <Link className="button primary large" href={assignmentHref(current)}>
              {["grading", "results_ready", "submitted", "completed"].includes(
                current.status,
              )
                ? t("childHome.viewStatus")
                : t("childHome.openWork")}{" "}
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
            <span className="status-pill">
              {loadState === "ready"
                ? t("childHome.allClear")
                : t("worksheet.unavailable")}
            </span>
            <h2>
              {loadState === "ready"
                ? t("childHome.noAssigned")
                : loadState === "signed-out"
                  ? t("worksheet.signInRequired")
                  : t("worksheet.loadError")}
            </h2>
            <p>
              {loadState === "ready"
                ? t("childHome.parentCanAssign")
                : t("worksheet.tryAgain")}
            </p>
          </div>
        </section>
      )}

      <section className="today-review">
        <div className="review-orb">
          <Sparkles size={22} />
        </div>
        <div>
          <p className="eyebrow">{t("childHome.todayReview")}</p>
          <h2>{t("childHome.shortQuestions", { count: reviewCount })}</h2>
          <p>{t("childHome.reviewNote")}</p>
        </div>
        <Link className="button ghost" href="/child/review/">
          {reviewCount > 0
            ? t("childHome.startReview")
            : t("childHome.viewReview")}
        </Link>
      </section>
    </>
  );
}
