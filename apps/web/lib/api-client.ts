import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type ApiQuestion = {
  id: string;
  position: number;
  type:
    | "single_choice"
    | "multiple_choice"
    | "typed_text"
    | "word_order"
    | "handwriting"
    | "photo"
    | "listening";
  prompt: string;
  options: string[] | null;
  points: number;
};

export type StructuredQuestion = {
  position: number;
  type: ApiQuestion["type"];
  prompt: string;
  options: string[];
  answer_key: Record<string, unknown>;
  rubric: Record<string, unknown>;
  points: number;
  knowledge_code: string;
};

export type StructuredQuestionSetDocument = {
  schema_version: "1.0";
  question_set: {
    title: string;
    subject: string;
    locale: "zh" | "ja" | "en";
    difficulty: "reinforcement" | "standard" | "challenge" | "adaptive";
    source_mode: "manual" | "generate" | "convert" | "similar";
    instructions?: string | null;
    estimated_minutes: number;
    source_summary?: Record<string, unknown>;
  };
  knowledge_tags: Array<{ code: string; label: string }>;
  questions: StructuredQuestion[];
};

export type StructuredImportPreview = {
  title: string;
  subject: string;
  locale: string;
  question_count: number;
  total_points: number;
  estimated_minutes: number;
  knowledge_tag_count: number;
  answer_keys_present: boolean;
  checksum: string;
  source_summary: Record<string, unknown>;
  questions: StructuredQuestion[];
};

export type AssignmentWork = {
  title: string;
  assignment: {
    id: string;
    family_id: string;
    mode: "practice" | "exam";
    time_limit_seconds: number | null;
    status: string;
  };
  attempt: {
    id: string;
  };
  questions: ApiQuestion[];
};

export type UploadIntent = {
  bucket: string;
  path: string;
  upload_url: string;
  expires_in: number;
};

const CHILD_TOKEN_KEY = "luma-child-session";
const CHILD_PROFILE_KEY = "luma-child-profile";

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:8000"
  );
}

function readJwtSessionIdentity(token: string) {
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) {
      return null;
    }
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(padded)) as {
      exp?: unknown;
      sub?: unknown;
    };
    return typeof payload.exp === "number" && typeof payload.sub === "string"
      ? { expiresAt: payload.exp, subject: payload.sub }
      : null;
  } catch {
    return null;
  }
}

async function refreshExpiredParentToken(staleToken: string) {
  const identity = readJwtSessionIdentity(staleToken);
  if (!identity || identity.expiresAt > Date.now() / 1000) {
    return null;
  }
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return null;
  }
  try {
    const current = await supabase.auth.getSession();
    if (current.data.session?.user.id !== identity.subject) {
      return null;
    }
    if (current.data.session.access_token !== staleToken) {
      return current.data.session.access_token;
    }
    const refreshed = await supabase.auth.refreshSession();
    return refreshed.data.session?.user.id === identity.subject
      ? refreshed.data.session.access_token
      : null;
  } catch {
    return null;
  }
}

async function reportClientApiError(
  path: string,
  method: string | undefined,
  statusCode: number,
) {
  if (typeof window === "undefined" || path === "/v1/client-logs") {
    return;
  }
  const requestPath = path.split("?")[0] ?? "/v1/unknown";
  const requestMethod = (method ?? "GET").toUpperCase();
  try {
    await fetch(`${apiBaseUrl()}/v1/client-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "api_request_failed",
        page: window.location.pathname,
        request_method: requestMethod,
        request_path: requestPath,
        status_code: statusCode,
        error_code: `http_${statusCode}`,
        occurred_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Logging must never replace the original API failure.
  }
}

function redirectExpiredChildSession(accessToken: string) {
  if (
    typeof window === "undefined" ||
    getChildAccessToken() !== accessToken
  ) {
    return;
  }
  const profile = getActiveChildProfile();
  const returnTo = `${window.location.pathname}${window.location.search}`;
  clearChildAccessToken();
  const params = new URLSearchParams({ expired: "1", returnTo });
  if (profile?.child_id) {
    params.set("childId", profile.child_id);
  }
  window.location.replace(`/child/login/?${params.toString()}`);
}

async function apiRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string,
  allowParentRefresh = true,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (
    response.status === 401 &&
    accessToken &&
    typeof window !== "undefined" &&
    getChildAccessToken() === accessToken
  ) {
    await reportClientApiError(path, init.method, response.status);
    redirectExpiredChildSession(accessToken);
    throw new Error("The child session has expired.");
  }
  if (response.status === 401 && accessToken && allowParentRefresh) {
    const refreshedToken = await refreshExpiredParentToken(accessToken);
    if (refreshedToken) {
      return apiRequest<T>(path, init, refreshedToken, false);
    }
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as unknown;
    await reportClientApiError(path, init.method, response.status);
    throw new Error(
      typeof detail === "object" && detail
        ? JSON.stringify(detail)
        : `API request failed with ${response.status}.`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function getChildAccessToken() {
  return window.localStorage.getItem(CHILD_TOKEN_KEY);
}

export function clearChildAccessToken() {
  window.localStorage.removeItem(CHILD_TOKEN_KEY);
  window.localStorage.removeItem(CHILD_PROFILE_KEY);
}

export function getActiveChildProfile() {
  const value = window.localStorage.getItem(CHILD_PROFILE_KEY);
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as {
      child_id: string;
      family_id: string;
      nickname: string;
      ui_language: "zh" | "ja" | "en";
    };
  } catch {
    return null;
  }
}

export async function createChildSession(childId: string, pin: string) {
  const session = await apiRequest<{
    access_token: string;
    expires_in: number;
    child_id: string;
    family_id: string;
    nickname: string;
    ui_language: "zh" | "ja" | "en";
  }>(
    `/v1/children/${encodeURIComponent(childId)}/sessions`,
    {
      method: "POST",
      body: JSON.stringify({ pin }),
    },
    undefined,
  );
  window.localStorage.setItem(CHILD_TOKEN_KEY, session.access_token);
  window.localStorage.setItem(
    CHILD_PROFILE_KEY,
    JSON.stringify({
      child_id: session.child_id,
      family_id: session.family_id,
      nickname: session.nickname,
      ui_language: session.ui_language,
    }),
  );
  window.localStorage.setItem(
    "luma-language:demo-child",
    session.ui_language,
  );
  return session;
}

export async function updateOwnChildLanguage(
  uiLanguage: "zh" | "ja" | "en",
  childToken: string,
) {
  const child = await apiRequest<ChildProfile>(
    "/v1/children/me/language",
    {
      method: "PUT",
      body: JSON.stringify({ ui_language: uiLanguage }),
    },
    childToken,
    false,
  );
  const activeProfile = getActiveChildProfile();
  if (activeProfile) {
    window.localStorage.setItem(
      CHILD_PROFILE_KEY,
      JSON.stringify({ ...activeProfile, ui_language: uiLanguage }),
    );
  }
  return child;
}

export async function getParentAccessToken() {
  const fixtureToken = process.env.NEXT_PUBLIC_E2E_PARENT_TOKEN;
  if (fixtureToken) {
    return fixtureToken;
  }
  const supabase = getSupabaseBrowserClient();
  const session = supabase ? await supabase.auth.getSession() : null;
  return session?.data.session?.access_token ?? null;
}

export type Family = {
  id: string;
  name: string;
};

export type ChildProfile = {
  id: string;
  family_id: string;
  nickname: string;
  grade_stage: string;
  ui_language: "zh" | "ja" | "en";
};

export type FamilyQuestionSet = {
  id: string;
  family_id: string;
  title: string;
  subject: string;
  status: "draft" | "processing" | "needs_review" | "confirmed";
  question_count: number;
  source_summary: {
    artifact_kind?: string;
    knowledge_points?: string[];
    reference_file_count?: number;
  };
};

export async function getFamilies(parentToken: string) {
  return apiRequest<Family[]>(
    "/v1/families",
    { method: "GET" },
    parentToken,
  );
}

export async function createFamily(
  name: string,
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<Family>(
    "/v1/families",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ name }),
    },
    parentToken,
  );
}

export async function getChildren(
  familyId: string,
  parentToken: string,
) {
  return apiRequest<ChildProfile[]>(
    `/v1/families/${encodeURIComponent(familyId)}/children`,
    { method: "GET" },
    parentToken,
  );
}

export async function getFamilyQuestionSets(
  familyId: string,
  parentToken: string,
) {
  return apiRequest<FamilyQuestionSet[]>(
    `/v1/library/families/${encodeURIComponent(familyId)}/question-sets`,
    { method: "GET" },
    parentToken,
  );
}

export async function createChild(
  familyId: string,
  payload: {
    nickname: string;
    grade_stage: string;
    pin: string;
    ui_language: "zh" | "ja" | "en";
  },
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<ChildProfile>(
    `/v1/families/${encodeURIComponent(familyId)}/children`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    parentToken,
  );
}

export async function updateChildPin(
  childId: string,
  pin: string,
  parentToken: string,
  managementUnlock: string,
) {
  return apiRequest<ChildProfile>(
    `/v1/children/${encodeURIComponent(childId)}/pin`,
    {
      method: "PUT",
      headers: { "X-Management-Unlock": managementUnlock },
      body: JSON.stringify({ pin }),
    },
    parentToken,
  );
}

export async function updateChildLanguage(
  childId: string,
  uiLanguage: "zh" | "ja" | "en",
  parentToken: string,
) {
  return apiRequest<ChildProfile>(
    `/v1/children/${encodeURIComponent(childId)}/language`,
    {
      method: "PUT",
      body: JSON.stringify({ ui_language: uiLanguage }),
    },
    parentToken,
  );
}

export async function setManagementPin(
  familyId: string,
  pin: string,
  parentToken: string,
) {
  await apiRequest<void>(
    `/v1/families/${encodeURIComponent(familyId)}/management-pin`,
    {
      method: "PUT",
      body: JSON.stringify({ pin }),
    },
    parentToken,
  );
}

export async function getManagementPinStatus(
  familyId: string,
  parentToken: string,
) {
  return apiRequest<{ configured: boolean }>(
    `/v1/families/${encodeURIComponent(familyId)}/management-pin`,
    { method: "GET" },
    parentToken,
  );
}

export async function unlockFamilyManagement(
  familyId: string,
  pin: string,
  parentToken: string,
) {
  return apiRequest<{
    access_token: string;
    token_type: "bearer";
    expires_in: number;
  }>(
    `/v1/families/${encodeURIComponent(familyId)}/management-unlock`,
    {
      method: "POST",
      body: JSON.stringify({ pin }),
    },
    parentToken,
  );
}

export async function createFamilyInvitation(
  familyId: string,
  email: string,
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{ id: string; email: string; expires_at: string }>(
    `/v1/families/${encodeURIComponent(familyId)}/invitations`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ email }),
    },
    parentToken,
  );
}

export type PendingInvitation = {
  id: string;
  family_id: string;
  email: string;
  expires_at: string;
};

export async function getPendingInvitations(parentToken: string) {
  return apiRequest<PendingInvitation[]>(
    "/v1/invitations/pending",
    { method: "GET" },
    parentToken,
  );
}

export async function acceptFamilyInvitation(
  invitationId: string,
  parentToken: string,
) {
  return apiRequest<Family>(
    `/v1/invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: "POST" },
    parentToken,
  );
}

export async function startAssignment(
  assignmentId: string,
  childToken: string,
) {
  return apiRequest<AssignmentWork>(
    `/v1/assignments/${encodeURIComponent(assignmentId)}/start`,
    { method: "POST" },
    childToken,
  );
}

export type ChildAssignmentSummary = {
  id: string;
  title: string;
  status: string;
  mode: string;
  time_limit_seconds: number | null;
  question_count: number;
  latest_attempt_id: string | null;
};

export async function getChildAssignments(childToken: string) {
  return apiRequest<ChildAssignmentSummary[]>(
    "/v1/assignments",
    { method: "GET" },
    childToken,
  );
}

export async function getPrintableAssignment(
  assignmentId: string,
  parentToken: string,
) {
  return apiRequest<{
    assignment: { id: string };
    title: string;
    questions: ApiQuestion[];
    template_version: "a4-v1";
  }>(
    `/v1/assignments/${encodeURIComponent(assignmentId)}/printable`,
    { method: "GET" },
    parentToken,
  );
}

export async function getAttemptWork(
  attemptId: string,
  childToken: string,
) {
  return apiRequest<AssignmentWork>(
    `/v1/attempts/${encodeURIComponent(attemptId)}/work`,
    { method: "GET" },
    childToken,
  );
}

export async function saveAttemptResponse(
  attemptId: string,
  questionId: string,
  payload: {
    kind: "choice" | "text" | "tokens" | "strokes" | "photo";
    answer: Record<string, unknown>;
    expected_version: number;
  },
  childToken: string,
) {
  return apiRequest<{ version: number }>(
    `/v1/attempts/${encodeURIComponent(attemptId)}/responses/${encodeURIComponent(questionId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
    childToken,
  );
}

export async function submitAttempt(
  attemptId: string,
  childToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{ job: { id: string; status: string } }>(
    `/v1/attempts/${encodeURIComponent(attemptId)}/submit`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
    childToken,
  );
}

export type AttemptResult = {
  id: string;
  question_id: string;
  outcome: "correct" | "incorrect" | "uncertain" | "needs_parent_review";
  awarded_points: number | null;
  confidence: number;
  feedback: {
    summary?: string;
    action?: string;
  };
};

export type ParentReviewItem = {
  result_id: string;
  question_id: string;
  question_position: number;
  question_prompt: string;
  question_type:
    | "single_choice"
    | "multiple_choice"
    | "typed_text"
    | "word_order"
    | "handwriting"
    | "photo"
    | "listening";
  question_points: number;
  response_kind: "choice" | "text" | "tokens" | "strokes" | "photo";
  response_answer: Record<string, unknown>;
  photo_urls: string[];
  automated_outcome:
    | "correct"
    | "incorrect"
    | "uncertain"
    | "needs_parent_review";
  automated_feedback: {
    summary?: string;
    action?: string;
  };
};

export type ParentAttemptReview = {
  attempt_id: string;
  child_nickname: string;
  title: string;
  complete: boolean;
  awarded_points: number;
  available_points: number;
  correct_count: number;
  correction_count: number;
  pending_review_count: number;
  reviews: ParentReviewItem[];
};

export async function getParentAttemptReview(
  attemptId: string,
  parentToken: string,
) {
  return apiRequest<ParentAttemptReview>(
    `/v1/grading-results/attempts/${encodeURIComponent(attemptId)}`,
    { method: "GET" },
    parentToken,
  );
}

export async function decideParentReview(
  resultId: string,
  payload: {
    outcome: "correct" | "incorrect";
    awarded_points: number;
    comment: string | null;
  },
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{
    parent_outcome: "correct" | "incorrect";
    parent_awarded_points: number | null;
    parent_comment: string | null;
    reviewed_at: string;
  }>(
    `/v1/grading-results/${encodeURIComponent(resultId)}/parent-decision`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    parentToken,
  );
}

export async function getAttemptResults(
  attemptId: string,
  childToken: string,
) {
  return apiRequest<{
    attempt_id: string;
    complete: boolean;
    results: AttemptResult[];
  }>(
    `/v1/attempts/${encodeURIComponent(attemptId)}/results`,
    { method: "GET" },
    childToken,
  );
}

export async function createCorrectionAttempt(
  attemptId: string,
  childToken: string,
  idempotencyKey: string,
) {
  return apiRequest<AssignmentWork>(
    `/v1/attempts/${encodeURIComponent(attemptId)}/correction`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
    childToken,
  );
}

export type ReviewItem = {
  id: string;
  source_question_id: string;
  prompt: string;
  due_on: string;
  interval_days: number;
  level: "reinforcement" | "standard" | "challenge";
};

export async function getTodayReviews(childToken: string) {
  return apiRequest<ReviewItem[]>(
    "/v1/reviews/today",
    { method: "GET" },
    childToken,
  );
}

export async function completeReview(
  itemId: string,
  outcome: "correct" | "incorrect",
  childToken: string,
) {
  return apiRequest<{
    item_id: string;
    old_interval_days: number;
    new_interval_days: number;
    next_due_on: string;
  }>(
    `/v1/reviews/${encodeURIComponent(itemId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ outcome }),
    },
    childToken,
  );
}

export type HistoryItem = {
  assignment_id: string;
  attempt_id: string | null;
  child_id: string;
  child_nickname: string;
  title: string;
  status: string;
  submitted_at: string | null;
  awarded_points: number;
  available_points: number;
  correction_count: number;
};

export async function getChildHistory(childToken: string) {
  return apiRequest<HistoryItem[]>(
    "/v1/history/child",
    { method: "GET" },
    childToken,
  );
}

export async function getFamilyHistory(
  familyId: string,
  parentToken: string,
) {
  return apiRequest<HistoryItem[]>(
    `/v1/history/families/${encodeURIComponent(familyId)}`,
    { method: "GET" },
    parentToken,
  );
}

export async function createUploadIntent(
  payload: {
    family_id: string;
    bucket: "sources" | "responses" | "audio" | "derived";
    object_id: string;
    filename: string;
    content_type:
      | "application/pdf"
      | "image/png"
      | "image/jpeg"
      | "audio/mpeg"
      | "audio/mp4";
  },
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<UploadIntent>(
    "/v1/uploads/intents",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    parentToken,
  );
}

export async function createChildUploadIntent(
  payload: {
    family_id: string;
    bucket: "responses";
    object_id: string;
    filename: string;
    content_type: "image/png" | "image/jpeg";
  },
  childToken: string,
  idempotencyKey: string,
) {
  return apiRequest<UploadIntent>(
    "/v1/uploads/child-intents",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    childToken,
  );
}

async function stripImageMetadata(file: File): Promise<File> {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return file;
  }
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    throw new Error("Image processing is unavailable.");
  }
  context.drawImage(image, 0, 0);
  image.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Image re-encoding failed.")),
      file.type,
      0.92,
    );
  });
  return new File([blob], file.name, {
    type: file.type,
    lastModified: Date.now(),
  });
}

export async function uploadToSignedUrl(
  intent: UploadIntent,
  file: File,
) {
  if (intent.upload_url.startsWith("fixture://")) {
    return;
  }
  const uploadFile = await stripImageMetadata(file);
  const response = await fetch(intent.upload_url, {
    method: "PUT",
    headers: { "Content-Type": uploadFile.type },
    body: uploadFile,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}.`);
  }
}

export async function createQuestionSetImport(
  payload: {
    family_id: string;
    filenames: string[];
    source_paths?: string[];
    answer_filenames?: string[];
    answer_source_paths?: string[];
    reference_filenames?: string[];
    reference_source_paths?: string[];
    purpose: "use_as_questions" | "generate_similar";
    title: string;
    subject: string;
  },
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{
    id: string;
    question_set_id: string;
    status: string;
  }>(
    "/v1/question-sets/imports",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    parentToken,
  );
}

export async function previewStructuredQuestionSet(
  document: StructuredQuestionSetDocument,
  parentToken: string,
) {
  return apiRequest<StructuredImportPreview>(
    "/v1/question-sets/imports/structured/preview",
    {
      method: "POST",
      body: JSON.stringify(document),
    },
    parentToken,
  );
}

export async function importStructuredQuestionSet(
  payload: {
    family_id: string;
    child_id: string;
    source_name: string;
    document: StructuredQuestionSetDocument;
  },
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{
    question_set_id: string;
    assignment_id: string;
    status: "confirmed";
    reused_existing: boolean;
    checksum: string;
  }>(
    "/v1/question-sets/imports/structured",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
    parentToken,
  );
}

export async function getQuestionSetDraft(
  questionSetId: string,
  parentToken: string,
) {
  return apiRequest<{
    question_set: { id: string; status: string };
    questions: Array<
      ApiQuestion & {
        answer_key: Record<string, unknown>;
      }
    >;
  }>(
    `/v1/question-sets/${encodeURIComponent(questionSetId)}`,
    { method: "GET" },
    parentToken,
  );
}

export async function confirmQuestionSet(
  questionSetId: string,
  parentToken: string,
  idempotencyKey: string,
) {
  return apiRequest<{ id: string; status: string }>(
    `/v1/question-sets/${encodeURIComponent(questionSetId)}/confirm`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
    parentToken,
  );
}

export async function assignQuestionSet(
  questionSetId: string,
  childId: string,
  parentToken: string,
  idempotencyKey: string,
  options: {
    mode: "practice" | "exam";
    time_limit_seconds: number | null;
  } = { mode: "practice", time_limit_seconds: null },
) {
  return apiRequest<{ id: string; status: string }>(
    `/v1/question-sets/${encodeURIComponent(questionSetId)}/assignments`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        child_id: childId,
        ...options,
      }),
    },
    parentToken,
  );
}
