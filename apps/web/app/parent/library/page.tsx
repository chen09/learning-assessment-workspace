"use client";

import { BookCopy, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { CopyChildSignInLink } from "@/components/copy-child-sign-in-link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  assignQuestionSet,
  createLibrarySubmission,
  getLibraryReviewerAccess,
  type ChildProfile,
  type Family,
  type FamilyQuestionSet,
  type LibrarySubmission,
  getChildren,
  getFamilies,
  getFamilyLibrarySubmissions,
  getFamilyQuestionSets,
  getParentAccessToken,
  withdrawLibrarySubmission,
} from "@/lib/api-client";

const copy = {
  en: {
    eyebrow: "Question library",
    title: "Reuse what works",
    description:
      "Your family library is private. Original material and answer keys remain private.",
    search: "Topic, level, or test…",
    searchLabel: "Search question library",
    family: "Family",
    questions: (count: number) => `${count} questions`,
    references: (count: number) =>
      `Based on ${count} private source ${count === 1 ? "file" : "files"}`,
    source: (title: string, subject: string) =>
      `Based on private material: ${title}${subject ? ` · ${subject}` : ""}`,
    empty: "No question sets yet.",
    error: "The family library could not be loaded.",
    reviewLink: "Review submissions",
    publicLink: "Browse public library",
    published: "Published to the public library",
    rejected: "Review needs changes",
    resumeReview: "Continue question-set review",
    useSourceMaterial: "Create questions from this material",
    createVariant: "Create a variant",
    resumeImport: "Check import progress",
    importFailed: "Import needs to be retried",
    retryImport: "Retry import",
    assign: "Assign to child",
    assignTitle: (title: string) => `Assign “${title}”`,
    child: "Child",
    practice: "Practice",
    exam: "Exam",
    timeLimit: "Time limit",
    minutes: (minutes: number) => `${minutes} minutes`,
    note: "Note for child (optional)",
    noteHint: "A short note appears before the work starts.",
    confirmAssignment: "Assign practice",
    cancel: "Cancel",
    assigning: "Assigning…",
    assigned: (child: string) => `Assigned to ${child}.`,
    assignedDetails: "Assigned practice details",
    printAssignment: "Print A4 worksheet",
    assignmentError: "The practice could not be assigned. Please try again.",
    childrenError: "Children could not be loaded for this family.",
    noChildren: "Add a child in family settings before assigning practice.",
    status: {
      draft: "Draft",
      processing: "Processing",
      needs_review: "Needs parent review",
      confirmed: "Ready to use",
    },
  },
  ja: {
    eyebrow: "問題ライブラリ",
    title: "良い問題を繰り返し使う",
    description:
      "家族の問題ライブラリは非公開です。元教材と解答も非公開のままです。",
    search: "単元、レベル、テスト…",
    searchLabel: "問題ライブラリを検索",
    family: "家族",
    questions: (count: number) => `${count}問`,
    references: (count: number) => `非公開の元教材 ${count}件に基づく`,
    source: (title: string, subject: string) =>
      `元教材：${title}${subject ? ` · ${subject}` : ""}`,
    empty: "問題セットはまだありません。",
    error: "家族の問題ライブラリを読み込めませんでした。",
    reviewLink: "投稿を確認する",
    publicLink: "公開問題を探す",
    published: "公開問題ライブラリに掲載済み",
    rejected: "レビューで修正が必要",
    resumeReview: "問題セットの確認を続ける",
    useSourceMaterial: "この教材をもとに問題を作る",
    createVariant: "変式問題を作る",
    resumeImport: "取込状況を確認する",
    importFailed: "取込の再実行が必要です",
    retryImport: "取込をやり直す",
    assign: "子どもに割り当てる",
    assignTitle: (title: string) => `「${title}」を割り当てる`,
    child: "子ども",
    practice: "練習",
    exam: "テスト",
    timeLimit: "制限時間",
    minutes: (minutes: number) => `${minutes}分`,
    note: "子どもへのメモ（任意）",
    noteHint: "練習を始める前に表示されます。",
    confirmAssignment: "割り当てる",
    cancel: "キャンセル",
    assigning: "割り当て中…",
    assigned: (child: string) => `${child}さんに割り当てました。`,
    assignedDetails: "割り当て済みの練習詳細",
    printAssignment: "A4プリントを印刷",
    assignmentError: "割り当てられませんでした。もう一度お試しください。",
    childrenError: "この家族の子どもを読み込めませんでした。",
    noChildren: "先に家族設定で子どもを追加してください。",
    status: {
      draft: "下書き",
      processing: "処理中",
      needs_review: "保護者の確認待ち",
      confirmed: "利用可能",
    },
  },
  zh: {
    eyebrow: "家庭题库",
    title: "把有效的题目沉淀下来",
    description: "家庭题库默认私有，原教材和答案也始终保持私有。",
    search: "知识点、难度或测试…",
    searchLabel: "搜索家庭题库",
    family: "家庭",
    questions: (count: number) => `${count} 道题`,
    references: (count: number) => `来自 ${count} 份原教材资料`,
    source: (title: string, subject: string) =>
      `基于教材：${title}${subject ? ` · ${subject}` : ""}`,
    empty: "还没有题单。",
    error: "无法加载家庭题库。",
    reviewLink: "审核投稿",
    publicLink: "浏览公共题库",
    published: "已发布到公共题库",
    rejected: "审核需要修改",
    resumeReview: "继续审核题单",
    useSourceMaterial: "基于这份教材出题",
    createVariant: "创建变式题单",
    resumeImport: "查看导入进度",
    importFailed: "导入失败，可重新处理",
    retryImport: "重新处理导入",
    assign: "分配给孩子",
    assignTitle: (title: string) => `分配「${title}」`,
    child: "孩子",
    practice: "练习",
    exam: "考试",
    timeLimit: "限时",
    minutes: (minutes: number) => `${minutes} 分钟`,
    note: "给孩子的说明（可选）",
    noteHint: "孩子开始练习前会看到这条说明。",
    confirmAssignment: "确认分配",
    cancel: "取消",
    assigning: "正在分配…",
    assigned: (child: string) => `已分配给${child}。`,
    assignedDetails: "已分配的练习详情",
    printAssignment: "打印 A4 试卷",
    assignmentError: "无法分配题单，请重试。",
    childrenError: "无法加载这个家庭的孩子资料。",
    noChildren: "请先在家庭设置中添加孩子。",
    status: {
      draft: "草稿",
      processing: "处理中",
      needs_review: "待家长确认",
      confirmed: "可以使用",
    },
  },
} as const;

export default function LibraryPage() {
  return (
    <AppShell currentPath="/parent/library/" role="parent">
      <LibraryContent />
    </AppShell>
  );
}

function LibraryContent() {
  const { language, t } = useLanguage();
  const text = copy[language];
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [sets, setSets] = useState<FamilyQuestionSet[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<
    LibrarySubmission[]
  >([]);
  const [isLibraryReviewer, setIsLibraryReviewer] = useState(false);
  const [withdrawingSubmissionId, setWithdrawingSubmissionId] = useState<
    string | null
  >(null);
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadRequest, setLoadRequest] = useState(0);
  const [assignmentSet, setAssignmentSet] =
    useState<FamilyQuestionSet | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [assignmentChildId, setAssignmentChildId] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<"practice" | "exam">(
    "practice",
  );
  const [assignmentMinutes, setAssignmentMinutes] = useState(20);
  const [assignmentNote, setAssignmentNote] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState<
    "idle" | "loading_children" | "submitting" | "success" | "error"
  >("idle");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [newAssignmentId, setNewAssignmentId] = useState<string | null>(null);
  const [submissionSet, setSubmissionSet] =
    useState<FamilyQuestionSet | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    const reloadForLibraryNavigation = () => {
      setStatus("loading");
      setFamilies([]);
      setFamilyId("");
      setSets([]);
      setPendingSubmissions([]);
      setIsLibraryReviewer(false);
      setWithdrawingSubmissionId(null);
      setSubmissionMessage("");
      setQuery("");
      setAssignmentSet(null);
      setChildren([]);
      setAssignmentChildId("");
      setAssignmentMode("practice");
      setAssignmentMinutes(20);
      setAssignmentNote("");
      setAssignmentStatus("idle");
      setAssignmentMessage("");
      setNewAssignmentId(null);
      setSubmissionSet(null);
      setRightsConfirmed(false);
      setPrivacyConfirmed(false);
      setSubmissionStatus("idle");
      setSubmissionError(null);
      setLoadRequest((current) => current + 1);
    };

    window.addEventListener("popstate", reloadForLibraryNavigation);
    return () => {
      window.removeEventListener("popstate", reloadForLibraryNavigation);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus("loading");
      setFamilies([]);
      setFamilyId("");
      setSets([]);
      setPendingSubmissions([]);
      setIsLibraryReviewer(false);
      const token = await getParentAccessToken();
      if (!token) {
        if (!cancelled) {
          setStatus("error");
        }
        return;
      }
      try {
        const availableFamilies = await getFamilies(token);
        if (cancelled) {
          return;
        }
        setFamilies(availableFamilies);
        const requestedFamilyId = new URLSearchParams(
          window.location.search,
        ).get("familyId");
        const selectedFamily =
          availableFamilies.find(
            (family) => family.id === requestedFamilyId,
          ) ?? availableFamilies[0];
        if (!selectedFamily) {
          setStatus("ready");
          return;
        }
        setFamilyId(selectedFamily.id);
        const [questionSets, pendingSubmissions, reviewerAccess] = await Promise.all([
          getFamilyQuestionSets(selectedFamily.id, token),
          getFamilyLibrarySubmissions(selectedFamily.id, token),
          getLibraryReviewerAccess(token),
        ]);
        if (cancelled) {
          return;
        }
        setSets(questionSets);
        setPendingSubmissions(pendingSubmissions);
        setIsLibraryReviewer(reviewerAccess.is_reviewer);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  const retryLibraryLoad = () => {
    setLoadRequest((current) => current + 1);
  };

  const filteredSets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return sets;
    }
    return sets.filter((set) =>
      [
        set.title,
        set.subject,
        set.source_summary.source_material_title,
        set.source_summary.source_material_subject,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, sets]);

  const pendingSubmissionsBySetId = useMemo(
    () =>
      new Map(
        pendingSubmissions.map((submission) => [
          submission.question_set_id,
          submission,
        ]),
      ),
    [pendingSubmissions],
  );

  const switchFamily = (nextFamilyId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("familyId", nextFamilyId);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const loadAssignmentChildren = async (questionSet: FamilyQuestionSet) => {
    setChildren([]);
    setAssignmentChildId("");
    setAssignmentMessage("");
    setAssignmentStatus("loading_children");
    const token = await getParentAccessToken();
    if (!token) {
      setAssignmentStatus("error");
      setAssignmentMessage(text.childrenError);
      return;
    }
    try {
      const availableChildren = await getChildren(questionSet.family_id, token);
      setChildren(availableChildren);
      setAssignmentChildId(availableChildren[0]?.id ?? "");
      setAssignmentStatus("idle");
    } catch {
      setAssignmentStatus("error");
      setAssignmentMessage(text.childrenError);
    }
  };

  const openAssignment = (questionSet: FamilyQuestionSet) => {
    setAssignmentSet(questionSet);
    setAssignmentNote("");
    setNewAssignmentId(null);
    setAssignmentMode("practice");
    setAssignmentMinutes(20);
    void loadAssignmentChildren(questionSet);
  };

  const submitAssignment = async () => {
    if (!assignmentSet || !assignmentChildId) {
      return;
    }
    setAssignmentStatus("submitting");
    setAssignmentMessage("");
    const token = await getParentAccessToken();
    if (!token) {
      setAssignmentStatus("error");
      setAssignmentMessage(text.assignmentError);
      return;
    }
    try {
      const assignment = await assignQuestionSet(
        assignmentSet.id,
        assignmentChildId,
        token,
        crypto.randomUUID(),
        {
          mode: assignmentMode,
          time_limit_seconds:
            assignmentMode === "exam" ? assignmentMinutes * 60 : null,
          parent_note: assignmentNote.trim() || null,
        },
      );
      const child = children.find((candidate) => candidate.id === assignmentChildId);
      setNewAssignmentId(assignment.id);
      setAssignmentStatus("success");
      setAssignmentMessage(text.assigned(child?.nickname ?? ""));
    } catch {
      setAssignmentStatus("error");
      setAssignmentMessage(text.assignmentError);
    }
  };

  const openSubmission = (questionSet: FamilyQuestionSet) => {
    setSubmissionSet(questionSet);
    setRightsConfirmed(false);
    setPrivacyConfirmed(false);
    setSubmissionStatus("idle");
    setSubmissionError(null);
  };

  const submitForReview = async () => {
    if (!submissionSet || !rightsConfirmed || !privacyConfirmed) {
      return;
    }
    setSubmissionStatus("submitting");
    setSubmissionError(null);
    const token = await getParentAccessToken();
    if (!token) {
      setSubmissionStatus("error");
      return;
    }
    try {
      const submission = await createLibrarySubmission(
        {
          family_id: submissionSet.family_id,
          question_set_id: submissionSet.id,
          rights_confirmed: true,
          privacy_confirmed: true,
        },
        token,
        crypto.randomUUID(),
      );
      setPendingSubmissions((current) =>
        current.some((item) => item.id === submission.id)
          ? current
          : [...current, submission],
      );
      setSubmissionStatus("success");
    } catch (error) {
      setSubmissionStatus("error");
      setSubmissionError(
        error instanceof Error &&
          error.message.includes("library_submission_contains_private_figure")
          ? t("librarySubmission.privateFigureError")
          : t("librarySubmission.error"),
      );
    }
  };

  const withdrawSubmission = async (submission: LibrarySubmission) => {
    setWithdrawingSubmissionId(submission.id);
    setSubmissionMessage("");
    const token = await getParentAccessToken();
    if (!token) {
      setWithdrawingSubmissionId(null);
      setSubmissionMessage(t("librarySubmission.withdrawError"));
      return;
    }
    try {
      await withdrawLibrarySubmission(submission.id, token);
      setPendingSubmissions((current) =>
        current.filter((item) => item.id !== submission.id),
      );
      setSubmissionMessage(t("librarySubmission.withdrawSuccess"));
    } catch {
      setSubmissionMessage(t("librarySubmission.withdrawError"));
    } finally {
      setWithdrawingSubmissionId(null);
    }
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p className="lede">{text.description}</p>
        </div>
        <div className="shell-tools">
          {families.length > 1 ? (
            <select
              aria-label={text.family}
              onChange={(event) => switchFamily(event.target.value)}
              value={familyId}
            >
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          ) : null}
          <LanguageSwitcher />
          <Link className="button secondary" href="/parent/library/public/">
            {text.publicLink}
          </Link>
          {isLibraryReviewer ? (
            <Link className="button secondary" href="/parent/library/review/">
              {text.reviewLink}
            </Link>
          ) : null}
        </div>
      </header>
      <label className="library-search">
        <Search aria-hidden="true" />
        <input
          aria-label={text.searchLabel}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={text.search}
          value={query}
        />
      </label>
      {status === "error" ? (
        <div className="form-error" role="alert">
          <p>{text.error}</p>
          <button
            className="button ghost"
            onClick={retryLibraryLoad}
            type="button"
          >
            {t("history.retry")}
          </button>
        </div>
      ) : null}
      {status === "ready" && filteredSets.length === 0 ? (
        <p>{text.empty}</p>
      ) : null}
      <section className="library-grid">
        {filteredSets.map((set) => {
          const referenceCount =
            set.source_summary.reference_file_count ?? 0;
          const sourceMaterialTitle =
            set.source_summary.source_material_title?.trim();
          const sourceMaterialSubject =
            set.source_summary.source_material_subject?.trim() ?? "";
          const sourceImportFailed =
            set.status === "processing" && set.import_job_status === "failed";
          const isPrivateSourceMaterial =
            set.source_summary.artifact_kind === "private_source_material";
          return (
            <article className="library-card" key={set.id}>
              <span className="library-icon">
                <BookCopy aria-hidden="true" />
              </span>
              <p className="eyebrow">
                {text.family} · {set.subject}
              </p>
              <h2>{set.title}</h2>
              <p>{text.questions(set.question_count)}</p>
              {referenceCount > 0 ? (
                <p>{text.references(referenceCount)}</p>
              ) : null}
              {sourceMaterialTitle ? (
                <p>{text.source(sourceMaterialTitle, sourceMaterialSubject)}</p>
              ) : null}
              <span
                className={
                  set.status === "needs_review" || sourceImportFailed
                    ? "status-pill warm"
                    : "status-pill"
                }
              >
                {sourceImportFailed
                  ? text.importFailed
                  : text.status[set.status]}
              </span>
              {set.status === "confirmed" ? (
                <div className="library-card-actions">
                  <Link
                    className="button secondary"
                    href={`/parent/create/?variantOfQuestionSetId=${encodeURIComponent(
                      set.id,
                    )}`}
                  >
                    {text.createVariant}
                  </Link>
                  <button
                    className="button secondary library-assign-button"
                    onClick={() => void openAssignment(set)}
                    type="button"
                  >
                    {text.assign}
                  </button>
          {pendingSubmissionsBySetId.get(set.id)?.status === "pending_review" ? (
                    <div className="library-card-actions">
                      <span className="status-pill warm">
                        {t("librarySubmission.pending")}
                      </span>
                      <button
                        className="text-button"
                        disabled={
                          withdrawingSubmissionId ===
                          pendingSubmissionsBySetId.get(set.id)?.id
                        }
                        onClick={() =>
                          void withdrawSubmission(
                            pendingSubmissionsBySetId.get(set.id)!,
                          )
                        }
                        type="button"
                      >
                        {withdrawingSubmissionId ===
                        pendingSubmissionsBySetId.get(set.id)?.id
                          ? t("librarySubmission.withdrawing")
                          : t("librarySubmission.withdraw")}
                      </button>
                    </div>
                  ) : pendingSubmissionsBySetId.get(set.id)?.status ===
                    "published" ? (
                    <span className="status-pill">{text.published}</span>
                  ) : pendingSubmissionsBySetId.get(set.id)?.status ===
                    "rejected" ? (
                    <div className="library-card-actions">
                      <span className="status-pill warm">{text.rejected}</span>
                      {pendingSubmissionsBySetId.get(set.id)?.review_note ? (
                        <p className="record-source">
                          {pendingSubmissionsBySetId.get(set.id)?.review_note}
                        </p>
                      ) : null}
                      <button
                        className="text-button"
                        onClick={() => openSubmission(set)}
                        type="button"
                      >
                        {t("librarySubmission.open")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => openSubmission(set)}
                      type="button"
                    >
                      {t("librarySubmission.open")}
                    </button>
                  )}
                </div>
              ) : set.status === "needs_review" ? (
                <div className="library-card-actions">
                  <Link
                    className="button secondary"
                    href={`/parent/create/?questionSetId=${encodeURIComponent(
                      set.id,
                    )}`}
                  >
                    {isPrivateSourceMaterial
                      ? text.useSourceMaterial
                      : text.resumeReview}
                  </Link>
                </div>
              ) : set.status === "processing" ? (
                <div className="library-card-actions">
                  <Link
                    className="button secondary"
                    href={`/parent/create/?questionSetId=${encodeURIComponent(
                      set.id,
                    )}`}
                  >
                    {sourceImportFailed ? text.retryImport : text.resumeImport}
                  </Link>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
      {submissionMessage ? (
        <p className="confirmed-message" role="status">
          {submissionMessage}
        </p>
      ) : null}
      {assignmentSet ? (
        <section
          aria-labelledby="library-assignment-title"
          className="assignment-panel library-assignment-panel"
        >
          <div>
            <p className="eyebrow">{text.assign}</p>
            <h2 id="library-assignment-title">
              {text.assignTitle(assignmentSet.title)}
            </h2>
          </div>
          {assignmentStatus === "loading_children" ? (
            <p>{text.assigning}</p>
          ) : (
            <>
              <div className="library-assignment-controls">
                <div
                  aria-label={
                    assignmentStatus === "success"
                      ? text.assignedDetails
                      : undefined
                  }
                  className="library-assignment-fields"
                  inert={assignmentStatus === "success"}
                >
                  <label>
                    <span>{text.child}</span>
                    <select
                      aria-label={text.child}
                      onChange={(event) =>
                        setAssignmentChildId(event.target.value)
                      }
                      value={assignmentChildId}
                    >
                      {children.map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.nickname} · {child.grade_stage}
                        </option>
                      ))}
                    </select>
                  </label>
                  {children.length === 0 && assignmentStatus === "idle" ? (
                    <p role="status">{text.noChildren}</p>
                  ) : null}
                  <fieldset className="assignment-mode-selector">
                    <legend>{text.assign}</legend>
                    <label>
                      <input
                        checked={assignmentMode === "practice"}
                        name="library-assignment-mode"
                        onChange={() => setAssignmentMode("practice")}
                        type="radio"
                      />
                      {text.practice}
                    </label>
                    <label>
                      <input
                        checked={assignmentMode === "exam"}
                        name="library-assignment-mode"
                        onChange={() => setAssignmentMode("exam")}
                        type="radio"
                      />
                      {text.exam}
                    </label>
                    {assignmentMode === "exam" ? (
                      <label>
                        <span>{text.timeLimit}</span>
                        <select
                          aria-label={text.timeLimit}
                          onChange={(event) =>
                            setAssignmentMinutes(Number(event.target.value))
                          }
                          value={assignmentMinutes}
                        >
                          {[10, 20, 30, 45, 60].map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {text.minutes(minutes)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </fieldset>
                  <label className="assignment-note">
                    <span>{text.note}</span>
                    <textarea
                      aria-label={text.note}
                      maxLength={300}
                      onChange={(event) =>
                        setAssignmentNote(event.target.value)
                      }
                      value={assignmentNote}
                    />
                    <small>{text.noteHint}</small>
                  </label>
                  {assignmentStatus === "error" ? (
                    <div role="alert">
                      <p>{assignmentMessage}</p>
                      <button
                        className="button ghost"
                        onClick={() => {
                          if (assignmentSet) {
                            void loadAssignmentChildren(assignmentSet);
                          }
                        }}
                        type="button"
                      >
                        {t("history.retry")}
                      </button>
                    </div>
                  ) : null}
                  {assignmentStatus === "success" ? (
                    <p className="confirmed-message" role="status">
                      {assignmentMessage}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="library-assignment-actions">
                <button
                  className="button secondary"
                  onClick={() => setAssignmentSet(null)}
                  type="button"
                >
                  {text.cancel}
                </button>
                {newAssignmentId ? (
                  <Link
                    className="button secondary"
                    href={`/parent/print/?assignmentId=${encodeURIComponent(
                      newAssignmentId,
                    )}`}
                  >
                    {text.printAssignment}
                  </Link>
                ) : null}
                {newAssignmentId && assignmentChildId ? (
                  <>
                    <Link
                      className="button secondary"
                      href={`/child/login/?childId=${encodeURIComponent(assignmentChildId)}&assignmentId=${encodeURIComponent(newAssignmentId)}`}
                    >
                      {t("draftReview.openChildSignIn")}
                    </Link>
                    <CopyChildSignInLink
                      assignmentId={newAssignmentId}
                      childId={assignmentChildId}
                      className="button secondary"
                    />
                  </>
                ) : null}
                <button
                  className="button primary"
                  disabled={
                    !assignmentChildId ||
                    assignmentStatus === "submitting" ||
                    assignmentStatus === "success"
                  }
                  onClick={() => void submitAssignment()}
                  type="button"
                >
                  {assignmentStatus === "submitting"
                    ? text.assigning
                    : text.confirmAssignment}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
      {submissionSet ? (
        <section
          aria-labelledby="library-submission-title"
          className="assignment-panel library-submission-panel"
        >
          <div>
            <p className="eyebrow">{t("librarySubmission.eyebrow")}</p>
            <h2 id="library-submission-title">
              {t("librarySubmission.title", { title: submissionSet.title })}
            </h2>
            <p>{t("librarySubmission.description")}</p>
          </div>
          <div className="library-submission-fields">
            <label>
              <input
                checked={rightsConfirmed}
                disabled={submissionStatus === "success"}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
                type="checkbox"
              />
              {t("librarySubmission.rights")}
            </label>
            <label>
              <input
                checked={privacyConfirmed}
                disabled={submissionStatus === "success"}
                onChange={(event) => setPrivacyConfirmed(event.target.checked)}
                type="checkbox"
              />
              {t("librarySubmission.privacy")}
            </label>
            {submissionStatus === "success" ? (
              <p className="confirmed-message" role="status">
                {t("librarySubmission.success")}
              </p>
            ) : null}
            {submissionStatus === "error" ? (
              <p role="alert">{submissionError ?? t("librarySubmission.error")}</p>
            ) : null}
            <div className="library-assignment-actions">
              <button
                className="button secondary"
                onClick={() => setSubmissionSet(null)}
                type="button"
              >
                {text.cancel}
              </button>
              <button
                className="button primary"
                disabled={
                  !rightsConfirmed ||
                  !privacyConfirmed ||
                  submissionStatus === "submitting" ||
                  submissionStatus === "success"
                }
                onClick={() => void submitForReview()}
                type="button"
              >
                {submissionStatus === "submitting"
                  ? t("librarySubmission.submitting")
                  : t("librarySubmission.confirm")}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
