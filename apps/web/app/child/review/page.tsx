"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  completeReview,
  getChildAccessToken,
  getTodayReviews,
  type ReviewItem,
} from "@/lib/api-client";

export default function ChildReviewPage() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [completed, setCompleted] = useState<Record<string, string>>({});

  useEffect(() => {
    const childToken = getChildAccessToken();
    if (!childToken) {
      return;
    }
    void getTodayReviews(childToken).then(setReviews);
  }, []);

  const record = async (
    review: ReviewItem,
    outcome: "correct" | "incorrect",
  ) => {
    const childToken = getChildAccessToken();
    if (!childToken) {
      return;
    }
    const result = await completeReview(review.id, outcome, childToken);
    setCompleted((current) => ({
      ...current,
      [review.id]: `Next review: ${result.next_due_on}`,
    }));
  };

  return (
    <AppShell currentPath="/child/review/" role="child">
      <section className="review-hero">
        <span>
          <Sparkles />
        </span>
        <p className="eyebrow">Today&apos;s review</p>
        <h1>
          {reviews.length} quick question{reviews.length === 1 ? "" : "s"}
        </h1>
        <p>A short mix at the right level, with no timer.</p>
        {reviews.length === 0 ? (
          <>
            <p>Nothing is due today.</p>
            <Link className="button primary large" href="/child/">
              Back home <ArrowRight size={17} />
            </Link>
          </>
        ) : null}
      </section>

      {reviews.length > 0 ? (
        <section className="draft-question-list">
          {reviews.map((review, index) => (
            <article key={review.id}>
              <div className="draft-question-number">{index + 1}</div>
              <div>
                <span className="question-type">{review.level}</span>
                <h2>{review.prompt}</h2>
                {completed[review.id] ? (
                  <p className="form-notice">{completed[review.id]}</p>
                ) : (
                  <div className="header-actions">
                    <button
                      className="button primary"
                      onClick={() => void record(review, "correct")}
                      type="button"
                    >
                      I got it
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => void record(review, "incorrect")}
                      type="button"
                    >
                      I need another try
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <button className="skip-button" type="button">
        <CalendarDays size={16} /> Skip for today
      </button>
    </AppShell>
  );
}
