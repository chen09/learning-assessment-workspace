"use client";

import { AlertCircle, Check, PenLine } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import {
  type AttemptResult,
  createCorrectionAttempt,
  getActiveChildProfile,
  getAttemptResults,
  getChildAccessToken,
} from "@/lib/api-client";

const subscribeToHydration = () => () => undefined;
const getRequestedAttemptId = () =>
  new URLSearchParams(window.location.search).get("attemptId");
const getServerAttemptId = () => null;

export default function ChildResultsPage() {
  return (
    <AppShell currentPath="/child/history/" role="child">
      <ChildResultsContent />
    </AppShell>
  );
}

function ChildResultsContent() {
  const { t } = useLanguage();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const requestedAttemptId = useSyncExternalStore(
    subscribeToHydration,
    getRequestedAttemptId,
    getServerAttemptId,
  );
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "missing"
  >("loading");
  const [correctionStatus, setCorrectionStatus] = useState<
    "idle" | "working" | "error"
  >("idle");
  const [childName, setChildName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const profile = getActiveChildProfile();
    if (profile) {
      queueMicrotask(() => {
        if (active) {
          setChildName(profile.nickname);
        }
      });
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const id = requestedAttemptId;
    const token = getChildAccessToken();
    if (!id) {
      queueMicrotask(() => setLoadState("missing"));
      return;
    }
    if (!token) {
      queueMicrotask(() => setLoadState("missing"));
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const payload = await getAttemptResults(id, token);
        if (cancelled) {
          return;
        }
        setAttemptId(id);
        if (payload.complete) {
          setResults(payload.results);
          setLoadState("ready");
          return;
        }
        timer = window.setTimeout(() => void poll(), 2000);
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void poll(), 4000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [requestedAttemptId]);

  const score = useMemo(
    () =>
      results.reduce(
        (total, result) => total + (result.awarded_points ?? 0),
        0,
      ),
    [results],
  );
  const correctionCount = results.filter(
    (result) => result.outcome !== "correct",
  ).length;
  const visibleComplete = loadState === "ready";
  const correctionActionReady =
    hydrated && loadState === "ready" && Boolean(attemptId);
  const correctionButtonLabel =
    !correctionActionReady || correctionStatus === "working"
      ? t("results.preparingCorrections")
      : t("results.correctAnswers");

  const beginCorrection = async () => {
    const token = getChildAccessToken();
    if (!attemptId || !token) {
      return;
    }
    setCorrectionStatus("working");
    try {
      const work = await createCorrectionAttempt(
        attemptId,
        token,
        `correction-${attemptId}`,
      );
      window.location.assign(
        `/child/work/?attemptId=${encodeURIComponent(work.attempt.id)}`,
      );
    } catch {
      setCorrectionStatus("error");
    }
  };

  return (
    <>
      <header className="result-header">
        <div>
          <p className="eyebrow">
            {loadState === "missing"
              ? t("results.unavailable")
              : visibleComplete
                ? t("results.ready")
                : t("results.checking")}
          </p>
          <h1>
            {loadState === "missing"
              ? t("results.unavailableTitle")
              : visibleComplete
                ? t("results.goodWork", {
                    name: childName ?? t("role.child"),
                  })
                : t("results.almostReady")}
          </h1>
          <p>
            {loadState === "missing"
              ? t("results.unavailableBody")
              : visibleComplete
                ? t(
                    correctionCount === 1
                      ? "results.correctionOne"
                      : "results.correctionMany",
                    { count: correctionCount },
                  )
                : t("results.fullResult")}
          </p>
        </div>
        {loadState !== "missing" ? (
          <div className="score-badge">
            <strong>{visibleComplete ? score : "—"}</strong>
            <span>{t("results.points")}</span>
          </div>
        ) : null}
      </header>
      <section className="result-list" aria-live="polite">
        {visibleComplete
          ? results.map((result, index) => {
              const isCorrect = result.outcome === "correct";
              const isIncorrect = result.outcome === "incorrect";
              return (
                <article
                  className={[
                    "result-item",
                    isCorrect
                      ? "correct-result"
                      : isIncorrect
                        ? "attention-result"
                        : "uncertain-result",
                  ].join(" ")}
                  key={result.id}
                >
                  <span className="result-icon">
                    {isCorrect ? (
                      <Check />
                    ) : isIncorrect ? (
                      <PenLine />
                    ) : (
                      <AlertCircle />
                    )}
                  </span>
                  <div>
                    <p>
                      {t("results.question", { number: index + 1 })}
                    </p>
                    <h2>
                      {isCorrect
                        ? t("results.correct")
                        : isIncorrect
                          ? t("results.tryAgain")
                          : t("results.parentCheck")}
                    </h2>
                    {result.feedback.summary ? (
                      <p className="result-summary">
                        {result.feedback.summary}
                      </p>
                    ) : null}
                    {result.feedback.action ? (
                      <p className="result-hint">
                        {result.feedback.action}
                      </p>
                    ) : null}
                    {result.parent_comment ? (
                      <p className="result-parent-comment">
                        {t("results.parentComment", {
                          comment: result.parent_comment,
                        })}
                      </p>
                    ) : null}
                    {result.transcript ? (
                      <details className="result-transcript">
                        <summary>{t("worksheet.transcript")}</summary>
                        <p>{result.transcript}</p>
                      </details>
                    ) : null}
                  </div>
                </article>
              );
            })
          : null}
      </section>
      {visibleComplete && correctionCount > 0 ? (
        <button
          aria-busy={
            !correctionActionReady || correctionStatus === "working"
          }
          className="button primary"
          disabled={
            !correctionActionReady || correctionStatus === "working"
          }
          onClick={() => void beginCorrection()}
          type="button"
        >
          {correctionButtonLabel}
        </button>
      ) : null}
      {correctionStatus === "error" ? (
        <p className="form-error" role="alert">
          {t("results.openError")}
        </p>
      ) : null}
    </>
  );
}
