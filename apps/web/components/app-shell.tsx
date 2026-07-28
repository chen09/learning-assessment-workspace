"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  History,
  House,
  LibraryBig,
  Settings,
  Sparkles,
} from "lucide-react";

import { Brand } from "@/components/brand";
import {
  LanguageProvider,
  useLanguage,
} from "@/components/language-provider";

const parentNavigation = [
  { href: "/parent/", labelKey: "nav.home", icon: House },
  { href: "/parent/create/", labelKey: "nav.create", icon: Sparkles },
  { href: "/parent/history/", labelKey: "nav.history", icon: History },
  { href: "/parent/library/", labelKey: "nav.library", icon: LibraryBig },
  { href: "/parent/family/", labelKey: "nav.family", icon: Settings },
] as const;

const childNavigation = [
  { href: "/child/", labelKey: "nav.home", icon: House },
  { href: "/child/work/", labelKey: "nav.work", icon: BookOpen },
  { href: "/child/review/", labelKey: "nav.review", icon: Sparkles },
  { href: "/child/history/", labelKey: "nav.history", icon: History },
] as const;

type AppShellProps = {
  children: ReactNode;
  role: "parent" | "child";
  currentPath: string;
};

export function AppShell({ children, role, currentPath }: AppShellProps) {
  return (
    <LanguageProvider storageKey={`demo-${role}`}>
      <AppShellContent currentPath={currentPath} role={role}>
        {children}
      </AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({ children, role, currentPath }: AppShellProps) {
  const { t } = useLanguage();
  const navigation = role === "parent" ? parentNavigation : childNavigation;

  return (
    <div className={`app-frame ${role === "child" ? "child-frame" : ""}`}>
      <aside className="side-rail">
        <Brand />
        <nav aria-label={`${role} navigation`}>
          {navigation.map(({ href, labelKey, icon: Icon }) => (
            <Link
              className={currentPath === href ? "nav-link active" : "nav-link"}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={2.2} />
              <span>{t(labelKey)}</span>
            </Link>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="avatar">{role === "parent" ? "M" : "A"}</span>
          <span>
            <strong>{role === "parent" ? "Maya" : "Alex"}</strong>
            <small>
              {t(role === "parent" ? "role.parent" : "role.child")}
            </small>
          </span>
        </div>
        {role === "child" ? (
          <Link className="quiet-link" href="/child/exit/">
            Exit child mode
          </Link>
        ) : null}
      </aside>
      <main className="app-main">{children}</main>
      <nav className="bottom-nav" aria-label={`${role} mobile navigation`}>
        {navigation.slice(0, 4).map(({ href, labelKey, icon: Icon }) => (
          <Link
            className={currentPath === href ? "active" : ""}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
