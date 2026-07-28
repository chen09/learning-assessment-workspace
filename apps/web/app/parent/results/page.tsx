"use client";

import { Check, CircleHelp, PenLine, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function ParentResultsPage() {
  const [decision, setDecision] = useState<"correct" | "incorrect" | null>(null);

  return (
    <AppShell currentPath="/parent/history/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Alex · submitted today</p>
          <h1>Review results</h1>
          <p className="lede">
            Only uncertain answers and items that need a parent are shown here.
            Your decision overrides the automated result.
          </p>
        </div>
        <LanguageSwitcher />
      </header>
      <section className="review-result-grid">
        <article className="parent-review-card">
          <header>
            <span><CircleHelp /></span>
            <div>
              <p>Question 3 · Handwriting</p>
              <h2>Does this show the difference of squares correctly?</h2>
            </div>
          </header>
          <div className="handwriting-preview" aria-label="Handwritten response preview">
            <p>(a + b)(a − b)</p>
            <p>= a² − ab + ab − b²</p>
            <p>= a² − b²</p>
          </div>
          <div className="ai-observation">
            <PenLine />
            <p>
              The final answer appears correct. One middle sign was hard to
              read, so this was not marked wrong.
            </p>
          </div>
          {decision ? (
            <div className="confirmed-message" role="status">
              <ShieldCheck />
              Parent marked this {decision}.
            </div>
          ) : (
            <div className="decision-row">
              <button
                className="button primary"
                onClick={() => setDecision("correct")}
                type="button"
              >
                <Check /> Mark correct
              </button>
              <button
                className="button ghost"
                onClick={() => setDecision("incorrect")}
                type="button"
              >
                Needs correction
              </button>
            </div>
          )}
        </article>
        <aside className="result-context">
          <p className="eyebrow">Whole set</p>
          <h2>6 / 8 points</h2>
          <dl>
            <div><dt>Correct</dt><dd>1</dd></div>
            <div><dt>Correction</dt><dd>1</dd></div>
            <div><dt>Parent review</dt><dd>{decision ? 0 : 1}</dd></div>
          </dl>
          <p>
            Results were released only after every question finished grading.
          </p>
        </aside>
      </section>
    </AppShell>
  );
}
