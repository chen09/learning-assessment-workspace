"use client";

import { Check, Clock3 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";

const subscribeToHydration = () => () => undefined;

export default function SubmittedPage() {
  return (
    <AppShell currentPath="/child/work/" role="child">
      <SubmittedContent />
    </AppShell>
  );
}

function SubmittedContent() {
  const { t } = useLanguage();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  const openResults = () => {
    const attemptId = new URLSearchParams(window.location.search).get(
      "attemptId",
    );
    window.location.assign(
      attemptId
        ? `/child/results/?attemptId=${encodeURIComponent(attemptId)}`
        : "/child/results/",
    );
  };

  return (
    <section className="submitted-card">
        <span className="submitted-check">
          <Check size={34} aria-hidden="true" />
        </span>
        <p className="eyebrow">{t("submitted.eyebrow")}</p>
        <h1>{t("submitted.title")}</h1>
        <p>{t("submitted.description")}</p>
        <div className="grading-line">
          <Clock3 size={18} aria-hidden="true" />
          {t("submitted.duration")}
        </div>
        <button
          aria-busy={!hydrated}
          className="button primary"
          disabled={!hydrated}
          onClick={openResults}
          type="button"
        >
          {hydrated
            ? t("submitted.viewResults")
            : t("submitted.preparing")}
        </button>
    </section>
  );
}
