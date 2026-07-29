"use client";

import { useLanguage, type Language } from "@/components/language-provider";

const languageLabels: Record<Language, string> = {
  en: "EN",
  ja: "日本語",
  zh: "中文",
};

export function LanguageSwitcher({
  onLanguageChange,
}: {
  onLanguageChange?: (language: Language) => void | Promise<void>;
} = {}) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <label className="language-picker">
      <span className="sr-only">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        onChange={(event) => {
          const nextLanguage = event.target.value as Language;
          setLanguage(nextLanguage);
          void (async () => {
            await onLanguageChange?.(nextLanguage);
          })().catch(() => undefined);
        }}
        value={language}
      >
        {Object.entries(languageLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
