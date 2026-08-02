"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { MathText } from "@/components/math-text";
import {
  getAvailableWordOrderTokens,
  moveWordOrderToken,
  removeWordOrderToken,
} from "@/lib/word-order";
import {
  completeReview,
  getChildAccessToken,
  getTodayReviews,
  skipTodayReviews,
  type ReviewAnswer,
  type ReviewItem,
} from "@/lib/api-client";

type CompletedReview = {
  nextDueOn: string;
  outcome?: "correct" | "incorrect";
};

type ReviewActionError = "save" | "skip";

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
  const [answers, setAnswers] = useState<Record<string, ReviewAnswer>>({});
  const [completed, setCompleted] = useState<Record<string, CompletedReview>>(
    {},
  );
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "signed-out" | "error"
  >("loading");
  const [skipping, setSkipping] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ReviewActionError | null>(
    null,
  );
  const latestReviewRequest = useRef(0);

  const refreshReviews = useCallback(async () => {
    const request = latestReviewRequest.current + 1;
    latestReviewRequest.current = request;
    const childToken = getChildAccessToken();
    if (!childToken) {
      if (latestReviewRequest.current !== request) {
        return;
      }
      setReviews([]);
      setLoadState("signed-out");
      return;
    }
    try {
      const nextReviews = await getTodayReviews(childToken);
      if (latestReviewRequest.current !== request) {
        return;
      }
      setReviews(nextReviews);
      setLoadState("ready");
    } catch {
      if (latestReviewRequest.current !== request) {
        return;
      }
      setReviews([]);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshReviews();
    }, 0);
    const refreshWhenReturning = () => {
      void refreshReviews();
    };
    window.addEventListener("focus", refreshWhenReturning);
    return () => {
      latestReviewRequest.current += 1;
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refreshWhenReturning);
    };
  }, [refreshReviews]);

  const updateAnswer = (reviewId: string, answer: ReviewAnswer) => {
    setAnswers((current) => ({ ...current, [reviewId]: answer }));
  };

  const record = async (review: ReviewItem) => {
    const childToken = getChildAccessToken();
    if (!childToken || submittingId === review.id) {
      return;
    }
    setActionError(null);
    setSubmittingId(review.id);
    try {
      const result = await completeReview(
        review.id,
        answers[review.id] ?? {},
        childToken,
      );
      setCompleted((current) => ({
        ...current,
        [review.id]: {
          nextDueOn: result.next_due_on,
          outcome: result.outcome,
        },
      }));
    } catch {
      setActionError("save");
    } finally {
      setSubmittingId(null);
    }
  };

  const skipToday = async () => {
    const childToken = getChildAccessToken();
    if (!childToken || skipping) {
      return;
    }
    setActionError(null);
    setSkipping(true);
    try {
      const skipped = await skipTodayReviews(childToken);
      setCompleted((current) => ({
        ...current,
        ...Object.fromEntries(
          skipped.map((item) => [item.item_id, { nextDueOn: item.next_due_on }]),
        ),
      }));
    } catch {
      setActionError("skip");
    } finally {
      setSkipping(false);
    }
  };

  const countKey =
    reviews.length === 1 ? "review.quickOne" : "review.quickMany";
  const dateLocale = { en: "en-US", ja: "ja-JP", zh: "zh-CN" }[language];

  const isAnswerReady = (review: ReviewItem) => {
    const answer = answers[review.id];
    if (review.answer_mode === "choice") {
      return Boolean(answer?.choices?.length);
    }
    if (review.answer_mode === "text") {
      return Boolean(answer?.text?.trim());
    }
    if (review.answer_mode === "tokens") {
      return Boolean(answer?.tokens?.length);
    }
    return false;
  };

  const renderAnswer = (review: ReviewItem) => {
    const answer = answers[review.id] ?? {};
    if (review.answer_mode === "choice") {
      const multiple = review.type === "multiple_choice";
      return (
        <fieldset className="choice-list">
          <legend>{t("review.chooseAnswer")}</legend>
          {review.options?.map((option, index) => {
            const selected = answer.choices?.includes(index) ?? false;
            return (
              <label className={selected ? "choice active" : "choice"} key={option}>
                <input
                  checked={selected}
                  name={review.id}
                  onChange={() => {
                    const choices = multiple
                      ? selected
                        ? (answer.choices ?? []).filter((choice) => choice !== index)
                        : [...(answer.choices ?? []), index].sort((left, right) => left - right)
                      : [index];
                    updateAnswer(review.id, { choices });
                  }}
                  type={multiple ? "checkbox" : "radio"}
                />
                <span aria-hidden="true" className="choice-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <strong>{option}</strong>
              </label>
            );
          })}
        </fieldset>
      );
    }
    if (review.answer_mode === "text") {
      return (
        <label className="typed-answer">
          {t("review.writeAnswer")}
          <input
            onChange={(event) => updateAnswer(review.id, { text: event.target.value })}
            placeholder={t("review.writeAnswer")}
            type="text"
            value={answer.text ?? ""}
          />
        </label>
      );
    }
    if (review.answer_mode === "tokens") {
      const selectedTokens = answer.tokens ?? [];
      return (
        <div className="typed-answer">
          <span>{t("review.buildSentence")}</span>
          {selectedTokens.length > 0 ? (
            <ol
              aria-label={t("worksheet.selectedWords")}
              className="word-order-selected"
            >
              {selectedTokens.map((token, index) => (
                <li className="word-order-token" key={`${token}-${index}`}>
                  <span>{token}</span>
                  <span className="word-order-token-actions">
                    <button
                      aria-label={t("worksheet.moveTokenEarlier", { token })}
                      className="word-order-token-button"
                      disabled={index === 0}
                      onClick={() =>
                        updateAnswer(review.id, {
                          tokens: moveWordOrderToken(selectedTokens, index, "left"),
                        })
                      }
                      type="button"
                    >
                      <ArrowLeft aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={t("worksheet.moveTokenLater", { token })}
                      className="word-order-token-button"
                      disabled={index === selectedTokens.length - 1}
                      onClick={() =>
                        updateAnswer(review.id, {
                          tokens: moveWordOrderToken(selectedTokens, index, "right"),
                        })
                      }
                      type="button"
                    >
                      <ArrowRight aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={t("worksheet.removeToken", { token })}
                      className="word-order-token-button"
                      onClick={() =>
                        updateAnswer(review.id, {
                          tokens: removeWordOrderToken(selectedTokens, index),
                        })
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("review.chooseWords")}</p>
          )}
          <div className="word-order-options">
            {getAvailableWordOrderTokens(review.options ?? [], selectedTokens).map((token, index) => (
              <button
                className="button ghost"
                key={`${token}-${index}`}
                onClick={() => updateAnswer(review.id, { tokens: [...selectedTokens, token] })}
                type="button"
              >
                {token}
              </button>
            ))}
            <button
              className="quiet-link"
              onClick={() => updateAnswer(review.id, { tokens: [] })}
              type="button"
            >
              {t("review.reset")}
            </button>
          </div>
        </div>
      );
    }
    return <p className="form-notice">{t("review.parentReview")}</p>;
  };

  return (
    <>
      <section className="review-hero">
        <span>
          <Sparkles />
        </span>
        <p className="eyebrow">{t("review.today")}</p>
        <h1>
          {loadState === "loading"
            ? t("review.loading")
            : loadState === "error"
              ? t("review.loadError")
              : loadState === "signed-out"
                ? t("history.signedOut")
            : t(countKey, { count: reviews.length })}
        </h1>
        <p>{t("review.description")}</p>
        {loadState === "ready" && reviews.length === 0 ? (
          <>
            <p>{t("review.none")}</p>
            <Link className="button primary large" href="/child/">
              {t("review.backHome")} <ArrowRight size={17} />
            </Link>
          </>
        ) : null}
        {loadState === "error" ? (
          <div className="form-error" role="alert">
            <p>{t("review.loadError")}</p>
            <button
              className="button ghost"
              onClick={() => {
                setLoadState("loading");
                void refreshReviews();
              }}
              type="button"
            >
              {t("worksheet.retryLoad")}
            </button>
          </div>
        ) : null}
        {loadState === "signed-out" ? (
          <Link className="button primary large" href="/child/login/">
            {t("review.backHome")} <ArrowRight size={17} />
          </Link>
        ) : null}
      </section>

      {loadState === "ready" && reviews.length > 0 ? (
        <section className="draft-question-list">
          {reviews.map((review, index) => (
            <article key={review.id}>
              <div className="draft-question-number">{index + 1}</div>
              <div>
                <span className="question-type">
                  {t(`review.level.${review.level}`)}
                </span>
                <h2>
                  <MathText>{review.prompt}</MathText>
                </h2>
                {completed[review.id] ? (
                  <p className="form-notice">
                    {completed[review.id].outcome === "correct"
                      ? t("review.result.correct")
                      : completed[review.id].outcome === "incorrect"
                        ? t("review.result.incorrect")
                        : null}{" "}
                    {t("review.next", {
                      date: new Intl.DateTimeFormat(dateLocale, {
                        dateStyle: "long",
                        timeZone: "UTC",
                      }).format(
                        new Date(`${completed[review.id].nextDueOn}T00:00:00Z`),
                      ),
                    })}
                  </p>
                ) : (
                  <div className="review-answer">
                    {renderAnswer(review)}
                    {review.answer_mode !== "parent_review" ? (
                      <button
                        className="button primary"
                        disabled={!isAnswerReady(review) || submittingId === review.id}
                        onClick={() => void record(review)}
                        type="button"
                      >
                        {submittingId === review.id
                          ? t("review.submitting")
                          : t("review.submit")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {actionError ? (
        <p className="form-error" role="alert">
          {t(
            actionError === "save"
              ? "review.saveError"
              : "review.skipError",
          )}
        </p>
      ) : null}

      <button
        className="skip-button"
        disabled={
          loadState !== "ready" ||
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
