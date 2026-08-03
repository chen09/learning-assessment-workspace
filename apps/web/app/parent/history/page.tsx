"use client";

import { ArrowRight, Clock3, FileCheck2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import {
  getCompletedWorksheetImports,
  getFamilyHistory,
  getFamilies,
  type Family,
  type FamilyCompletedWorksheetImport,
  type ParentHistoryItem,
  getParentAccessToken,
  stopAssignment,
  withdrawAssignment,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "missing" | "error";

const statusTranslationKeys = {
  draft: "history.status.draft",
  confirmed: "history.status.confirmed",
  assigned: "history.status.assigned",
  in_progress: "history.status.inProgress",
  submitted: "history.status.submitted",
  grading: "history.status.grading",
  results_ready: "history.status.resultsReady",
  correcting: "history.status.correcting",
  completed: "history.status.completed",
  withdrawn: "parentHistory.status.withdrawn",
  stopped: "parentHistory.status.stopped",
} as const;

export default function ParentHistoryPage() {
  return (
    <AppShell currentPath="/parent/history/" role="parent">
      <ParentHistoryContent />
    </AppShell>
  );
}

function ParentHistoryContent() {
  const { t } = useLanguage();
  const [items, setItems] = useState<ParentHistoryItem[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [completedWorksheetImports, setCompletedWorksheetImports] = useState<
    FamilyCompletedWorksheetImport[]
  >([]);
  const [childFilter, setChildFilter] = useState("all");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [actionAssignmentId, setActionAssignmentId] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const reloadForHistoryNavigation = () => {
      setItems([]);
      setFamilies([]);
      setFamilyId(null);
      setCompletedWorksheetImports([]);
      setChildFilter("all");
      setActionAssignmentId(null);
      setActionError(null);
      setLoadState("loading");
      setReloadVersion((current) => current + 1);
    };

    window.addEventListener("popstate", reloadForHistoryNavigation);
    return () => {
      window.removeEventListener("popstate", reloadForHistoryNavigation);
    };
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const token = await getParentAccessToken();
        if (!token) {
          if (active) {
            setLoadState("error");
          }
          return;
        }
        const availableFamilies = await getFamilies(token);
        if (active) {
          const requestedFamilyId = new URLSearchParams(
            window.location.search,
          ).get("familyId");
          const selectedFamily =
            availableFamilies.find((family) => family.id === requestedFamilyId) ??
            availableFamilies[0];
          setFamilies(availableFamilies);
          if (!selectedFamily) {
            setLoadState("missing");
            return;
          }
          setFamilyId(selectedFamily.id);
        }
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadVersion]);

  useEffect(() => {
    if (!familyId) {
      return;
    }
    let active = true;

    void (async () => {
      try {
        const token = await getParentAccessToken();
        if (!token) {
          if (active) {
            setLoadState("error");
          }
          return;
        }
        const [historyItems, paperImports] = await Promise.all([
          getFamilyHistory(familyId, token),
          getCompletedWorksheetImports(familyId, token),
        ]);
        if (active) {
          setItems(historyItems);
          setCompletedWorksheetImports(paperImports);
          setLoadState("ready");
        }
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [familyId, reloadVersion]);

  const selectFamily = (nextFamilyId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("familyId", nextFamilyId);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setLoadState("loading");
    setItems([]);
    setCompletedWorksheetImports([]);
    setChildFilter("all");
    setFamilyId(nextFamilyId);
  };

  const retryHistory = () => {
    setLoadState("loading");
    setItems([]);
    setCompletedWorksheetImports([]);
    setReloadVersion((current) => current + 1);
  };

  const children = Array.from(
    new Map(items.map((item) => [item.child_id, item.child_nickname])),
  );
  const visibleItems =
    childFilter === "all"
      ? items
      : items.filter((item) => item.child_id === childFilter);
  const recoverablePaperImports = completedWorksheetImports.filter((item) =>
    ["processing", "needs_review", "failed"].includes(item.status),
  );
  const submittedPaperImports = completedWorksheetImports.filter((item) =>
    ["grading", "results_ready"].includes(item.status),
  );
  const paperImportStatusLabel = (status: string) =>
    t(
      status === "needs_review"
        ? "parentHistory.paperNeedsReview"
        : status === "failed"
          ? "parentHistory.paperFailed"
          : "parentHistory.paperProcessing",
    );

  const updateAssignmentStatus = async (
    item: ParentHistoryItem,
    action: "withdraw" | "stop",
  ) => {
    setActionAssignmentId(item.assignment_id);
    setActionError(null);
    try {
      const token = await getParentAccessToken();
      if (!token) {
        throw new Error("missing parent session");
      }
      const assignment =
        action === "withdraw"
          ? await withdrawAssignment(item.assignment_id, token)
          : await stopAssignment(item.assignment_id, token);
      setItems((current) =>
        current.map((candidate) =>
          candidate.assignment_id === item.assignment_id
            ? { ...candidate, status: assignment.status }
            : candidate,
        ),
      );
    } catch {
      setActionError(t("parentHistory.actionError"));
    } finally {
      setActionAssignmentId(null);
    }
  };

  const statusLabel = (status: string) =>
    t(
      statusTranslationKeys[
        status as keyof typeof statusTranslationKeys
      ] ?? "history.status.other",
    );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("parentHistory.eyebrow")}</p>
          <h1>{t("parentHistory.title")}</h1>
          <p className="lede">{t("parentHistory.description")}</p>
        </div>
        <div className="header-actions">
          {families.length > 1 && familyId ? (
            <label className="dashboard-family-selector">
              <span>{t("family.currentLabel")}</span>
              <select
                value={familyId}
                onChange={(event) => selectFamily(event.target.value)}
              >
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <LanguageSwitcher />
        </div>
      </header>
      <section className="filter-row" aria-label={t("parentHistory.filters")}>
        <button
          className={childFilter === "all" ? "active" : ""}
          onClick={() => setChildFilter("all")}
          type="button"
        >
          {t("parentHistory.allChildren")}
        </button>
        {children.map(([id, name]) => (
          <button
            className={childFilter === id ? "active" : ""}
            key={id}
            onClick={() => setChildFilter(id)}
            type="button"
          >
            {name}
          </button>
        ))}
      </section>
      {loadState === "ready" && recoverablePaperImports.length > 0 ? (
        <section
          aria-labelledby="pending-paper-imports-title"
          className="record-table paper-review-table"
        >
          <header>
            <h2 id="pending-paper-imports-title">
              {t("parentHistory.paperImportsTitle")}
            </h2>
            <p>{t("parentHistory.paperImportsDescription")}</p>
          </header>
          {recoverablePaperImports.map((item) => (
            <article key={item.id}>
              <span className="record-icon">
                {item.status === "processing" ? <Clock3 /> : <FileCheck2 />}
              </span>
              <div>
                <p>
                  {item.child_nickname} · {item.subject}
                </p>
                <h2>{item.title}</h2>
              </div>
              <span
                className={
                  item.status === "needs_review" || item.status === "failed"
                    ? "status-pill warm"
                    : "status-pill"
                }
              >
                {paperImportStatusLabel(item.status)}
              </span>
              <Link
                className="record-action"
                href={`/parent/create/?completedWorksheetId=${encodeURIComponent(
                  item.id,
                )}`}
              >
                {t("parentHistory.paperContinue")}
              </Link>
            </article>
          ))}
        </section>
      ) : null}
      {loadState === "ready" && submittedPaperImports.length > 0 ? (
        <section
          aria-labelledby="submitted-paper-imports-title"
          className="record-table paper-review-table"
        >
          <header>
            <h2 id="submitted-paper-imports-title">
              {t("parentHistory.submittedPapersTitle")}
            </h2>
            <p>{t("parentHistory.submittedPapersDescription")}</p>
          </header>
          {submittedPaperImports.map((item) => (
            <article key={item.id}>
              <span className="record-icon">
                {item.status === "grading" ? <Clock3 /> : <FileCheck2 />}
              </span>
              <div>
                <p>
                  {item.child_nickname} · {item.subject}
                </p>
                <h2>{item.title}</h2>
              </div>
              <span className="status-pill">
                {t(
                  item.status === "results_ready"
                    ? "parentHistory.paperResultsReady"
                    : "parentHistory.paperGrading",
                )}
              </span>
              {item.attempt_id ? (
                <Link
                  className="record-action"
                  href={`/parent/results/?attemptId=${encodeURIComponent(item.attempt_id)}`}
                >
                  {t("parentHistory.paperOpenResults")}
                </Link>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      <section className="record-table">
        {loadState === "loading" ? <p>{t("parentHistory.loading")}</p> : null}
        {loadState === "missing" ? (
          <p>{t("parentHistory.missing")}</p>
        ) : null}
        {loadState === "error" ? (
          <>
            <p>{t("parentHistory.error")}</p>
            <button
              className="button primary"
              onClick={retryHistory}
              type="button"
            >
              {t("history.retry")}
            </button>
          </>
        ) : null}
        {loadState === "ready" && visibleItems.length === 0 ? (
          <p>{t("parentHistory.empty")}</p>
        ) : null}
        {actionError ? <p role="alert">{actionError}</p> : null}
        {loadState === "ready"
          ? visibleItems.map((item) => (
              <article key={item.assignment_id}>
                <span className="record-icon">
                  {item.status === "grading" ? <Clock3 /> : <FileCheck2 />}
                </span>
                <div>
                  <p>
                    {item.child_nickname} ·{" "}
                    {item.submitted_at
                      ? new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(item.submitted_at))
                      : t("history.assigned")}
                  </p>
                  <h2>{item.title}</h2>
                  {item.source_material_title ? (
                    <p className="record-source">
                      {t("parentHistory.sourceMaterial", {
                        title: item.source_material_title,
                        subject: item.source_material_subject
                          ? ` · ${item.source_material_subject}`
                          : "",
                      })}
                    </p>
                  ) : null}
                  <span>
                    {["results_ready", "correcting", "completed"].includes(
                      item.status,
                    )
                      ? `${t("parentHistory.points", {
                          awarded: item.awarded_points,
                          available: item.available_points,
                        })} · `
                      : ""}
                    {t(
                      item.correction_count === 1
                        ? "history.correctionOne"
                        : "history.correctionMany",
                      { count: item.correction_count },
                    )}
                  </span>
                </div>
                <span
                  className={
                    item.correction_count > 0
                      ? "status-pill warm"
                      : "status-pill"
                  }
                >
                  {statusLabel(item.status)}
                </span>
                {item.status === "assigned" ? (
                  <button
                    className="record-action"
                    disabled={actionAssignmentId === item.assignment_id}
                    onClick={() => void updateAssignmentStatus(item, "withdraw")}
                    type="button"
                  >
                    {t("parentHistory.withdraw")}
                  </button>
                ) : null}
                {item.status === "in_progress" ? (
                  <button
                    className="record-action"
                    disabled={actionAssignmentId === item.assignment_id}
                    onClick={() => void updateAssignmentStatus(item, "stop")}
                    type="button"
                  >
                    {t("parentHistory.stop")}
                  </button>
                ) : null}
                {item.attempt_id ? (
                  <Link
                    aria-label={t("history.openResults", { title: item.title })}
                    href={`/parent/results/?attemptId=${encodeURIComponent(
                      item.attempt_id,
                    )}`}
                  >
                    <ArrowRight />
                  </Link>
                ) : null}
              </article>
            ))
          : null}
      </section>
    </>
  );
}
