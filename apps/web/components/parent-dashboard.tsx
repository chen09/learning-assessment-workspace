import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Camera,
  CircleAlert,
  Clock3,
  FilePlus2,
  Sparkles,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";

export function ParentDashboard() {
  return (
    <AppShell currentPath="/parent/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Tuesday · Family overview</p>
          <h1>Good afternoon, Maya</h1>
          <p className="lede">
            Alex has one correction ready. Emi&apos;s worksheet is being graded.
          </p>
        </div>
        <div className="header-actions">
          <LanguageSwitcher />
          <Link className="button primary" href="/parent/create/">
            <Sparkles size={17} aria-hidden="true" />
            Create practice
          </Link>
        </div>
      </header>

      <section className="attention-card" aria-labelledby="attention-heading">
        <span className="attention-icon">
          <CircleAlert aria-hidden="true" />
        </span>
        <div>
          <p className="kicker">Parent review</p>
          <h2 id="attention-heading">2 items need you</h2>
          <p>One handwritten answer is unclear and one score needs confirmation.</p>
        </div>
        <Link className="text-link" href="/parent/results/">
          Review uncertain answers
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Children</p>
          <h2>Learning today</h2>
        </div>
        <Link className="quiet-link" href="/parent/family/">
          Manage family
        </Link>
      </div>

      <section className="child-grid" aria-label="Children">
        <article className="child-card child-card-blue">
          <div className="child-card-top">
            <span className="child-avatar">A</span>
            <span className="status-pill warm">Correction ready</span>
          </div>
          <div>
            <h3>Alex</h3>
            <p>Junior high 1 · English &amp; math</p>
          </div>
          <div className="progress-row">
            <div>
              <strong>8 / 10</strong>
              <span>finished today</span>
            </div>
            <div
              className="progress-ring"
              style={{ "--progress": "80%" } as CSSProperties}
              aria-label="80 percent complete"
            >
              80%
            </div>
          </div>
          <Link href="/parent/results/">
            Open today&apos;s work <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </article>

        <article className="child-card child-card-mint">
          <div className="child-card-top">
            <span className="child-avatar">E</span>
            <span className="status-pill">Grading</span>
          </div>
          <div>
            <h3>Emi</h3>
            <p>Grade 5 · English</p>
          </div>
          <div className="progress-row">
            <div>
              <strong>Submitted</strong>
              <span>about 2 minutes ago</span>
            </div>
            <Clock3 aria-label="Grading in progress" size={32} />
          </div>
          <span className="muted-link">Results will appear when ready</span>
        </article>
      </section>

      <div className="dashboard-lower">
        <section>
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Quick start</p>
              <h2>Make the next set</h2>
            </div>
          </div>
          <div className="quick-grid">
            <Link className="quick-card coral" href="/parent/create/?mode=generate">
              <Sparkles aria-hidden="true" />
              <span>
                <strong>Ask AI</strong>
                <small>Describe what to practise</small>
              </span>
            </Link>
            <Link className="quick-card blue" href="/parent/create/?mode=import">
              <Camera aria-hidden="true" />
              <span>
                <strong>Scan material</strong>
                <small>PDF, textbook, or worksheet</small>
              </span>
            </Link>
            <Link className="quick-card sand" href="/parent/create/?mode=manual">
              <FilePlus2 aria-hidden="true" />
              <span>
                <strong>Start simple</strong>
                <small>Create a structured set</small>
              </span>
            </Link>
          </div>
        </section>

        <aside className="review-summary">
          <BookOpenCheck aria-hidden="true" />
          <p className="eyebrow">Review rhythm</p>
          <h2>6 questions due this week</h2>
          <p>
            Today stays light: three short questions, about five minutes.
          </p>
          <Link className="button secondary" href="/child/review/">
            Preview today&apos;s review
          </Link>
        </aside>
      </div>
    </AppShell>
  );
}
