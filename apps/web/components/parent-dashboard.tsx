"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getParentAccessToken } from "@/lib/api-client";

function removeLegacyAuthCode() {
  const currentUrl = new URL(window.location.href);
  if (!currentUrl.searchParams.has("code")) {
    return;
  }

  currentUrl.searchParams.delete("code");
  window.history.replaceState(
    window.history.state,
    "",
    `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
  );
}

export function ParentDashboard() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    removeLegacyAuthCode();

    void getParentAccessToken()
      .then((accessToken) => {
        if (!active) {
          return;
        }
        if (!accessToken) {
          router.replace("/login/");
          return;
        }
        setAuthenticated(true);
      })
      .catch(() => {
        if (active) {
          router.replace("/login/");
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  if (!authenticated) {
    return null;
  }

  return (
    <AppShell currentPath="/parent/" role="parent">
      <ParentDashboardContent />
    </AppShell>
  );
}

function ParentDashboardContent() {
  const { t } = useLanguage();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("parentDashboard.eyebrow")}</p>
          <h1>{t("parentDashboard.title")}</h1>
          <p className="lede">{t("parentDashboard.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>

      <section className="attention-card" aria-labelledby="attention-heading">
        <span className="attention-icon">
          <UsersRound aria-hidden="true" />
        </span>
        <div>
          <p className="kicker">{t("parentDashboard.firstStep")}</p>
          <h2 id="attention-heading">
            {t("parentDashboard.familyAction")}
          </h2>
          <p>{t("parentDashboard.familyDetails")}</p>
        </div>
        <Link className="text-link" href="/parent/family/">
          {t("parentDashboard.openFamilySetup")}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="settings-card">
        <ShieldCheck aria-hidden="true" />
        <p className="eyebrow">{t("parentDashboard.private")}</p>
        <h2>{t("parentDashboard.accountReady")}</h2>
        <p>{t("parentDashboard.accountReadyDetails")}</p>
        <Link className="button primary" href="/parent/family/">
          {t("parentDashboard.continueFamilySetup")}
        </Link>
      </section>
    </>
  );
}
