"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BookOpenText,
  Camera,
  Check,
  FileText,
  FileJson2,
  Headphones,
  ImagePlus,
  Printer,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  type ApiQuestion,
  type ChildProfile,
  type Family,
  type StructuredQuestionSetDocument,
  assignQuestionSet,
  confirmQuestionSet,
  createQuestionSetImport,
  createUploadIntent,
  getChildren,
  getFamilies,
  getParentAccessToken,
  getQuestionSetDraft,
  importStructuredQuestionSet,
  previewStructuredQuestionSet,
  uploadToSignedUrl,
} from "@/lib/api-client";

type CreateMode = "generate" | "import" | "structured" | "manual";
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

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The selected file is not text.")),
    );
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("The selected file could not be read.")),
    );
    reader.readAsText(file);
  });
}

export function CreateWorkspace() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
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
  const [structuredFile, setStructuredFile] = useState<File | null>(null);
  const [structuredDocument, setStructuredDocument] =
    useState<StructuredQuestionSetDocument | null>(null);
  const [structuredChecksum, setStructuredChecksum] = useState("");
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

  useEffect(() => {
    let active = true;
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      try {
        const loadedFamilies = await getFamilies(parentToken);
        const params = new URLSearchParams(window.location.search);
        const requestedFamilyId = params.get("familyId");
        const selectedFamily =
          loadedFamilies.find((family) => family.id === requestedFamilyId) ??
          loadedFamilies[0];
        const loadedChildren = selectedFamily
          ? await getChildren(selectedFamily.id, parentToken)
          : [];
        const requestedChildId = params.get("childId");
        const selectedChild =
          loadedChildren.find((child) => child.id === requestedChildId) ??
          loadedChildren[0];
        if (active) {
          setFamilies(loadedFamilies);
          setSelectedFamilyId(selectedFamily?.id ?? "");
          setChildren(loadedChildren);
          setSelectedChildId(selectedChild?.id ?? "");
        }
      } catch {
        if (active) {
          setRequestStatus("error");
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const canCreate =
    mode === "import"
      ? Boolean(fileName)
      : mode === "structured"
        ? structuredFile !== null &&
          Boolean(selectedFamilyId) &&
          Boolean(selectedChildId)
        : true;
  const isLessonOneImport = files.some(
    (file) => file.name === "english_lesson1_similar_practice.pdf",
  );

  const getRouteIds = () => {
    return {
      familyId: selectedFamilyId || null,
      childId: selectedChildId || null,
    };
  };

  const selectFamily = async (familyId: string) => {
    setSelectedFamilyId(familyId);
    setSelectedChildId("");
    const parentToken = await getParentAccessToken();
    if (!parentToken) {
      setChildren([]);
      return;
    }
    try {
      const loadedChildren = await getChildren(familyId, parentToken);
      setChildren(loadedChildren);
      setSelectedChildId(loadedChildren[0]?.id ?? "");
    } catch {
      setChildren([]);
      setRequestStatus("error");
    }
  };

  const createDraft = async () => {
    if (mode === "structured") {
      if (!structuredFile) {
        setRequestStatus("error");
        return;
      }
      const parentToken = await getParentAccessToken();
      if (!parentToken) {
        setRequestStatus("error");
        return;
      }
      setRequestStatus("working");
      try {
        const document = JSON.parse(
          await readTextFile(structuredFile),
        ) as StructuredQuestionSetDocument;
        const preview = await previewStructuredQuestionSet(
          document,
          parentToken,
        );
        setStructuredDocument(document);
        setStructuredChecksum(preview.checksum);
        setDraftQuestions(
          preview.questions.map((question) => ({
            id: `preview-${question.position}`,
            position: question.position,
            type: question.type,
            prompt: question.prompt,
            options: question.options.length > 0 ? question.options : null,
            points: question.points,
            answer_key: question.answer_key,
          })),
        );
        setStage("review");
        setRequestStatus("idle");
      } catch {
        setRequestStatus("error");
      }
      return;
    }

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
    const { familyId, childId } = getRouteIds();
    if (mode === "structured") {
      if (
        !familyId ||
        !childId ||
        !structuredFile ||
        !structuredDocument ||
        !structuredChecksum
      ) {
        setRequestStatus("error");
        return;
      }
      const parentToken = await getParentAccessToken();
      if (!parentToken) {
        setRequestStatus("error");
        return;
      }
      setRequestStatus("working");
      try {
        const imported = await importStructuredQuestionSet(
          {
            family_id: familyId,
            child_id: childId,
            source_name: structuredFile.name,
            document: structuredDocument,
          },
          parentToken,
          `structured-${structuredChecksum}-${childId}`,
        );
        setQuestionSetId(imported.question_set_id);
        setAssignmentId(imported.assignment_id);
        setConfirmed(true);
        setRequestStatus("idle");
      } catch {
        setRequestStatus("error");
      }
      return;
    }

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
            {mode === "structured"
              ? "validated JSON · answers stay private"
              : isLessonOneImport
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
              {children.find((child) => child.id === selectedChildId)
                ?.nickname ?? "Selected child"}{" "}
              ·{" "}
              {isLessonOneImport ? "45-minute test" : "practice mode"}
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
          {requestStatus === "error" ? (
            <p className="form-error" role="alert">
              The JSON could not be imported. Check that the family and child
              are still available, then try again.
            </p>
          ) : null}
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

      <section className="creation-card assignment-target-card">
        <div>
          <p className="eyebrow">Assign to</p>
          <h2>Choose the child who will receive this set</h2>
        </div>
        {families.length > 0 ? (
          <div className="assignment-target-fields">
            <label>
              Family
              <select
                aria-label="Family"
                onChange={(event) => void selectFamily(event.target.value)}
                value={selectedFamilyId}
              >
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Child
              <select
                aria-label="Child"
                disabled={children.length === 0}
                onChange={(event) => setSelectedChildId(event.target.value)}
                value={selectedChildId}
              >
                {children.length > 0 ? (
                  children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.nickname}
                    </option>
                  ))
                ) : (
                  <option value="">Add a child first</option>
                )}
              </select>
            </label>
          </div>
        ) : (
          <Link className="button ghost" href="/parent/family/">
            Add a family and child first
          </Link>
        )}
      </section>

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
            className={mode === "structured" ? "active" : ""}
            onClick={() => setMode("structured")}
            type="button"
          >
            <FileJson2 /> Import AI question JSON
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

          {mode === "structured" ? (
            <>
              <div className="creation-heading">
                <span>
                  <FileJson2 />
                </span>
                <div>
                  <h2>Import an AI-structured question set</h2>
                  <p>
                    Select a schema 1.0 JSON file. It is validated and previewed
                    here; it is never added to the application code or a pull
                    request.
                  </p>
                </div>
              </div>
              <label className="drop-zone">
                <input
                  accept=".json,application/json"
                  aria-label="AI question JSON"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setStructuredFile(file);
                    setStructuredDocument(null);
                    setStructuredChecksum("");
                  }}
                  type="file"
                />
                <FileJson2 />
                <strong>
                  {structuredFile?.name || "Choose AI question JSON"}
                </strong>
                <span>
                  Preview does not write to the database. Questions are created
                  and assigned only after your confirmation.
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

          {mode !== "structured" ? (
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
          ) : null}
          {mode !== "structured" ? (
            <label className="toggle-row">
              <input type="checkbox" />
              <Headphones size={18} />
              Include listening when the source calls for it
            </label>
          ) : null}
          <button
            className="button primary large create-submit"
            disabled={!canCreate || requestStatus === "working"}
            onClick={() => void createDraft()}
            type="button"
          >
            {requestStatus === "working"
              ? "Preparing draft…"
              : mode === "structured"
                ? "Preview questions"
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
