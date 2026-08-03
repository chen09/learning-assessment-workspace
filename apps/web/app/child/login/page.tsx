"use client";

import Link from "next/link";
import { Delete, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import {
  LanguageProvider,
  useLanguage,
} from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createChildSession } from "@/lib/api-client";

export default function ChildLoginPage() {
  return (
    <LanguageProvider storageKey="demo-child">
      <ChildLoginContent />
    </LanguageProvider>
  );
}

function ChildLoginContent() {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "opening" | "error">("idle");
  const [entryLocked, setEntryLocked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const ready = pin.length === 6;

  useEffect(() => {
    let active = true;
    const getExpiredState = () =>
      new URLSearchParams(window.location.search).get("expired") === "1";
    queueMicrotask(() => {
      if (active) {
        setSessionExpired(getExpiredState());
      }
    });
    const resetForLoginNavigation = () => {
      setPin("");
      setStatus("idle");
      setEntryLocked(false);
      setSessionExpired(getExpiredState());
    };
    window.addEventListener("popstate", resetForLoginNavigation);
    return () => {
      active = false;
      window.removeEventListener("popstate", resetForLoginNavigation);
    };
  }, []);

  const getRouteIds = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      childId: params.get("childId"),
      assignmentId: params.get("assignmentId"),
      returnTo: params.get("returnTo"),
    };
  };

  const openWork = async () => {
    const { assignmentId, childId, returnTo } = getRouteIds();
    if (!childId) {
      window.location.assign("/child/");
      return;
    }
    setStatus("opening");
    try {
      await createChildSession(childId, pin);
      if (returnTo) {
        const target = new URL(returnTo, window.location.origin);
        if (
          target.origin === window.location.origin &&
          target.pathname.startsWith("/child/") &&
          target.pathname.replace(/\/+$/, "") !== "/child/login"
        ) {
          window.location.assign(
            `${target.pathname}${target.search}${target.hash}`,
          );
          return;
        }
      }
      window.location.assign(
        assignmentId
          ? `/child/work/?assignmentId=${encodeURIComponent(assignmentId)}`
          : "/child/",
      );
    } catch (error) {
      const locked =
        error instanceof Error &&
        error.message.includes("Child entry is temporarily locked.");
      setPin("");
      setEntryLocked(locked);
      setStatus("error");
    }
  };

  const updatePin = (nextPin: string) => {
    setPin(nextPin);
    setEntryLocked(false);
    setStatus("idle");
  };

  const appendPinDigit = (digit: string) => {
    setPin((current) => `${current}${digit}`);
    setEntryLocked(false);
    setStatus("idle");
  };

  return (
    <main className="child-entry">
      <header>
        <Brand tagline={t("brand.tagline")} />
        <LanguageSwitcher />
      </header>
      <section className="pin-card">
        <span className="pin-avatar">A</span>
        <p className="eyebrow">{t("childLogin.eyebrow")}</p>
        <h1>{t("childLogin.title")}</h1>
        <p>{t("childLogin.help")}</p>
        {sessionExpired ? (
          <p className="form-notice" role="status">
            {t("childLogin.expired")}
          </p>
        ) : null}
        <div
          className="pin-dots"
          aria-label={t("childLogin.digitsEntered", {
            count: pin.length,
          })}
        >
          {Array.from({ length: 6 }, (_, index) => (
            <i className={index < pin.length ? "filled" : ""} key={index} />
          ))}
        </div>
        <div className="pin-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              disabled={ready}
              key={digit}
              onClick={() => appendPinDigit(String(digit))}
              type="button"
            >
              {digit}
            </button>
          ))}
          <span />
          <button
            disabled={ready}
            onClick={() => appendPinDigit("0")}
            type="button"
          >
            0
          </button>
          <button
            aria-label={t("childLogin.deleteDigit")}
            onClick={() => updatePin(pin.slice(0, -1))}
            type="button"
          >
            <Delete />
          </button>
        </div>
        {ready ? (
          <button
            className="button primary large full-button"
            disabled={status === "opening"}
            onClick={() => void openWork()}
            type="button"
          >
            <LockKeyhole />
            {status === "opening"
              ? t("childLogin.opening")
              : t("childLogin.openWork")}
          </button>
        ) : null}
        {status === "error" ? (
          <p className="form-error" role="alert">
            {entryLocked ? t("childLogin.locked") : t("childLogin.error")}
          </p>
        ) : null}
        <Link className="quiet-link parent-return" href="/parent/">
          {t("childLogin.returnParent")}
        </Link>
      </section>
    </main>
  );
}
