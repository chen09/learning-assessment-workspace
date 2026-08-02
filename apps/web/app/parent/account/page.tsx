"use client";

import { type FormEvent, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AccountSettingsPage() {
  return (
    <AppShell currentPath="/parent/family/" role="parent">
      <AccountSettingsContent />
    </AppShell>
  );
}

function AccountSettingsContent() {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice(t("account.demoNotice"));
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    setNotice(error ? error.message : t("account.passwordSaved"));
    if (!error) {
      setPassword("");
    }
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("account.eyebrow")}</p>
          <h1>{t("account.title")}</h1>
          <p className="lede">{t("account.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>
      <section className="settings-card account-card">
        <h2>{t("account.passwordTitle")}</h2>
        <form className="invite-form" onSubmit={updatePassword}>
          <label>
            {t("account.newPassword")}
            <input
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="button primary" type="submit">
            {t("account.savePassword")}
          </button>
        </form>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        <hr />
        <h2>{t("account.methodsTitle")}</h2>
        <div className="connected-methods">
          <span>
            {t("account.emailLink")} <strong>{t("account.ready")}</strong>
          </span>
          <span>
            Google <strong>{t("account.configureSupabase")}</strong>
          </span>
          <span>
            LINE <strong>{t("account.configureOidc")}</strong>
          </span>
        </div>
      </section>
    </>
  );
}
