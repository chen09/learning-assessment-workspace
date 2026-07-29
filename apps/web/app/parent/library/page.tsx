"use client";

import { BookCopy, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  type Family,
  type FamilyQuestionSet,
  getFamilies,
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
    empty: "No question sets yet.",
    error: "The family library could not be loaded.",
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
    empty: "問題セットはまだありません。",
    error: "家族の問題ライブラリを読み込めませんでした。",
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
    empty: "还没有题单。",
    error: "无法加载家庭题库。",
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
  const { language } = useLanguage();
  const text = copy[language];
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [sets, setSets] = useState<FamilyQuestionSet[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

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
        setSets(await getFamilyQuestionSets(selectedFamily.id, token));
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
      setSets(await getFamilyQuestionSets(nextFamilyId, token));
      setStatus("ready");
    } catch {
      setStatus("error");
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
              <span
                className={
                  set.status === "needs_review"
                    ? "status-pill warm"
                    : "status-pill"
                }
              >
                {text.status[set.status]}
              </span>
            </article>
          );
        })}
      </section>
    </>
  );
}
