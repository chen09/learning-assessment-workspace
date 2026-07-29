"use client";

import Link from "next/link";
import { KeyRound, LineChart, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "otp" | "password" | "forgot";

function getCallbackUrl(nextPath: string) {
  const callbackUrl = new URL("/auth/callback/", window.location.origin);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}

export function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const supabase = getSupabaseBrowserClient();

  const finish = (message: string) => {
    setNotice(message);
    setBusy(false);
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      finish("Local demo mode: add the public Supabase settings to enable sign-in.");
      return;
    }
    setBusy(true);
    setNotice("");

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getCallbackUrl("/parent/account/"),
      });
      finish(error ? error.message : "Password reset instructions sent.");
      return;
    }

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error) {
        window.location.assign("/parent/family/");
      }
      finish(error ? error.message : "Signed in.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getCallbackUrl("/parent/family/"),
        shouldCreateUser: true,
      },
    });
    finish(error ? error.message : "Check your email for the secure sign-in link.");
  };

  const signInWithProvider = async (provider: "google" | `custom:${string}`) => {
    if (!supabase) {
      setNotice("Local demo mode: authentication is not connected yet.");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getCallbackUrl("/parent/family/") },
    });
    if (error) {
      setNotice(error.message);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">One family, one learning space</p>
          <h1>Stay close to their work.</h1>
          <p>
            Create, print, answer, photograph, review, and return to the right
            questions at the right time.
          </p>
        </div>
        <p className="auth-privacy">Student work stays private to the family.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-top">
          <span className="auth-mobile-brand">
            <Brand />
          </span>
          <Link className="quiet-link" href="/">
            Back
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="auth-card">
          <p className="eyebrow">Parent sign in</p>
          <h2>
            {mode === "forgot"
              ? "Reset your password"
              : "Welcome to your family workspace"}
          </h2>
          <p>
            {mode === "otp"
              ? "We will email a one-time link. No password needed."
              : mode === "password"
                ? "Use the password you set for this account."
                : "We will send a secure reset link to your email."}
          </p>
          <form className="auth-form" onSubmit={submitEmail}>
            <label>
              Email
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            {mode === "password" ? (
              <label>
                Password
                <input
                  autoComplete="current-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            ) : null}
            <button className="button primary large" disabled={busy} type="submit">
              {mode === "password" ? (
                <KeyRound size={17} />
              ) : (
                <Mail size={17} />
              )}
              {busy
                ? "Please wait…"
                : mode === "otp"
                  ? "Email me a sign-in link"
                  : mode === "password"
                    ? "Sign in"
                    : "Send reset link"}
            </button>
          </form>
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="auth-mode-row">
            <button
              aria-pressed={mode === "otp"}
              className={mode === "otp" ? "active" : undefined}
              onClick={() => setMode("otp")}
              type="button"
            >
              One-time link
            </button>
            <button
              aria-pressed={mode === "password"}
              className={mode === "password" ? "active" : undefined}
              onClick={() => setMode("password")}
              type="button"
            >
              Password
            </button>
            <button
              aria-pressed={mode === "forgot"}
              className={mode === "forgot" ? "active" : undefined}
              onClick={() => setMode("forgot")}
              type="button"
            >
              Forgot password
            </button>
          </div>
          <div className="auth-divider">
            <span>or</span>
          </div>
          <div className="provider-grid">
            <button
              className="button ghost"
              onClick={() => void signInWithProvider("google")}
              type="button"
            >
              <span className="provider-mark">G</span> Google
            </button>
            <button
              className="button ghost"
              onClick={() => void signInWithProvider("custom:line")}
              type="button"
            >
              <LineChart size={17} aria-hidden="true" /> LINE
            </button>
          </div>
          {!supabase ? (
            <Link className="demo-entry" href="/parent/">
              Continue with the local family demo
            </Link>
          ) : null}
          <p className="auth-child-note">
            Children join from the family screen with their six-digit PIN.
          </p>
        </div>
      </section>
    </main>
  );
}
