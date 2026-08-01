"use client";

import {
  AlertCircle,
  Check,
  CircleHelp,
  History,
  Image as ImageIcon,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  decideParentReview,
  getParentAccessToken,
  getParentAttemptReview,
  type ParentAttemptReview,
  type ParentReviewItem,
  type ResponseRevision,
} from "@/lib/api-client";

type Decision = "correct" | "incorrect";
type Point = { x: number; y: number } | [number, number];
type Stroke = {
  points?: Point[];
  width?: number;
  eraser?: boolean;
};

const REVIEW_POLL_INTERVAL_MS = 2_000;
const subscribeToHydration = () => () => undefined;
const getRequestedAttemptId = () =>
  new URLSearchParams(window.location.search).get("attemptId");
const getServerAttemptId = () => null;

function coordinates(point: Point) {
  return Array.isArray(point)
    ? { x: point[0], y: point[1] }
    : { x: point.x, y: point.y };
}

function HandwritingPreview({
  item,
  label,
}: {
  item: ParentReviewItem;
  label: string;
}) {
  const rawStrokes = item.response_answer.strokes;
  const strokes = Array.isArray(rawStrokes)
    ? (rawStrokes as Stroke[])
    : [];
  const rawCanvasSize = item.response_answer.canvas_size;
  const canvasSize =
    rawCanvasSize &&
    typeof rawCanvasSize === "object" &&
    "width" in rawCanvasSize &&
    "height" in rawCanvasSize &&
    typeof rawCanvasSize.width === "number" &&
    typeof rawCanvasSize.height === "number"
      ? rawCanvasSize
      : { width: 900, height: 420 };

  return (
    <div
      aria-label={label}
      className="handwriting-preview parent-handwriting-preview"
    >
      {strokes.length ? (
        <svg
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
        >
          {strokes.map((stroke, index) => {
            const points = (stroke.points ?? [])
              .map(coordinates)
              .map((point) => `${point.x},${point.y}`)
              .join(" ");
            return (
              <polyline
                fill="none"
                key={`${item.result_id}-${index}`}
                points={points}
                stroke={stroke.eraser ? "#fffdf8" : "#1f2833"}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={stroke.width ?? 2.5}
              />
            );
          })}
        </svg>
      ) : (
        <p>—</p>
      )}
    </div>
  );
}

function PhotoPreview({
  item,
  label,
}: {
  item: ParentReviewItem;
  label: string;
}) {
  const rawPaths = item.response_answer.paths;
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((path): path is string => typeof path === "string")
    : [];
  const photoUrls = item.photo_urls ?? [];
  return (
    <div aria-label={label} className="photo-answer-preview">
      {photoUrls.length ? (
        <div className="photo-answer-grid">
          {photoUrls.map((url, index) => (
            <figure key={url}>
              <Image
                alt={`${label} ${index + 1}`}
                height={1_600}
                src={url}
                unoptimized
                width={1_200}
              />
              <figcaption>
                {paths[index]?.split("/").at(-1) ?? `${index + 1}`}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="handwriting-preview">
          <ImageIcon aria-hidden="true" />
          {paths.length ? (
            <ol>
              {paths.map((path) => (
                <li key={path}>{path.split("/").at(-1)}</li>
              ))}
            </ol>
          ) : (
            <p>—</p>
          )}
        </div>
      )}
    </div>
  );
}

function revisionText(
  revision: ResponseRevision,
  t: ReturnType<typeof useLanguage>["t"],
) {
  if (revision.change === "photo_added") {
    return t("parentResults.revision.photoAdded", {
      count: revision.page_count,
    });
  }
  if (revision.change === "photo_removed") {
    return t("parentResults.revision.photoRemoved", {
      count: revision.previous_page_count,
    });
  }
  return t("parentResults.revision.photoUpdated", {
    from: revision.previous_page_count,
    to: revision.page_count,
  });
}

function revisionTimestamp(savedAt: string, language: ReturnType<typeof useLanguage>["language"]) {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(
    language === "ja" ? "ja-JP" : language === "zh" ? "zh-CN" : "en-US",
    { dateStyle: "medium", timeStyle: "short" },
  ).format(date);
}

export default function ParentResultsPage() {
  return (
    <AppShell currentPath="/parent/history/" role="parent">
      <ParentResultsContent />
    </AppShell>
  );
}

function ParentResultsContent() {
  const { language, t } = useLanguage();
  const attemptId = useSyncExternalStore(
    subscribeToHydration,
    getRequestedAttemptId,
    getServerAttemptId,
  );
  const [review, setReview] = useState<ParentAttemptReview | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [decisionErrorId, setDecisionErrorId] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptId) {
      queueMicrotask(() => setLoadState("ready"));
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadReview = async () => {
      try {
        const token = await getParentAccessToken();
        if (!token) {
          throw new Error("Parent session is unavailable.");
        }
        const payload = await getParentAttemptReview(attemptId, token);
        if (cancelled) {
          return;
        }
        setReview(payload);
        setLoadState("ready");
        if (!payload.complete) {
          retryTimer = setTimeout(() => {
            void loadReview();
          }, REVIEW_POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          setLoadState("error");
        }
      }
    };

    void loadReview();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [attemptId]);

  const decide = async (item: ParentReviewItem, outcome: Decision) => {
    setSavingId(item.result_id);
    setDecisionErrorId(null);
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("Parent session is unavailable.");
      }
      const points = outcome === "correct" ? item.question_points : 0;
      await decideParentReview(
        item.result_id,
        {
          outcome,
          awarded_points: points,
          comment: null,
        },
        token,
        `parent-review-${item.result_id}`,
      );
      setDecisions((current) => ({
        ...current,
        [item.result_id]: outcome,
      }));
      setReview((current) =>
        current
          ? {
              ...current,
              awarded_points: current.awarded_points + points,
              correct_count:
                current.correct_count + (outcome === "correct" ? 1 : 0),
              correction_count:
                current.correction_count + (outcome === "incorrect" ? 1 : 0),
              pending_review_count: Math.max(
                0,
                current.pending_review_count - 1,
              ),
            }
          : current,
      );
    } catch {
      setDecisionErrorId(item.result_id);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {review
              ? t("parentResults.eyebrow", {
                  name: review.child_nickname,
                  title: review.title,
                })
              : t("parentResults.wholeSet")}
          </p>
          <h1>{t("parentResults.title")}</h1>
          <p className="lede">{t("parentResults.description")}</p>
          {review?.source_material_title ? (
            <p className="record-source">
              {t("parentHistory.sourceMaterial", {
                title: review.source_material_title,
                subject: review.source_material_subject
                  ? ` · ${review.source_material_subject}`
                  : "",
              })}
            </p>
          ) : null}
        </div>
        <LanguageSwitcher />
      </header>

      {loadState === "loading" ? (
        <p role="status">{t("parentResults.loading")}</p>
      ) : loadState === "error" ? (
        <p className="form-error" role="alert">
          {t("parentResults.error")}
        </p>
      ) : !attemptId ? (
        <p className="empty-state">{t("parentResults.missingAttempt")}</p>
      ) : review && !review.complete ? (
        <p className="empty-state" role="status">
          {t("parentResults.processing")}
        </p>
      ) : review ? (
        <section className="review-result-grid">
          <div>
            {review.reviews.length === 0 ? (
              <p className="empty-state">
                {t("parentResults.allReviewed")}
              </p>
            ) : (
              review.reviews.map((item) => {
                const decision = decisions[item.result_id];
                const typeLabel = t(
                  item.response_kind === "photo"
                    ? "parentResults.photo"
                    : "parentResults.handwriting",
                );
                return (
                  <article className="parent-review-card" key={item.result_id}>
                    <header>
                      <span>
                        <CircleHelp />
                      </span>
                      <div>
                        <p>
                          {t("parentResults.question", {
                            number: item.question_position,
                            type: typeLabel,
                          })}
                        </p>
                        <h2>{item.question_prompt}</h2>
                      </div>
                    </header>
                    {item.response_kind === "photo" ? (
                      <PhotoPreview
                        item={item}
                        label={t("parentResults.photoList")}
                      />
                    ) : (
                      <HandwritingPreview
                        item={item}
                        label={t("parentResults.handwritingPreview")}
                      />
                    )}
                    <div className="ai-observation">
                      <PenLine />
                      <p>{t("parentResults.parentNeeded")}</p>
                    </div>
                    {decision ? (
                      <div className="confirmed-message" role="status">
                        <ShieldCheck />
                        {t(
                          decision === "correct"
                            ? "parentResults.savedCorrect"
                            : "parentResults.savedIncorrect",
                        )}
                      </div>
                    ) : (
                      <div className="decision-row">
                        <button
                          className="button primary"
                          disabled={savingId === item.result_id}
                          onClick={() => void decide(item, "correct")}
                          type="button"
                        >
                          <Check />
                          {savingId === item.result_id
                            ? t("parentResults.saving")
                            : t("parentResults.markCorrect")}
                        </button>
                        <button
                          className="button ghost"
                          disabled={savingId === item.result_id}
                          onClick={() => void decide(item, "incorrect")}
                          type="button"
                        >
                          {t("parentResults.markIncorrect")}
                        </button>
                      </div>
                    )}
                    {decisionErrorId === item.result_id ? (
                      <p className="form-error" role="alert">
                        <AlertCircle />
                        {t("parentResults.decisionError")}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
          <aside className="result-context">
            <p className="eyebrow">{t("parentResults.wholeSet")}</p>
            <h2>
              {t("parentResults.score", {
                awarded: review.awarded_points,
                available: review.available_points,
              })}
            </h2>
            <dl>
              <div>
                <dt>{t("parentResults.correct")}</dt>
                <dd>{review.correct_count}</dd>
              </div>
              <div>
                <dt>{t("parentResults.correction")}</dt>
                <dd>{review.correction_count}</dd>
              </div>
              <div>
                <dt>{t("parentResults.pending")}</dt>
                <dd>{review.pending_review_count}</dd>
              </div>
            </dl>
            <p>{t("parentResults.releaseNote")}</p>
            {review.response_revisions.length ? (
              <section className="response-revision-timeline">
                <header>
                  <History aria-hidden="true" />
                  <div>
                    <h3>{t("parentResults.revision.title")}</h3>
                    <p>{t("parentResults.revision.description")}</p>
                  </div>
                </header>
                <ol>
                  {review.response_revisions.map((revision) => (
                    <li
                      key={`${revision.question_id}-${revision.response_version}`}
                    >
                      <strong>
                        {t("parentResults.question", {
                          number: revision.question_position,
                          type: t("parentResults.photo"),
                        })}
                      </strong>
                      <span>{revisionText(revision, t)}</span>
                      <small>
                        {t("parentResults.revision.version", {
                          version: revision.response_version,
                        })}
                        {" · "}
                        {revisionTimestamp(revision.saved_at, language)}
                      </small>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </aside>
        </section>
      ) : null}
    </>
  );
}
