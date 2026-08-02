"use client";

import {
  AlertCircle,
  Check,
  CircleHelp,
  Download,
  FileText,
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
import { MathText } from "@/components/math-text";
import {
  decideParentReview,
  getParentAccessToken,
  getParentAttemptReview,
  type GradingAnnotation,
  type ParentAttemptReview,
  type ParentReviewItem,
  type ResponseRevision,
} from "@/lib/api-client";

type Decision = "correct" | "incorrect";
type SavedDecision = Decision | "partial";
type Point = { x: number; y: number } | [number, number];
type Stroke = {
  points?: Point[];
  width?: number;
  eraser?: boolean;
};

const REVIEW_POLL_INTERVAL_MS = 2_000;
const subscribeToAttemptId = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
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

function xmlEscape(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function annotationSvg(annotations: GradingAnnotation[]) {
  const marks = annotations
    .map((annotation) => {
      const title = `<title>${xmlEscape(annotation.label)}</title>`;
      if (annotation.kind === "underline") {
        return `<line x1="${annotation.x}" y1="${annotation.y + annotation.height}" x2="${annotation.x + annotation.width}" y2="${annotation.y + annotation.height}">${title}</line>`;
      }
      if (annotation.kind === "cross") {
        return `<g>${title}<line x1="${annotation.x}" y1="${annotation.y}" x2="${annotation.x + annotation.width}" y2="${annotation.y + annotation.height}"/><line x1="${annotation.x + annotation.width}" y1="${annotation.y}" x2="${annotation.x}" y2="${annotation.y + annotation.height}"/></g>`;
      }
      return `<rect x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" rx="0.01">${title}</rect>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><g fill="none" stroke="#dc2626" stroke-width="0.006" vector-effect="non-scaling-stroke">${marks}</g></svg>`;
}

function downloadAnnotationOverlay(
  sourcePath: string | undefined,
  pageIndex: number,
  annotations: GradingAnnotation[],
) {
  if (!annotations.length || typeof document === "undefined") {
    return;
  }
  const originalFilename = sourcePath?.split("/").at(-1) || `page-${pageIndex + 1}`;
  const filename = `${originalFilename.replace(/\.[^.]+$/, "") || `page-${pageIndex + 1}`}-red-pencil.svg`;
  const overlay = new Blob([annotationSvg(annotations)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(overlay);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function PhotoPreview({
  item,
  label,
}: {
  item: ParentReviewItem;
  label: string;
}) {
  const { t } = useLanguage();
  const [showAnnotations, setShowAnnotations] = useState(false);
  const rawPaths = Array.isArray(item.response_answer.paths)
    ? item.response_answer.paths
    : item.response_answer.source_paths;
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((path): path is string => typeof path === "string")
    : [];
  const photoUrls = item.photo_urls ?? [];
  const annotations = (item.automated_feedback.annotations ?? []).filter(
    (annotation): annotation is GradingAnnotation =>
      Number.isFinite(annotation.x) &&
      Number.isFinite(annotation.y) &&
      Number.isFinite(annotation.width) &&
      Number.isFinite(annotation.height) &&
      typeof annotation.label === "string",
  );
  const annotationsForPage = (pageIndex: number) =>
    annotations.filter(
      (annotation) => (annotation.page_index ?? 0) === pageIndex,
    );
  return (
    <div aria-label={label} className="photo-answer-preview">
      {annotations.length ? (
        <button
          aria-pressed={showAnnotations}
          className="button ghost red-pencil-toggle"
          onClick={() => setShowAnnotations((current) => !current)}
          type="button"
        >
          {showAnnotations
            ? t("parentResults.hideRedMarks")
            : t("parentResults.showRedMarks")}
        </button>
      ) : null}
      {photoUrls.length ? (
        <div className="photo-answer-grid">
          {photoUrls.map((url, index) => {
            const pageAnnotations = annotationsForPage(index);
            const sourcePath = paths[index];
            const filename = sourcePath?.split("/").at(-1) ?? `${index + 1}`;
            const isPdf = /\.pdf$/i.test(filename);
            return (
              <figure className="annotated-photo" key={url}>
                {isPdf ? (
                  <a
                    aria-label={t("parentResults.openOriginalPdf", { filename })}
                    className="photo-answer-pdf"
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <FileText aria-hidden="true" />
                    <span>{filename}</span>
                    <small>{t("parentResults.openOriginalPdfAction")}</small>
                  </a>
                ) : (
                  <>
                    <div className="photo-answer-image-frame">
                      <Image
                        alt={`${label} ${index + 1}`}
                        height={1_600}
                        src={url}
                        unoptimized
                        width={1_200}
                      />
                      {showAnnotations && pageAnnotations.length ? (
                        <svg
                          aria-hidden="true"
                          className="grading-annotation-layer photo-grading-annotation-layer"
                          preserveAspectRatio="none"
                          viewBox="0 0 1 1"
                        >
                          {pageAnnotations.map((annotation, annotationIndex) => {
                            const commonProps = {
                              "data-grading-annotation": annotation.kind,
                              "data-testid": "red-pencil-mark",
                              vectorEffect: "non-scaling-stroke" as const,
                            };
                            if (annotation.kind === "underline") {
                              return (
                                <line
                                  {...commonProps}
                                  key={`${annotation.kind}-${annotationIndex}`}
                                  x1={annotation.x}
                                  x2={annotation.x + annotation.width}
                                  y1={annotation.y + annotation.height}
                                  y2={annotation.y + annotation.height}
                                />
                              );
                            }
                            if (annotation.kind === "cross") {
                              return (
                                <g
                                  data-grading-annotation={annotation.kind}
                                  data-testid="red-pencil-mark"
                                  key={`${annotation.kind}-${annotationIndex}`}
                                >
                                  <line
                                    vectorEffect="non-scaling-stroke"
                                    x1={annotation.x}
                                    x2={annotation.x + annotation.width}
                                    y1={annotation.y}
                                    y2={annotation.y + annotation.height}
                                  />
                                  <line
                                    vectorEffect="non-scaling-stroke"
                                    x1={annotation.x + annotation.width}
                                    x2={annotation.x}
                                    y1={annotation.y}
                                    y2={annotation.y + annotation.height}
                                  />
                                </g>
                              );
                            }
                            return (
                              <rect
                                {...commonProps}
                                height={annotation.height}
                                key={`${annotation.kind}-${annotationIndex}`}
                                rx={0.01}
                                width={annotation.width}
                                x={annotation.x}
                                y={annotation.y}
                              />
                            );
                          })}
                        </svg>
                      ) : null}
                    </div>
                    <figcaption>{filename}</figcaption>
                  </>
                )}
                {pageAnnotations.length ? (
                  <button
                    className="button ghost red-pencil-download"
                    onClick={() =>
                      downloadAnnotationOverlay(
                        sourcePath,
                        index,
                        pageAnnotations,
                      )
                    }
                    type="button"
                  >
                    <Download aria-hidden="true" />
                    {t("parentResults.downloadRedMarks")}
                  </button>
                ) : null}
              </figure>
            );
          })}
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
      {showAnnotations && annotations.length ? (
        <ol className="grading-annotation-list photo-grading-annotation-list">
          {annotations.map((annotation, index) => (
            <li key={`${annotation.page_index ?? 0}-${annotation.kind}-${index}`}>
              <span>{index + 1}</span>
              {annotation.label}
            </li>
          ))}
        </ol>
      ) : null}
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
    subscribeToAttemptId,
    getRequestedAttemptId,
    getServerAttemptId,
  );
  const [loadedReview, setLoadedReview] =
    useState<ParentAttemptReview | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reviewReloadVersion, setReviewReloadVersion] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, SavedDecision>>({});
  const [decisionComments, setDecisionComments] = useState<
    Record<string, string>
  >({});
  const [savedComments, setSavedComments] = useState<Record<string, string>>(
    {},
  );
  const [partialPoints, setPartialPoints] = useState<Record<string, string>>(
    {},
  );
  const [partialEntryId, setPartialEntryId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [decisionErrorId, setDecisionErrorId] = useState<string | null>(null);
  const review =
    loadState === "ready" && loadedReview?.attempt_id === attemptId
      ? loadedReview
      : null;

  useEffect(() => {
    const reloadReviewFromHistory = () => {
      setLoadedReview(null);
      setLoadState("loading");
      setDecisions({});
      setDecisionComments({});
      setSavedComments({});
      setPartialPoints({});
      setPartialEntryId(null);
      setSavingId(null);
      setDecisionErrorId(null);
      setReviewReloadVersion((current) => current + 1);
    };

    window.addEventListener("popstate", reloadReviewFromHistory);
    return () =>
      window.removeEventListener("popstate", reloadReviewFromHistory);
  }, []);

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
        setLoadedReview(payload);
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
  }, [attemptId, reviewReloadVersion]);

  const retryReview = () => {
    setLoadedReview(null);
    setLoadState("loading");
    setReviewReloadVersion((current) => current + 1);
  };

  const decide = async (
    item: ParentReviewItem,
    outcome: Decision,
    awardedPoints?: number,
  ) => {
    setSavingId(item.result_id);
    setDecisionErrorId(null);
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("Parent session is unavailable.");
      }
      const points =
        awardedPoints ?? (outcome === "correct" ? item.question_points : 0);
      const comment = decisionComments[item.result_id]?.trim() || null;
      await decideParentReview(
        item.result_id,
        {
          outcome,
          awarded_points: points,
          comment,
        },
        token,
        `parent-review-${item.result_id}`,
      );
      setDecisions((current) => ({
        ...current,
        [item.result_id]: outcome === "incorrect" && points > 0 ? "partial" : outcome,
      }));
      if (comment) {
        setSavedComments((current) => ({
          ...current,
          [item.result_id]: comment,
        }));
      }
      setLoadedReview((current) =>
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
        <div className="stacked-form">
          <p className="form-error" role="alert">
            {t("parentResults.error")}
          </p>
          <button className="button primary" onClick={retryReview} type="button">
            {t("history.retry")}
          </button>
        </div>
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
                const isPartialEntry = partialEntryId === item.result_id;
                const enteredPartialPoints = Number(
                  partialPoints[item.result_id] ?? "",
                );
                const canSavePartial =
                  Number.isFinite(enteredPartialPoints) &&
                  enteredPartialPoints > 0 &&
                  enteredPartialPoints < item.question_points;
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
                        <h2>
                          <MathText>{item.question_prompt}</MathText>
                        </h2>
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
                        <div>
                          <p>
                            {t(
                              decision === "correct"
                                ? "parentResults.savedCorrect"
                                : decision === "partial"
                                  ? "parentResults.savedPartial"
                                : "parentResults.savedIncorrect",
                            )}
                          </p>
                          {savedComments[item.result_id] ? (
                            <p className="parent-review-saved-comment">
                              {t("parentResults.savedComment", {
                                comment: savedComments[item.result_id],
                              })}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="parent-review-decision">
                        <label className="field-label parent-review-comment">
                          {t("parentResults.comment")}
                          <textarea
                            maxLength={500}
                            onChange={(event) =>
                              setDecisionComments((current) => ({
                                ...current,
                                [item.result_id]: event.target.value,
                              }))
                            }
                            placeholder={t("parentResults.commentHint")}
                            value={decisionComments[item.result_id] ?? ""}
                          />
                        </label>
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
                          <button
                            aria-expanded={isPartialEntry}
                            className="button ghost"
                            disabled={savingId === item.result_id}
                            onClick={() =>
                              setPartialEntryId((current) =>
                                current === item.result_id
                                  ? null
                                  : item.result_id,
                              )
                            }
                            type="button"
                          >
                            {t("parentResults.markPartial")}
                          </button>
                        </div>
                        {isPartialEntry ? (
                          <div className="parent-review-partial">
                            <label className="field-label">
                              {t("parentResults.partialPoints", {
                                points: item.question_points,
                              })}
                              <input
                                inputMode="decimal"
                                max={item.question_points}
                                min="0"
                                onChange={(event) =>
                                  setPartialPoints((current) => ({
                                    ...current,
                                    [item.result_id]: event.target.value,
                                  }))
                                }
                                step="0.5"
                                type="number"
                                value={partialPoints[item.result_id] ?? ""}
                              />
                            </label>
                            <p>{t("parentResults.partialHint")}</p>
                            <div className="decision-row">
                              <button
                                className="button primary"
                                disabled={
                                  savingId === item.result_id || !canSavePartial
                                }
                                onClick={() =>
                                  void decide(
                                    item,
                                    "incorrect",
                                    enteredPartialPoints,
                                  )
                                }
                                type="button"
                              >
                                {savingId === item.result_id
                                  ? t("parentResults.saving")
                                  : t("parentResults.savePartial")}
                              </button>
                              <button
                                className="button ghost"
                                disabled={savingId === item.result_id}
                                onClick={() => setPartialEntryId(null)}
                                type="button"
                              >
                                {t("parentResults.cancelPartial")}
                              </button>
                            </div>
                            {!canSavePartial &&
                            partialPoints[item.result_id] ? (
                              <p className="form-error" role="alert">
                                {t("parentResults.partialInvalid", {
                                  points: item.question_points,
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
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
