"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { completeAuthCallback } from "@/lib/auth-callback";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthCallback() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      queueMicrotask(() => {
        if (active) {
          setError("Authentication is not configured for this site.");
        }
      });
      return () => {
        active = false;
      };
    }

    void completeAuthCallback(supabase, new URL(window.location.href))
      .then((nextPath) => {
        if (active) {
          window.location.replace(nextPath);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The sign-in link could not be completed.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">Secure family access</p>
          <h1>Opening your workspace.</h1>
          <p>We are confirming this one-time link with your learning account.</p>
        </div>
        <p className="auth-privacy">Student work stays private to the family.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">{error ? "Link problem" : "Signing you in"}</p>
          <h2>{error ? "This link could not be completed" : "Just a moment…"}</h2>
          <p role="status">
            {error ||
              "After the secure link is confirmed, this page will continue automatically."}
          </p>
          {error ? (
            <Link className="button primary large" href="/login/">
              Request a new sign-in link
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
