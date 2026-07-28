"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock3,
  Cloud,
  Focus,
  Grid2X2,
  Send,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  HandwritingCanvas,
  type Stroke,
} from "@/components/handwriting-canvas";
import {
  type DraftSyncRequest,
  removePendingDraftsByPrefix,
  removePendingDraft,
  savePendingDraft,
  syncPendingDrafts,
} from "@/lib/draft-queue";
import {
  createChildUploadIntent,
  getAttemptWork,
  getChildAccessToken,
  saveAttemptResponse,
  startAssignment,
  submitAttempt,
  uploadToSignedUrl,
} from "@/lib/api-client";

type Question = {
  id: string;
  number: number;
  type:
    | "choice"
    | "multiple_choice"
    | "word_order"
    | "text"
    | "handwriting"
    | "photo"
    | "listening";
  subject: string;
  prompt: string;
  options?: string[];
  points: number;
};

type Answer = {
  choice?: number;
  choices?: number[];
  tokens?: string[];
  text?: string;
  strokes?: Stroke[];
  photoNames?: string[];
  photoPaths?: string[];
};

const demoQuestions: Question[] = [
  {
    id: "algebra-choice",
    number: 1,
    type: "choice",
    subject: "Algebra · Foundation",
    prompt: "Choose the correct expansion of (a + b)(a − b).",
    options: ["a² − b²", "a² + b²", "a² − 2ab + b²"],
    points: 1,
  },
  {
    id: "english-fill",
    number: 2,
    type: "text",
    subject: "English · Present simple",
    prompt: "Complete: She ___ to school every day.",
    points: 1,
  },
  {
    id: "algebra-proof",
    number: 3,
    type: "handwriting",
    subject: "Algebra · Show your work",
    prompt: "Show why (a + b)(a − b) = a² − b².",
    points: 2,
  },
  {
    id: "math-photo",
    number: 4,
    type: "photo",
    subject: "Mathematics · Paper response",
    prompt: "Solve 3(x − 2) = 12 on paper, then photograph your work.",
    points: 2,
  },
  {
    id: "english-listening",
    number: 5,
    type: "listening",
    subject: "English · Listening",
    prompt: "Listen and choose where the speaker goes every morning.",
    options: ["The library", "School", "The station"],
    points: 1,
  },
];

export function WorksheetWorkbench() {
  const [questions, setQuestions] = useState<Question[]>(demoQuestions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<"focus" | "sheet">("focus");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "offline"
  >("idle");
  const [dirtyQuestionId, setDirtyQuestionId] = useState<string | null>(null);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [examMode, setExamMode] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(10 * 60);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [childToken, setChildToken] = useState<string | null>(null);
  const [responseVersions, setResponseVersions] = useState<
    Record<string, number>
  >({});
  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get("assignmentId");
    const existingAttemptId = params.get("attemptId");
    const token = getChildAccessToken();
    if ((!assignmentId && !existingAttemptId) || !token) {
      return;
    }
    const loadWork = existingAttemptId
      ? getAttemptWork(existingAttemptId, token)
      : startAssignment(assignmentId!, token);
    void loadWork
      .then((work) => {
        setChildToken(token);
        setAttemptId(work.attempt.id);
        setFamilyId(work.assignment.family_id);
        setExamMode(work.assignment.mode === "exam");
        if (work.assignment.time_limit_seconds) {
          setSecondsRemaining(work.assignment.time_limit_seconds);
        }
        setQuestions(
          work.questions.map((question) => ({
            id: question.id,
            number: question.position,
            type:
              question.type === "single_choice"
                ? "choice"
                : question.type === "multiple_choice"
                  ? "multiple_choice"
                  : question.type === "word_order"
                    ? "word_order"
                : question.type === "typed_text"
                  ? "text"
                  : question.type,
            subject: "Assigned practice",
            prompt: question.prompt,
            options: question.options ?? undefined,
            points: question.points,
          })),
        );
        return syncPendingDrafts(token);
      })
      .catch(() => setSaveStatus("offline"));
  }, []);

  useEffect(() => {
    if (!dirtyQuestionId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const answer = answers[dirtyQuestionId];
      const queueKey = `${attemptId ?? "demo-attempt"}:${dirtyQuestionId}`;
      const kind: DraftSyncRequest["payload"]["kind"] =
        answer?.photoPaths?.length
          ? "photo"
          : answer?.tokens !== undefined
            ? "tokens"
          : answer?.choices !== undefined
            ? "choice"
          : answer?.choice !== undefined
          ? "choice"
          : answer?.text !== undefined
            ? "text"
            : "strokes";
      const apiAnswer: Record<string, unknown> =
        kind === "photo"
          ? { paths: answer.photoPaths }
          : kind === "tokens"
          ? { tokens: answer?.tokens ?? [] }
          : kind === "choice"
          ? {
              choices:
                answer?.choices ??
                (answer?.choice === undefined ? [] : [answer.choice]),
            }
          : kind === "text"
            ? { text: answer.text ?? "" }
            : { strokes: answer?.strokes ?? [] };
      const syncRequest: DraftSyncRequest | undefined =
        attemptId && childToken
          ? {
              attemptId,
              questionId: dirtyQuestionId,
              payload: {
                kind,
                answer: apiAnswer,
                expected_version: responseVersions[dirtyQuestionId] ?? 0,
              },
            }
          : undefined;
      void savePendingDraft(
        queueKey,
        answer,
        syncRequest,
      )
        .then(async () => {
          if (!syncRequest || !childToken) {
            setSaveStatus("saved");
            setDirtyQuestionId(null);
            return;
          }
          const saved = await saveAttemptResponse(
            syncRequest.attemptId,
            syncRequest.questionId,
            syncRequest.payload,
            childToken,
          );
          setResponseVersions((current) => ({
            ...current,
            [dirtyQuestionId]: saved.version,
          }));
          await removePendingDraft(queueKey);
          setSaveStatus("saved");
          setDirtyQuestionId(null);
        })
        .catch(() => setSaveStatus("offline"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    answers,
    attemptId,
    childToken,
    dirtyQuestionId,
    responseVersions,
  ]);

  useEffect(() => {
    if (!examMode) {
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          if (attemptId && childToken) {
            void submitAttempt(
              attemptId,
              childToken,
              `submit-${attemptId}-time-limit`,
            )
              .then(() => removePendingDraftsByPrefix(`${attemptId}:`))
              .finally(() =>
                window.location.assign(
                  `/child/submitted/?reason=time-limit&attemptId=${encodeURIComponent(
                    attemptId,
                  )}`,
                ),
              );
          } else {
            window.location.assign("/child/submitted/?reason=time-limit");
          }
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attemptId, childToken, examMode]);

  useEffect(() => {
    if (!childToken) {
      return;
    }
    const sync = () => {
      void syncPendingDrafts(childToken).then((count) => {
        if (count > 0) {
          setSaveStatus("saved");
        }
      });
    };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [childToken]);

  async function submitAll(reason = "completed") {
    if (attemptId && childToken) {
      try {
        await submitAttempt(
          attemptId,
          childToken,
          `submit-${attemptId}-${reason}`,
        );
        await removePendingDraftsByPrefix(`${attemptId}:`);
      } catch {
        setSaveStatus("offline");
        return;
      }
    } else {
      await removePendingDraftsByPrefix("demo-attempt:");
    }
    const attemptQuery = attemptId
      ? `&attemptId=${encodeURIComponent(attemptId)}`
      : "";
    window.location.assign(
      `/child/submitted/?reason=${reason}${attemptQuery}`,
    );
  }

  const answeredCount = useMemo(
    () =>
      questions.filter((question) => {
        const answer = answers[question.id];
        return Boolean(
          answer &&
            (answer.choice !== undefined ||
              answer.choices?.length ||
              answer.tokens?.length ||
              answer.text?.trim() ||
              answer.strokes?.length ||
              answer.photoNames?.length),
        );
      }).length,
    [answers, questions],
  );

  const updateAnswer = (questionId: string, answer: Answer) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setDirtyQuestionId(questionId);
    setSaveStatus("saving");
  };

  const renderResponse = (question: Question) => {
    const answer = answers[question.id] ?? {};
    if (question.type === "multiple_choice") {
      return (
        <fieldset className="choice-list">
          <legend>Choose every correct answer</legend>
          {question.options?.map((option, index) => {
            const selected = answer.choices?.includes(index) ?? false;
            return (
              <label
                className={selected ? "choice active" : "choice"}
                key={option}
              >
                <input
                  checked={selected}
                  name={question.id}
                  onChange={() => {
                    const choices = selected
                      ? (answer.choices ?? []).filter(
                          (choice) => choice !== index,
                        )
                      : [...(answer.choices ?? []), index].sort(
                          (left, right) => left - right,
                        );
                    updateAnswer(question.id, { choices });
                  }}
                  type="checkbox"
                />
                <span aria-hidden="true" className="choice-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <strong>{option}</strong>
                <Check aria-hidden="true" size={18} />
              </label>
            );
          })}
        </fieldset>
      );
    }
    if (question.type === "word_order") {
      const selectedTokens = answer.tokens ?? [];
      const available = (question.options ?? []).filter(
        (token) => !selectedTokens.includes(token),
      );
      return (
        <div className="typed-answer">
          <label>Build the sentence</label>
          <p>
            {selectedTokens.join(" ") || "Choose words below…"}
          </p>
          <div className="header-actions">
            {available.map((token) => (
                <button
                  className="button ghost"
                  key={token}
                  onClick={() =>
                    updateAnswer(question.id, {
                      tokens: [...selectedTokens, token],
                    })
                  }
                  type="button"
                >
                  {token}
                </button>
              ))}
            <button
              className="quiet-link"
              onClick={() => updateAnswer(question.id, { tokens: [] })}
              type="button"
            >
              Reset
            </button>
          </div>
        </div>
      );
    }
    if (question.type === "choice" || question.type === "listening") {
      return (
        <>
          {question.type === "listening" ? (
            <div className="listening-player">
              <button
                className="button dark"
                disabled={(playCounts[question.id] ?? 0) >= 2}
                onClick={() => {
                  const utterance = new SpeechSynthesisUtterance(
                    "Every morning, I walk to school with my sister.",
                  );
                  utterance.lang = "en-US";
                  utterance.rate = 0.85;
                  window.speechSynthesis.speak(utterance);
                  setPlayCounts((current) => ({
                    ...current,
                    [question.id]: (current[question.id] ?? 0) + 1,
                  }));
                }}
                type="button"
              >
                <Volume2 size={17} />
                Play at 0.85×
              </button>
              <span>{playCounts[question.id] ?? 0} / 2 plays used</span>
            </div>
          ) : null}
          <fieldset className="choice-list">
            <legend className="sr-only">Choose one answer</legend>
            {question.options?.map((option, index) => (
              <label
                className={answer.choice === index ? "choice active" : "choice"}
                key={option}
              >
                <input
                  checked={answer.choice === index}
                  name={question.id}
                  onChange={() => updateAnswer(question.id, { choice: index })}
                  type="radio"
                />
                <span aria-hidden="true" className="choice-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <strong>{option}</strong>
                <Check aria-hidden="true" size={18} />
              </label>
            ))}
          </fieldset>
        </>
      );
    }
    if (question.type === "photo") {
      const photoNames = answer.photoNames ?? [];
      const photoPaths = answer.photoPaths ?? [];
      return (
        <label className="photo-answer">
          <input
            accept="image/jpeg,image/png"
            aria-label="Take a photo or choose images"
            capture="environment"
            onChange={(event) => {
              const selectedFiles = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (selectedFiles.length > 0) {
                if (attemptId && familyId && childToken) {
                  setSaveStatus("saving");
                  void (async () => {
                    const uploadedNames: string[] = [];
                    const uploadedPaths: string[] = [];
                    try {
                      for (const [index, file] of selectedFiles.entries()) {
                        const uploadKey = `response-${attemptId}-${question.id}-${file.lastModified}-${index}`;
                        const intent = await createChildUploadIntent(
                          {
                            family_id: familyId,
                            bucket: "responses",
                            object_id: attemptId,
                            filename: file.name,
                            content_type:
                              file.type === "image/png"
                                ? "image/png"
                                : "image/jpeg",
                          },
                          childToken,
                          uploadKey,
                        );
                        await uploadToSignedUrl(intent, file);
                        uploadedNames.push(file.name);
                        uploadedPaths.push(intent.path);
                      }
                      updateAnswer(question.id, {
                        photoNames: [...photoNames, ...uploadedNames],
                        photoPaths: [...photoPaths, ...uploadedPaths],
                      });
                    } catch {
                      updateAnswer(question.id, {
                        photoNames: [
                          ...photoNames,
                          ...selectedFiles.map((file) => file.name),
                        ],
                        photoPaths: [...photoPaths, ...uploadedPaths],
                      });
                      setSaveStatus("offline");
                    }
                  })();
                } else {
                  updateAnswer(question.id, {
                    photoNames: [
                      ...photoNames,
                      ...selectedFiles.map((file) => file.name),
                    ],
                    photoPaths,
                  });
                }
              }
            }}
            multiple
            type="file"
          />
          <Camera size={26} />
          <strong>
            {photoNames.length > 0
              ? "Add more answer images"
              : "Take a photo or choose images"}
          </strong>
          <span>
            Upload one question at a time. Images stay in shooting order.
          </span>
          {photoNames.length > 0 ? (
            <ol
              aria-label="Uploaded answer images"
              className="photo-file-list"
            >
              {photoNames.map((name, index) => (
                <li key={`${name}-${index}`}>
                  {index + 1}. {name}
                </li>
              ))}
            </ol>
          ) : null}
        </label>
      );
    }
    if (question.type === "text") {
      return (
        <div className="typed-answer">
          <label htmlFor={`${question.id}-answer`}>Your answer</label>
          <input
            autoComplete="off"
            id={`${question.id}-answer`}
            onChange={(event) =>
              updateAnswer(question.id, { text: event.target.value })
            }
            placeholder="Type here…"
            value={answer.text ?? ""}
          />
          <p>You can also switch this question to handwriting from the menu.</p>
        </div>
      );
    }
    return (
      <HandwritingCanvas
        onChange={(strokes) => updateAnswer(question.id, { strokes })}
      />
    );
  };

  const questionCard = (question: Question) => (
    <article className="question-card" key={question.id}>
      <header>
        <div>
          <p className="eyebrow">{question.subject}</p>
          <span>
            Question {question.number} · {question.points}{" "}
            {question.points === 1 ? "point" : "points"}
          </span>
        </div>
      </header>
      <h1>{question.prompt}</h1>
      {renderResponse(question)}
    </article>
  );

  return (
    <AppShell currentPath="/child/work/" role="child">
      <header className="work-header">
        <div>
          <p className="eyebrow">Today&apos;s practice</p>
          <h2>Algebra &amp; English warm-up</h2>
        </div>
        <div className="work-status">
          <button
            className={examMode ? "exam-toggle active" : "exam-toggle"}
            onClick={() => setExamMode((current) => !current)}
            type="button"
          >
            <Clock3 size={15} />
            {examMode
              ? `${Math.floor(secondsRemaining / 60)}:${String(
                  secondsRemaining % 60,
                ).padStart(2, "0")}`
              : "Practice mode"}
          </button>
          <span
            className={`save-state ${saveStatus}`}
            aria-live="polite"
          >
            <Cloud aria-hidden="true" size={15} />
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "offline"
                  ? "Saved on this device"
                  : "Saves automatically"}
          </span>
          <div className="mode-switch" aria-label="Worksheet layout">
            <button
              aria-label="Focus mode"
              className={mode === "focus" ? "active" : ""}
              onClick={() => setMode("focus")}
              type="button"
            >
              <Focus size={17} />
            </button>
            <button
              aria-label="Worksheet mode"
              className={mode === "sheet" ? "active" : ""}
              onClick={() => setMode("sheet")}
              type="button"
            >
              <Grid2X2 size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="work-layout">
        <aside className="question-index">
          <div className="index-progress">
            <strong>
              {answeredCount}/{questions.length}
            </strong>
            <span>answered</span>
          </div>
          <ol>
            {questions.map((question, index) => (
              <li key={question.id}>
                <button
                  aria-label={`Go to question ${question.number}`}
                  className={[
                    index === currentIndex ? "current" : "",
                    answers[question.id] ? "answered" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setCurrentIndex(index);
                    setMode("focus");
                  }}
                  type="button"
                >
                  {question.number}
                </button>
              </li>
            ))}
          </ol>
          <p>
            {examMode
              ? "Exam timer · auto-submit at zero"
              : "No timer · Take your time"}
          </p>
        </aside>

        <section className={mode === "sheet" ? "question-stack" : ""}>
          {mode === "sheet"
            ? questions.map((question) => questionCard(question))
            : questionCard(currentQuestion)}

          <footer className="work-actions">
            <button
              className="button ghost"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              type="button"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Previous
            </button>
            {currentIndex < questions.length - 1 ? (
              <button
                className="button primary"
                onClick={() =>
                  setCurrentIndex((index) =>
                    Math.min(questions.length - 1, index + 1),
                  )
                }
                type="button"
              >
                Next question
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => {
                  void submitAll();
                }}
                type="button"
              >
                Submit all answers
                <Send size={16} aria-hidden="true" />
              </button>
            )}
          </footer>
        </section>
      </div>
    </AppShell>
  );
}
