"use client";

import { type FormEvent, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AccountSettingsPage() {
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice("Local demo mode: no account change was sent.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    setNotice(error ? error.message : "Password saved. One-time links still work.");
    if (!error) {
      setPassword("");
    }
  };

  return (
    <AppShell currentPath="/parent/family/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Sign-in and language</p>
          <h1>My account</h1>
          <p className="lede">
            A password is optional. Email one-time links, Google, and LINE can
            remain available after you set one.
          </p>
        </div>
        <LanguageSwitcher />
      </header>
      <section className="settings-card account-card">
        <h2>Set or change password</h2>
        <form className="invite-form" onSubmit={updatePassword}>
          <label>
            New password
            <input
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="button primary" type="submit">Save password</button>
        </form>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        <hr />
        <h2>Connected sign-in methods</h2>
        <div className="connected-methods">
          <span>Email link <strong>Ready</strong></span>
          <span>Google <strong>Configure in Supabase</strong></span>
          <span>LINE <strong>Configure custom OIDC</strong></span>
        </div>
      </section>
    </AppShell>
  );
}
