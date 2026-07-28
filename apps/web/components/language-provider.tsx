"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Language = "en" | "ja" | "zh";

const messages = {
  en: {
    "nav.home": "Home",
    "nav.create": "Create",
    "nav.history": "History",
    "nav.library": "Library",
    "nav.family": "Family",
    "nav.work": "Work",
    "nav.review": "Review",
    "role.parent": "Parent mode",
    "role.child": "Child mode",
    "language.label": "Language",
  },
  ja: {
    "nav.home": "ホーム",
    "nav.create": "作成",
    "nav.history": "履歴",
    "nav.library": "問題集",
    "nav.family": "家族",
    "nav.work": "学習",
    "nav.review": "復習",
    "role.parent": "保護者モード",
    "role.child": "子どもモード",
    "language.label": "言語",
  },
  zh: {
    "nav.home": "首页",
    "nav.create": "创建",
    "nav.history": "历史",
    "nav.library": "题库",
    "nav.family": "家庭",
    "nav.work": "答题",
    "nav.review": "复习",
    "role.parent": "家长模式",
    "role.child": "孩子模式",
    "language.label": "语言",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
};

const defaultLanguageContext: LanguageContextValue = {
  language: "en",
  setLanguage: () => undefined,
  t: (key) => messages.en[key],
};

const LanguageContext = createContext<LanguageContextValue>(
  defaultLanguageContext,
);

const languageEvent = "luma-language-change";

function readLanguage(storageKey: string): Language {
  const stored = window.localStorage.getItem(`luma-language:${storageKey}`);
  return stored === "ja" || stored === "zh" ? stored : "en";
}

function subscribeToLanguage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(languageEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(languageEvent, onChange);
  };
}

export function LanguageProvider({
  children,
  storageKey = "public",
}: {
  children: ReactNode;
  storageKey?: string;
}) {
  const language = useSyncExternalStore<Language>(
    subscribeToLanguage,
    () => readLanguage(storageKey),
    () => "en",
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        window.localStorage.setItem(
          `luma-language:${storageKey}`,
          nextLanguage,
        );
        document.documentElement.lang = nextLanguage;
        window.dispatchEvent(new Event(languageEvent));
      },
      t: (key) => messages[language][key],
    }),
    [language, storageKey],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
