"use client";

import { AlertCircle, Check, PenLine } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { AppShell } from "@/components/app-shell";
import {
  type AttemptResult,
  createCorrectionAttempt,
  getAttemptResults,
  getChildAccessToken,
} from "@/lib/api-client";

const demoResults: AttemptResult[] = [
  {
    id: "demo-correct",
    question_id: "algebra-choice",
    outcome: "correct",
    awarded_points: 1,
    confidence: 0.99,
    feedback: { summary: "Correct." },
  },
  {
    id: "demo-incorrect",
    question_id: "english-fill",
    outcome: "incorrect",
    awarded_points: 0,
    confidence: 0.98,
    feedback: {
      summary: "Try once more.",
      action: "Check the subject and the verb ending.",
    },
  },
  {
    id: "demo-uncertain",
    question_id: "algebra-proof",
    outcome: "uncertain",
    awarded_points: null,
    confidence: 0.35,
    feedback: { summary: "Waiting for a parent." },
  },
];

const subscribeToHydration = () => () => undefined;

export default function ChildResultsPage() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [results, setResults] = useState<AttemptResult[]>(demoResults);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [correctionStatus, setCorrectionStatus] = useState<
    "idle" | "working" | "error"
  >("idle");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("attemptId");
    const token = getChildAccessToken();
    if (!id || !token) {
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
        setComplete(payload.complete);
        if (payload.complete) {
          setResults(payload.results);
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
  }, []);

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
  const correctionButtonLabel =
    !hydrated || correctionStatus === "working"
      ? "Preparing corrections…"
      : "Correct these answers";

  const beginCorrection = async () => {
    const token = getChildAccessToken();
    if (!attemptId || !token) {
      window.location.assign("/child/work/?correction=demo");
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
    <AppShell currentPath="/child/history/" role="child">
      <header className="result-header">
        <div>
          <p className="eyebrow">
            {complete ? "Results ready" : "Checking your work"}
          </p>
          <h1>{complete ? "Good work, Alex" : "Almost ready"}</h1>
          <p>
            {complete
              ? `${correctionCount} answers are ready for one more try or a parent check.`
              : "The full result appears only after every answer is checked."}
          </p>
        </div>
        <div className="score-badge">
          <strong>{complete ? score : "—"}</strong>
          <span>points</span>
        </div>
      </header>
      <section className="result-list" aria-live="polite">
        {complete
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
                    <p>Question {index + 1}</p>
                    <h2>
                      {isCorrect
                        ? "Correct"
                        : isIncorrect
                          ? "Try once more"
                          : "Waiting for a parent"}
                    </h2>
                    {result.feedback.action ? (
                      <p className="result-hint">{result.feedback.action}</p>
                    ) : null}
                  </div>
                </article>
              );
            })
          : null}
      </section>
      {complete && correctionCount > 0 ? (
        <button
          aria-busy={!hydrated || correctionStatus === "working"}
          className="button primary"
          disabled={!hydrated || correctionStatus === "working"}
          onClick={() => void beginCorrection()}
          type="button"
        >
          {correctionButtonLabel}
        </button>
      ) : null}
      {correctionStatus === "error" ? (
        <p className="form-error" role="alert">
          Corrections could not be opened. Please try again.
        </p>
      ) : null}
    </AppShell>
  );
}
