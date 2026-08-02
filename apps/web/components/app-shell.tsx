"use client";

import { type ReactNode, useEffect, useState } from "react";
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
  type Language,
  useLanguage,
} from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  getActiveChildProfile,
  getChildAccessToken,
  getOwnParentLanguage,
  getParentAccessToken,
  updateOwnParentLanguage,
  updateOwnChildLanguage,
} from "@/lib/api-client";

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
  const persistLanguage = async (language: Language) => {
    if (role === "child") {
      const childToken = getChildAccessToken();
      if (childToken) {
        await updateOwnChildLanguage(language, childToken);
      }
      return;
    }
    const parentToken = await getParentAccessToken();
    if (parentToken) {
      await updateOwnParentLanguage(language, parentToken);
    }
  };

  return (
    <LanguageProvider
      onLanguageChange={persistLanguage}
      storageKey={`demo-${role}`}
    >
      <AppShellContent currentPath={currentPath} role={role}>
        {children}
      </AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({ children, role, currentPath }: AppShellProps) {
  const { syncLanguage, t } = useLanguage();
  const [childName, setChildName] = useState<string | null>(null);
  const navigation = role === "parent" ? parentNavigation : childNavigation;
  const roleLabel = t(role === "parent" ? "role.parent" : "role.child");

  useEffect(() => {
    let active = true;
    if (role === "child") {
      const profile = getActiveChildProfile();
      if (profile) {
        queueMicrotask(() => {
          if (active) {
            setChildName(profile.nickname);
          }
        });
      }
    }
    return () => {
      active = false;
    };
  }, [role]);

  useEffect(() => {
    if (role !== "parent") {
      return;
    }
    let active = true;
    void getParentAccessToken()
      .then(async (parentToken) => {
        if (!parentToken || !active) {
          return;
        }
        const hasBrowserPreference =
          window.localStorage.getItem("luma-language:demo-parent") !== null;
        if (hasBrowserPreference) {
          return;
        }
        const preference = await getOwnParentLanguage(parentToken);
        if (active) {
          syncLanguage(preference.ui_language);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [role, syncLanguage]);

  return (
    <div className={`app-frame ${role === "child" ? "child-frame" : ""}`}>
      <aside className="side-rail">
        <Brand tagline={t("brand.tagline")} />
        <nav
          aria-label={t(
            role === "parent" ? "navigation.parent" : "navigation.child",
          )}
        >
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
          <span className="avatar">
            {role === "parent"
              ? "P"
              : childName?.slice(0, 1).toUpperCase() ?? "•"}
          </span>
          <span>
            <strong>
              {role === "parent"
                ? t("identity.parent")
                : childName ?? roleLabel}
            </strong>
            <small>{roleLabel}</small>
          </span>
        </div>
        {role === "child" ? (
          <Link className="quiet-link" href="/child/exit/">
            {t("action.exitChild")}
          </Link>
        ) : null}
      </aside>
      <main className="app-main">
        {role === "child" ? (
          <div className="shell-tools">
            <LanguageSwitcher />
          </div>
        ) : null}
        {children}
      </main>
      <nav
        className="bottom-nav"
        aria-label={t("navigation.mobile", { role: roleLabel })}
      >
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
