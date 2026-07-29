import Link from "next/link";
import { ArrowRight, ShieldCheck, UsersRound } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";

export function ParentDashboard() {
  return (
    <AppShell currentPath="/parent/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Parent workspace</p>
          <h1>Set up your family workspace</h1>
          <p className="lede">
            Add your family and children before creating their first practice
            set.
          </p>
        </div>
        <LanguageSwitcher />
      </header>

      <section className="attention-card" aria-labelledby="attention-heading">
        <span className="attention-icon">
          <UsersRound aria-hidden="true" />
        </span>
        <div>
          <p className="kicker">First step</p>
          <h2 id="attention-heading">Create or join a family</h2>
          <p>
            Family setup keeps each child&apos;s assignments, photos, results,
            and review schedule separate.
          </p>
        </div>
        <Link className="text-link" href="/parent/family/">
          Open family setup
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="settings-card">
        <ShieldCheck aria-hidden="true" />
        <p className="eyebrow">Private by default</p>
        <h2>Your account is ready</h2>
        <p>
          Nothing from the sample family is attached to your account. Your
          workspace starts empty and only shows the people you add or join.
        </p>
        <Link className="button primary" href="/parent/family/">
          Continue to family setup
        </Link>
      </section>
    </AppShell>
  );
}
