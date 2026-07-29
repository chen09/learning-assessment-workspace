"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BookOpenText,
  Camera,
  Check,
  FileText,
  Headphones,
  ImagePlus,
  Printer,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  type ApiQuestion,
  assignQuestionSet,
  confirmQuestionSet,
  createQuestionSetImport,
  createUploadIntent,
  getParentAccessToken,
  getQuestionSetDraft,
  uploadToSignedUrl,
} from "@/lib/api-client";

type CreateMode = "generate" | "import" | "manual";
type ImportPurpose = "generate_similar" | "use_as_questions";
type Stage = "compose" | "review";

const sampleQuestions = [
  {
    type: "Choice",
    prompt: "Choose the sentence that uses the present simple correctly.",
    answer: "B · She walks to school every day.",
  },
  {
    type: "Type or handwrite",
    prompt: "Complete: My brother ___ tennis on Sundays.",
    answer: "plays",
  },
  {
    type: "Handwrite",
    prompt: "Explain why (a + b)(a − b) = a² − b².",
    answer: "Expand and combine the middle terms.",
  },
];

export function CreateWorkspace() {
  const [mode, setMode] = useState<CreateMode>("generate");
  const [importPurpose, setImportPurpose] =
    useState<ImportPurpose>("generate_similar");
  const [stage, setStage] = useState<Stage>("compose");
  const [fileName, setFileName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [answerFileName, setAnswerFileName] = useState("");
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [referenceFileName, setReferenceFileName] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState(
    "Make a short mixed practice from this week’s algebra and English work.",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [questionSetId, setQuestionSetId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [draftQuestions, setDraftQuestions] = useState<
    Array<ApiQuestion & { answer_key: Record<string, unknown> }>
  >([]);
  const [requestStatus, setRequestStatus] = useState<
    "idle" | "working" | "error"
  >("idle");

  const canCreate = mode !== "import" || Boolean(fileName);
  const isLessonOneImport = files.some(
    (file) => file.name === "english_lesson1_similar_practice.pdf",
  );

  const getRouteIds = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      familyId: params.get("familyId"),
      childId: params.get("childId"),
    };
  };

  const createDraft = async () => {
    const { familyId } = getRouteIds();
    if (!familyId) {
      setStage("review");
      return;
    }
    const parentToken = await getParentAccessToken();
    if (!parentToken) {
      setRequestStatus("error");
      return;
    }
    setRequestStatus("working");
    try {
      const importObjectId = crypto.randomUUID();
      const sourcePaths: string[] = [];
      const answerSourcePaths: string[] = [];
      const referenceSourcePaths: string[] = [];
      if (mode === "import") {
        const uploadSources = async (
          selectedFiles: File[],
          role: "questions" | "answers" | "references",
          target: string[],
        ) => {
          for (const [index, file] of selectedFiles.entries()) {
            const contentType = (
              ["application/pdf", "image/png", "image/jpeg"].includes(file.type)
                ? file.type
                : "application/pdf"
            ) as "application/pdf" | "image/png" | "image/jpeg";
            const intent = await createUploadIntent(
              {
                family_id: familyId,
                bucket: "sources",
                object_id: importObjectId,
                filename: file.name,
                content_type: contentType,
              },
              parentToken,
              `source-${role}-${importObjectId}-${index}`,
            );
            await uploadToSignedUrl(intent, file);
            target.push(intent.path);
          }
        };
        await uploadSources(files, "questions", sourcePaths);
        await uploadSources(answerFiles, "answers", answerSourcePaths);
        await uploadSources(referenceFiles, "references", referenceSourcePaths);
      }
      const imported = await createQuestionSetImport(
        {
          family_id: familyId,
          filenames:
            files.length > 0
              ? files.map((file) => file.name)
              : [`${mode}-request.txt`],
          source_paths: sourcePaths,
          answer_filenames: answerFiles.map((file) => file.name),
          answer_source_paths: answerSourcePaths,
          reference_filenames: referenceFiles.map((file) => file.name),
          reference_source_paths: referenceSourcePaths,
          purpose:
            mode === "import" ? importPurpose : "generate_similar",
          title:
            mode === "generate"
              ? prompt.slice(0, 160)
              : isLessonOneImport
                ? "Lesson 1 同レベル変形練習"
                : "Imported learning material",
          subject: isLessonOneImport ? "English" : "Mixed practice",
        },
        parentToken,
        `import-${importObjectId}`,
      );
      setQuestionSetId(imported.question_set_id);
      let draft = await getQuestionSetDraft(
        imported.question_set_id,
        parentToken,
      );
      if (imported.status === "processing") {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          draft = await getQuestionSetDraft(
            imported.question_set_id,
            parentToken,
          );
          if (draft.question_set.status === "needs_review") {
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          if (attempt === 59) {
            throw new Error("Draft processing timed out.");
          }
        }
      }
      setDraftQuestions(draft.questions);
      setStage("review");
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const confirmAndAssign = async () => {
    const { childId } = getRouteIds();
    if (!questionSetId || !childId) {
      setConfirmed(true);
      return;
    }
    const parentToken = await getParentAccessToken();
    if (!parentToken) {
      setRequestStatus("error");
      return;
    }
    setRequestStatus("working");
    try {
      await confirmQuestionSet(
        questionSetId,
        parentToken,
        `confirm-${questionSetId}`,
      );
      const assignment = await assignQuestionSet(
        questionSetId,
        childId,
        parentToken,
        `assign-${questionSetId}-${childId}`,
        isLessonOneImport
          ? { mode: "exam", time_limit_seconds: 2700 }
          : { mode: "practice", time_limit_seconds: null },
      );
      setAssignmentId(assignment.id);
      setConfirmed(true);
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  if (stage === "review") {
    return (
      <AppShell currentPath="/parent/create/" role="parent">
        <header className="page-header">
          <div>
            <button
              className="back-button"
              onClick={() => setStage("compose")}
              type="button"
            >
              <ArrowLeft size={16} /> Back to source
            </button>
            <p className="eyebrow">AI structured draft</p>
            <h1>Review before assigning</h1>
            <p className="lede">
              Check wording, answers, difficulty, and response type. Children
              cannot see this until you confirm it.
            </p>
          </div>
          <LanguageSwitcher />
        </header>
        <div className="draft-toolbar">
          <span className="status-pill warm">
            Draft · not visible to children
          </span>
          <span>
            {draftQuestions.length || sampleQuestions.length} questions ·{" "}
            {isLessonOneImport
              ? "45-minute test"
              : "about 8 minutes · standard difficulty"}
          </span>
        </div>
        <section className="draft-question-list">
          {(draftQuestions.length > 0 ? draftQuestions : sampleQuestions).map(
            (question, index) => (
            <article key={question.prompt}>
              <div className="draft-question-number">{index + 1}</div>
              <div>
                <span className="question-type">
                  {question.type.replaceAll("_", " ")}
                </span>
                <h2>{question.prompt}</h2>
                <details>
                  <summary>Answer and grading guide</summary>
                  <p>
                    {"answer_key" in question
                      ? JSON.stringify(question.answer_key)
                      : question.answer}
                  </p>
                </details>
              </div>
              <button className="quiet-link" type="button">
                Edit
              </button>
            </article>
            ),
          )}
        </section>
        <section className="assignment-panel">
          <div>
            <p className="eyebrow">Assign</p>
            <h2>
              Alex · {isLessonOneImport ? "45-minute test" : "practice mode"}
            </h2>
            <p>
              {isLessonOneImport ? "Timer: 45 minutes. " : "No timer. "}
              Results appear after the whole set is graded.
            </p>
          </div>
          {confirmed ? (
            <div className="confirmed-message" role="status">
              <Check size={18} /> Confirmed and assigned
            </div>
          ) : (
            <button
              className="button primary large"
              disabled={requestStatus === "working"}
              onClick={() => void confirmAndAssign()}
              type="button"
            >
              Confirm and assign
            </button>
          )}
          <Link
            className="button ghost"
            href={
              assignmentId
                ? `/parent/print/?assignmentId=${encodeURIComponent(assignmentId)}`
                : "/parent/print/"
            }
          >
            <Printer size={17} /> Print A4 instead
          </Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/parent/create/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">New question set</p>
          <h1>What should we practise?</h1>
          <p className="lede">
            Start from a learning goal, a worksheet, textbook pages, or a small
            set you write yourself.
          </p>
        </div>
        <LanguageSwitcher />
      </header>

      <div className="create-layout">
        <nav className="creation-tabs" aria-label="Question set source">
          <button
            className={mode === "generate" ? "active" : ""}
            onClick={() => setMode("generate")}
            type="button"
          >
            <Sparkles /> Generate with AI
          </button>
          <button
            className={mode === "import" ? "active" : ""}
            onClick={() => setMode("import")}
            type="button"
          >
            <Camera /> Import material
          </button>
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
            type="button"
          >
            <BookOpenText /> Start simple
          </button>
        </nav>

        <section className="creation-card">
          {mode === "generate" ? (
            <>
              <div className="creation-heading">
                <span><Sparkles /></span>
                <div>
                  <h2>Describe the learning goal</h2>
                  <p>The generated questions always return here as a draft.</p>
                </div>
              </div>
              <label className="field-label">
                What should the set cover?
                <textarea
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  value={prompt}
                />
              </label>
            </>
          ) : null}

          {mode === "import" ? (
            <>
              <div className="creation-heading">
                <span><ImagePlus /></span>
                <div>
                  <h2>Import pages or an existing worksheet</h2>
                  <p>
                    PDF, PNG, and JPEG are supported. Multiple images keep their
                    selected order.
                  </p>
                </div>
              </div>
              <fieldset className="source-purpose-options">
                <legend>How should these files be used?</legend>
                <label>
                  <input
                    aria-label="Generate new questions from textbook or exercises"
                    checked={importPurpose === "generate_similar"}
                    name="import-purpose"
                    onChange={() => setImportPurpose("generate_similar")}
                    type="radio"
                  />
                  <span>
                    <strong>
                      Generate new questions from textbook or exercises
                    </strong>
                    <small>
                      AI extracts the unit, knowledge points, examples, and
                      difficulty progression before drafting new questions.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    aria-label="Convert an existing worksheet into questions"
                    checked={importPurpose === "use_as_questions"}
                    name="import-purpose"
                    onChange={() => setImportPurpose("use_as_questions")}
                    type="radio"
                  />
                  <span>
                    <strong>
                      Convert an existing worksheet into questions
                    </strong>
                    <small>
                      The uploaded exercises become the child&apos;s
                      interactive question set after your review.
                    </small>
                  </span>
                </label>
              </fieldset>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={
                    importPurpose === "use_as_questions"
                      ? "Question material"
                      : "Learning material and exercises"
                  }
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(
                      event.target.files ?? [],
                    );
                    setFiles(selectedFiles);
                    setFileName(
                      selectedFiles.map((file) => file.name).join(", "),
                    );
                  }}
                  type="file"
                />
                <FileText />
                <strong>
                  {fileName ||
                    (importPurpose === "use_as_questions"
                      ? "Choose worksheet PDF or photos"
                      : "Choose textbook and exercise pages")}
                </strong>
                <span>
                  {importPurpose === "use_as_questions"
                    ? "These pages become the questions children answer after your review."
                    : "These private pages become the basis for a reusable unit and new AI-generated questions."}
                </span>
              </label>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label="Answer key (private)"
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(
                      event.target.files ?? [],
                    );
                    setAnswerFiles(selectedFiles);
                    setAnswerFileName(
                      selectedFiles.map((file) => file.name).join(", "),
                    );
                  }}
                  type="file"
                />
                <Check />
                <strong>{answerFileName || "Choose answer key"}</strong>
                <span>Children never receive this file.</span>
              </label>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label="Original material or examples (optional)"
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(
                      event.target.files ?? [],
                    );
                    setReferenceFiles(selectedFiles);
                    setReferenceFileName(
                      selectedFiles.map((file) => file.name).join(", "),
                    );
                  }}
                  type="file"
                />
                <BookOpenText />
                <strong>
                  {referenceFileName || "Add original material or examples"}
                </strong>
                <span>
                  Used privately to understand the learning goal and validate
                  similar questions.
                </span>
              </label>
            </>
          ) : null}

          {mode === "manual" ? (
            <>
              <div className="creation-heading">
                <span><BookOpenText /></span>
                <div>
                  <h2>Start with one structured question</h2>
                  <p>You can add more questions on the review screen.</p>
                </div>
              </div>
              <label className="field-label">
                Question
                <textarea
                  placeholder="Write the question children will see…"
                  rows={4}
                />
              </label>
              <label className="field-label">
                Answer or grading guide
                <textarea placeholder="The expected answer…" rows={3} />
              </label>
            </>
          ) : null}

          <div className="creation-options">
            <label>
              Subject
              <select defaultValue="mixed">
                <option value="mixed">English + mathematics</option>
                <option value="english">English</option>
                <option value="math">Mathematics</option>
              </select>
            </label>
            <label>
              Difficulty
              <select defaultValue="adaptive">
                <option value="adaptive">Match Alex</option>
                <option value="foundation">Foundation</option>
                <option value="standard">Standard</option>
                <option value="challenge">Challenge</option>
              </select>
            </label>
            <label>
              Questions
              <select defaultValue="8">
                <option>5</option>
                <option>8</option>
                <option>10</option>
              </select>
            </label>
          </div>
          <label className="toggle-row">
            <input type="checkbox" />
            <Headphones size={18} />
            Include listening when the source calls for it
          </label>
          <button
            className="button primary large create-submit"
            disabled={!canCreate || requestStatus === "working"}
            onClick={() => void createDraft()}
            type="button"
          >
            {requestStatus === "working"
              ? "Preparing draft…"
              : "Create review draft"}
          </button>
          {requestStatus === "error" ? (
            <p className="form-error" role="alert">
              The request could not be completed. Check your connection and
              sign-in, then try again.
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
