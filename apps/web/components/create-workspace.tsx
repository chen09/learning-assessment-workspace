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
  confirmCompletedWorksheetImport,
  confirmQuestionSet,
  createQuestionSetImport,
  createCompletedWorksheetImport,
  createUploadIntent,
  getCompletedWorksheetImport,
  getChildren,
  getFamilies,
  getParentAccessToken,
  getQuestionSetDraft,
  importStructuredQuestionSet,
  previewStructuredQuestionSet,
  uploadToSignedUrl,
} from "@/lib/api-client";

type CreateMode = "generate" | "import" | "completed" | "structured" | "manual";
type ImportPurpose = "generate_similar" | "use_as_questions";
type Stage = "compose" | "review";
type ManualQuestionType = "single_choice" | "typed_text" | "handwriting";

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

type ReviewDraftQuestion = ApiQuestion & {
  answer_key: Record<string, unknown>;
  answer?: string;
};

const sampleQuestions: ReviewDraftQuestion[] = [
  {
    id: "sample-choice",
    position: 1,
    type: "single_choice",
    prompt: "Choose the sentence that uses the present simple correctly.",
    options: [],
    points: 1,
    answer_key: { answer: "B · She walks to school every day." },
    answer: "B · She walks to school every day.",
  },
  {
    id: "sample-type",
    position: 2,
    type: "typed_text",
    prompt: "Complete: My brother ___ tennis on Sundays.",
    options: [],
    points: 1,
    answer_key: { answer: "plays" },
    answer: "plays",
  },
  {
    id: "sample-handwrite",
    position: 3,
    type: "handwriting",
    prompt: "Explain why (a + b)(a − b) = a² − b².",
    options: [],
    points: 1,
    answer_key: { answer: "Expand and combine the middle terms." },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (
      question.type === "handwriting" &&
      (!isRecord(question.answer_key) ||
        typeof question.answer_key.reference !== "string" ||
        !question.answer_key.reference.trim() ||
        !isRecord(question.rubric) ||
        question.rubric.grading_mode !== "parent_review")
    ) {
      throw new Error(
        "Handwriting questions need a private reference answer and parent review.",
      );
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
  const [manualTitle, setManualTitle] = useState("New practice");
  const [manualSubject, setManualSubject] = useState("Mixed practice");
  const [manualLocale, setManualLocale] = useState<"zh" | "ja" | "en">("en");
  const [manualQuestionType, setManualQuestionType] =
    useState<ManualQuestionType>("typed_text");
  const [manualQuestionPrompt, setManualQuestionPrompt] = useState("");
  const [manualOptions, setManualOptions] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [manualPoints, setManualPoints] = useState("1");
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
  const [completedResponsePaths, setCompletedResponsePaths] = useState<string[]>(
    [],
  );
  const [completedPromptCopied, setCompletedPromptCopied] = useState(false);
  const [completedAttemptId, setCompletedAttemptId] = useState<string | null>(
    null,
  );
  const [completedWorksheetStatus, setCompletedWorksheetStatus] = useState<
    "processing" | "needs_review" | "grading" | "results_ready" | null
  >(null);
  const [draftQuestions, setDraftQuestions] = useState<ReviewDraftQuestion[]>(
    [],
  );
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );
  const [editedQuestionPrompt, setEditedQuestionPrompt] = useState("");
  const [editedQuestionPoints, setEditedQuestionPoints] = useState("1");
  const [editError, setEditError] = useState("");
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
      manualTitle.trim() && manualQuestionPrompt.trim() && manualAnswer.trim(),
    ) &&
    Number.isFinite(manualPointsValue) &&
    manualPointsValue > 0 &&
    (manualQuestionType !== "single_choice" ||
      manualOptionList.some((option) => option === manualAnswer.trim()));
  const canCreate =
    hasAssignmentTarget &&
    (mode === "import" || mode === "completed"
      ? Boolean(fileName)
      : mode === "structured"
        ? structuredFile !== null
        : mode === "manual"
          ? manualQuestionIsReady
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

  const createDraft = async () => {
    if (mode === "completed") {
      const { familyId, childId } = getRouteIds();
      if (!familyId || !childId || files.length === 0) {
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
        const uploadObjectId = crypto.randomUUID();
        const responsePaths: string[] = [];
        for (const [index, file] of files.entries()) {
          const contentType = (
            ["application/pdf", "image/png", "image/jpeg"].includes(file.type)
              ? file.type
              : "image/jpeg"
          ) as "application/pdf" | "image/png" | "image/jpeg";
          const intent = await createUploadIntent(
            {
              family_id: familyId,
              bucket: "responses",
              object_id: uploadObjectId,
              filename: file.name,
              content_type: contentType,
            },
            parentToken,
            `completed-response-${uploadObjectId}-${index}`,
          );
          await uploadToSignedUrl(intent, file);
          responsePaths.push(intent.path);
        }
        const imported = await createCompletedWorksheetImport(
          {
            family_id: familyId,
            child_id: childId,
            title: fileName.slice(0, 160),
            subject: "Mixed practice",
            document_language: "ja",
            feedback_language: "ja",
            filenames: files.map((file) => file.name),
            response_paths: responsePaths,
          },
          parentToken,
          `completed-worksheet-${uploadObjectId}`,
        );
        setCompletedWorksheetId(imported.id);
        setCompletedWorksheetStatus(imported.status);
        setCompletedResponsePaths(imported.response_paths);
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

    if (mode === "manual") {
      if (!manualQuestionIsReady) {
        setRequestStatus("error");
        return;
      }
      const parentToken = await getParentAccessToken();
      if (!parentToken) {
        setRequestStatus("error");
        return;
      }
      const answer = manualAnswer.trim();
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
        questions: [
          {
            position: 1,
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
          },
        ],
      };
      setRequestStatus("working");
      try {
        const preview = await previewStructuredQuestionSet(document, parentToken);
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
    if (mode === "structured" || mode === "manual") {
      if (
        !familyId ||
        !childId ||
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
            source_name: structuredFile?.name ?? "Manual question",
            document: structuredDocument,
          },
          parentToken,
          `${mode}-${structuredChecksum}-${childId}`,
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

  const beginStructuredQuestionEdit = (
    question: ReviewDraftQuestion,
  ) => {
    setEditingQuestionId(question.id);
    setEditedQuestionPrompt(question.prompt);
    setEditedQuestionPoints(String(question.points));
    setEditError("");
  };

  const saveStructuredQuestionEdit = (questionId: string) => {
    const prompt = editedQuestionPrompt.trim();
    const points = Number(editedQuestionPoints);
    if (!structuredDocument || !prompt || !Number.isFinite(points) || points <= 0) {
      setEditError("Add question wording and a positive point value.");
      return;
    }
    const question = draftQuestions.find((candidate) => candidate.id === questionId);
    if (!question) {
      setEditError("This draft question is no longer available.");
      return;
    }
    setDraftQuestions((current) =>
      current.map((candidate) =>
        candidate.id === questionId
          ? { ...candidate, prompt, points }
          : candidate,
      ),
    );
    setStructuredDocument((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((candidate) =>
              candidate.position === question.position
                ? { ...candidate, prompt, points }
                : candidate,
            ),
          }
        : current,
    );
    setEditingQuestionId(null);
    setEditError("");
  };

  const confirmCompletedPaper = async () => {
    if (!completedWorksheetId || !completedReview) {
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
          document: completedReview.document,
          responses: completedReview.answer_regions.map((region) => ({
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

  const selectCompletedReview = async (file: File | null) => {
    setCompletedReviewFile(file);
    setCompletedReview(null);
    setCompletedPromptCopied(false);
    if (!file) {
      return;
    }
    try {
      setCompletedReview(parseCompletedPaperReview(await readTextFile(file)));
      setRequestStatus("idle");
    } catch {
      setRequestStatus("error");
    }
  };

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
      <AppShell currentPath="/parent/create/" role="parent">
        <header className="page-header">
          <div>
            <p className="eyebrow">Completed worksheet received</p>
            <h1>
              {completedWorksheetStatus === "processing"
                ? "Reading the paper"
                : "Preparing the review draft"}
            </h1>
            <p className="lede">
              The original paper is private. Question boundaries and scoring
              must be confirmed before it becomes a learning record.
            </p>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="assignment-panel">
          <div>
            <p className="eyebrow">
              {completedWorksheetStatus === "processing"
                ? "Analysis in progress"
                : "Analysis ready for review"}
            </p>
            <h2>
              {completedAttemptId
                ? "Submitted for grading"
                : completedWorksheetStatus === "processing"
                  ? "Your paper is being prepared"
                : "Paper upload is safe and not yet assigned"}
            </h2>
            <p>
              {completedAttemptId
                ? "The paper is now an immutable learning record. Results appear when grading finishes."
                : completedWorksheetStatus === "processing"
                  ? "We are preparing a private review draft. This page will update automatically; no child task has been created."
                : "Confirm the reviewed question and answer regions. Only then will it create a submitted attempt and start grading."}
            </p>
          </div>
          {completedAttemptId ? (
            <Link
              className="button primary"
              href={`/parent/results/?attemptId=${encodeURIComponent(completedAttemptId)}`}
            >
              Open grading results
            </Link>
          ) : completedWorksheetStatus === "needs_review" ? (
            <div className="stacked-form">
              <details open>
                <summary>Prepare a local AI review JSON</summary>
                <p>
                  Attach the original pages to your local AI, copy this prompt,
                  and save its JSON-only response. The prompt never asks for a
                  storage path; this app adds the private paper reference itself.
                </p>
                <button
                  className="button secondary"
                  onClick={() => void copyCompletedPaperPrompt()}
                  type="button"
                >
                  {completedPromptCopied ? "Prompt copied" : "Copy local AI prompt"}
                </button>
              </details>
              <label className="drop-zone compact-drop-zone">
                <input
                  accept=".json,application/json"
                  aria-label="Reviewed completed worksheet JSON"
                  onChange={(event) =>
                    void selectCompletedReview(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
                <FileJson2 />
                <strong>
                  {completedReviewFile?.name || "Choose reviewed paper JSON"}
                </strong>
                <span>
                  The app validates question order and answer regions before
                  creating a learning record.
                </span>
              </label>
              {completedReview ? (
                <>
                  <p className="status-pill cool">
                    Review ready: {completedReview.document.questions.length} question
                    {completedReview.document.questions.length === 1 ? "" : "s"} and {" "}
                    {completedReview.answer_regions.length} answer region
                    {completedReview.answer_regions.length === 1 ? "" : "s"}
                  </p>
                  <details open>
                    <summary>Preview confirmed questions</summary>
                    <ol>
                      {completedReview.document.questions.map((question, index) => (
                        <li key={question.position}>
                          <strong>{question.prompt}</strong>
                          <span>
                            Page {completedReview.answer_regions[index]?.page_numbers.join(", ")}
                            {completedReview.answer_regions[index]?.legibility
                              ? ` · ${completedReview.answer_regions[index].legibility}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
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
                  ? "Confirming…"
                  : "Confirm and start grading"}
              </button>
            </div>
          ) : (
            <span className="status-pill warm">Preparing private review</span>
          )}
        </section>
        {requestStatus === "error" ? (
          <p className="form-error" role="alert">
            The reviewed JSON must match every confirmed question and answer
            region. Nothing was assigned; correct it and try again.
          </p>
        ) : null}
      </AppShell>
    );
  }

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
                {(mode === "structured" || mode === "manual") &&
                editingQuestionId === question.id ? (
                  <div className="draft-question-editor">
                    <label>
                      Question wording
                      <textarea
                        aria-label="Question wording"
                        onChange={(event) =>
                          setEditedQuestionPrompt(event.target.value)
                        }
                        rows={3}
                        value={editedQuestionPrompt}
                      />
                    </label>
                    <label>
                      Points
                      <input
                        aria-label="Points"
                        min="0.5"
                        onChange={(event) =>
                          setEditedQuestionPoints(event.target.value)
                        }
                        step="0.5"
                        type="number"
                        value={editedQuestionPoints}
                      />
                    </label>
                    <p>Answer key and response type stay unchanged in this step.</p>
                    {editError ? <p role="alert">{editError}</p> : null}
                    <div className="draft-question-editor-actions">
                      <button
                        className="button primary"
                        onClick={() => saveStructuredQuestionEdit(question.id)}
                        type="button"
                      >
                        Save question
                      </button>
                      <button
                        className="button ghost"
                        onClick={() => {
                          setEditingQuestionId(null);
                          setEditError("");
                        }}
                        type="button"
                      >
                        Cancel
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
                      <summary>Answer and grading guide</summary>
                      <p>
                        {question.answer ?? JSON.stringify(question.answer_key)}
                      </p>
                    </details>
                  </>
                )}
              </div>
              {(mode === "structured" || mode === "manual") &&
              editingQuestionId !== question.id ? (
                <button
                  className="quiet-link"
                  onClick={() => beginStructuredQuestionEdit(question)}
                  type="button"
                >
                  Edit wording and points
                </button>
              ) : null}
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
            className={mode === "completed" ? "active" : ""}
            onClick={() => setMode("completed")}
            type="button"
          >
            <Camera /> Grade completed paper
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

          {mode === "completed" ? (
            <>
              <div className="creation-heading">
                <span><Camera /></span>
                <div>
                  <h2>Upload a paper the child has already completed</h2>
                  <p>
                    Upload the original scan or photos. The handwriting stays
                    private and is reviewed only after you confirm the draft.
                  </p>
                </div>
              </div>
              <label className="drop-zone">
                <input
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  aria-label="Completed worksheet scans"
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    setFiles(selectedFiles);
                    setFileName(selectedFiles.map((file) => file.name).join(", "));
                  }}
                  type="file"
                />
                <ImagePlus />
                <strong>{fileName || "Choose completed worksheet pages"}</strong>
                <span>
                  Upload several pages in their photographed order. Nothing is
                  assigned or graded until you confirm the review draft.
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
                  <p>
                    Create one question, review it privately, then assign it to
                    your child.
                  </p>
                </div>
              </div>
              <label className="field-label">
                Practice title
                <input
                  aria-label="Practice title"
                  onChange={(event) => setManualTitle(event.target.value)}
                  value={manualTitle}
                />
              </label>
              <div className="creation-options">
                <label>
                  Subject
                  <input
                    aria-label="Manual subject"
                    onChange={(event) => setManualSubject(event.target.value)}
                    value={manualSubject}
                  />
                </label>
                <label>
                  Language
                  <select
                    aria-label="Question language"
                    onChange={(event) =>
                      setManualLocale(event.target.value as "zh" | "ja" | "en")
                    }
                    value={manualLocale}
                  >
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <label>
                  Response type
                  <select
                    aria-label="Response type"
                    onChange={(event) =>
                      setManualQuestionType(
                        event.target.value as ManualQuestionType,
                      )
                    }
                    value={manualQuestionType}
                  >
                    <option value="typed_text">Text answer</option>
                    <option value="single_choice">Choose one answer</option>
                    <option value="handwriting">Handwritten answer</option>
                  </select>
                </label>
              </div>
              <label className="field-label">
                Question
                <textarea
                  aria-label="Question"
                  onChange={(event) => setManualQuestionPrompt(event.target.value)}
                  placeholder="Write the question children will see…"
                  rows={4}
                  value={manualQuestionPrompt}
                />
              </label>
              {manualQuestionType === "single_choice" ? (
                <label className="field-label">
                  Choices, one per line
                  <textarea
                    aria-label="Choices, one per line"
                    onChange={(event) => setManualOptions(event.target.value)}
                    placeholder={"Option A\nOption B\nOption C"}
                    rows={4}
                    value={manualOptions}
                  />
                </label>
              ) : null}
              <label className="field-label">
                Answer or grading guide
                <textarea
                  aria-label="Answer or grading guide"
                  onChange={(event) => setManualAnswer(event.target.value)}
                  placeholder={
                    manualQuestionType === "handwriting"
                      ? "A private reference answer for parent review…"
                      : manualQuestionType === "single_choice"
                        ? "Paste one option exactly as written above…"
                        : "The exact answer children should enter…"
                  }
                  rows={3}
                  value={manualAnswer}
                />
              </label>
              <label className="field-label manual-points-field">
                Points
                <input
                  aria-label="Points"
                  min="0.5"
                  onChange={(event) => setManualPoints(event.target.value)}
                  step="0.5"
                  type="number"
                  value={manualPoints}
                />
              </label>
            </>
          ) : null}

          {mode !== "structured" && mode !== "completed" ? (
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
          {mode !== "structured" && mode !== "completed" ? (
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
                : mode === "completed"
                  ? "Upload for review"
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
