"use client";

import { useState } from "react";

import { useLanguage } from "@/components/language-provider";

export function CopyChildSignInLink({
  assignmentId,
  childId,
  className = "button ghost",
}: {
  assignmentId: string;
  childId: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const copy = async () => {
    const path = `/child/login?childId=${encodeURIComponent(childId)}&assignmentId=${encodeURIComponent(assignmentId)}`;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  };

  return (
    <span className="copy-child-sign-in-link">
      <button className={className} onClick={() => void copy()} type="button">
        {t("draftReview.copyChildSignIn")}
      </button>
      {status === "copied" ? (
        <span role="status">{t("draftReview.childSignInCopied")}</span>
      ) : null}
      {status === "error" ? (
        <span role="alert">{t("draftReview.childSignInCopyError")}</span>
      ) : null}
    </span>
  );
}
