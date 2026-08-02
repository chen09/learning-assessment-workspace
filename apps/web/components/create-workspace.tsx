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
import { CopyChildSignInLink } from "@/components/copy-child-sign-in-link";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  type ApiQuestion,
  type ChildProfile,
  type Family,
  type FamilyQuestionSet,
  type StructuredQuestionSetDocument,
  assignQuestionSet,
  confirmCompletedWorksheetImport,
  confirmQuestionSet,
  createQuestionSetImport,
  createCompletedWorksheetImport,
  createUploadIntent,
  getCompletedWorksheetImport,
  getChildren,
  getFamilyQuestionSets,
  getFamilies,
  getParentAccessToken,
  getQuestionSetDraft,
  importStructuredQuestionSet,
  previewStructuredQuestionSet,
  retryJob,
  uploadToSignedUrl,
} from "@/lib/api-client";

type CreateMode = "generate" | "import" | "completed" | "structured" | "manual";
type ImportPurpose = "generate_similar" | "use_as_questions";
type Stage =
  | "compose"
  | "review"
  | "source_ready"
  | "source_processing"
  | "variant_ready";
type AssignmentMode = "practice" | "exam";
type ManualQuestionType = "single_choice" | "typed_text" | "handwriting";
type VariantDifficulty = StructuredQuestionSetDocument["question_set"]["difficulty"];
type ManualDraftQuestion = StructuredQuestionSetDocument["questions"][number] & {
  id: string;
};
type QuestionSetDraft = Awaited<ReturnType<typeof getQuestionSetDraft>>;
type SourceImportJob = NonNullable<QuestionSetDraft["import_job"]>;

type CompletedPaperAnswerRegion = {
  question_position: number;
  page_numbers: number[];
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
  transcription?: string;
  legibility?: "clear" | "uncertain" | "unreadable";
};

type CompletedPaperReview = {
  document: StructuredQuestionSetDocument;
  answer_regions: CompletedPaperAnswerRegion[];
};

const LOCAL_COMPLETED_PAPER_REVIEW_PROMPT = `You are a careful school worksheet reviewer. Read the attached completed worksheet pages locally and return JSON only. Do not return Markdown, explanation, or an annotated image.

Goal: turn the printed questions and the student's handwritten answers into a parent-reviewable learning record. Preserve the original wording. Do not invent an answer when print or handwriting is unclear.

Rules:
1. Make one question for each separately scored unit. Keep positions 1, 2, 3... in reading order.
2. Use type single_choice, multiple_choice, typed_text, word_order, handwriting, photo, or listening. Use handwriting when the answer needs visual interpretation.
3. Include answer_key and rubric only when they can be verified from the paper or an attached answer key. Handwriting requires answer_key.reference (a private reference answer) and rubric.grading_mode "parent_review". For uncertain handwriting, set legibility to "uncertain" or "unreadable".
4. Keep question_set.locale as ja, zh, or en based on the worksheet. Keep prompts in the worksheet's language.
5. Do not include student names, storage paths, URLs, tokens, or any image data. Do not draw red marks or alter the original paper.
6. Every question must have exactly one matching answer_regions item. page_numbers are one-based. Regions are optional normalized coordinates: x/y/width/height must be 0..1.

Return this JSON shape exactly:
{
  "document": {
    "schema_version": "1.0",
    "question_set": {
      "title": "Worksheet title",
      "subject": "Mathematics or English",
      "locale": "ja",
      "difficulty": "standard",
      "source_mode": "convert",
      "instructions": "Answer every question.",
      "estimated_minutes": 20,
      "source_summary": { "source_kind": "completed_worksheet" }
    },
    "knowledge_tags": [{ "code": "topic-code", "label": "Topic" }],
    "questions": [{
      "position": 1,
      "type": "handwriting",
      "prompt": "Printed question text",
      "options": [],
      "answer_key": { "reference": "verified reference answer" },
      "rubric": { "grading_mode": "parent_review" },
      "points": 1,
      "knowledge_code": "topic-code"
    }]
  },
  "answer_regions": [{
    "question_position": 1,
    "page_numbers": [1],
    "regions": [{ "x": 0.1, "y": 0.2, "width": 0.7, "height": 0.12 }],
    "transcription": "optional careful transcription",
    "legibility": "clear"
  }]
}`;

const STRUCTURED_QUESTION_SET_PROMPT = `You are preparing a family learning question set from private textbook or worksheet material. Return JSON only, with no Markdown and no explanation. Do not copy student names, storage paths, URLs, tokens, or image data.

The parent will verify every question and answer before assigning it to a child. Use only content you can read from the supplied material. If source text is unclear, omit it rather than inventing it.

Return this strict JSON shape:
{
  "schema_version": "1.0",
  "question_set": {
    "title": "Short descriptive title",
    "subject": "English or Mathematics",
    "locale": "ja",
    "difficulty": "standard",
    "source_mode": "similar",
    "instructions": "Answer every question.",
    "estimated_minutes": 20,
    "source_summary": { "unit": "brief source description" }
  },
  "knowledge_tags": [{ "code": "short-topic-code", "label": "Topic label" }],
  "questions": [{
    "position": 1,
    "type": "typed_text",
    "prompt": "Question text for the child",
    "options": [],
    "answer_key": { "text": "exact accepted answer" },
    "rubric": { "grading_mode": "exact_match" },
    "points": 1,
    "knowledge_code": "short-topic-code"
  }]
}

Rules:
1. Positions must be continuous from 1. Every question must use one listed knowledge_code.
2. Use single_choice only with options and answer_key.choice as a zero-based number. Use typed_text with answer_key.text. Use handwriting for work that must be handwritten; then use answer_key.reference and rubric.grading_mode "parent_review". A listening question uses type listening, options, answer_key.choice, and a listening object with replay_limit (0–10), transcript, and transcript_policy (never, after_submission, or always). Do not provide audio_path: the parent attaches the private audio file during review.
3. Keep answers and rubrics private in the JSON. Never include answer keys inside the child-facing prompt.
4. Make the requested difficulty genuinely easier, similar, harder, or competition-level by changing reasoning demands, not merely calculation length.`;

function buildVariantQuestionSetPrompt(
  source: {
    title: string;
    subject: string;
    questions: QuestionSetDraft["questions"];
  },
  difficulty: VariantDifficulty,
) {
  const blueprint = source.questions.map((question) => ({
    position: question.position,
    type: question.type,
    prompt: question.prompt,
    options: question.options,
    answer_key: question.answer_key,
    points: question.points,
  }));
  return `${STRUCTURED_QUESTION_SET_PROMPT}

This is a variant request. The confirmed source set remains immutable; create a genuinely new question set with the same learning goals, not a copy or a superficial rewording. Target difficulty: ${difficulty}.

Private source blueprint for the parent only:
${JSON.stringify(
  {
    title: source.title,
    subject: source.subject,
    questions: blueprint,
  },
  null,
  2,
)}

Use source_mode "similar". Preserve only the learning goals, not the original wording. Return the strict JSON object defined above.`;
}

type ReviewDraftQuestion = Omit<ApiQuestion, "listening"> & {
  answer_key: Record<string, unknown>;
  answer?: string;
  listening?: StructuredQuestionSetDocument["questions"][number]["listening"];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSameTokenInventory(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const token of left) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const token of right) {
    const remaining = counts.get(token);
    if (!remaining) {
      return false;
    }
    counts.set(token, remaining - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

function parseCompletedPaperReview(value: string): CompletedPaperReview {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.document)) {
    throw new Error("The review must include a document object.");
  }
  const document = parsed.document as StructuredQuestionSetDocument;
  const questions = document.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("The review needs at least one confirmed question.");
  }
  if (!Array.isArray(parsed.answer_regions)) {
    throw new Error("The review must include answer_regions.");
  }

  const expectedPositions = questions.map((question) => question.position);
  if (expectedPositions.some((position, index) => position !== index + 1)) {
    throw new Error("Question positions must be contiguous and ordered from 1.");
  }
  for (const question of questions) {
    if (!isRecord(question.answer_key)) {
      throw new Error("Each question needs an answer key.");
    }
    const isOptionIndex = (candidate: unknown) =>
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 0 &&
      candidate < question.options.length;
    if (question.type === "single_choice" && !isOptionIndex(question.answer_key.choice)) {
      throw new Error("Single-choice answers must select one available option.");
    }
    if (question.type === "multiple_choice") {
      const choices = question.answer_key.choices;
      if (
        !Array.isArray(choices) ||
        choices.length === 0 ||
        choices.some((choice) => !isOptionIndex(choice)) ||
        new Set(choices).size !== choices.length
      ) {
        throw new Error("Multiple-choice answers must select available options.");
      }
    }
    if (question.type === "typed_text") {
      const text = question.answer_key.text;
      const texts = question.answer_key.texts;
      const hasSingleAnswer = typeof text === "string" && Boolean(text.trim());
      const hasMultipleAnswers =
        Array.isArray(texts) &&
        texts.length > 0 &&
        texts.every((answer) => typeof answer === "string" && Boolean(answer.trim()));
      if (!hasSingleAnswer && !hasMultipleAnswers) {
        throw new Error("Typed-text questions need at least one accepted answer.");
      }
    }
    if (question.type === "word_order") {
      const tokens = question.answer_key.tokens;
      if (
        !Array.isArray(tokens) ||
        tokens.length === 0 ||
        tokens.some((token) => typeof token !== "string" || !token.trim()) ||
        !hasSameTokenInventory(question.options, tokens)
      ) {
        throw new Error("Word-order answers must use the available tokens exactly once.");
      }
    }
    if (
      question.type === "handwriting" &&
      (typeof question.answer_key.reference !== "string" ||
        !question.answer_key.reference.trim() ||
        !isRecord(question.rubric) ||
        question.rubric.grading_mode !== "parent_review")
    ) {
      throw new Error("Handwriting questions need a private reference answer and parent review.");
    }
  }
  const answerRegions = parsed.answer_regions.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("Each answer region must be an object.");
    }
    const position = candidate.question_position;
    const pageNumbers = candidate.page_numbers;
    if (
      typeof position !== "number" ||
      !Number.isInteger(position) ||
      !Array.isArray(pageNumbers) ||
      pageNumbers.length === 0 ||
      pageNumbers.some(
        (page) => typeof page !== "number" || !Number.isInteger(page) || page < 1,
      )
    ) {
      throw new Error("Each answer region needs a question position and page number.");
    }
    const regions = candidate.regions;
    if (
      regions !== undefined &&
      (!Array.isArray(regions) ||
        regions.some(
          (region) =>
            !isRecord(region) ||
            ["x", "y", "width", "height"].some(
              (key) =>
                typeof region[key] !== "number" ||
                (region[key] as number) < 0 ||
                (region[key] as number) > 1,
            ),
        ))
    ) {
      throw new Error("Answer region coordinates must be normalized between 0 and 1.");
    }
    if (
      candidate.legibility !== undefined &&
      !["clear", "uncertain", "unreadable"].includes(String(candidate.legibility))
    ) {
      throw new Error("Legibility must be clear, uncertain, or unreadable.");
    }
    return {
      question_position: position,
      page_numbers: pageNumbers as number[],
      regions: regions as CompletedPaperAnswerRegion["regions"],
      transcription:
        typeof candidate.transcription === "string"
          ? candidate.transcription
          : undefined,
      legibility: candidate.legibility as CompletedPaperAnswerRegion["legibility"],
    };
  });
  if (
    answerRegions.length !== expectedPositions.length ||
    answerRegions.some(
      (region, index) => region.question_position !== expectedPositions[index],
    )
  ) {
    throw new Error("Answer regions must match every confirmed question in order.");
  }
  return { document, answer_regions: answerRegions };
}

export function CreateWorkspace() {
  return (
    <AppShell currentPath="/parent/create/" role="parent">
      <CreateWorkspaceContent />
    </AppShell>
  );
}

function CreateWorkspaceContent() {
  const { t } = useLanguage();
  const [families, setFamilies] = useState<Family[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
  const [mode, setMode] = useState<CreateMode>("generate");
  const [importPurpose, setImportPurpose] =
    useState<ImportPurpose>("generate_similar");
  const [stage, setStage] = useState<Stage>("compose");
  const [sourceMaterialName, setSourceMaterialName] = useState("");
  const [sourceMaterialQuestionSetId, setSourceMaterialQuestionSetId] =
    useState<string | null>(null);
  const [sourceMaterialTitle, setSourceMaterialTitle] = useState("");
  const [sourceMaterialSubject, setSourceMaterialSubject] = useState("");
  const [variantSource, setVariantSource] = useState<{
    id: string;
    title: string;
    subject: string;
    questions: QuestionSetDraft["questions"];
  } | null>(null);
  const [variantDifficulty, setVariantDifficulty] =
    useState<VariantDifficulty>("standard");
  const [sourceImportJob, setSourceImportJob] =
    useState<SourceImportJob | null>(null);
  const [availableSourceMaterials, setAvailableSourceMaterials] = useState<
    FamilyQuestionSet[]
  >([]);
  const [sourcePromptCopied, setSourcePromptCopied] = useState(false);
  const [importTitle, setImportTitle] = useState("Imported learning material");
  const [importSubject, setImportSubject] = useState("Mixed practice");
  const [fileName, setFileName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [completedDocumentLanguage, setCompletedDocumentLanguage] = useState<
    "zh" | "ja" | "en"
  >("ja");
  const [answerFileName, setAnswerFileName] = useState("");
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [referenceFileName, setReferenceFileName] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [structuredFile, setStructuredFile] = useState<File | null>(null);
  const [structuredDocument, setStructuredDocument] =
    useState<StructuredQuestionSetDocument | null>(null);
  const [structuredChecksum, setStructuredChecksum] = useState("");
  const [structuredImportKey, setStructuredImportKey] = useState("");
  const [manualTitle, setManualTitle] = useState("New practice");
  const [manualSubject, setManualSubject] = useState("Mixed practice");
  const [manualLocale, setManualLocale] = useState<"zh" | "ja" | "en">("en");
  const [manualQuestionType, setManualQuestionType] =
    useState<ManualQuestionType>("typed_text");
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("practice");
  const [assignmentDurationMinutes, setAssignmentDurationMinutes] =
    useState("30");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [manualQuestionPrompt, setManualQuestionPrompt] = useState("");
  const [manualOptions, setManualOptions] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [manualPoints, setManualPoints] = useState("1");
  const [manualDraftQuestions, setManualDraftQuestions] = useState<
    ManualDraftQuestion[]
  >([]);
  const [prompt, setPrompt] = useState(
    "Make a short mixed practice from this week’s algebra and English work.",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [questionSetId, setQuestionSetId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [completedWorksheetId, setCompletedWorksheetId] = useState<string | null>(
    null,
  );
  const [completedReviewFile, setCompletedReviewFile] = useState<File | null>(
    null,
  );
  const [completedReview, setCompletedReview] =
    useState<CompletedPaperReview | null>(null);
  const [completedReviewSource, setCompletedReviewSource] = useState<
    "ai" | "file" | null
  >(null);
  const [completedResponsePaths, setCompletedResponsePaths] = useState<string[]>(
    [],
  );
  const [completedPromptCopied, setCompletedPromptCopied] = useState(false);
  const [completedAttemptId, setCompletedAttemptId] = useState<string | null>(
    null,
  );
  const [completedWorksheetStatus, setCompletedWorksheetStatus] = useState<
    | "processing"
    | "needs_review"
    | "grading"
    | "results_ready"
    | "failed"
    | null
  >(null);
  const [draftQuestions, setDraftQuestions] = useState<ReviewDraftQuestion[]>(
    [],
  );
  const [listeningAudioFiles, setListeningAudioFiles] = useState<
    Record<string, File>
  >({});
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );
  const [editedQuestionPrompt, setEditedQuestionPrompt] = useState("");
  const [editedQuestionPoints, setEditedQuestionPoints] = useState("1");
  const [editedQuestionType, setEditedQuestionType] =
    useState<ManualQuestionType>("typed_text");
  const [editedQuestionOptions, setEditedQuestionOptions] = useState("");
  const [editedQuestionAnswer, setEditedQuestionAnswer] = useState("");
  const [editError, setEditError] = useState("");
  const [requestStatus, setRequestStatus] = useState<
    "idle" | "working" | "error"
  >("idle");

  const assignmentTimeLimitSeconds =
    assignmentMode === "exam" ? Number(assignmentDurationMinutes) * 60 : null;

  const loadCompletedReviewDraft = (extraction?: Record<string, unknown>) => {
    if (!extraction) {
      return;
    }
    try {
      setCompletedReview(parseCompletedPaperReview(JSON.stringify(extraction)));
      setCompletedReviewSource("ai");
      setCompletedReviewFile(null);
      setRequestStatus("idle");
    } catch {
      // A fixture or incomplete AI response remains safely manual-review only.
    }
  };

  const saveCompletedWorksheetRecoveryLink = (worksheetId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("completedWorksheetId", worksheetId);
    window.history.replaceState(window.history.state, "", url);
  };

  const saveQuestionSetRecoveryLink = (setId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("questionSetId", setId);
    window.history.replaceState(window.history.state, "", url);
  };

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

  useEffect(() => {
    const worksheetId = new URLSearchParams(window.location.search).get(
      "completedWorksheetId",
    );
    if (!worksheetId) {
      return;
    }

    let active = true;
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      try {
        const imported = await getCompletedWorksheetImport(
          worksheetId,
          parentToken,
        );
        if (!active) {
          return;
        }
        setCompletedWorksheetId(imported.id);
        setCompletedWorksheetStatus(imported.status);
        setCompletedResponsePaths(imported.response_paths);
        setCompletedAttemptId(imported.attempt_id);
        loadCompletedReviewDraft(imported.extraction);
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

  useEffect(() => {
    const setId = new URLSearchParams(window.location.search).get(
      "questionSetId",
    );
    if (!setId) {
      return;
    }

    let active = true;
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      try {
        const draft = await getQuestionSetDraft(setId, parentToken);
        if (!active) {
          return;
        }
        setMode("import");
        setQuestionSetId(draft.question_set.id);
        if (
          draft.question_set.status === "processing" &&
          draft.import_job !== null
        ) {
          setSourceImportJob(draft.import_job);
          setStage("source_processing");
          setRequestStatus("idle");
          return;
        }
        if (draft.question_set.status !== "needs_review") {
          return;
        }
        setDraftQuestions(draft.questions);
        if (
          draft.questions.length === 0 &&
          draft.question_set.source_summary.artifact_kind ===
            "private_source_material"
        ) {
          setSourceMaterialName(draft.question_set.title);
          setSourceMaterialQuestionSetId(draft.question_set.id);
          setSourceMaterialTitle(draft.question_set.title);
          setSourceMaterialSubject(draft.question_set.subject);
          setSourcePromptCopied(false);
          setStage("source_ready");
          setRequestStatus("idle");
          return;
        }
        setStage("review");
        setRequestStatus("idle");
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

  useEffect(() => {
    const variantSetId = new URLSearchParams(window.location.search).get(
      "variantOfQuestionSetId",
    );
    if (!variantSetId) {
      return;
    }

    let active = true;
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      try {
        const draft = await getQuestionSetDraft(variantSetId, parentToken);
        if (!active) {
          return;
        }
        if (
          draft.question_set.status !== "confirmed" ||
          draft.questions.length === 0
        ) {
          setRequestStatus("error");
          return;
        }
        setVariantSource({
          id: draft.question_set.id,
          title: draft.question_set.title,
          subject: draft.question_set.subject,
          questions: draft.questions,
        });
        setSourcePromptCopied(false);
        setStage("variant_ready");
        setRequestStatus("idle");
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

  useEffect(() => {
    if (
      stage !== "source_processing" ||
      !questionSetId ||
      sourceImportJob?.status === "failed"
    ) {
      return;
    }

    let active = true;
    const refresh = async () => {
      const parentToken = await getParentAccessToken();
      if (!parentToken || !active) {
        return;
      }
      try {
        const draft = await getQuestionSetDraft(questionSetId, parentToken);
        if (!active) {
          return;
        }
        if (draft.import_job !== null) {
          setSourceImportJob(draft.import_job);
        }
        if (draft.question_set.status !== "needs_review") {
          return;
        }
        setDraftQuestions(draft.questions);
        if (
          draft.questions.length === 0 &&
          draft.question_set.source_summary.artifact_kind ===
            "private_source_material"
        ) {
          setSourceMaterialName(draft.question_set.title);
          setSourceMaterialQuestionSetId(draft.question_set.id);
          setSourceMaterialTitle(draft.question_set.title);
          setSourceMaterialSubject(draft.question_set.subject);
          setSourcePromptCopied(false);
          setStage("source_ready");
          return;
        }
        setStage("review");
      } catch {
        if (active) {
          setRequestStatus("error");
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [questionSetId, sourceImportJob?.status, stage]);

  useEffect(() => {
    if (mode !== "structured" || !selectedFamilyId) {
      return;
    }

    let active = true;
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      try {
        const questionSets = await getFamilyQuestionSets(
          selectedFamilyId,
          parentToken,
        );
        if (!active) {
          return;
        }
        const privateMaterials = questionSets.filter(
          (questionSet) =>
            questionSet.source_summary.artifact_kind ===
            "private_source_material",
        );
        setAvailableSourceMaterials(privateMaterials);
        if (
          sourceMaterialQuestionSetId &&
          !privateMaterials.some(
            (material) => material.id === sourceMaterialQuestionSetId,
          )
        ) {
          setSourceMaterialQuestionSetId(null);
          setSourceMaterialTitle("");
          setSourceMaterialSubject("");
        }
      } catch {
        if (active) {
          setAvailableSourceMaterials([]);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [mode, selectedFamilyId, sourceMaterialQuestionSetId]);

  useEffect(() => {
    if (
      !completedWorksheetId ||
      completedWorksheetStatus !== "processing"
    ) {
      return;
    }

    let active = true;
    const poll = async () => {
      const parentToken = await getParentAccessToken();
      if (!parentToken || !active) {
        return;
      }
      try {
        const imported = await getCompletedWorksheetImport(
          completedWorksheetId,
          parentToken,
        );
        if (active) {
          setCompletedWorksheetStatus(imported.status);
          loadCompletedReviewDraft(imported.extraction);
        }
      } catch {
        if (active) {
          setRequestStatus("error");
        }
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [completedWorksheetId, completedWorksheetStatus]);

  const hasAssignmentTarget = Boolean(
    selectedFamilyId && selectedChildId,
  );
  const manualOptionList = manualOptions
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);
  const manualPointsValue = Number(manualPoints);
  const manualQuestionIsReady =
    Boolean(
      manualQuestionPrompt.trim() && manualAnswer.trim(),
    ) &&
    Number.isFinite(manualPointsValue) &&
    manualPointsValue > 0 &&
    (manualQuestionType !== "single_choice" ||
      manualOptionList.some((option) => option === manualAnswer.trim()));
  const manualQuestionHasContent = Boolean(
    manualQuestionPrompt.trim() || manualOptions.trim() || manualAnswer.trim(),
  );
  const manualDraftIsReady =
    Boolean(manualTitle.trim()) &&
    (manualDraftQuestions.length > 0 || manualQuestionIsReady) &&
    (!manualQuestionHasContent || manualQuestionIsReady);
  const canCreate =
    hasAssignmentTarget &&
    (mode === "import" || mode === "completed"
      ? Boolean(fileName)
      : mode === "structured"
        ? structuredFile !== null
        : mode === "manual"
          ? manualDraftIsReady
          : true);
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

  const buildManualQuestion = (position: number) => {
    const answer = manualAnswer.trim();
    return {
      position,
      type: manualQuestionType,
      prompt: manualQuestionPrompt.trim(),
      options:
        manualQuestionType === "single_choice" ? manualOptionList : [],
      answer_key:
        manualQuestionType === "single_choice"
          ? { choice: manualOptionList.indexOf(answer) }
          : manualQuestionType === "handwriting"
            ? { reference: answer }
            : { text: answer },
      rubric:
        manualQuestionType === "handwriting"
          ? { grading_mode: "parent_review" }
          : { grading_mode: "exact" },
      points: manualPointsValue,
      knowledge_code: "manual-practice",
    };
  };

  const addManualQuestion = () => {
    if (!manualQuestionIsReady) {
      setRequestStatus("error");
      return;
    }
    setManualDraftQuestions((current) => [
      ...current,
      { id: `manual-${crypto.randomUUID()}`, ...buildManualQuestion(current.length + 1) },
    ]);
    setManualQuestionPrompt("");
    setManualOptions("");
    setManualAnswer("");
    setManualPoints("1");
    setRequestStatus("idle");
  };

  const removeManualDraftQuestion = (questionId: string) => {
    setManualDraftQuestions((current) =>
      current
        .filter((question) => question.id !== questionId)
        .map((question, index) => ({ ...question, position: index + 1 })),
    );
  };

  const createDraft = async () => {
    if (mode === "completed") {
      const { familyId, childId } = getRouteIds();
      if (!familyId || !childId || files.length === 0) {
        setRequestStatus("error");
        return;
      }
      const feedbackLanguage =
        children.find((child) => child.id === childId)?.ui_language ?? "en";
      const parentToken = await getParentAccessToken();
      if (!parentToken) {
        setRequestStatus("error");
        return;
      }
      setRequestStatus("working");
      try {
        const uploadObjectId = crypto.randomUUID();
        const responsePaths: string[] = [];
        const answerSourcePaths: string[] = [];
        const referenceSourcePaths: string[] = [];
        const uploadContentType = (file: File) =>
          (["application/pdf", "image/png", "image/jpeg"].includes(file.type)
            ? file.type
            : "image/jpeg") as "application/pdf" | "image/png" | "image/jpeg";
        for (const [index, file] of files.entries()) {
          const intent = await createUploadIntent(
            {
              family_id: familyId,
              bucket: "responses",
              object_id: uploadObjectId,
              filename: file.name,
              content_type: uploadContentType(file),
            },
            parentToken,
            `completed-response-${uploadObjectId}-${index}`,
          );
          await uploadToSignedUrl(intent, file);
          responsePaths.push(intent.path);
        }
        const uploadPrivateSources = async (
          selectedFiles: File[],
          role: "answers" | "references",
          target: string[],
        ) => {
          for (const [index, file] of selectedFiles.entries()) {
            const intent = await createUploadIntent(
              {
                family_id: familyId,
                bucket: "sources",
                object_id: uploadObjectId,
                filename: file.name,
                content_type: uploadContentType(file),
              },
              parentToken,
              `completed-${role}-${uploadObjectId}-${index}`,
            );
            await uploadToSignedUrl(intent, file);
            target.push(intent.path);
          }
        };
        await uploadPrivateSources(answerFiles, "answers", answerSourcePaths);
        await uploadPrivateSources(
          referenceFiles,
          "references",
          referenceSourcePaths,
        );
        const imported = await createCompletedWorksheetImport(
          {
            family_id: familyId,
            child_id: childId,
            title: fileName.slice(0, 160),
            subject: "Mixed practice",
            document_language: completedDocumentLanguage,
            feedback_language: feedbackLanguage,
            filenames: files.map((file) => file.name),
            response_paths: responsePaths,
            answer_source_paths: answerSourcePaths,
            reference_source_paths: referenceSourcePaths,
          },
          parentToken,
          `completed-worksheet-${uploadObjectId}`,
        );
        saveCompletedWorksheetRecoveryLink(imported.id);
        setCompletedWorksheetId(imported.id);
        setCompletedWorksheetStatus(imported.status);
        setCompletedResponsePaths(imported.response_paths);
        loadCompletedReviewDraft(imported.extraction);
        setRequestStatus("idle");
      } catch {
        setRequestStatus("error");
      }
      return;
    }
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
        const parsedDocument = JSON.parse(
          await readTextFile(structuredFile),
        ) as StructuredQuestionSetDocument;
        const sourceSummary = {
          ...parsedDocument.question_set.source_summary,
          ...(sourceMaterialQuestionSetId
            ? {
                source_material_question_set_id: sourceMaterialQuestionSetId,
                source_material_title: sourceMaterialTitle,
                source_material_subject: sourceMaterialSubject,
              }
            : {}),
          ...(variantSource
            ? {
                variant_of_question_set_id: variantSource.id,
                variant_of_title: variantSource.title,
                variant_of_subject: variantSource.subject,
                variant_difficulty: variantDifficulty,
              }
            : {}),
        };
        const document: StructuredQuestionSetDocument = {
          ...parsedDocument,
          question_set: {
            ...parsedDocument.question_set,
            source_summary: sourceSummary,
          },
        };
        const preview = await previewStructuredQuestionSet(
          document,
          parentToken,
        );
        setStructuredDocument(document);
        setStructuredChecksum(preview.checksum);
        setStructuredImportKey(crypto.randomUUID());
        setDraftQuestions(
          preview.questions.map((question) => ({
            id: `preview-${question.position}`,
            position: question.position,
            type: question.type,
            prompt: question.prompt,
            options: question.options.length > 0 ? question.options : null,
            points: question.points,
            answer_key: question.answer_key,
            listening: question.listening,
          })),
        );
        setListeningAudioFiles({});
        setStage("review");
        setRequestStatus("idle");
      } catch {
        setRequestStatus("error");
      }
      return;
    }

    if (mode === "manual") {
      if (!manualDraftIsReady) {
        setRequestStatus("error");
        return;
      }
      const parentToken = await getParentAccessToken();
      if (!parentToken) {
        setRequestStatus("error");
        return;
      }
      const questions = [
        ...manualDraftQuestions.map((question) => ({
          position: question.position,
          type: question.type,
          prompt: question.prompt,
          options: question.options,
          answer_key: question.answer_key,
          rubric: question.rubric,
          points: question.points,
          knowledge_code: question.knowledge_code,
        })),
        ...(manualQuestionIsReady
          ? [buildManualQuestion(manualDraftQuestions.length + 1)]
          : []),
      ].map((question, index) => ({ ...question, position: index + 1 }));
      const document: StructuredQuestionSetDocument = {
        schema_version: "1.0",
        question_set: {
          title: manualTitle.trim(),
          subject: manualSubject.trim() || "Mixed practice",
          locale: manualLocale,
          difficulty: "adaptive",
          source_mode: "manual",
          instructions: "Answer the question.",
          estimated_minutes: 5,
          source_summary: { source_kind: "manual" },
        },
        knowledge_tags: [
          { code: "manual-practice", label: "Parent-authored practice" },
        ],
        questions,
      };
      setRequestStatus("working");
      try {
        const preview = await previewStructuredQuestionSet(document, parentToken);
        setStructuredDocument(document);
        setStructuredChecksum(preview.checksum);
        setStructuredImportKey(crypto.randomUUID());
        setDraftQuestions(
          preview.questions.map((question) => ({
            id: `preview-${question.position}`,
            position: question.position,
            type: question.type,
            prompt: question.prompt,
            options: question.options.length > 0 ? question.options : null,
            points: question.points,
            answer_key: question.answer_key,
            listening: question.listening,
          })),
        );
        setListeningAudioFiles({});
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
              : mode === "import"
                ? importTitle.trim() || "Imported learning material"
                : isLessonOneImport
                  ? "Lesson 1 同レベル変形練習"
                  : "Imported learning material",
          subject:
            mode === "import"
              ? importSubject.trim() || "Mixed practice"
              : isLessonOneImport
                ? "English"
                : "Mixed practice",
        },
        parentToken,
        `import-${importObjectId}`,
      );
      setQuestionSetId(imported.question_set_id);
      saveQuestionSetRecoveryLink(imported.question_set_id);
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
          if (draft.import_job?.status === "failed") {
            setSourceImportJob(draft.import_job);
            setStage("source_processing");
            setRequestStatus("idle");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          if (attempt === 59) {
            setSourceImportJob(draft.import_job);
            setStage("source_processing");
            setRequestStatus("idle");
            return;
          }
        }
      }
      setDraftQuestions(draft.questions);
      if (mode === "import" && draft.questions.length === 0) {
        setSourceMaterialName(
          files.map((file) => file.name).join(", ") || "Source material",
        );
        setSourceMaterialQuestionSetId(imported.question_set_id);
        setSourceMaterialTitle(
          importTitle.trim() || "Imported learning material",
        );
        setSourceMaterialSubject(importSubject.trim() || "Mixed practice");
        setSourcePromptCopied(false);
        setStage("source_ready");
        setRequestStatus("idle");
        return;
      }
      if (isLessonOneImport) {
        setAssignmentMode("exam");
        setAssignmentDurationMinutes("45");
      }
      setStage("review");
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const copyStructuredQuestionSetPrompt = async () => {
    try {
      await navigator.clipboard.writeText(
        variantSource
          ? buildVariantQuestionSetPrompt(variantSource, variantDifficulty)
          : STRUCTURED_QUESTION_SET_PROMPT,
      );
      setSourcePromptCopied(true);
    } catch {
      setRequestStatus("error");
    }
  };

  const confirmAndAssign = async () => {
    const { familyId, childId } = getRouteIds();
    if (mode === "structured" || mode === "manual") {
      if (
        !familyId ||
        !childId ||
        !structuredDocument ||
        !structuredChecksum ||
        !structuredImportKey
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
        const draftQuestionByPosition = new Map(
          draftQuestions.map((question) => [question.position, question]),
        );
        const documentWithPrivateAudio: StructuredQuestionSetDocument = {
          ...structuredDocument,
          questions: await Promise.all(
            structuredDocument.questions.map(async (question) => {
              if (question.type !== "listening") {
                return question;
              }
              const draftQuestion = draftQuestionByPosition.get(
                question.position,
              );
              const audioFile = draftQuestion
                ? listeningAudioFiles[draftQuestion.id]
                : undefined;
              if (!audioFile && !question.listening?.audio_path) {
                throw new Error(
                  `Listening question ${question.position} needs an audio file.`,
                );
              }
              if (!audioFile) {
                return question;
              }
              const contentType =
                audioFile.type === "audio/mpeg" ||
                audioFile.name.toLowerCase().endsWith(".mp3")
                  ? "audio/mpeg"
                  : audioFile.type === "audio/mp4" ||
                      audioFile.type === "audio/x-m4a" ||
                      audioFile.name.toLowerCase().endsWith(".m4a") ||
                      audioFile.name.toLowerCase().endsWith(".mp4")
                    ? "audio/mp4"
                    : null;
              if (!contentType) {
                throw new Error("Use an MP3, M4A, or MP4 audio file.");
              }
              const intent = await createUploadIntent(
                {
                  family_id: familyId,
                  bucket: "audio",
                  object_id: crypto.randomUUID(),
                  filename: audioFile.name,
                  content_type: contentType,
                },
                parentToken,
                `listening-audio-${structuredImportKey}-${question.position}`,
              );
              await uploadToSignedUrl(intent, audioFile);
              return {
                ...question,
                listening: {
                  ...question.listening,
                  audio_path: intent.path,
                },
              };
            }),
          ),
        };
        const imported = await importStructuredQuestionSet(
          {
            family_id: familyId,
            child_id: childId,
            source_name: structuredFile?.name ?? "Manual question",
            assignment_mode: assignmentMode,
            time_limit_seconds: assignmentTimeLimitSeconds,
            parent_note: assignmentNote.trim() || null,
            document: documentWithPrivateAudio,
          },
          parentToken,
          `${mode}-${structuredImportKey}-${childId}`,
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
        {
          mode: assignmentMode,
          time_limit_seconds: assignmentTimeLimitSeconds,
          parent_note: assignmentNote.trim() || null,
        },
      );
      setAssignmentId(assignment.id);
      setConfirmed(true);
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const beginStructuredQuestionEdit = (
    question: ReviewDraftQuestion,
  ) => {
    const type: ManualQuestionType =
      question.type === "single_choice" ||
      question.type === "typed_text" ||
      question.type === "handwriting"
        ? question.type
        : "typed_text";
    const choice = question.answer_key.choice;
    const answer =
      type === "single_choice" &&
      typeof choice === "number" &&
      question.options?.[choice]
        ? question.options[choice]
        : typeof question.answer_key.reference === "string"
          ? question.answer_key.reference
          : typeof question.answer_key.text === "string"
            ? question.answer_key.text
            : "";
    setEditingQuestionId(question.id);
    setEditedQuestionPrompt(question.prompt);
    setEditedQuestionPoints(String(question.points));
    setEditedQuestionType(type);
    setEditedQuestionOptions((question.options ?? []).join("\n"));
    setEditedQuestionAnswer(answer);
    setEditError("");
  };

  const saveStructuredQuestionEdit = (questionId: string) => {
    const prompt = editedQuestionPrompt.trim();
    const points = Number(editedQuestionPoints);
    const answer = editedQuestionAnswer.trim();
    const options = editedQuestionOptions
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean);
    if (
      !structuredDocument ||
      !prompt ||
      !answer ||
      !Number.isFinite(points) ||
      points <= 0
    ) {
      setEditError("Add wording, an answer or grading guide, and a positive point value.");
      return;
    }
    if (
      editedQuestionType === "single_choice" &&
      (options.length < 2 || !options.includes(answer))
    ) {
      setEditError("A choice question needs at least two choices and a matching correct answer.");
      return;
    }
    const question = draftQuestions.find((candidate) => candidate.id === questionId);
    if (!question) {
      setEditError("This draft question is no longer available.");
      return;
    }
    const answerKey =
      editedQuestionType === "single_choice"
        ? { choice: options.indexOf(answer) }
        : editedQuestionType === "handwriting"
          ? { reference: answer }
          : { text: answer };
    const rubric =
      editedQuestionType === "handwriting"
        ? { grading_mode: "parent_review" }
        : { grading_mode: "exact" };
    setDraftQuestions((current) =>
      current.map((candidate) =>
        candidate.id === questionId
          ? {
              ...candidate,
              prompt,
              points,
              type: editedQuestionType,
              options: options.length > 0 ? options : null,
              answer_key: answerKey,
            }
          : candidate,
      ),
    );
    setStructuredDocument((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((candidate) =>
              candidate.position === question.position
                ? {
                    ...candidate,
                    prompt,
                    points,
                    type: editedQuestionType,
                    options: editedQuestionType === "single_choice" ? options : [],
                    answer_key: answerKey,
                    rubric,
                  }
                : candidate,
            ),
          }
        : current,
    );
    setEditingQuestionId(null);
    setEditError("");
    setStructuredImportKey(crypto.randomUUID());
  };

  const removeStructuredQuestion = (questionId: string) => {
    if (!structuredDocument || draftQuestions.length <= 1) {
      return;
    }
    const question = draftQuestions.find((candidate) => candidate.id === questionId);
    if (!question) {
      return;
    }
    setDraftQuestions((current) =>
      current
        .filter((candidate) => candidate.id !== questionId)
        .map((candidate, index) => ({ ...candidate, position: index + 1 })),
    );
    setStructuredDocument((current) =>
      current
        ? {
            ...current,
            questions: current.questions
              .filter((candidate) => candidate.position !== question.position)
              .map((candidate, index) => ({ ...candidate, position: index + 1 })),
          }
        : current,
    );
    if (editingQuestionId === questionId) {
      setEditingQuestionId(null);
      setEditError("");
    }
    setStructuredImportKey(crypto.randomUUID());
  };

  const moveStructuredQuestion = (questionId: string, direction: -1 | 1) => {
    if (!structuredDocument) {
      return;
    }
    const currentIndex = draftQuestions.findIndex(
      (candidate) => candidate.id === questionId,
    );
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= draftQuestions.length) {
      return;
    }
    const currentQuestion = draftQuestions[currentIndex];
    const targetQuestion = draftQuestions[targetIndex];
    setDraftQuestions((current) => {
      const next = [...current];
      [next[currentIndex], next[targetIndex]] = [
        next[targetIndex],
        next[currentIndex],
      ];
      return next.map((candidate, index) => ({ ...candidate, position: index + 1 }));
    });
    setStructuredDocument((current) =>
      current
        ? {
            ...current,
            questions: current.questions
              .map((candidate) =>
                candidate.position === currentQuestion.position
                  ? { ...candidate, position: targetQuestion.position }
                  : candidate.position === targetQuestion.position
                    ? { ...candidate, position: currentQuestion.position }
                    : candidate,
              )
              .sort((left, right) => left.position - right.position),
          }
        : current,
    );
    setStructuredImportKey(crypto.randomUUID());
  };

  const duplicateStructuredQuestion = (questionId: string) => {
    if (!structuredDocument) {
      return;
    }
    const currentIndex = draftQuestions.findIndex(
      (candidate) => candidate.id === questionId,
    );
    if (currentIndex < 0) {
      return;
    }
    const question = draftQuestions[currentIndex];
    const copiedPrompt = `${question.prompt} (copy)`;
    setDraftQuestions((current) => {
      const next = [...current];
      next.splice(currentIndex + 1, 0, {
        ...question,
        id: `copy-${crypto.randomUUID()}`,
        prompt: copiedPrompt,
        options: question.options ? [...question.options] : null,
        answer_key: { ...question.answer_key },
      });
      return next.map((candidate, index) => ({ ...candidate, position: index + 1 }));
    });
    setStructuredDocument((current) =>
      current
        ? {
            ...current,
            questions: current.questions
              .flatMap((candidate) =>
                candidate.position === question.position
                  ? [
                      candidate,
                      {
                        ...candidate,
                        prompt: copiedPrompt,
                        options: [...candidate.options],
                        answer_key: { ...candidate.answer_key },
                        rubric: { ...candidate.rubric },
                      },
                    ]
                  : [candidate],
              )
              .map((candidate, index) => ({ ...candidate, position: index + 1 })),
          }
        : current,
    );
    setStructuredImportKey(crypto.randomUUID());
  };

  const confirmCompletedPaper = async () => {
    if (!completedWorksheetId || !completedReview) {
      setRequestStatus("error");
      return;
    }
    let validatedReview: CompletedPaperReview;
    try {
      validatedReview = parseCompletedPaperReview(
        JSON.stringify(completedReview),
      );
    } catch {
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
      const confirmed = await confirmCompletedWorksheetImport(
        completedWorksheetId,
        {
          document: validatedReview.document,
          responses: validatedReview.answer_regions.map((region) => ({
            question_position: region.question_position,
            kind: "photo" as const,
            answer: {
              source_paths: completedResponsePaths,
              page_numbers: region.page_numbers,
              ...(region.regions ? { regions: region.regions } : {}),
              ...(region.transcription
                ? { transcription: region.transcription }
                : {}),
              ...(region.legibility ? { legibility: region.legibility } : {}),
            },
          })),
        },
        parentToken,
        `confirm-completed-${completedWorksheetId}`,
      );
      setAssignmentId(confirmed.assignment.id);
      setCompletedAttemptId(confirmed.attempt.id);
      setCompletedWorksheetStatus(confirmed.completed_worksheet.status);
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const retryCompletedPaperAnalysis = async () => {
    if (!completedWorksheetId) {
      setRequestStatus("error");
      return;
    }
    const parentToken = await getParentAccessToken();
    if (!parentToken) {
      setRequestStatus("error");
      return;
    }
    try {
      const imported = await getCompletedWorksheetImport(
        completedWorksheetId,
        parentToken,
      );
      if (imported.job.status !== "failed") {
        setCompletedWorksheetStatus(imported.status);
        return;
      }
      setRequestStatus("working");
      await retryJob(imported.job.id, parentToken);
      setCompletedWorksheetStatus("processing");
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const retrySourceImport = async () => {
    if (!sourceImportJob || sourceImportJob.status !== "failed") {
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
      const retried = await retryJob(sourceImportJob.id, parentToken);
      setSourceImportJob(retried);
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const selectCompletedReview = async (file: File | null) => {
    setCompletedReviewFile(file);
    setCompletedReview(null);
    setCompletedReviewSource(null);
    setCompletedPromptCopied(false);
    if (!file) {
      return;
    }
    try {
      setCompletedReview(parseCompletedPaperReview(await readTextFile(file)));
      setCompletedReviewSource("file");
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

  const updateCompletedPaperQuestion = (
    position: number,
    update: (question: StructuredQuestionSetDocument["questions"][number]) => StructuredQuestionSetDocument["questions"][number],
  ) => {
    setCompletedReview((current) =>
      current
        ? {
            ...current,
            document: {
              ...current.document,
              questions: current.document.questions.map((question) =>
                question.position === position ? update(question) : question,
              ),
            },
          }
        : current,
    );
  };

  const removeCompletedPaperQuestion = (position: number) => {
    setCompletedReview((current) => {
      if (!current || current.document.questions.length <= 1) {
        return current;
      }
      const keptQuestions = current.document.questions.filter(
        (question) => question.position !== position,
      );
      const nextPositionByCurrentPosition = new Map(
        keptQuestions.map((question, index) => [question.position, index + 1]),
      );
      return {
        ...current,
        document: {
          ...current.document,
          questions: keptQuestions.map((question, index) => ({
            ...question,
            position: index + 1,
          })),
        },
        answer_regions: current.answer_regions
          .filter((region) => region.question_position !== position)
          .flatMap((region) => {
            const nextPosition = nextPositionByCurrentPosition.get(
              region.question_position,
            );
            return nextPosition
              ? [{ ...region, question_position: nextPosition }]
              : [];
          })
          .sort((left, right) => left.question_position - right.question_position),
      };
    });
  };

  const addCompletedPaperHandwritingQuestion = () => {
    setCompletedReview((current) => {
      if (!current) {
        return current;
      }
      const position = current.document.questions.length + 1;
      return {
        ...current,
        document: {
          ...current.document,
          questions: [
            ...current.document.questions,
            {
              position,
              type: "handwriting",
              prompt: "",
              options: [],
              answer_key: { reference: "" },
              rubric: { grading_mode: "parent_review" },
              points: 1,
              knowledge_code:
                current.document.knowledge_tags[0]?.code ?? "parent-added",
            },
          ],
        },
        answer_regions: [
          ...current.answer_regions,
          {
            question_position: position,
            page_numbers: [1],
            legibility: "uncertain",
          },
        ],
      };
    });
  };

  const updateCompletedPaperAnswerRegion = (
    position: number,
    update: (region: CompletedPaperAnswerRegion) => CompletedPaperAnswerRegion,
  ) => {
    setCompletedReview((current) =>
      current
        ? {
            ...current,
            answer_regions: current.answer_regions.map((region) =>
              region.question_position === position ? update(region) : region,
            ),
          }
        : current,
    );
  };

  const parseCompletedPaperPageNumbers = (value: string) =>
    value
      .split(",")
      .map((candidate) => Number(candidate.trim()))
      .filter(
        (candidate) => Number.isInteger(candidate) && candidate >= 1,
      );

  const copyCompletedPaperPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LOCAL_COMPLETED_PAPER_REVIEW_PROMPT);
      setCompletedPromptCopied(true);
    } catch {
      setRequestStatus("error");
    }
  };

  if (completedWorksheetId) {
    return (
      <>
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("completedPaper.eyebrow")}</p>
            <h1>
              {completedWorksheetStatus === "processing"
                ? t("completedPaper.readingTitle")
                : t("completedPaper.reviewTitle")}
            </h1>
            <p className="lede">{t("completedPaper.description")}</p>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="assignment-panel">
          <div>
            <p className="eyebrow">
              {completedWorksheetStatus === "processing"
                ? t("completedPaper.analysisProcessing")
                : completedWorksheetStatus === "failed"
                  ? t("completedPaper.analysisFailed")
                : t("completedPaper.analysisReady")}
            </p>
            <h2>
              {completedAttemptId
                ? t("completedPaper.submitted")
                : completedWorksheetStatus === "processing"
                  ? t("completedPaper.preparing")
                  : completedWorksheetStatus === "failed"
                    ? t("completedPaper.analysisFailedTitle")
                  : t("completedPaper.notAssigned")}
            </h2>
            <p>
              {completedAttemptId
                ? t("completedPaper.submittedDetails")
                : completedWorksheetStatus === "processing"
                  ? t("completedPaper.preparingDetails")
                  : completedWorksheetStatus === "failed"
                    ? t("completedPaper.analysisFailedDetails")
                  : t("completedPaper.reviewDetails")}
            </p>
          </div>
          {completedAttemptId ? (
            <Link
              className="button primary"
              href={`/parent/results/?attemptId=${encodeURIComponent(completedAttemptId)}`}
            >
              {t("completedPaper.openResults")}
            </Link>
          ) : completedWorksheetStatus === "needs_review" ? (
            <div className="stacked-form">
              {completedReviewSource === "ai" ? (
                <p className="status-pill cool">
                  {t("completedPaper.serverDraft")}
                </p>
              ) : (
                <details open>
                  <summary>{t("completedPaper.prepareLocal")}</summary>
                  <p>{t("completedPaper.localDetails")}</p>
                  <button
                    className="button secondary"
                    onClick={() => void copyCompletedPaperPrompt()}
                    type="button"
                  >
                    {completedPromptCopied
                      ? t("completedPaper.promptCopied")
                      : t("completedPaper.copyPrompt")}
                  </button>
                </details>
              )}
              <label className="drop-zone compact-drop-zone">
                <input
                  accept=".json,application/json"
                  aria-label={t("completedPaper.reviewJson")}
                  onChange={(event) =>
                    void selectCompletedReview(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
                <FileJson2 />
                <strong>
                  {completedReviewFile?.name || t("completedPaper.chooseJson")}
                </strong>
                <span>{t("completedPaper.jsonHelp")}</span>
              </label>
              {completedReview ? (
                <>
                  <p className="status-pill cool">
                    {t("completedPaper.reviewReady", {
                      questions: completedReview.document.questions.length,
                      regions: completedReview.answer_regions.length,
                    })}
                  </p>
                  <details open>
                    <summary>{t("completedPaper.previewQuestions")}</summary>
                    <ol className="completed-paper-review-list">
                      {completedReview.document.questions.map((question, index) => (
                        <li key={question.position}>
                          <label>
                            <span>{t("completedPaper.questionWording")}</span>
                            <textarea
                              aria-label={t("completedPaper.questionWordingFor", {
                                position: question.position,
                              })}
                              onChange={(event) =>
                                updateCompletedPaperQuestion(question.position, (current) => ({
                                  ...current,
                                  prompt: event.target.value,
                                }))
                              }
                              value={question.prompt}
                            />
                          </label>
                          {question.type === "handwriting" ? (
                            <label>
                              <span>{t("completedPaper.referenceAnswer")}</span>
                              <input
                                aria-label={t("completedPaper.referenceAnswerFor", {
                                  position: question.position,
                                })}
                                onChange={(event) =>
                                  updateCompletedPaperQuestion(question.position, (current) => ({
                                    ...current,
                                    answer_key: {
                                      ...current.answer_key,
                                      reference: event.target.value,
                                    },
                                  }))
                                }
                                value={
                                  typeof question.answer_key.reference === "string"
                                    ? question.answer_key.reference
                                    : ""
                                }
                              />
                            </label>
                          ) : null}
                          {question.type === "typed_text" ? (
                            <label>
                              <span>{t("completedPaper.acceptedAnswer")}</span>
                              <input
                                aria-label={t("completedPaper.acceptedAnswerFor", {
                                  position: question.position,
                                })}
                                onChange={(event) =>
                                  updateCompletedPaperQuestion(question.position, (current) => {
                                    const answerKey = { ...current.answer_key };
                                    delete answerKey.texts;
                                    return {
                                      ...current,
                                      answer_key: {
                                        ...answerKey,
                                        text: event.target.value,
                                      },
                                    };
                                  })
                                }
                                value={
                                  typeof question.answer_key.text === "string"
                                    ? question.answer_key.text
                                    : Array.isArray(question.answer_key.texts)
                                      ? question.answer_key.texts.find(
                                          (answer): answer is string =>
                                            typeof answer === "string",
                                        ) ?? ""
                                      : ""
                                }
                              />
                            </label>
                          ) : null}
                          {question.type === "single_choice" ? (
                            <label>
                              <span>{t("completedPaper.correctChoice")}</span>
                              <select
                                aria-label={t("completedPaper.correctChoiceFor", {
                                  position: question.position,
                                })}
                                onChange={(event) =>
                                  updateCompletedPaperQuestion(question.position, (current) => ({
                                    ...current,
                                    answer_key: {
                                      ...current.answer_key,
                                      choice: Number(event.target.value),
                                    },
                                  }))
                                }
                                value={
                                  typeof question.answer_key.choice === "number"
                                    ? String(question.answer_key.choice)
                                    : ""
                                }
                              >
                                {question.options.map((option, optionIndex) => (
                                  <option key={`${optionIndex}-${option}`} value={optionIndex}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {question.type === "multiple_choice" ? (
                            <fieldset className="completed-paper-choice-list">
                              <legend>{t("completedPaper.correctChoices")}</legend>
                              {question.options.map((option, optionIndex) => {
                                const selectedChoices = Array.isArray(
                                  question.answer_key.choices,
                                )
                                  ? question.answer_key.choices.filter(
                                      (choice): choice is number =>
                                        typeof choice === "number" &&
                                        Number.isInteger(choice) &&
                                        choice >= 0 &&
                                        choice < question.options.length,
                                    )
                                  : [];
                                const isSelected = selectedChoices.includes(optionIndex);
                                return (
                                  <label key={`${optionIndex}-${option}`}>
                                    <input
                                      aria-label={t(
                                        "completedPaper.correctChoiceOptionFor",
                                        {
                                          choice: optionIndex + 1,
                                          position: question.position,
                                        },
                                      )}
                                      checked={isSelected}
                                      onChange={() =>
                                        updateCompletedPaperQuestion(
                                          question.position,
                                          (current) => {
                                            const choices = Array.isArray(
                                              current.answer_key.choices,
                                            )
                                              ? current.answer_key.choices.filter(
                                                  (choice): choice is number =>
                                                    typeof choice === "number" &&
                                                    Number.isInteger(choice) &&
                                                    choice >= 0 &&
                                                    choice < current.options.length,
                                                )
                                              : [];
                                            const nextChoices = choices.includes(optionIndex)
                                              ? choices.length === 1
                                                ? choices
                                                : choices.filter(
                                                    (choice) => choice !== optionIndex,
                                                  )
                                              : [...choices, optionIndex].sort(
                                                  (left, right) => left - right,
                                                );
                                            return {
                                              ...current,
                                              answer_key: {
                                                ...current.answer_key,
                                                choices: nextChoices,
                                              },
                                            };
                                          },
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    <span>{option}</span>
                                  </label>
                                );
                              })}
                            </fieldset>
                          ) : null}
                          {question.type === "word_order" ? (
                            <label>
                              <span>{t("completedPaper.correctWordOrder")}</span>
                              <textarea
                                aria-label={t("completedPaper.correctWordOrderFor", {
                                  position: question.position,
                                })}
                                onChange={(event) =>
                                  updateCompletedPaperQuestion(question.position, (current) => ({
                                    ...current,
                                    answer_key: {
                                      ...current.answer_key,
                                      tokens: event.target.value
                                        .split("\n")
                                        .map((token) => token.trim())
                                        .filter(Boolean),
                                    },
                                  }))
                                }
                                value={
                                  Array.isArray(question.answer_key.tokens)
                                    ? question.answer_key.tokens
                                        .filter(
                                          (token): token is string =>
                                            typeof token === "string",
                                        )
                                        .join("\n")
                                    : ""
                                }
                              />
                            </label>
                          ) : null}
                          {completedReview.answer_regions[index] ? (
                            <div className="completed-paper-region-fields">
                              <label>
                                <span>{t("completedPaper.answerPages")}</span>
                                <input
                                  aria-label={t("completedPaper.answerPagesFor", {
                                    position: question.position,
                                  })}
                                  onChange={(event) =>
                                    updateCompletedPaperAnswerRegion(
                                      question.position,
                                      (region) => ({
                                        ...region,
                                        page_numbers: parseCompletedPaperPageNumbers(
                                          event.target.value,
                                        ),
                                      }),
                                    )
                                  }
                                  value={completedReview.answer_regions[index].page_numbers.join(", ")}
                                />
                              </label>
                              <label>
                                <span>{t("completedPaper.answerTranscription")}</span>
                                <textarea
                                  aria-label={t("completedPaper.answerTranscriptionFor", {
                                    position: question.position,
                                  })}
                                  onChange={(event) =>
                                    updateCompletedPaperAnswerRegion(
                                      question.position,
                                      (region) => ({
                                        ...region,
                                        transcription: event.target.value || undefined,
                                      }),
                                    )
                                  }
                                  value={
                                    completedReview.answer_regions[index].transcription ?? ""
                                  }
                                />
                              </label>
                              <label>
                                <span>{t("completedPaper.legibility")}</span>
                                <select
                                  aria-label={t("completedPaper.legibilityFor", {
                                    position: question.position,
                                  })}
                                  onChange={(event) =>
                                    updateCompletedPaperAnswerRegion(
                                      question.position,
                                      (region) => ({
                                        ...region,
                                        legibility: event.target.value as CompletedPaperAnswerRegion["legibility"],
                                      }),
                                    )
                                  }
                                  value={
                                    completedReview.answer_regions[index].legibility ?? "clear"
                                  }
                                >
                                  <option value="clear">{t("completedPaper.legibility.clear")}</option>
                                  <option value="uncertain">{t("completedPaper.legibility.uncertain")}</option>
                                  <option value="unreadable">{t("completedPaper.legibility.unreadable")}</option>
                                </select>
                              </label>
                              {completedReview.answer_regions[index].regions?.length ? (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    updateCompletedPaperAnswerRegion(
                                      question.position,
                                      (region) => ({ ...region, regions: undefined }),
                                    )
                                  }
                                  type="button"
                                >
                                  {t("completedPaper.useWholePage")}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          <button
                            className="text-button completed-paper-remove-question"
                            disabled={completedReview.document.questions.length <= 1}
                            onClick={() => removeCompletedPaperQuestion(question.position)}
                            type="button"
                          >
                            {t("completedPaper.removeQuestion", {
                              position: question.position,
                            })}
                          </button>
                        </li>
                      ))}
                    </ol>
                    <button
                      className="button secondary completed-paper-add-question"
                      onClick={addCompletedPaperHandwritingQuestion}
                      type="button"
                    >
                      {t("completedPaper.addHandwritingQuestion")}
                    </button>
                  </details>
                </>
              ) : null}
              <button
                className="button primary"
                disabled={!completedReview || requestStatus === "working"}
                onClick={() => void confirmCompletedPaper()}
                type="button"
              >
                {requestStatus === "working"
                  ? t("completedPaper.confirming")
                  : t("completedPaper.confirm")}
              </button>
            </div>
          ) : completedWorksheetStatus === "failed" ? (
            <button
              className="button primary"
              disabled={requestStatus === "working"}
              onClick={() => void retryCompletedPaperAnalysis()}
              type="button"
            >
              {requestStatus === "working"
                ? t("completedPaper.retrying")
                : t("completedPaper.retry")}
            </button>
          ) : (
            <span className="status-pill warm">
              {t("completedPaper.preparingReview")}
            </span>
          )}
        </section>
        {requestStatus === "error" ? (
          <p className="form-error" role="alert">
            {t("completedPaper.error")}
          </p>
        ) : null}
      </>
    );
  }

  if (stage === "source_processing") {
    const sourceImportFailed = sourceImportJob?.status === "failed";
    return (
      <>
        <header className="page-header">
          <div>
            <button
              className="back-button"
              onClick={() => setStage("compose")}
              type="button"
            >
              <ArrowLeft size={16} /> {t("sourceImport.back")}
            </button>
            <p className="eyebrow">{t("sourceImport.eyebrow")}</p>
            <h1>
              {sourceImportFailed
                ? t("sourceImport.failedTitle")
                : t("sourceImport.processingTitle")}
            </h1>
            <p className="lede">
              {sourceImportFailed
                ? t("sourceImport.failedDescription")
                : t("sourceImport.processingDescription")}
            </p>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="creation-card source-ready-card">
          <div className="creation-heading">
            <span><FileText /></span>
            <div>
              <h2>
                {sourceImportFailed
                  ? t("sourceImport.failedCardTitle")
                  : t("sourceImport.processingCardTitle")}
              </h2>
              <p>
                {sourceImportFailed
                  ? t("sourceImport.failedCardDescription")
                  : t("sourceImport.processingCardDescription")}
              </p>
            </div>
          </div>
          {sourceImportFailed ? (
            <button
              className="button primary"
              disabled={requestStatus === "working"}
              onClick={() => void retrySourceImport()}
              type="button"
            >
              {requestStatus === "working"
                ? t("sourceImport.retrying")
                : t("sourceImport.retry")}
            </button>
          ) : (
            <span className="status-pill warm">
              {t("sourceImport.processing")}
            </span>
          )}
        </section>
        {requestStatus === "error" ? (
          <p className="form-error" role="alert">
            {t("sourceImport.error")}
          </p>
        ) : null}
      </>
    );
  }

  if (stage === "source_ready") {
    return (
      <>
        <header className="page-header">
          <div>
            <button
              className="back-button"
              onClick={() => setStage("compose")}
              type="button"
            >
              <ArrowLeft size={16} /> {t("sourceMaterial.back")}
            </button>
            <p className="eyebrow">{t("sourceMaterial.eyebrow")}</p>
            <h1>{t("sourceMaterial.savedTitle")}</h1>
            <p className="lede">
              {t("sourceMaterial.savedDescription", {
                name: sourceMaterialName,
              })}
            </p>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="creation-card source-ready-card">
          <div className="creation-heading">
            <span><FileJson2 /></span>
            <div>
              <h2>{t("sourceMaterial.prepareTitle")}</h2>
              <p>{t("sourceMaterial.prepareDescription")}</p>
            </div>
          </div>
          <ol className="source-ready-steps">
            <li>{t("sourceMaterial.stepCopy")}</li>
            <li>{t("sourceMaterial.stepUse")}</li>
            <li>{t("sourceMaterial.stepImport")}</li>
          </ol>
          <div className="draft-actions">
            <button
              className="button secondary"
              onClick={() => void copyStructuredQuestionSetPrompt()}
              type="button"
            >
              {sourcePromptCopied
                ? t("sourceMaterial.promptCopied")
                : t("sourceMaterial.copyPrompt")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                setMode("structured");
                setStage("compose");
              }}
              type="button"
            >
              <FileJson2 /> {t("sourceMaterial.importJson")}
            </button>
          </div>
        </section>
      </>
    );
  }

  if (stage === "variant_ready" && variantSource) {
    return (
      <>
        <header className="page-header">
          <div>
            <Link className="back-button" href="/parent/library/">
              <ArrowLeft size={16} /> {t("variant.back")}
            </Link>
            <p className="eyebrow">{t("variant.eyebrow")}</p>
            <h1>{t("variant.title")}</h1>
            <p className="lede">
              {t("variant.description", { name: variantSource.title })}
            </p>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="creation-card source-ready-card">
          <div className="creation-heading">
            <span><Sparkles /></span>
            <div>
              <h2>{t("variant.prepareTitle")}</h2>
              <p>{t("variant.prepareDescription")}</p>
            </div>
          </div>
          <label className="field-label">
            {t("variant.difficulty")}
            <select
              aria-label={t("variant.difficulty")}
              onChange={(event) =>
                setVariantDifficulty(event.target.value as VariantDifficulty)
              }
              value={variantDifficulty}
            >
              {(
                [
                  "reinforcement",
                  "standard",
                  "challenge",
                  "adaptive",
                ] as const
              ).map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {t(`variant.difficulty.${difficulty}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="draft-actions">
            <button
              className="button secondary"
              onClick={() => void copyStructuredQuestionSetPrompt()}
              type="button"
            >
              {sourcePromptCopied
                ? t("sourceMaterial.promptCopied")
                : t("variant.copyPrompt")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                setMode("structured");
                setStage("compose");
              }}
              type="button"
            >
              <FileJson2 /> {t("variant.importJson")}
            </button>
          </div>
        </section>
      </>
    );
  }

  if (stage === "review") {
    return (
      <>
        <header className="page-header">
          <div>
            <button
              className="back-button"
              onClick={() => setStage("compose")}
              type="button"
            >
              <ArrowLeft size={16} /> {t("draftReview.back")}
            </button>
            <p className="eyebrow">{t("draftReview.eyebrow")}</p>
            <h1>{t("draftReview.title")}</h1>
            <p className="lede">{t("draftReview.description")}</p>
          </div>
          <LanguageSwitcher />
        </header>
        <div className="draft-toolbar">
          <span className="status-pill warm">
            {t("draftReview.private")}
          </span>
          <span>
            {t("draftReview.questions", { count: draftQuestions.length })} ·{" "}
            {mode === "structured"
              ? t("draftReview.validated")
              : assignmentMode === "exam"
                ? t("draftReview.timed", {
                    minutes: assignmentDurationMinutes,
                  })
                : t("draftReview.practice")}
          </span>
        </div>
        <section className="draft-question-list">
          {draftQuestions.length === 0 ? (
            <div className="empty-state" role="status">
              <h2>{t("draftReview.emptyTitle")}</h2>
              <p>{t("draftReview.emptyDescription")}</p>
            </div>
          ) : (
            draftQuestions.map((question, index) => (
            <article key={question.prompt}>
              <div className="draft-question-number">{index + 1}</div>
              <div>
                {(mode === "structured" || mode === "manual") &&
                editingQuestionId === question.id ? (
                  <div className="draft-question-editor">
                    <label>
                      {t("draftReview.questionWording")}
                      <textarea
                        aria-label={t("draftReview.questionWording")}
                        onChange={(event) =>
                          setEditedQuestionPrompt(event.target.value)
                        }
                        rows={3}
                        value={editedQuestionPrompt}
                      />
                    </label>
                    <label>
                      {t("draftReview.points")}
                      <input
                        aria-label={t("draftReview.points")}
                        min="0.5"
                        onChange={(event) =>
                          setEditedQuestionPoints(event.target.value)
                        }
                        step="0.5"
                        type="number"
                        value={editedQuestionPoints}
                      />
                    </label>
                    <label>
                      {t("draftReview.responseType")}
                      <select
                        aria-label={t("draftReview.responseType")}
                        onChange={(event) =>
                          setEditedQuestionType(
                            event.target.value as ManualQuestionType,
                          )
                        }
                        value={editedQuestionType}
                      >
                        <option value="typed_text">
                          {t("draftReview.typeTyped")}
                        </option>
                        <option value="single_choice">
                          {t("draftReview.typeChoice")}
                        </option>
                        <option value="handwriting">
                          {t("draftReview.typeHandwriting")}
                        </option>
                      </select>
                    </label>
                    {editedQuestionType === "single_choice" ? (
                      <label>
                        {t("draftReview.choices")}
                        <textarea
                          aria-label={t("draftReview.choices")}
                          onChange={(event) =>
                            setEditedQuestionOptions(event.target.value)
                          }
                          rows={4}
                          value={editedQuestionOptions}
                        />
                      </label>
                    ) : null}
                    <label>
                      {editedQuestionType === "handwriting"
                        ? t("draftReview.referenceAnswer")
                        : t("draftReview.correctAnswer")}
                      <textarea
                        aria-label={
                          editedQuestionType === "handwriting"
                            ? t("draftReview.referenceAnswer")
                            : t("draftReview.correctAnswer")
                        }
                        onChange={(event) =>
                          setEditedQuestionAnswer(event.target.value)
                        }
                        rows={3}
                        value={editedQuestionAnswer}
                      />
                    </label>
                    <p>
                      {t("draftReview.handwritingNotice")}
                    </p>
                    {editError ? <p role="alert">{editError}</p> : null}
                    <div className="draft-question-editor-actions">
                      <button
                        className="button primary"
                        onClick={() => saveStructuredQuestionEdit(question.id)}
                        type="button"
                      >
                        {t("draftReview.saveQuestion")}
                      </button>
                      <button
                        className="button ghost"
                        onClick={() => {
                          setEditingQuestionId(null);
                          setEditError("");
                        }}
                        type="button"
                      >
                        {t("draftReview.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="question-type">
                      {question.type.replaceAll("_", " ")}
                    </span>
                    <h2>{question.prompt}</h2>
                    <details>
                      <summary>{t("draftReview.answerGuide")}</summary>
                      <p>
                        {question.answer ?? JSON.stringify(question.answer_key)}
                      </p>
                    </details>
                    {question.type === "listening" ? (
                      <label className="draft-listening-audio">
                        {t("draftReview.privateAudio")}
                        <input
                          accept="audio/mpeg,audio/mp4,.mp3,.m4a,.mp4"
                          aria-label={t("draftReview.audioForQuestion", {
                            number: index + 1,
                          })}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) {
                              return;
                            }
                            setListeningAudioFiles((current) => ({
                              ...current,
                              [question.id]: file,
                            }));
                          }}
                          type="file"
                        />
                        <span>
                          {listeningAudioFiles[question.id]?.name ??
                            (question.listening?.audio_path
                              ? t("draftReview.audioAttached")
                              : t("draftReview.audioRequired"))}
                        </span>
                      </label>
                    ) : null}
                  </>
                )}
              </div>
              {(mode === "structured" || mode === "manual") &&
              editingQuestionId !== question.id ? (
                <div className="draft-question-actions">
                  <button
                    aria-label={t("draftReview.moveUpAction", {
                      number: index + 1,
                    })}
                    className="quiet-link"
                    disabled={index === 0}
                    onClick={() => moveStructuredQuestion(question.id, -1)}
                    type="button"
                  >
                    {t("draftReview.moveUp")}
                  </button>
                  <button
                    aria-label={t("draftReview.moveDownAction", {
                      number: index + 1,
                    })}
                    className="quiet-link"
                    disabled={
                      index === draftQuestions.length - 1
                    }
                    onClick={() => moveStructuredQuestion(question.id, 1)}
                    type="button"
                  >
                    {t("draftReview.moveDown")}
                  </button>
                  <button
                    aria-label={t("draftReview.duplicateAction", {
                      number: index + 1,
                    })}
                    className="quiet-link"
                    onClick={() => duplicateStructuredQuestion(question.id)}
                    type="button"
                  >
                    {t("draftReview.duplicate")}
                  </button>
                  <button
                    aria-label={t("draftReview.editQuestionAction", {
                      number: index + 1,
                    })}
                    className="quiet-link"
                    onClick={() => beginStructuredQuestionEdit(question)}
                    type="button"
                  >
                    {t("draftReview.editQuestion")}
                  </button>
                  <button
                    aria-label={t("draftReview.removeAction", {
                      number: index + 1,
                    })}
                    className="quiet-link draft-question-remove"
                    disabled={draftQuestions.length <= 1}
                    onClick={() => removeStructuredQuestion(question.id)}
                    title={
                      draftQuestions.length <= 1
                        ? t("draftReview.removeOnlyTitle")
                        : t("draftReview.removeTitle")
                    }
                    type="button"
                  >
                    {t("draftReview.remove")}
                  </button>
                </div>
              ) : null}
            </article>
            ))
          )}
        </section>
        <section className="assignment-panel">
          <div>
            <p className="eyebrow">{t("draftReview.assign")}</p>
            <h2>
              {children.find((child) => child.id === selectedChildId)
                ?.nickname ?? t("draftReview.selectedChild")}{" "}
              ·{" "}
              {assignmentMode === "exam"
                ? t("draftReview.timed", {
                    minutes: assignmentDurationMinutes,
                  })
                : t("draftReview.practice")}
            </h2>
            <p>
              {assignmentMode === "exam"
                ? `${t("draftReview.timeLimit")}: ${assignmentDurationMinutes}. `
                : `${t("draftReview.noTimer")} `}
              {t("draftReview.results")}
            </p>
            {!confirmed ? (
              <fieldset className="assignment-mode-selector">
                <legend>{t("draftReview.settings")}</legend>
                <label>
                  <input
                    aria-label={t("draftReview.practiceMode")}
                    checked={assignmentMode === "practice"}
                    name="assignment-mode"
                    onChange={() => setAssignmentMode("practice")}
                    type="radio"
                  />
                  {t("draftReview.practiceMode")}
                </label>
                <label>
                  <input
                    aria-label={t("draftReview.examMode")}
                    checked={assignmentMode === "exam"}
                    name="assignment-mode"
                    onChange={() => setAssignmentMode("exam")}
                    type="radio"
                  />
                  {t("draftReview.examMode")}
                </label>
                {assignmentMode === "exam" ? (
                  <label>
                    {t("draftReview.timeLimit")}
                    <select
                      aria-label={t("draftReview.timeLimit")}
                      onChange={(event) =>
                        setAssignmentDurationMinutes(event.target.value)
                      }
                      value={assignmentDurationMinutes}
                    >
                      <option value="10">10 minutes</option>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="45">45 minutes</option>
                      <option value="60">60 minutes</option>
                      <option value="90">90 minutes</option>
                      <option value="120">120 minutes</option>
                    </select>
                  </label>
                ) : null}
                <label className="assignment-note">
                  {t("draftReview.note")}
                  <textarea
                    aria-label={t("draftReview.note")}
                    maxLength={300}
                    onChange={(event) => setAssignmentNote(event.target.value)}
                    placeholder={t("draftReview.notePlaceholder")}
                    rows={2}
                    value={assignmentNote}
                  />
                  <span>{assignmentNote.length}/300</span>
                </label>
              </fieldset>
            ) : null}
          </div>
          {confirmed ? (
            <div className="confirmed-message" role="status">
              <Check size={18} /> {t("draftReview.confirmed")}
            </div>
          ) : (
            <button
              className="button primary large"
              disabled={requestStatus === "working" || draftQuestions.length === 0}
              onClick={() => void confirmAndAssign()}
              type="button"
            >
              {t("draftReview.confirm")}
            </button>
          )}
          {requestStatus === "error" ? (
            <p className="form-error" role="alert">
              {t("draftReview.error")}
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
            <Printer size={17} /> {t("draftReview.print")}
          </Link>
          {assignmentId && selectedChildId ? (
            <>
              <Link
                className="button ghost"
                href={`/child/login/?childId=${encodeURIComponent(selectedChildId)}&assignmentId=${encodeURIComponent(assignmentId)}`}
              >
                {t("draftReview.openChildSignIn")}
              </Link>
              <CopyChildSignInLink
                assignmentId={assignmentId}
                childId={selectedChildId}
              />
            </>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("creation.eyebrow")}</p>
          <h1>{t("creation.title")}</h1>
          <p className="lede">{t("creation.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>

      <section className="creation-card assignment-target-card">
        <div>
          <p className="eyebrow">{t("creation.assignTo")}</p>
          <h2>{t("creation.chooseChild")}</h2>
        </div>
        {families.length > 0 ? (
          <div className="assignment-target-fields">
            <label>
              {t("creation.family")}
              <select
                aria-label={t("creation.family")}
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
              {t("creation.child")}
              <select
                aria-label={t("creation.child")}
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
                  <option value="">{t("creation.addChildFirst")}</option>
                )}
              </select>
            </label>
          </div>
        ) : (
          <Link className="button ghost" href="/parent/family/">
            {t("creation.addFamilyChildFirst")}
          </Link>
        )}
      </section>

      <div className="create-layout">
        <nav className="creation-tabs" aria-label={t("creation.source")}>
          <button
            className={mode === "generate" ? "active" : ""}
            onClick={() => setMode("generate")}
            type="button"
          >
            <Sparkles /> {t("creation.tab.generate")}
          </button>
          <button
            className={mode === "import" ? "active" : ""}
            onClick={() => setMode("import")}
            type="button"
          >
            <Camera /> {t("creation.tab.import")}
          </button>
          <button
            className={mode === "completed" ? "active" : ""}
            onClick={() => setMode("completed")}
            type="button"
          >
            <Camera /> {t("completedPaper.mode")}
          </button>
          <button
            className={mode === "structured" ? "active" : ""}
            onClick={() => setMode("structured")}
            type="button"
          >
            <FileJson2 /> {t("creation.tab.structured")}
          </button>
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
            type="button"
          >
            <BookOpenText /> {t("creation.tab.manual")}
          </button>
        </nav>

        <section className="creation-card">
          {mode === "generate" ? (
            <>
              <div className="creation-heading">
                <span><Sparkles /></span>
                <div>
                  <h2>{t("generation.heading")}</h2>
                  <p>{t("generation.description")}</p>
                </div>
              </div>
              <label className="field-label">
                {t("generation.prompt")}
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
                  <h2>{t("materialImport.heading")}</h2>
                  <p>{t("materialImport.description")}</p>
                </div>
              </div>
              <fieldset className="source-purpose-options">
                <legend>{t("materialImport.purpose")}</legend>
                <label>
                  <input
                    aria-label={t("materialImport.generate")}
                    checked={importPurpose === "generate_similar"}
                    name="import-purpose"
                    onChange={() => setImportPurpose("generate_similar")}
                    type="radio"
                  />
                  <span>
                    <strong>
                      {t("materialImport.generate")}
                    </strong>
                    <small>
                      {t("materialImport.generateHelp")}
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    aria-label={t("materialImport.convert")}
                    checked={importPurpose === "use_as_questions"}
                    name="import-purpose"
                    onChange={() => setImportPurpose("use_as_questions")}
                    type="radio"
                  />
                  <span>
                    <strong>
                      {t("materialImport.convert")}
                    </strong>
                    <small>
                      {t("materialImport.convertHelp")}
                    </small>
                  </span>
                </label>
              </fieldset>
              <div className="assignment-target-fields source-material-metadata">
                <label>
                  {t("materialImport.title")}
                  <input
                    aria-label={t("materialImport.title")}
                    onChange={(event) => setImportTitle(event.target.value)}
                    value={importTitle}
                  />
                </label>
                <label>
                  {t("materialImport.subject")}
                  <input
                    aria-label={t("materialImport.subject")}
                    onChange={(event) => setImportSubject(event.target.value)}
                    value={importSubject}
                  />
                </label>
              </div>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={
                    importPurpose === "use_as_questions"
                      ? t("materialImport.questionMaterial")
                      : t("materialImport.learningMaterial")
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
                      ? t("materialImport.chooseWorksheet")
                      : t("materialImport.chooseTextbook"))}
                </strong>
                <span>
                  {importPurpose === "use_as_questions"
                    ? t("materialImport.worksheetHelp")
                    : t("materialImport.textbookHelp")}
                </span>
              </label>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={t("materialImport.answerKey")}
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
                <strong>{answerFileName || t("materialImport.chooseAnswerKey")}</strong>
                <span>{t("materialImport.answerKeyHelp")}</span>
              </label>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={t("materialImport.referenceMaterial")}
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
                  {referenceFileName || t("materialImport.addReferenceMaterial")}
                </strong>
                <span>
                  {t("materialImport.referenceHelp")}
                </span>
              </label>
            </>
          ) : null}

          {mode === "completed" ? (
            <>
              <div className="creation-heading">
                <span><Camera /></span>
                <div>
                  <h2>{t("completedPaper.composeTitle")}</h2>
                  <p>{t("completedPaper.composeDescription")}</p>
                </div>
              </div>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={t("completedPaper.scans")}
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    setFiles(selectedFiles);
                    setFileName(selectedFiles.map((file) => file.name).join(", "));
                  }}
                  type="file"
                />
                <ImagePlus />
                <strong>{fileName || t("completedPaper.choosePages")}</strong>
                <span>{t("completedPaper.pagesHelp")}</span>
              </label>
              <label className="completed-paper-language">
                {t("completedPaper.documentLanguage")}
                <select
                  aria-label={t("completedPaper.documentLanguage")}
                  onChange={(event) =>
                    setCompletedDocumentLanguage(
                      event.target.value as "zh" | "ja" | "en",
                    )
                  }
                  value={completedDocumentLanguage}
                >
                  <option value="ja">{t("language.option.ja")}</option>
                  <option value="zh">{t("language.option.zh")}</option>
                  <option value="en">{t("language.option.en")}</option>
                </select>
                <span>{t("completedPaper.documentLanguageHelp")}</span>
              </label>
              <label className="drop-zone completed-paper-private-file">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={t("completedPaper.answerKey")}
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    setAnswerFiles(selectedFiles);
                    setAnswerFileName(
                      selectedFiles.map((file) => file.name).join(", "),
                    );
                  }}
                  type="file"
                />
                <Check />
                <strong>{answerFileName || t("completedPaper.chooseAnswerKey")}</strong>
                <span>{t("completedPaper.answerKeyHelp")}</span>
              </label>
              <label className="drop-zone completed-paper-private-file">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label={t("completedPaper.referenceMaterial")}
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    setReferenceFiles(selectedFiles);
                    setReferenceFileName(
                      selectedFiles.map((file) => file.name).join(", "),
                    );
                  }}
                  type="file"
                />
                <BookOpenText />
                <strong>
                  {referenceFileName || t("completedPaper.chooseReferenceMaterial")}
                </strong>
                <span>{t("completedPaper.referenceMaterialHelp")}</span>
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
                  <h2>{t("structuredImport.heading")}</h2>
                  <p>{t("structuredImport.description")}</p>
                </div>
              </div>
              <label className="field-label">
                {t("structuredImport.privateSource")}
                <select
                  aria-label={t("structuredImport.privateSource")}
                  onChange={(event) => {
                    const material = availableSourceMaterials.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    setSourceMaterialQuestionSetId(material?.id ?? null);
                    setSourceMaterialTitle(material?.title ?? "");
                    setSourceMaterialSubject(material?.subject ?? "");
                  }}
                  value={sourceMaterialQuestionSetId ?? ""}
                >
                  <option value="">
                    {t("structuredImport.noLinkedSource")}
                  </option>
                  {availableSourceMaterials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.title} · {material.subject}
                    </option>
                  ))}
                </select>
                <span>
                  {t("structuredImport.sourceHelp")}
                </span>
              </label>
              <label className="drop-zone">
                <input
                  accept=".json,application/json"
                  aria-label={t("structuredImport.json")}
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
                  {structuredFile?.name || t("structuredImport.chooseJson")}
                </strong>
                <span>
                  {t("structuredImport.previewHelp")}
                </span>
              </label>
            </>
          ) : null}

          {mode === "manual" ? (
            <>
              <div className="creation-heading">
                <span><BookOpenText /></span>
                <div>
                  <h2>{t("manual.heading")}</h2>
                  <p>{t("manual.description")}</p>
                </div>
              </div>
              <label className="field-label">
                {t("manual.title")}
                <input
                  aria-label={t("manual.title")}
                  onChange={(event) => setManualTitle(event.target.value)}
                  value={manualTitle}
                />
              </label>
              <div className="creation-options">
                <label>
                  {t("manual.subject")}
                  <input
                    aria-label={t("manual.subject")}
                    onChange={(event) => setManualSubject(event.target.value)}
                    value={manualSubject}
                  />
                </label>
                <label>
                  {t("manual.language")}
                  <select
                    aria-label={t("manual.language")}
                    onChange={(event) =>
                      setManualLocale(event.target.value as "zh" | "ja" | "en")
                    }
                    value={manualLocale}
                  >
                    <option value="en">{t("language.option.en")}</option>
                    <option value="ja">{t("language.option.ja")}</option>
                    <option value="zh">{t("language.option.zh")}</option>
                  </select>
                </label>
                <label>
                  {t("manual.responseType")}
                  <select
                    aria-label={t("manual.responseType")}
                    onChange={(event) =>
                      setManualQuestionType(
                        event.target.value as ManualQuestionType,
                      )
                    }
                    value={manualQuestionType}
                  >
                    <option value="typed_text">{t("manual.type.typed")}</option>
                    <option value="single_choice">{t("manual.type.choice")}</option>
                    <option value="handwriting">{t("manual.type.handwriting")}</option>
                  </select>
                </label>
              </div>
              <label className="field-label">
                {t("manual.question")}
                <textarea
                  aria-label={t("manual.question")}
                  onChange={(event) => setManualQuestionPrompt(event.target.value)}
                  placeholder={t("manual.questionPlaceholder")}
                  rows={4}
                  value={manualQuestionPrompt}
                />
              </label>
              {manualQuestionType === "single_choice" ? (
                <label className="field-label">
                  {t("manual.choices")}
                  <textarea
                    aria-label={t("manual.choices")}
                    onChange={(event) => setManualOptions(event.target.value)}
                    placeholder={t("manual.choicesPlaceholder")}
                    rows={4}
                    value={manualOptions}
                  />
                </label>
              ) : null}
              <label className="field-label">
                {t("manual.answerGuide")}
                <textarea
                  aria-label={t("manual.answerGuide")}
                  onChange={(event) => setManualAnswer(event.target.value)}
                  placeholder={
                    manualQuestionType === "handwriting"
                      ? t("manual.handwritingPlaceholder")
                      : manualQuestionType === "single_choice"
                        ? t("manual.choicePlaceholder")
                        : t("manual.typedPlaceholder")
                  }
                  rows={3}
                  value={manualAnswer}
                />
              </label>
              <label className="field-label manual-points-field">
                {t("manual.points")}
                <input
                  aria-label={t("manual.points")}
                  min="0.5"
                  onChange={(event) => setManualPoints(event.target.value)}
                  step="0.5"
                  type="number"
                  value={manualPoints}
                />
              </label>
              <div className="manual-question-actions">
                <button
                  className="button ghost"
                  disabled={!manualQuestionIsReady}
                  onClick={addManualQuestion}
                  type="button"
                >
                  {t("manual.addQuestion")}
                </button>
                <p>
                  {t("manual.queueHelp")}
                </p>
              </div>
              {manualDraftQuestions.length > 0 ? (
                <ol className="manual-question-queue" aria-label={t("manual.queueLabel")}>
                  {manualDraftQuestions.map((question, index) => (
                    <li key={question.id}>
                      <div>
                        <strong>{t("manual.questionReady", { number: index + 1 })}</strong>
                        <span>
                          {question.type === "typed_text"
                            ? t("manual.type.typed")
                            : question.type === "single_choice"
                              ? t("manual.type.choice")
                              : t("manual.type.handwriting")} · {t("manual.pointsSummary", { count: question.points })}
                        </span>
                        <p>{question.prompt}</p>
                      </div>
                      <button
                        aria-label={t("manual.removeQueuedQuestion", { number: index + 1 })}
                        className="quiet-link draft-question-remove"
                        onClick={() => removeManualDraftQuestion(question.id)}
                        type="button"
                      >
                        {t("manual.remove")}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          ) : null}

          {mode !== "structured" && mode !== "completed" ? (
            <div className="creation-options">
              <label>
                {t("creation.options.subject")}
                <select defaultValue="mixed">
                  <option value="mixed">{t("creation.options.mixed")}</option>
                  <option value="english">{t("creation.options.english")}</option>
                  <option value="math">{t("creation.options.mathematics")}</option>
                </select>
              </label>
              <label>
                {t("creation.options.difficulty")}
                <select defaultValue="adaptive">
                  <option value="adaptive">{t("creation.options.adaptive")}</option>
                  <option value="foundation">{t("creation.options.foundation")}</option>
                  <option value="standard">{t("creation.options.standard")}</option>
                  <option value="challenge">{t("creation.options.challenge")}</option>
                </select>
              </label>
              <label>
                {t("creation.options.questions")}
                <select defaultValue="8">
                  <option>5</option>
                  <option>8</option>
                  <option>10</option>
                </select>
              </label>
            </div>
          ) : null}
          {mode !== "structured" && mode !== "completed" ? (
            <label className="toggle-row">
              <input type="checkbox" />
              <Headphones size={18} />
              {t("creation.options.listening")}
            </label>
          ) : null}
          <button
            className="button primary large create-submit"
            disabled={!canCreate || requestStatus === "working"}
            onClick={() => void createDraft()}
            type="button"
          >
            {requestStatus === "working"
              ? t("creation.preparingDraft")
              : mode === "structured"
                ? t("structuredImport.preview")
                : mode === "completed"
                  ? t("completedPaper.uploadForReview")
                  : t("creation.createReviewDraft")}
          </button>
          {requestStatus === "error" ? (
            <p className="form-error" role="alert">
              {t("creation.error")}
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
