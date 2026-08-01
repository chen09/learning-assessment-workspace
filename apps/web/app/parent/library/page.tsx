"use client";

import { BookCopy, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  assignQuestionSet,
  createLibrarySubmission,
  type ChildProfile,
  type Family,
  type FamilyQuestionSet,
  getChildren,
  getFamilies,
  getFamilyLibrarySubmissions,
  getFamilyQuestionSets,
  getParentAccessToken,
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
  const [pendingSubmissionSetIds, setPendingSubmissionSetIds] = useState<
    string[]
  >([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
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

  useEffect(() => {
    void (async () => {
      const token = await getParentAccessToken();
      if (!token) {
        setStatus("error");
        return;
      }
      try {
        const availableFamilies = await getFamilies(token);
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
        const [questionSets, pendingSubmissions] = await Promise.all([
          getFamilyQuestionSets(selectedFamily.id, token),
          getFamilyLibrarySubmissions(selectedFamily.id, token),
        ]);
        setSets(questionSets);
        setPendingSubmissionSetIds(
          pendingSubmissions.map((submission) => submission.question_set_id),
        );
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
  }, []);

  const filteredSets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return sets;
    }
    return sets.filter((set) =>
      `${set.title} ${set.subject}`.toLowerCase().includes(normalized),
    );
  }, [query, sets]);

  const switchFamily = async (nextFamilyId: string) => {
    setFamilyId(nextFamilyId);
    setStatus("loading");
    const token = await getParentAccessToken();
    if (!token) {
      setStatus("error");
      return;
    }
    try {
      const [questionSets, pendingSubmissions] = await Promise.all([
        getFamilyQuestionSets(nextFamilyId, token),
        getFamilyLibrarySubmissions(nextFamilyId, token),
      ]);
      setSets(questionSets);
      setPendingSubmissionSetIds(
        pendingSubmissions.map((submission) => submission.question_set_id),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  const openAssignment = async (questionSet: FamilyQuestionSet) => {
    setAssignmentSet(questionSet);
    setChildren([]);
    setAssignmentChildId("");
    setAssignmentNote("");
    setNewAssignmentId(null);
    setAssignmentMode("practice");
    setAssignmentMinutes(20);
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
  };

  const submitForReview = async () => {
    if (!submissionSet || !rightsConfirmed || !privacyConfirmed) {
      return;
    }
    setSubmissionStatus("submitting");
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
      setPendingSubmissionSetIds((current) =>
        current.includes(submission.question_set_id)
          ? current
          : [...current, submission.question_set_id],
      );
      setSubmissionStatus("success");
    } catch {
      setSubmissionStatus("error");
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
              onChange={(event) => void switchFamily(event.target.value)}
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
        <p className="form-error" role="alert">
          {text.error}
        </p>
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
                  set.status === "needs_review"
                    ? "status-pill warm"
                    : "status-pill"
                }
              >
                {text.status[set.status]}
              </span>
              {set.status === "confirmed" ? (
                <div className="library-card-actions">
                  <button
                    className="button secondary library-assign-button"
                    onClick={() => void openAssignment(set)}
                    type="button"
                  >
                    {text.assign}
                  </button>
                  {pendingSubmissionSetIds.includes(set.id) ? (
                    <span className="status-pill warm">
                      {t("librarySubmission.pending")}
                    </span>
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
              ) : null}
            </article>
          );
        })}
      </section>
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
            <div className="library-assignment-fields">
              <label>
                <span>{text.child}</span>
                <select
                  aria-label={text.child}
                  onChange={(event) => setAssignmentChildId(event.target.value)}
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
                  onChange={(event) => setAssignmentNote(event.target.value)}
                  value={assignmentNote}
                />
                <small>{text.noteHint}</small>
              </label>
              {assignmentStatus === "error" ? (
                <p role="alert">{assignmentMessage}</p>
              ) : null}
              {assignmentStatus === "success" ? (
                <p className="confirmed-message" role="status">
                  {assignmentMessage}
                </p>
              ) : null}
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
            </div>
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
              <p role="alert">{t("librarySubmission.error")}</p>
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
