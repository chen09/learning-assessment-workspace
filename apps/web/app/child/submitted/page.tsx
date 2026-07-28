"use client";

import { Check, Clock3 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { AppShell } from "@/components/app-shell";

const subscribeToHydration = () => () => undefined;

export default function SubmittedPage() {
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
    <AppShell currentPath="/child/work/" role="child">
      <section className="submitted-card">
        <span className="submitted-check">
          <Check size={34} aria-hidden="true" />
        </span>
        <p className="eyebrow">All handed in</p>
        <h1>Your work is being checked</h1>
        <p>
          You finished the whole set. Results appear together when every answer
          is ready.
        </p>
        <div className="grading-line">
          <Clock3 size={18} aria-hidden="true" />
          Usually a few minutes
        </div>
        <button
          aria-busy={!hydrated}
          className="button primary"
          disabled={!hydrated}
          onClick={openResults}
          type="button"
        >
          {hydrated ? "View results" : "Preparing results…"}
        </button>
      </section>
    </AppShell>
  );
}
