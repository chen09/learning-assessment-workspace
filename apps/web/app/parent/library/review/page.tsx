"use client";

import { Check, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  getLibraryReviewerAccess,
  getLibraryReviewSubmissions,
  getParentAccessToken,
  reviewLibrarySubmission,
  type LibraryReviewSubmission,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "forbidden" | "error";

const copy = {
  en: {
    eyebrow: "Restricted reviewer workspace",
    title: "Review public-library submissions",
    description:
      "Only question-set metadata is shown here. Source files, answers, child work, and family identity remain private.",
    loading: "Loading pending submissions…",
    forbidden: "You do not have review permission.",
    error: "The review queue could not be loaded.",
    empty: "No submissions are waiting for review.",
    note: "Review note (optional)",
    approve: "Approve publication",
    reject: "Request changes",
    approving: "Saving…",
    approved: "Publication approved.",
    rejected: "Changes requested.",
    actionError: "The decision could not be saved. Please retry.",
    back: "Back to library",
    questions: (count: number) => `${count} questions`,
  },
  ja: {
    eyebrow: "権限付きレビューワークスペース",
    title: "公開問題ライブラリの投稿を確認",
    description:
      "ここには問題セットのメタデータだけを表示します。元ファイル、解答、子どもの作答、家族の特定情報は非公開です。",
    loading: "レビュー待ちの投稿を読み込んでいます…",
    forbidden: "レビュー権限がありません。",
    error: "レビュー待ちの投稿を読み込めませんでした。",
    empty: "レビュー待ちの投稿はありません。",
    note: "レビューコメント（任意）",
    approve: "公開を承認",
    reject: "修正を依頼",
    approving: "保存中…",
    approved: "公開を承認しました。",
    rejected: "修正を依頼しました。",
    actionError: "判定を保存できませんでした。もう一度お試しください。",
    back: "問題ライブラリに戻る",
    questions: (count: number) => `${count}問`,
  },
  zh: {
    eyebrow: "受限审核空间",
    title: "审核公共题库投稿",
    description:
      "这里仅显示题集元信息；原文件、答案、孩子作答和可识别家庭身份的信息始终保持私有。",
    loading: "正在加载待审核投稿…",
    forbidden: "你没有审核权限。",
    error: "无法加载审核队列。",
    empty: "没有待审核的投稿。",
    note: "审核说明（可选）",
    approve: "批准发布",
    reject: "要求修改",
    approving: "正在保存…",
    approved: "已批准发布。",
    rejected: "已要求修改。",
    actionError: "无法保存审核结论，请重试。",
    back: "返回家庭题库",
    questions: (count: number) => `${count} 道题`,
  },
} as const;

export default function LibraryReviewPage() {
  return (
    <AppShell currentPath="/parent/library/" role="parent">
      <LibraryReviewContent />
    </AppShell>
  );
}

function LibraryReviewContent() {
  const { language } = useLanguage();
  const text = copy[language];
  const [state, setState] = useState<LoadState>("loading");
  const [submissions, setSubmissions] = useState<LibraryReviewSubmission[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getParentAccessToken();
        if (!token) {
          throw new Error("missing parent session");
        }
        const access = await getLibraryReviewerAccess(token);
        if (!access.is_reviewer) {
          if (active) {
            setState("forbidden");
          }
          return;
        }
        const queue = await getLibraryReviewSubmissions(token);
        if (active) {
          setSubmissions(queue);
          setState("ready");
        }
      } catch {
        if (active) {
          setState("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const decide = async (
    submission: LibraryReviewSubmission,
    decision: "approve" | "reject",
  ) => {
    setSavingId(submission.id);
    setMessage("");
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("missing parent session");
      }
      await reviewLibrarySubmission(
        submission.id,
        { decision, note: notes[submission.id]?.trim() || null },
        token,
        crypto.randomUUID(),
      );
      setSubmissions((current) =>
        current.filter((candidate) => candidate.id !== submission.id),
      );
      setMessage(decision === "approve" ? text.approved : text.rejected);
    } catch {
      setMessage(text.actionError);
    } finally {
      setSavingId(null);
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
          <LanguageSwitcher />
          <Link className="button secondary" href="/parent/library/">
            {text.back}
          </Link>
        </div>
      </header>
      {state === "loading" ? <p>{text.loading}</p> : null}
      {state === "forbidden" ? <p role="alert">{text.forbidden}</p> : null}
      {state === "error" ? <p role="alert">{text.error}</p> : null}
      {message ? <p className="confirmed-message" role="status">{message}</p> : null}
      {state === "ready" && submissions.length === 0 ? <p>{text.empty}</p> : null}
      <section className="library-grid" aria-label={text.title}>
        {submissions.map((submission) => (
          <article className="library-card" key={submission.id}>
            <span className="library-icon"><ShieldCheck aria-hidden="true" /></span>
            <p className="eyebrow">{submission.subject}</p>
            <h2>{submission.title}</h2>
            <p>{submission.subject} · {text.questions(submission.question_count)}</p>
            <label className="assignment-note">
              <span>{text.note}</span>
              <textarea
                aria-label={text.note}
                maxLength={600}
                onChange={(event) =>
                  setNotes((current) => ({
                    ...current,
                    [submission.id]: event.target.value,
                  }))
                }
                value={notes[submission.id] ?? ""}
              />
            </label>
            <div className="library-card-actions">
              <button
                className="button secondary"
                disabled={savingId === submission.id}
                onClick={() => void decide(submission, "reject")}
                type="button"
              >
                <X aria-hidden="true" />
                {savingId === submission.id ? text.approving : text.reject}
              </button>
              <button
                className="button"
                disabled={savingId === submission.id}
                onClick={() => void decide(submission, "approve")}
                type="button"
              >
                <Check aria-hidden="true" />
                {savingId === submission.id ? text.approving : text.approve}
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
