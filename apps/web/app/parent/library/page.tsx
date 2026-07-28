import { BookCopy, CheckCircle2, Clock3, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LibraryPage() {
  return (
    <AppShell currentPath="/parent/library/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Question library</p>
          <h1>Reuse what works</h1>
          <p className="lede">
            Your family library is private. Submitted community sets enter a
            review queue before anyone else can use them.
          </p>
        </div>
        <LanguageSwitcher />
      </header>
      <label className="library-search">
        <Search />
        <input aria-label="Search question library" placeholder="Topic, level, or exam…" />
      </label>
      <section className="library-grid">
        <article className="library-card">
          <span className="library-icon"><BookCopy /></span>
          <p className="eyebrow">Family · English</p>
          <h2>Present simple from Lesson 1</h2>
          <p>12 questions · three difficulty levels · typing or handwriting</p>
          <span className="status-pill">Ready to use</span>
        </article>
        <article className="library-card">
          <span className="library-icon"><Clock3 /></span>
          <p className="eyebrow">Submitted · Mathematics</p>
          <h2>Difference of squares, visual proofs</h2>
          <p>8 questions · standard and challenge · handwriting</p>
          <span className="status-pill warm">Awaiting review</span>
        </article>
        <article className="library-card">
          <span className="library-icon"><CheckCircle2 /></span>
          <p className="eyebrow">Community · EIKEN</p>
          <h2>EIKEN Grade 3 listening warm-up</h2>
          <p>10 questions · audio replay rules included</p>
          <span className="status-pill">Reviewed</span>
        </article>
      </section>
    </AppShell>
  );
}
