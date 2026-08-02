"use client";

import Link from "next/link";
import { KeyRound, LineChart, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Brand } from "@/components/brand";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "otp" | "password" | "forgot";

function getCallbackUrl(nextPath: string) {
  const callbackUrl = new URL("/auth/callback/", window.location.origin);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}

export function AuthPanel() {
  const { t } = useLanguage();
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
      finish(t("auth.localSettingsRequired"));
      return;
    }
    setBusy(true);
    setNotice("");

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getCallbackUrl("/parent/account/"),
      });
      finish(error ? error.message : t("auth.resetSent"));
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
      finish(error ? error.message : t("auth.signedIn"));
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getCallbackUrl("/parent/family/"),
        shouldCreateUser: true,
      },
    });
    finish(error ? error.message : t("auth.otpSent"));
  };

  const signInWithProvider = async (provider: "google" | `custom:${string}`) => {
    if (!supabase) {
      setNotice(t("auth.localNotConnected"));
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
          <p className="eyebrow">{t("auth.storyEyebrow")}</p>
          <h1>{t("auth.storyTitle")}</h1>
          <p>{t("auth.storyDescription")}</p>
        </div>
        <p className="auth-privacy">{t("auth.privacy")}</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-top">
          <span className="auth-mobile-brand">
            <Brand />
          </span>
          <Link className="quiet-link" href="/">
            {t("auth.back")}
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="auth-card">
          <p className="eyebrow">{t("auth.parentSignIn")}</p>
          <h2>
            {mode === "forgot"
              ? t("auth.resetTitle")
              : t("auth.welcomeTitle")}
          </h2>
          <p>
            {mode === "otp"
              ? t("auth.otpDescription")
              : mode === "password"
                ? t("auth.passwordDescription")
                : t("auth.forgotDescription")}
          </p>
          <form className="auth-form" onSubmit={submitEmail}>
            <label>
              {t("auth.email")}
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
                {t("auth.password")}
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
                ? t("auth.pleaseWait")
                : mode === "otp"
                  ? t("auth.sendSignInLink")
                  : mode === "password"
                    ? t("auth.signIn")
                    : t("auth.sendResetLink")}
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
              {t("auth.oneTimeLink")}
            </button>
            <button
              aria-pressed={mode === "password"}
              className={mode === "password" ? "active" : undefined}
              onClick={() => setMode("password")}
              type="button"
            >
              {t("auth.passwordMode")}
            </button>
            <button
              aria-pressed={mode === "forgot"}
              className={mode === "forgot" ? "active" : undefined}
              onClick={() => setMode("forgot")}
              type="button"
            >
              {t("auth.forgotPassword")}
            </button>
          </div>
          <div className="auth-divider">
            <span>{t("auth.or")}</span>
          </div>
          <div className="provider-grid">
            <button
              className="button ghost"
              onClick={() => void signInWithProvider("google")}
              type="button"
            >
              <span className="provider-mark">G</span> {t("auth.google")}
            </button>
            <button
              className="button ghost"
              onClick={() => void signInWithProvider("custom:line")}
              type="button"
            >
              <LineChart size={17} aria-hidden="true" /> {t("auth.line")}
            </button>
          </div>
          {!supabase ? (
            <Link className="demo-entry" href="/parent/">
              {t("auth.localDemo")}
            </Link>
          ) : null}
          <p className="auth-child-note">
            {t("auth.childNote")}
          </p>
        </div>
      </section>
    </main>
  );
}
