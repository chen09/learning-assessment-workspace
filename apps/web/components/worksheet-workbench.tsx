"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  Clock3,
  Cloud,
  Focus,
  Grid2X2,
  RefreshCw,
  RotateCw,
  Send,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  type CanvasSize,
  HandwritingCanvas,
  type Stroke,
} from "@/components/handwriting-canvas";
import { useLanguage } from "@/components/language-provider";
import {
  type DraftSyncRequest,
  removePendingDraftsByPrefix,
  removePendingDraft,
  savePendingDraft,
  syncPendingDrafts,
} from "@/lib/draft-queue";
import {
  type ApiQuestion,
  type AttemptResult,
  type AssignmentWork,
  createChildUploadIntent,
  createQuestionRetry,
  getAttemptResults,
  getAttemptWork,
  getChildAccessToken,
  getChildAssignments,
  getQuestionGradingJob,
  recordListeningPlayback,
  regradeQuestion,
  saveAttemptResponse,
  startAssignment,
  submitAttempt,
  submitQuestion,
  uploadToSignedUrl,
} from "@/lib/api-client";
import { getAvailableWordOrderTokens } from "@/lib/word-order";
import { rotateAnswerImage } from "@/lib/photo-rotation";

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
  listening?: ApiQuestion["listening"];
};

type Answer = {
  choice?: number;
  choices?: number[];
  tokens?: string[];
  text?: string;
  strokes?: Stroke[];
  canvasSize?: CanvasSize;
  photoNames?: string[];
  photoPaths?: string[];
};

const MINIMUM_PHOTO_FILE_BYTES = 100 * 1024;

function hasMeaningfulAnswer(answer: Answer | undefined) {
  return Boolean(
    answer &&
      (answer.choice !== undefined ||
        answer.choices?.length ||
        answer.tokens?.length ||
        answer.text?.trim() ||
        answer.strokes?.length ||
        answer.photoNames?.length),
  );
}

function canvasSizeFromAnswer(
  answer: Record<string, unknown>,
): CanvasSize | undefined {
  const rawSize = answer.canvas_size;
  if (
    !rawSize ||
    typeof rawSize !== "object" ||
    !("width" in rawSize) ||
    !("height" in rawSize) ||
    typeof rawSize.width !== "number" ||
    typeof rawSize.height !== "number"
  ) {
    return undefined;
  }
  return { width: rawSize.width, height: rawSize.height };
}

function restoreAnswer(
  response: AssignmentWork["responses"][number],
  questionType: ApiQuestion["type"] | undefined,
): Answer {
  const answer = response.answer;
  if (response.kind === "choice") {
    const choices = Array.isArray(answer.choices)
      ? answer.choices.filter(
          (choice): choice is number => typeof choice === "number",
        )
      : [];
    return questionType === "single_choice"
      ? { choice: choices[0] }
      : { choices };
  }
  if (response.kind === "tokens") {
    return {
      tokens: Array.isArray(answer.tokens)
        ? answer.tokens.filter(
            (token): token is string => typeof token === "string",
          )
        : [],
    };
  }
  if (response.kind === "text") {
    return { text: typeof answer.text === "string" ? answer.text : "" };
  }
  if (response.kind === "photo") {
    const paths = Array.isArray(answer.paths)
      ? answer.paths.filter(
          (path): path is string => typeof path === "string",
        )
      : [];
    return {
      photoNames: paths.map((path) => path.split("/").at(-1) ?? path),
      photoPaths: paths,
    };
  }
  return {
    strokes: Array.isArray(answer.strokes)
      ? (answer.strokes as Stroke[])
      : [],
    canvasSize: canvasSizeFromAnswer(answer),
  };
}

function questionFromApi(question: ApiQuestion): Question {
  return {
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
    subject: "",
    prompt: question.prompt,
    options: question.options ?? undefined,
    points: question.points,
    listening: question.listening,
  };
}

export function WorksheetWorkbench() {
  return (
    <AppShell currentPath="/child/work/" role="child">
      <WorksheetWorkbenchContent />
    </AppShell>
  );
}

function WorksheetWorkbenchContent() {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "empty" | "signed-out" | "error"
  >("loading");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<"focus" | "sheet">("focus");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<
    Record<string, string[]>
  >({});
  const [photoClarityWarnings, setPhotoClarityWarnings] = useState<
    Record<string, boolean[]>
  >({});
  const [photoUploadQuestionId, setPhotoUploadQuestionId] = useState<
    string | null
  >(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "offline"
  >("idle");
  const [dirtyQuestionId, setDirtyQuestionId] = useState<string | null>(null);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [examMode, setExamMode] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(10 * 60);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [childToken, setChildToken] = useState<string | null>(null);
  const [responseVersions, setResponseVersions] = useState<
    Record<string, number>
  >({});
  const [submittedQuestionIds, setSubmittedQuestionIds] = useState<string[]>(
    [],
  );
  const [questionResults, setQuestionResults] = useState<
    Record<string, AttemptResult>
  >({});
  const [gradingQuestionIds, setGradingQuestionIds] = useState<string[]>([]);
  const [submissionConfirmation, setSubmissionConfirmation] = useState<
    "question" | "all" | null
  >(null);
  const [isRetryAttempt, setIsRetryAttempt] = useState(false);
  const [retryingQuestionId, setRetryingQuestionId] = useState<string | null>(
    null,
  );
  const [regradingQuestionId, setRegradingQuestionId] = useState<string | null>(
    null,
  );
  const automaticSubmissionAttemptId = useRef<string | null>(null);
  const photoObjectUrls = useRef(new Set<string>());
  const currentQuestion = questions[currentIndex];

  useEffect(
    () => () => {
      for (const previewUrl of photoObjectUrls.current) {
        URL.revokeObjectURL(previewUrl);
      }
      photoObjectUrls.current.clear();
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get("assignmentId");
    const existingAttemptId = params.get("attemptId");
    const retryAttempt = params.get("retry") === "1";
    const token = getChildAccessToken();
    let active = true;

    void (async () => {
      if (!token) {
        setLoadState("signed-out");
        return;
      }
      try {
        let work;
        if (existingAttemptId) {
          work = await getAttemptWork(existingAttemptId, token);
        } else if (assignmentId) {
          work = await startAssignment(assignmentId, token);
        } else {
          const assignments = await getChildAssignments(token);
          const current = assignments[0];
          if (!current) {
            if (active) {
              setLoadState("empty");
            }
            return;
          }
          if (
            current.latest_attempt_id &&
            ["grading", "results_ready", "submitted", "completed"].includes(
              current.status,
            )
          ) {
            window.location.assign(
              `/child/results/?attemptId=${encodeURIComponent(
                current.latest_attempt_id,
              )}`,
            );
            return;
          }
          work = current.latest_attempt_id
            ? await getAttemptWork(current.latest_attempt_id, token)
            : await startAssignment(current.id, token);
        }
        if (!active) {
          return;
        }
        setTitle(work.title);
        setChildToken(token);
        setAttemptId(work.attempt.id);
        setFamilyId(work.assignment.family_id);
        setExamMode(work.assignment.mode === "exam");
        if (
          work.assignment.mode === "exam" &&
          work.assignment.time_limit_seconds
        ) {
          const elapsedSeconds = Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(work.attempt.started_at).getTime()) / 1000,
            ),
          );
          setSecondsRemaining(
            Math.max(0, work.assignment.time_limit_seconds - elapsedSeconds),
          );
        }
        const questionTypes = new Map(
          work.questions.map((question) => [question.id, question.type]),
        );
        const savedResponses = work.responses ?? [];
        setAnswers(
          Object.fromEntries(
            savedResponses.map((response) => [
              response.question_id,
              restoreAnswer(
                response,
                questionTypes.get(response.question_id),
              ),
            ]),
          ),
        );
        setPhotoPreviewUrls(
          Object.fromEntries(
            savedResponses
              .filter(
                (response) =>
                  response.kind === "photo" && (response.photo_urls?.length ?? 0) > 0,
              )
              .map((response) => [
                response.question_id,
                response.photo_urls ?? [],
              ]),
          ),
        );
        setResponseVersions(
          Object.fromEntries(
            savedResponses.map((response) => [
              response.question_id,
              response.version,
            ]),
          ),
        );
        const submittedIds = work.submitted_question_ids ?? [];
        setSubmittedQuestionIds(submittedIds);
        setPlayCounts(
          Object.fromEntries(
            work.questions
              .filter((question) => question.listening)
              .map((question) => [
                question.id,
                question.listening?.play_count ?? 0,
              ]),
          ),
        );
        setQuestions(work.questions.map(questionFromApi));
        setIsRetryAttempt(retryAttempt);
        setLoadState("ready");
        if (submittedIds.length > 0) {
          void getAttemptResults(work.attempt.id, token)
            .then((resultSet) => {
              if (!active) {
                return;
              }
              setQuestionResults(
                Object.fromEntries(
                  resultSet.results.map((result) => [
                    result.question_id,
                    result,
                  ]),
                ),
              );
            })
            .catch(() => undefined);
        }
        window.history.replaceState(
          {},
          "",
          `/child/work/?attemptId=${encodeURIComponent(work.attempt.id)}${
            retryAttempt ? "&retry=1" : ""
          }`,
        );
        void syncPendingDrafts(token).catch(() => setSaveStatus("offline"));
      } catch {
        if (active) {
          setLoadState("error");
          setSaveStatus("offline");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!dirtyQuestionId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const answer = answers[dirtyQuestionId];
      const queueKey = `${attemptId ?? "demo-attempt"}:${dirtyQuestionId}`;
      const question = questions.find(
        (candidate) => candidate.id === dirtyQuestionId,
      );
      const kind: DraftSyncRequest["payload"]["kind"] =
        question?.type === "photo"
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
            : {
                strokes: answer?.strokes ?? [],
                canvas_size: answer?.canvasSize,
              };
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
    questions,
    responseVersions,
  ]);

  useEffect(() => {
    if (!examMode) {
      return;
    }
    const submitForTimeLimit = () => {
      if (automaticSubmissionAttemptId.current === attemptId) {
        return;
      }
      automaticSubmissionAttemptId.current = attemptId;
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
        return;
      }
      window.location.assign("/child/submitted/?reason=time-limit");
    };
    if (secondsRemaining <= 0) {
      submitForTimeLimit();
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          submitForTimeLimit();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attemptId, childToken, examMode, secondsRemaining]);

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

  async function waitForQuestionResult(questionId: string) {
    if (!attemptId || !childToken) {
      return;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const resultSet = await getAttemptResults(attemptId, childToken);
      const result = resultSet.results.find(
        (candidate) => candidate.question_id === questionId,
      );
      if (result) {
        setQuestionResults((current) => ({
          ...current,
          [questionId]: result,
        }));
        setGradingQuestionIds((current) =>
          current.filter((id) => id !== questionId),
        );
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setGradingQuestionIds((current) =>
      current.filter((id) => id !== questionId),
    );
  }

  async function submitCurrentQuestion() {
    if (!attemptId || !childToken || !currentQuestion) {
      return;
    }
    const questionId = currentQuestion.id;
    try {
      await submitQuestion(
        attemptId,
        questionId,
        childToken,
        `submit-${attemptId}-${questionId}`,
      );
      setSubmittedQuestionIds((current) =>
        current.includes(questionId) ? current : [...current, questionId],
      );
      setGradingQuestionIds((current) =>
        current.includes(questionId) ? current : [...current, questionId],
      );
      setSubmissionConfirmation(null);
      void waitForQuestionResult(questionId);
    } catch {
      setSaveStatus("offline");
    }
  }

  async function redoQuestion(question: Question) {
    if (
      !attemptId ||
      !childToken ||
      retryingQuestionId ||
      regradingQuestionId
    ) {
      return;
    }
    setRetryingQuestionId(question.id);
    try {
      const work = await createQuestionRetry(
        attemptId,
        question.id,
        childToken,
        `retry-${attemptId}-${question.id}`,
      );
      setTitle(work.title);
      setAttemptId(work.attempt.id);
      setFamilyId(work.assignment.family_id);
      setQuestions(work.questions.map(questionFromApi));
      setPlayCounts(
        Object.fromEntries(
          work.questions
            .filter((question) => question.listening)
            .map((question) => [
              question.id,
              question.listening?.play_count ?? 0,
            ]),
        ),
      );
      setAnswers({});
      setResponseVersions({});
      setSubmittedQuestionIds([]);
      setQuestionResults({});
      setGradingQuestionIds([]);
      setSubmissionConfirmation(null);
      setCurrentIndex(0);
      setMode("focus");
      setIsRetryAttempt(true);
      setSaveStatus("idle");
      window.history.replaceState(
        {},
        "",
        `/child/work/?attemptId=${encodeURIComponent(
          work.attempt.id,
        )}&retry=1`,
      );
    } catch {
      setSaveStatus("offline");
    } finally {
      setRetryingQuestionId(null);
    }
  }

  async function waitForRegradedResult(
    questionId: string,
    jobId: string,
  ) {
    if (!attemptId || !childToken) {
      return;
    }
    try {
      for (let poll = 0; poll < 120; poll += 1) {
        const job = await getQuestionGradingJob(
          attemptId,
          questionId,
          jobId,
          childToken,
        );
        if (job.status === "failed") {
          throw new Error("question_regrade_failed");
        }
        if (job.status === "succeeded") {
          const resultSet = await getAttemptResults(attemptId, childToken);
          const result = resultSet.results.find(
            (candidate) => candidate.question_id === questionId,
          );
          if (result) {
            setQuestionResults((current) => ({
              ...current,
              [questionId]: result,
            }));
            return;
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      throw new Error("question_regrade_timed_out");
    } catch {
      setSaveStatus("offline");
    } finally {
      setGradingQuestionIds((current) =>
        current.filter((id) => id !== questionId),
      );
      setRegradingQuestionId(null);
    }
  }

  async function regradeExistingAnswer(question: Question) {
    if (
      !attemptId ||
      !childToken ||
      retryingQuestionId ||
      regradingQuestionId
    ) {
      return;
    }
    setRegradingQuestionId(question.id);
    setGradingQuestionIds((current) =>
      current.includes(question.id) ? current : [...current, question.id],
    );
    try {
      const receipt = await regradeQuestion(
        attemptId,
        question.id,
        childToken,
        `regrade-${attemptId}-${question.id}-${window.crypto.randomUUID()}`,
      );
      void waitForRegradedResult(question.id, receipt.job.id);
    } catch {
      setGradingQuestionIds((current) =>
        current.filter((id) => id !== question.id),
      );
      setRegradingQuestionId(null);
      setSaveStatus("offline");
    }
  }

  const answeredCount = useMemo(
    () =>
      questions.filter((question) =>
        hasMeaningfulAnswer(answers[question.id]),
      ).length,
    [answers, questions],
  );

  const updateAnswer = (questionId: string, answer: Answer) => {
    if (submittedQuestionIds.includes(questionId)) {
      return;
    }
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setDirtyQuestionId(questionId);
    setSaveStatus("saving");
  };

  const playListeningAudio = async (question: Question) => {
    const listening = question.listening;
    const audio = audioRefs.current[question.id];
    if (
      !listening ||
      !audio ||
      !attemptId ||
      !childToken ||
      (playCounts[question.id] ?? 0) >= listening.replay_limit
    ) {
      return;
    }
    try {
      const receipt = await recordListeningPlayback(
        attemptId,
        question.id,
        childToken,
      );
      audio.pause();
      audio.src = receipt.audio_url;
      audio.currentTime = 0;
      audio.playbackRate = examMode ? 1 : 0.85;
      setQuestions((current) =>
        current.map((candidate) =>
          candidate.id === question.id && candidate.listening
            ? {
                ...candidate,
                listening: {
                  ...candidate.listening,
                  audio_url: receipt.audio_url,
                },
              }
            : candidate,
        ),
      );
      setPlayCounts((current) => ({
        ...current,
        [question.id]: receipt.play_count,
      }));
      // A successful receipt already consumed the replay. Media playback may
      // still reject for a device-specific decoder issue, which must not make
      // the app report a false network/offline error or re-enable the replay.
      void audio.play().catch(() => undefined);
    } catch {
      setSaveStatus("offline");
    }
  };

  const renderResponse = (question: Question) => {
    const answer = answers[question.id] ?? {};
    if (question.type === "multiple_choice") {
      return (
        <fieldset className="choice-list">
          <legend>{t("worksheet.multipleChoice")}</legend>
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
      const available = getAvailableWordOrderTokens(
        question.options ?? [],
        selectedTokens,
      );
      return (
        <div className="typed-answer">
          <label>{t("worksheet.buildSentence")}</label>
          <p>
            {selectedTokens.join(" ") || t("worksheet.chooseWords")}
          </p>
          <div className="header-actions">
            {available.map((token, index) => (
                <button
                  className="button ghost"
                  key={`${token}-${index}`}
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
              {t("worksheet.reset")}
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
              {question.listening ? (
                <audio
                  preload="metadata"
                  ref={(element) => {
                    audioRefs.current[question.id] = element;
                  }}
                  src={question.listening.audio_url ?? undefined}
                />
              ) : null}
              <button
                className="button dark"
                disabled={
                  !question.listening ||
                  (playCounts[question.id] ?? 0) >=
                    question.listening.replay_limit
                }
                onClick={() => void playListeningAudio(question)}
                type="button"
              >
                <Volume2 size={17} />
                {t(examMode ? "worksheet.playAudio" : "worksheet.playSlow")}
              </button>
              <span>
                {t("worksheet.playsUsed", {
                  count: playCounts[question.id] ?? 0,
                  limit: question.listening?.replay_limit ?? 0,
                })}
              </span>
              {question.listening?.transcript ? (
                <details className="listening-transcript">
                  <summary>{t("worksheet.transcript")}</summary>
                  <p>{question.listening.transcript}</p>
                </details>
              ) : null}
            </div>
          ) : null}
          <fieldset className="choice-list">
            <legend className="sr-only">
              {t("worksheet.singleChoice")}
            </legend>
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
      const photoPreviews = photoPreviewUrls[question.id] ?? [];
      const clarityWarnings = photoClarityWarnings[question.id] ?? [];
      const isUploadingPhotos = photoUploadQuestionId === question.id;
      const isSavingPhotoAnswer =
        isUploadingPhotos ||
        (dirtyQuestionId === question.id && saveStatus === "saving");
      const canManagePhotoOrder = photoNames.length === photoPaths.length;
      const updatePhotos = (names: string[], paths: string[]) => {
        updateAnswer(question.id, { photoNames: names, photoPaths: paths });
      };
      const updatePhotoPreviews = (previews: string[]) => {
        setPhotoPreviewUrls((current) => ({
          ...current,
          [question.id]: previews,
        }));
      };
      const updateClarityWarnings = (warnings: boolean[]) => {
        setPhotoClarityWarnings((current) => ({
          ...current,
          [question.id]: warnings,
        }));
      };
      const movePhoto = (from: number, to: number) => {
        if (!canManagePhotoOrder || to < 0 || to >= photoNames.length) {
          return;
        }
        const names = [...photoNames];
        const [name] = names.splice(from, 1);
        const paths = [...photoPaths];
        const [path] = paths.splice(from, 1);
        if (name === undefined || path === undefined) {
          return;
        }
        names.splice(to, 0, name);
        paths.splice(to, 0, path);
        updatePhotos(names, paths);
        const previews = [...photoPreviews];
        const [preview] = previews.splice(from, 1);
        if (preview !== undefined) {
          previews.splice(to, 0, preview);
        }
        updatePhotoPreviews(previews);
        const warnings = [...clarityWarnings];
        const [warning] = warnings.splice(from, 1);
        warnings.splice(to, 0, warning ?? false);
        updateClarityWarnings(warnings);
      };
      const removePhoto = (index: number) => {
        if (!canManagePhotoOrder) {
          return;
        }
        const preview = photoPreviews[index];
        if (preview && photoObjectUrls.current.delete(preview)) {
          URL.revokeObjectURL(preview);
        }
        updatePhotos(
          photoNames.filter((_, photoIndex) => photoIndex !== index),
          photoPaths.filter((_, photoIndex) => photoIndex !== index),
        );
        updatePhotoPreviews(
          photoPreviews.filter((_, photoIndex) => photoIndex !== index),
        );
        updateClarityWarnings(
          clarityWarnings.filter((_, photoIndex) => photoIndex !== index),
        );
      };
      const replaceStoredPhoto = (index: number, file: File, path?: string) => {
        const names = [...photoNames];
        names[index] = file.name;
        const paths = [...photoPaths];
        if (path !== undefined) {
          paths[index] = path;
        }
        updatePhotos(names, paths);

        const previews = [...photoPreviews];
        const previousPreview = previews[index];
        if (previousPreview && photoObjectUrls.current.delete(previousPreview)) {
          URL.revokeObjectURL(previousPreview);
        }
        const previewUrl = URL.createObjectURL(file);
        photoObjectUrls.current.add(previewUrl);
        previews[index] = previewUrl;
        updatePhotoPreviews(previews);

        const warnings = [...clarityWarnings];
        warnings[index] = file.size < MINIMUM_PHOTO_FILE_BYTES;
        updateClarityWarnings(warnings);
      };
      const uploadReplacementPhoto = async (index: number, file: File) => {
        if (!attemptId || !familyId || !childToken) {
          replaceStoredPhoto(index, file);
          return;
        }
        const uploadKey = `response-replace-${attemptId}-${question.id}-${index}-${file.lastModified}`;
        const intent = await createChildUploadIntent(
          {
            family_id: familyId,
            bucket: "responses",
            object_id: attemptId,
            filename: file.name,
            content_type:
              file.type === "image/png" ? "image/png" : "image/jpeg",
          },
          childToken,
          uploadKey,
        );
        await uploadToSignedUrl(intent, file);
        // The original response file remains private and untouched; only this answer reference changes.
        replaceStoredPhoto(index, file, intent.path);
      };
      const replacePhoto = (index: number, file: File) => {
        if (isSavingPhotoAnswer || !canManagePhotoOrder) {
          return;
        }
        setSaveStatus("saving");
        setPhotoUploadQuestionId(question.id);
        void (async () => {
          try {
            await uploadReplacementPhoto(index, file);
          } catch {
            setSaveStatus("offline");
          } finally {
            setPhotoUploadQuestionId((current) =>
              current === question.id ? null : current,
            );
          }
        })();
      };
      const rotatePhoto = (index: number) => {
        const previewUrl = photoPreviews[index];
        const name = photoNames[index];
        if (
          isSavingPhotoAnswer ||
          !canManagePhotoOrder ||
          !previewUrl ||
          !name
        ) {
          return;
        }
        setSaveStatus("saving");
        setPhotoUploadQuestionId(question.id);
        void (async () => {
          try {
            const rotatedFile = await rotateAnswerImage(previewUrl, name);
            await uploadReplacementPhoto(index, rotatedFile);
          } catch {
            setSaveStatus("offline");
          } finally {
            setPhotoUploadQuestionId((current) =>
              current === question.id ? null : current,
            );
          }
        })();
      };
      return (
        <div className="photo-answer">
          <label className="photo-input-trigger">
            <input
              accept="image/jpeg,image/png"
              aria-label={t("worksheet.photoInput")}
              capture="environment"
              onChange={(event) => {
                if (isSavingPhotoAnswer) {
                  return;
                }
                const selectedFiles = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (selectedFiles.length === 0) {
                  return;
                }

                const newPreviews = selectedFiles.map((file) => {
                  const previewUrl = URL.createObjectURL(file);
                  photoObjectUrls.current.add(previewUrl);
                  return previewUrl;
                });
                updatePhotoPreviews([...photoPreviews, ...newPreviews]);
                updateClarityWarnings([
                  ...photoNames.map((_, index) => clarityWarnings[index] ?? false),
                  ...selectedFiles.map(
                    (file) => file.size < MINIMUM_PHOTO_FILE_BYTES,
                  ),
                ]);

                if (!attemptId || !familyId || !childToken) {
                  updateAnswer(question.id, {
                    photoNames: [
                      ...photoNames,
                      ...selectedFiles.map((file) => file.name),
                    ],
                    photoPaths,
                  });
                  return;
                }

                setSaveStatus("saving");
                setPhotoUploadQuestionId(question.id);
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
                  } finally {
                    setPhotoUploadQuestionId((current) =>
                      current === question.id ? null : current,
                    );
                  }
                })();
              }}
              disabled={isSavingPhotoAnswer}
              multiple
              type="file"
            />
            <Camera size={26} />
            <strong>
              {photoNames.length > 0
                ? t("worksheet.addMoreImages")
                : t("worksheet.photoInput")}
            </strong>
            <span>{t("worksheet.photoHelp")}</span>
            {isUploadingPhotos ? (
              <span role="status">{t("worksheet.uploadingImages")}</span>
            ) : null}
          </label>
          {photoNames.length > 0 ? (
            <ol
              aria-label={t("worksheet.uploadedImages")}
              className="photo-file-list"
            >
              {photoNames.map((name, index) => (
                <li key={`${name}-${index}`}>
                  {photoPreviews[index] ? (
                    // Preview URLs are local blobs, so Next's remote image optimizer cannot serve them.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={t("worksheet.photoPreview", { name })}
                      className="photo-file-preview"
                      src={photoPreviews[index]}
                    />
                  ) : null}
                  <span className="photo-file-detail">
                    <span className="photo-file-name">
                      {index + 1}. {name}
                    </span>
                    {clarityWarnings[index] ? (
                      <span className="photo-clarity-warning" role="status">
                        {t("worksheet.photoClarityWarning")}
                      </span>
                    ) : null}
                  </span>
                  {canManagePhotoOrder ? (
                    <span className="photo-file-actions">
                      <label className="photo-file-replace">
                        <input
                          accept="image/jpeg,image/png"
                          aria-label={t("worksheet.replacePhoto", { name })}
                          capture="environment"
                          disabled={isSavingPhotoAnswer}
                          onChange={(event) => {
                            const replacement = event.target.files?.[0];
                            event.target.value = "";
                            if (replacement) {
                              replacePhoto(index, replacement);
                            }
                          }}
                          type="file"
                        />
                        <RefreshCw aria-hidden="true" size={15} />
                      </label>
                      <button
                        aria-label={t("worksheet.rotatePhoto", { name })}
                        disabled={isSavingPhotoAnswer || !photoPreviews[index]}
                        onClick={() => rotatePhoto(index)}
                        type="button"
                      >
                        <RotateCw size={15} />
                      </button>
                      <button
                        aria-label={t("worksheet.movePhotoEarlier", {
                          name,
                        })}
                        disabled={isSavingPhotoAnswer || index === 0}
                        onClick={() => movePhoto(index, index - 1)}
                        type="button"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        aria-label={t("worksheet.movePhotoLater", { name })}
                        disabled={
                          isSavingPhotoAnswer || index === photoNames.length - 1
                        }
                        onClick={() => movePhoto(index, index + 1)}
                        type="button"
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        aria-label={t("worksheet.removePhoto", { name })}
                        disabled={isSavingPhotoAnswer}
                        onClick={() => removePhoto(index)}
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      );
    }
    if (question.type === "text") {
      return (
        <div className="typed-answer">
          <label htmlFor={`${question.id}-answer`}>
            {t("worksheet.yourAnswer")}
          </label>
          <input
            autoComplete="off"
            id={`${question.id}-answer`}
            onChange={(event) =>
              updateAnswer(question.id, { text: event.target.value })
            }
            placeholder={t("worksheet.typeHere")}
            value={answer.text ?? ""}
          />
          <p>{t("worksheet.handwritingAlternative")}</p>
        </div>
      );
    }
    return (
      <HandwritingCanvas
        annotations={
          questionResults[question.id]?.feedback.annotations
        }
        initialSize={answer.canvasSize}
        initialStrokes={answer.strokes}
        key={`${attemptId ?? "demo-attempt"}:${question.id}`}
        onChange={(strokes, canvasSize) =>
          updateAnswer(question.id, { strokes, canvasSize })
        }
        readOnly={submittedQuestionIds.includes(question.id)}
      />
    );
  };

  const resultLabel = (outcome: AttemptResult["outcome"] | undefined) => {
    if (outcome === "correct") {
      return t("worksheet.result.correct");
    }
    if (outcome === "incorrect") {
      return t("worksheet.result.incorrect");
    }
    if (outcome === "uncertain") {
      return t("worksheet.result.uncertain");
    }
    if (outcome === "needs_parent_review") {
      return t("worksheet.result.needsParentReview");
    }
    return t("worksheet.result.pending");
  };

  const resultAction = (outcome: AttemptResult["outcome"]) => {
    if (outcome === "correct") {
      return t("worksheet.result.action.correct");
    }
    if (outcome === "incorrect") {
      return t("worksheet.result.action.incorrect");
    }
    return t("worksheet.result.action.review");
  };

  const questionCard = (question: Question) => {
    const submitted = submittedQuestionIds.includes(question.id);
    const grading = gradingQuestionIds.includes(question.id);
    const result = questionResults[question.id];
    return (
    <article className="question-card" key={question.id}>
      <header>
        <div>
          <p className="eyebrow">
            {question.subject || t("worksheet.assignedPractice")}
          </p>
          <span>
            {t("worksheet.questionMeta", {
              number: question.number,
              points: t(
                question.points === 1
                  ? "worksheet.pointOne"
                  : "worksheet.pointMany",
                { count: question.points },
              ),
            })}
          </span>
        </div>
      </header>
      <h1>{question.prompt}</h1>
      <div
        aria-disabled={submitted}
        className={submitted ? "response-locked" : undefined}
      >
        {renderResponse(question)}
      </div>
      {submitted ? (
        <div className={`question-grade-status ${result?.outcome ?? "grading"}`}>
          <strong>
            {grading
              ? t("worksheet.grading")
              : result?.feedback.summary ??
                resultLabel(result?.outcome)}
          </strong>
          {!grading && result ? (
            <>
              <p>{resultAction(result.outcome)}</p>
              <div className="question-grade-actions">
                <button
                  className="button ghost"
                  disabled={
                    retryingQuestionId !== null ||
                    regradingQuestionId !== null
                  }
                  onClick={() => void regradeExistingAnswer(question)}
                  type="button"
                >
                  {regradingQuestionId === question.id
                    ? t("worksheet.regradingAnswer")
                    : t("worksheet.regradeAnswer")}
                </button>
                <button
                  className="button ghost"
                  disabled={
                    retryingQuestionId !== null ||
                    regradingQuestionId !== null
                  }
                  onClick={() => void redoQuestion(question)}
                  type="button"
                >
                  {retryingQuestionId === question.id
                    ? t("worksheet.preparingRedo")
                    : t("worksheet.redoQuestion")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
    );
  };

  if (loadState !== "ready") {
    const isEmpty = loadState === "empty";
    const isLoading = loadState === "loading";
    return (
      <section className="continue-card">
        <div className="continue-copy">
          <span className="status-pill">
            {isLoading
              ? t("worksheet.loading")
              : isEmpty
                ? t("childHome.allClear")
                : t("worksheet.unavailable")}
          </span>
          <h1>
            {isLoading
              ? t("worksheet.loadingTitle")
              : isEmpty
                ? t("childHome.noAssigned")
                : loadState === "signed-out"
                  ? t("worksheet.signInRequired")
                  : t("worksheet.loadError")}
          </h1>
          <p>
            {isLoading
              ? t("worksheet.loadingBody")
              : isEmpty
                ? t("childHome.parentCanAssign")
                : t("worksheet.tryAgain")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <header className="work-header">
        <div>
          <p className="eyebrow">{t("worksheet.todayPractice")}</p>
          <h2>{title}</h2>
        </div>
        <div className="work-status">
          <span
            className={examMode ? "exam-toggle active" : "exam-toggle"}
          >
            <Clock3 size={15} />
            {examMode
              ? `${Math.floor(secondsRemaining / 60)}:${String(
                  secondsRemaining % 60,
                ).padStart(2, "0")}`
              : t("worksheet.practiceMode")}
          </span>
          <span
            className={`save-state ${saveStatus}`}
            aria-live="polite"
          >
            <Cloud aria-hidden="true" size={15} />
            {saveStatus === "saving"
              ? t("worksheet.saving")
              : saveStatus === "saved"
                ? t("worksheet.saved")
                : saveStatus === "offline"
                  ? t("worksheet.savedDevice")
                  : t("worksheet.autoSave")}
          </span>
          <div className="mode-switch" aria-label={t("worksheet.layout")}>
            <button
              aria-label={t("worksheet.focusMode")}
              className={mode === "focus" ? "active" : ""}
              onClick={() => setMode("focus")}
              type="button"
            >
              <Focus size={17} />
            </button>
            <button
              aria-label={t("worksheet.sheetMode")}
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
            <span>{t("worksheet.answered")}</span>
          </div>
          <ol>
            {questions.map((question, index) => (
              <li key={question.id}>
                <button
                  aria-label={t("worksheet.goToQuestion", {
                    number: question.number,
                  })}
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
              ? t("worksheet.examTimer")
              : t("worksheet.noTimer")}
          </p>
        </aside>

        <section className={mode === "sheet" ? "question-stack" : ""}>
          {mode === "sheet"
            ? questions.map((question) => questionCard(question))
            : questionCard(currentQuestion)}

          {submissionConfirmation ? (
            <section
              aria-live="polite"
              className="submission-confirmation"
            >
              <div>
                <strong>
                  {submissionConfirmation === "question"
                    ? t("worksheet.confirmQuestionTitle")
                    : t("worksheet.confirmAllTitle")}
                </strong>
                <p>
                  {submissionConfirmation === "question"
                    ? t("worksheet.confirmQuestionBody", {
                        number: currentQuestion.number,
                      })
                    : t("worksheet.confirmAllBody", {
                        count: questions.length - answeredCount,
                      })}
                </p>
              </div>
              <div>
                <button
                  className="button ghost"
                  onClick={() => setSubmissionConfirmation(null)}
                  type="button"
                >
                  {t("worksheet.cancel")}
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    if (submissionConfirmation === "question") {
                      void submitCurrentQuestion();
                    } else {
                      void submitAll();
                    }
                  }}
                  type="button"
                >
                  {submissionConfirmation === "question"
                    ? t("worksheet.confirmQuestionAction")
                    : t("worksheet.confirmAllAction")}
                </button>
              </div>
            </section>
          ) : null}

          <div className="grading-actions">
            <button
              className="button ghost"
              disabled={
                submittedQuestionIds.includes(currentQuestion.id) ||
                !hasMeaningfulAnswer(answers[currentQuestion.id]) ||
                saveStatus === "saving"
              }
              onClick={() => setSubmissionConfirmation("question")}
              type="button"
            >
              <Check size={16} aria-hidden="true" />
              {submittedQuestionIds.includes(currentQuestion.id)
                ? t("worksheet.questionSubmitted")
                : t(
                    isRetryAttempt
                      ? "worksheet.submitQuestionAgain"
                      : "worksheet.submitQuestion",
                  )}
            </button>
            {!isRetryAttempt ? (
              <button
                className="button primary"
                disabled={saveStatus === "saving"}
                onClick={() => setSubmissionConfirmation("all")}
                type="button"
              >
                {t("worksheet.submit")}
                <Send size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <footer className="work-actions">
            <button
              className="button ghost"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              type="button"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              {t("worksheet.previous")}
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
                {t("worksheet.next")}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : null}
          </footer>
        </section>
      </div>
    </>
  );
}
