"use client";

import { BookOpenCheck, Copy, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  copyPublicLibraryItem,
  getFamilies,
  getParentAccessToken,
  getPublicLibraryItems,
  type Family,
  type PublicLibraryItem,
} from "@/lib/api-client";

const copy = {
  en: {
    eyebrow: "Public library",
    title: "Reuse reviewed practice",
    description:
      "Published sets show anonymous metadata only. Their private source files and answer keys are never shared.",
    searchLabel: "Search public library",
    search: "Topic or subject…",
    empty: "No published question sets yet.",
    error: "The public library could not be loaded.",
    retry: "Try again",
    questions: (count: number, revision: number) =>
      `${count} questions · revision ${revision}`,
    copy: "Copy to my family",
    copying: "Copying…",
    copied: (family: string) => `Copied to ${family}'s family library.`,
    reused: (family: string) => `This revision is already in ${family}'s family library.`,
    copyError: "The question set could not be copied. Please try again.",
    noFamilies: "Create or join a family before copying practice.",
    back: "Back to family library",
  },
  ja: {
    eyebrow: "公開問題ライブラリ",
    title: "確認済みの練習を活用する",
    description:
      "公開されるのは匿名の概要だけです。元ファイルと解答は共有されません。",
    searchLabel: "公開問題ライブラリを検索",
    search: "単元・教科…",
    empty: "公開済みの問題セットはまだありません。",
    error: "公開問題ライブラリを読み込めませんでした。",
    retry: "もう一度試す",
    questions: (count: number, revision: number) => `${count}問 · 版 ${revision}`,
    copy: "自分の家族にコピー",
    copying: "コピー中…",
    copied: (family: string) => `「${family}」の家族ライブラリにコピーしました。`,
    reused: (family: string) => `この版はすでに「${family}」の家族ライブラリにあります。`,
    copyError: "問題セットをコピーできませんでした。もう一度お試しください。",
    noFamilies: "練習をコピーする前に、家族を作成または参加してください。",
    back: "家族の問題ライブラリに戻る",
  },
  zh: {
    eyebrow: "公共题库",
    title: "复用已审核的练习",
    description: "公开的只有匿名题目概要；原始资料和答案不会共享。",
    searchLabel: "搜索公共题库",
    search: "知识点或学科…",
    empty: "还没有已发布的题单。",
    error: "无法加载公共题库。",
    retry: "重试",
    questions: (count: number, revision: number) => `${count} 道题 · 版本 ${revision}`,
    copy: "复制到我的家庭",
    copying: "正在复制…",
    copied: (family: string) => `已复制到「${family}」的家庭题库。`,
    reused: (family: string) => `这个版本已经在「${family}」的家庭题库中。`,
    copyError: "无法复制题单，请重试。",
    noFamilies: "请先创建或加入家庭，再复制练习。",
    back: "返回家庭题库",
  },
} as const;

function displaySubject(subject: string, language: "en" | "ja" | "zh") {
  if (language === "zh" && subject === "Mathematics") return "数学";
  if (language === "zh" && subject === "English") return "英语";
  if (language === "ja" && subject === "Mathematics") return "数学";
  if (language === "ja" && subject === "English") return "英語";
  return subject;
}

export default function PublicLibraryPage() {
  return (
    <AppShell currentPath="/parent/library/" role="parent">
      <PublicLibraryContent />
    </AppShell>
  );
}

function PublicLibraryContent() {
  const { language } = useLanguage();
  const text = copy[language];
  const [families, setFamilies] = useState<Family[]>([]);
  const [items, setItems] = useState<PublicLibraryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const latestLoadRequest = useRef(0);

  const loadPublicLibrary = useCallback(async () => {
    const request = latestLoadRequest.current + 1;
    latestLoadRequest.current = request;
    setLoadError(false);
    setFamilies([]);
    setItems([]);
    setSelectedFamilyId("");
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("missing parent session");
      }
      const [nextFamilies, nextItems] = await Promise.all([
        getFamilies(token),
        getPublicLibraryItems(token),
      ]);
      if (latestLoadRequest.current !== request) return;
      setFamilies(nextFamilies);
      setSelectedFamilyId(nextFamilies[0]?.id ?? "");
      setItems(nextItems);
    } catch {
      if (latestLoadRequest.current !== request) return;
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadPublicLibrary();
    }, 0);
    return () => {
      latestLoadRequest.current += 1;
      window.clearTimeout(initialLoad);
    };
  }, [loadPublicLibrary]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.title} ${item.subject}`.toLocaleLowerCase().includes(normalized),
    );
  }, [items, query]);

  async function handleCopy(item: PublicLibraryItem) {
    if (!selectedFamilyId || copyingId) return;
    setCopyingId(item.id);
    setMessage(null);
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("missing parent session");
      }
      const result = await copyPublicLibraryItem(
        item.id,
        selectedFamilyId,
        token,
        crypto.randomUUID(),
      );
      const family = families.find(({ id }) => id === selectedFamilyId);
      const familyName = family?.name ?? "";
      setMessage(
        result.reused_existing
          ? text.reused(familyName)
          : text.copied(familyName),
      );
    } catch {
      setMessage(text.copyError);
    } finally {
      setCopyingId(null);
    }
  }

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
          </div>
        </header>
        <div className="library-public-tools">
          <Link className="button secondary" href="/parent/library/">
            {text.back}
          </Link>
          {families.length > 1 ? (
            <select
              aria-label={language === "zh" ? "复制目标家庭" : "Target family"}
              value={selectedFamilyId}
              onChange={(event) => setSelectedFamilyId(event.target.value)}
            >
              {families.map((family) => (
                <option key={family.id} value={family.id}>{family.name}</option>
              ))}
            </select>
          ) : null}
        </div>
        <label className="library-search">
          <Search aria-hidden="true" />
          <span className="sr-only">{text.searchLabel}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.search}
            aria-label={text.searchLabel}
          />
        </label>
        {loadError ? (
          <div className="form-error" role="alert">
            <p>{text.error}</p>
            <button
              className="button ghost"
              onClick={() => void loadPublicLibrary()}
              type="button"
            >
              {text.retry}
            </button>
          </div>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        {!loadError && families.length === 0 ? <p>{text.noFamilies}</p> : null}
        <section className="library-grid" aria-label={text.title}>
          {visibleItems.map((item) => (
            <article className="library-card" key={item.id}>
              <span className="library-icon"><BookOpenCheck aria-hidden="true" /></span>
              <p className="eyebrow">{displaySubject(item.subject, language)}</p>
              <h2>{item.title}</h2>
              <p>{text.questions(item.question_count, item.revision)}</p>
              <div className="library-card-actions">
                <button
                  className="button primary"
                  disabled={!selectedFamilyId || copyingId !== null}
                  onClick={() => void handleCopy(item)}
                >
                  <Copy aria-hidden="true" />
                  {copyingId === item.id ? text.copying : text.copy}
                </button>
              </div>
            </article>
          ))}
        </section>
        {!loadError && visibleItems.length === 0 ? <p>{text.empty}</p> : null}
    </>
  );
}
