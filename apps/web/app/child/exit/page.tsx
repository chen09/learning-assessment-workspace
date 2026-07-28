"use client";

import { Delete, LockKeyhole } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/brand";
import {
  clearChildAccessToken,
  getActiveChildProfile,
  getParentAccessToken,
  unlockFamilyManagement,
} from "@/lib/api-client";
import { clearPendingDrafts } from "@/lib/draft-queue";

export default function ExitChildModePage() {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");

  const unlock = async () => {
    const child = getActiveChildProfile();
    const parentToken = await getParentAccessToken();
    if (!child || !parentToken) {
      setStatus("error");
      return;
    }
    setStatus("working");
    try {
      await unlockFamilyManagement(child.family_id, pin, parentToken);
      await clearPendingDrafts();
      clearChildAccessToken();
      window.location.assign("/parent/");
    } catch {
      setPin("");
      setStatus("error");
    }
  };

  return (
    <main className="child-entry">
      <header>
        <Brand />
      </header>
      <section className="pin-card">
        <span className="pin-avatar">
          <LockKeyhole />
        </span>
        <p className="eyebrow">Parent check</p>
        <h1>Enter your management PIN</h1>
        <p>Child answers stay open until a parent unlocks this shared device.</p>
        <div className="pin-dots" aria-label={`${pin.length} of 6 digits entered`}>
          {Array.from({ length: 6 }, (_, index) => (
            <i className={index < pin.length ? "filled" : ""} key={index} />
          ))}
        </div>
        <div className="pin-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              disabled={pin.length === 6}
              key={digit}
              onClick={() => setPin((current) => `${current}${digit}`)}
              type="button"
            >
              {digit}
            </button>
          ))}
          <span />
          <button
            disabled={pin.length === 6}
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
        {pin.length === 6 ? (
          <button
            className="button primary large full-button"
            disabled={status === "working"}
            onClick={() => void unlock()}
            type="button"
          >
            <LockKeyhole />
            {status === "working" ? "Checking…" : "Return to parent mode"}
          </button>
        ) : null}
        {status === "error" ? (
          <p className="form-error" role="alert">
            A signed-in parent and the correct management PIN are required.
          </p>
        ) : null}
      </section>
    </main>
  );
}
