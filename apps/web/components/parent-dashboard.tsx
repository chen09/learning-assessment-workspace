"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, History, ShieldCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  type ChildProfile,
  type Family,
  type ParentHistoryItem,
  getChildren,
  getFamilyHistory,
  getFamilies,
  getParentAttemptReview,
  getParentAccessToken,
} from "@/lib/api-client";

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

const dashboardStatusKey = {
  assigned: "parentDashboard.status.assigned",
  in_progress: "parentDashboard.status.inProgress",
  submitted: "parentDashboard.status.submitted",
  grading: "parentDashboard.status.grading",
  results_ready: "parentDashboard.status.resultsReady",
  correcting: "parentDashboard.status.correcting",
  completed: "parentDashboard.status.completed",
  withdrawn: "parentDashboard.status.withdrawn",
  stopped: "parentDashboard.status.stopped",
} as const;

function getDashboardStatusKey(status: string) {
  return dashboardStatusKey[
    status as keyof typeof dashboardStatusKey
  ] ?? dashboardStatusKey.assigned;
}

export function ParentDashboard() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [familyHistory, setFamilyHistory] = useState<ParentHistoryItem[]>([]);
  const [pendingReviewCountByAttempt, setPendingReviewCountByAttempt] = useState<
    Record<string, number>
  >({});
  const [workspaceError, setWorkspaceError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let hasParentSession = false;
    removeLegacyAuthCode();

    void (async () => {
      try {
        const accessToken = await getParentAccessToken();
        if (!active) {
          return;
        }
        if (!accessToken) {
          router.replace("/login/");
          return;
        }
        hasParentSession = true;
        setAuthenticated(true);
        setWorkspaceError(false);
        setFamilies(null);

        const nextFamilies = await getFamilies(accessToken);
        if (!active) {
          return;
        }
        const firstFamily = nextFamilies[0];
        const [nextChildren, nextFamilyHistory] = firstFamily
          ? await Promise.all([
              getChildren(firstFamily.id, accessToken),
              getFamilyHistory(firstFamily.id, accessToken),
            ])
          : [[], []];
        const reviewableAttempts = nextFamilyHistory.filter(
          (work) =>
            work.attempt_id !== null &&
            ["results_ready", "correcting"].includes(work.status),
        );
        const reviewCounts = await Promise.allSettled(
          reviewableAttempts.map(async (work) => {
            const review = await getParentAttemptReview(
              work.attempt_id as string,
              accessToken,
            );
            return [work.attempt_id as string, review.pending_review_count] as const;
          }),
        );
        if (!active) {
          return;
        }
        setFamilies(nextFamilies);
        setChildren(nextChildren);
        setFamilyHistory(nextFamilyHistory);
        setPendingReviewCountByAttempt(
          Object.fromEntries(
            reviewCounts.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : [],
            ),
          ),
        );
      } catch {
        if (active && !hasParentSession) {
          router.replace("/login/");
        }
        if (active && hasParentSession) {
          setWorkspaceError(true);
          setFamilies([]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey, router]);

  if (!authenticated) {
    return null;
  }

  return (
    <AppShell currentPath="/parent/" role="parent">
      <ParentDashboardContent
        childProfiles={children}
        familyHistory={familyHistory}
        families={families}
        pendingReviewCountByAttempt={pendingReviewCountByAttempt}
        workspaceError={workspaceError}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    </AppShell>
  );
}

function ParentDashboardContent({
  families,
  childProfiles,
  familyHistory,
  workspaceError,
  pendingReviewCountByAttempt,
  onRetry,
}: {
  families: Family[] | null;
  childProfiles: ChildProfile[];
  familyHistory: ParentHistoryItem[];
  pendingReviewCountByAttempt: Record<string, number>;
  workspaceError: boolean;
  onRetry: () => void;
}) {
  const { t } = useLanguage();

  if (families === null) {
    return null;
  }

  if (workspaceError) {
    return (
      <>
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("parentDashboard.eyebrow")}</p>
            <h1>{t("parentDashboard.workspaceUnavailable")}</h1>
          </div>
          <LanguageSwitcher />
        </header>
        <section className="settings-card">
          <p>{t("parentDashboard.workspaceUnavailableDetails")}</p>
          <button className="button primary" type="button" onClick={onRetry}>
            {t("parentDashboard.tryAgain")}
          </button>
        </section>
      </>
    );
  }

  const activeFamily = families[0];
  if (activeFamily) {
    const currentWorkByChild = new Map<string, ParentHistoryItem>();
    for (const work of familyHistory) {
      if (
        !currentWorkByChild.has(work.child_id) &&
        !["completed", "withdrawn", "stopped"].includes(work.status)
      ) {
        currentWorkByChild.set(work.child_id, work);
      }
    }
    return (
      <>
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("family.eyebrow")}</p>
            <h1>{activeFamily.name}</h1>
            <p className="lede">
              {t("parentDashboard.activeFamilyDescription", {
                count: childProfiles.length,
              })}
            </p>
          </div>
          <LanguageSwitcher />
        </header>

        <section className="settings-card dashboard-family-card">
          <div className="settings-heading">
            <UsersRound aria-hidden="true" />
            <div>
              <p className="eyebrow">{t("family.children")}</p>
              <h2>{t("parentDashboard.learningToday")}</h2>
            </div>
          </div>
          {childProfiles.length > 0 ? (
            <div className="dashboard-child-grid">
              {childProfiles.map((child) => {
                const currentWork = currentWorkByChild.get(child.id);
                const pendingReviewCount = currentWork?.attempt_id
                  ? (pendingReviewCountByAttempt[currentWork.attempt_id] ?? 0)
                  : 0;
                return (
                  <article className="dashboard-child-card" key={child.id}>
                    <strong>{child.nickname}</strong>
                    <span>{child.grade_stage}</span>
                    {currentWork ? (
                      <div className="dashboard-current-work">
                        <span className={`dashboard-status ${currentWork.status}`}>
                          {t(getDashboardStatusKey(currentWork.status))}
                        </span>
                        <p>{currentWork.title}</p>
                        <Link
                          className="quiet-link"
                          href={
                            currentWork.attempt_id
                              ? `/parent/results?attemptId=${encodeURIComponent(currentWork.attempt_id)}`
                              : `/parent/history?familyId=${encodeURIComponent(activeFamily.id)}`
                          }
                        >
                          {currentWork.attempt_id
                            ? t("parentDashboard.viewResults")
                            : t("parentDashboard.viewProgress")}
                        </Link>
                        {pendingReviewCount > 0 ? (
                          <div className="dashboard-parent-review">
                            <span>
                              {t("parentDashboard.pendingParentReview", {
                                count: pendingReviewCount,
                              })}
                            </span>
                            <Link
                              className="quiet-link"
                              href={`/parent/results?attemptId=${encodeURIComponent(currentWork.attempt_id as string)}`}
                            >
                              {t("parentDashboard.reviewNow")}
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="dashboard-no-work">
                        {t("parentDashboard.noActiveWork")}
                      </p>
                    )}
                    <Link
                      className="button primary"
                      href={`/parent/create?familyId=${encodeURIComponent(activeFamily.id)}&childId=${encodeURIComponent(child.id)}`}
                    >
                      {t("family.createPractice")}
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-empty-children">
              <p>{t("parentDashboard.noChildren")}</p>
              <Link className="button primary" href="/parent/family/">
                {t("family.addChild")}
              </Link>
            </div>
          )}
        </section>

        <section className="dashboard-action-grid" aria-label={t("parentDashboard.quickActions")}>
          <Link className="settings-card dashboard-action-card" href={`/parent/family/?familyId=${encodeURIComponent(activeFamily.id)}`}>
            <ShieldCheck aria-hidden="true" />
            <span>{t("nav.family")}</span>
          </Link>
          <Link className="settings-card dashboard-action-card" href={`/parent/library/?familyId=${encodeURIComponent(activeFamily.id)}`}>
            <BookOpen aria-hidden="true" />
            <span>{t("nav.library")}</span>
          </Link>
          <Link className="settings-card dashboard-action-card" href={`/parent/history/?familyId=${encodeURIComponent(activeFamily.id)}`}>
            <History aria-hidden="true" />
            <span>{t("nav.history")}</span>
          </Link>
        </section>
      </>
    );
  }

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
