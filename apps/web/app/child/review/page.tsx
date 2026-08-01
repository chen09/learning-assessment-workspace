"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import {
  completeReview,
  getChildAccessToken,
  getTodayReviews,
  skipTodayReviews,
  type ReviewItem,
} from "@/lib/api-client";

export default function ChildReviewPage() {
  return (
    <AppShell currentPath="/child/review/" role="child">
      <ChildReviewContent />
    </AppShell>
  );
}

function ChildReviewContent() {
  const { language, t } = useLanguage();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    let active = true;
    const childToken = getChildAccessToken();
    if (!childToken) {
      queueMicrotask(() => {
        if (active) {
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }
    void getTodayReviews(childToken)
      .then((nextReviews) => {
        if (active) {
          setReviews(nextReviews);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
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
      [review.id]: result.next_due_on,
    }));
  };

  const skipToday = async () => {
    const childToken = getChildAccessToken();
    if (!childToken || skipping) {
      return;
    }
    setSkipping(true);
    try {
      const skipped = await skipTodayReviews(childToken);
      setCompleted((current) => ({
        ...current,
        ...Object.fromEntries(
          skipped.map((item) => [item.item_id, item.next_due_on]),
        ),
      }));
    } finally {
      setSkipping(false);
    }
  };

  const countKey =
    reviews.length === 1 ? "review.quickOne" : "review.quickMany";
  const dateLocale = { en: "en-US", ja: "ja-JP", zh: "zh-CN" }[language];

  return (
    <>
      <section className="review-hero">
        <span>
          <Sparkles />
        </span>
        <p className="eyebrow">{t("review.today")}</p>
        <h1>
          {loading
            ? t("review.loading")
            : t(countKey, { count: reviews.length })}
        </h1>
        <p>{t("review.description")}</p>
        {!loading && reviews.length === 0 ? (
          <>
            <p>{t("review.none")}</p>
            <Link className="button primary large" href="/child/">
              {t("review.backHome")} <ArrowRight size={17} />
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
                <span className="question-type">
                  {t(`review.level.${review.level}`)}
                </span>
                <h2>{review.prompt}</h2>
                {completed[review.id] ? (
                  <p className="form-notice">
                    {t("review.next", {
                      date: new Intl.DateTimeFormat(dateLocale, {
                        dateStyle: "long",
                        timeZone: "UTC",
                      }).format(
                        new Date(`${completed[review.id]}T00:00:00Z`),
                      ),
                    })}
                  </p>
                ) : (
                  <div className="header-actions">
                    <button
                      className="button primary"
                      onClick={() => void record(review, "correct")}
                      type="button"
                    >
                      {t("review.gotIt")}
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => void record(review, "incorrect")}
                      type="button"
                    >
                      {t("review.anotherTry")}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <button
        className="skip-button"
        disabled={
          loading ||
          reviews.length === 0 ||
          skipping ||
          reviews.every((review) => Boolean(completed[review.id]))
        }
        onClick={() => void skipToday()}
        type="button"
      >
        <CalendarDays size={16} /> {t("review.skip")}
      </button>
    </>
  );
}
