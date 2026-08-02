"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { useLanguage } from "@/components/language-provider";
import { completeAuthCallback } from "@/lib/auth-callback";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthCallback() {
  const { t } = useLanguage();
  const [error, setError] = useState<"not-configured" | "failed" | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      queueMicrotask(() => {
        if (active) {
          setError("not-configured");
        }
      });
      return () => {
        active = false;
      };
    }

    void completeAuthCallback(supabase, new URL(window.location.href))
      .then((nextPath) => {
        if (active) {
          window.location.replace(nextPath);
        }
      })
      .catch(() => {
        if (active) {
          setError("failed");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">{t("authCallback.secureAccess")}</p>
          <h1>{t("authCallback.openingTitle")}</h1>
          <p>{t("authCallback.openingDescription")}</p>
        </div>
        <p className="auth-privacy">{t("auth.privacy")}</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">
            {error ? t("authCallback.linkProblem") : t("authCallback.signingIn")}
          </p>
          <h2>
            {error ? t("authCallback.failedTitle") : t("authCallback.waiting")}
          </h2>
          <p role="status">
            {error === "not-configured"
              ? t("authCallback.notConfigured")
              : error === "failed"
                ? t("authCallback.failed")
                : t("authCallback.continuing")}
          </p>
          {error ? (
            <Link className="button primary large" href="/login/">
              {t("authCallback.requestNew")}
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
