"use client";

import Link from "next/link";
import { Delete, LockKeyhole } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createChildSession } from "@/lib/api-client";

export default function ChildLoginPage() {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "opening" | "error">("idle");
  const ready = pin.length === 6;

  const getRouteIds = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      childId: params.get("childId"),
      assignmentId: params.get("assignmentId"),
    };
  };

  const openWork = async () => {
    const { assignmentId, childId } = getRouteIds();
    if (!childId) {
      window.location.assign("/child/");
      return;
    }
    setStatus("opening");
    try {
      await createChildSession(childId, pin);
      window.location.assign(
        assignmentId
          ? `/child/work/?assignmentId=${encodeURIComponent(assignmentId)}`
          : "/child/",
      );
    } catch {
      setPin("");
      setStatus("error");
    }
  };

  return (
    <main className="child-entry">
      <header>
        <Brand />
        <LanguageSwitcher />
      </header>
      <section className="pin-card">
        <span className="pin-avatar">A</span>
        <p className="eyebrow">Alex</p>
        <h1>Enter your six-digit PIN</h1>
        <p>A parent can reset this PIN from Family settings.</p>
        <div className="pin-dots" aria-label={`${pin.length} of 6 digits entered`}>
          {Array.from({ length: 6 }, (_, index) => (
            <i className={index < pin.length ? "filled" : ""} key={index} />
          ))}
        </div>
        <div className="pin-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              disabled={ready}
              key={digit}
              onClick={() => setPin((current) => `${current}${digit}`)}
              type="button"
            >
              {digit}
            </button>
          ))}
          <span />
          <button
            disabled={ready}
            onClick={() => setPin((current) => `${current}0`)}
            type="button"
          >
            0
          </button>
          <button
            aria-label="Delete last digit"
            onClick={() => setPin((current) => current.slice(0, -1))}
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
            {status === "opening" ? "Opening…" : "Open my work"}
          </button>
        ) : null}
        {status === "error" ? (
          <p className="form-error" role="alert">
            That PIN did not work. Please try again.
          </p>
        ) : null}
        <Link className="quiet-link parent-return" href="/parent/">
          Return to parent mode
        </Link>
      </section>
    </main>
  );
}
