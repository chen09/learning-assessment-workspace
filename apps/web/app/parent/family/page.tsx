"use client";

import { MailPlus, Shield, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  type Language,
  useLanguage,
} from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  type ChildProfile,
  acceptFamilyInvitation,
  createChild,
  createFamily,
  createFamilyInvitation,
  type Family,
  getChildren,
  getFamilies,
  getManagementPinStatus,
  getPendingInvitations,
  type PendingInvitation,
  getParentAccessToken,
  setManagementPin,
  unlockFamilyManagement,
  updateChildLanguage,
  updateChildPin,
} from "@/lib/api-client";

const languageLocales: Record<Language, string> = {
  en: "en",
  ja: "ja-JP",
  zh: "zh-CN",
};

const childLanguageOptions = [
  { value: "zh", labelKey: "language.option.zh" },
  { value: "ja", labelKey: "language.option.ja" },
  { value: "en", labelKey: "language.option.en" },
] as const;

export default function FamilySettingsPage() {
  return (
    <AppShell currentPath="/parent/family/" role="parent">
      <FamilySettingsContent />
    </AppShell>
  );
}

function FamilySettingsContent() {
  const { language, t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<
    PendingInvitation[]
  >([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newChild, setNewChild] = useState({
    nickname: "",
    grade_stage: "",
    pin: "",
    ui_language: language,
  });
  const [pinEditor, setPinEditor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const [managementPin, setManagementPinValue] = useState("");
  const [managementUnlock, setManagementUnlock] = useState<string | null>(null);
  const [managementPinConfigured, setManagementPinConfigured] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadRequest, setLoadRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadFamilyWorkspace = async () => {
      try {
        const parentToken = await getParentAccessToken();
        if (!parentToken) {
          window.location.replace("/login/");
          return;
        }
        const loadedFamilies = await getFamilies(parentToken);
        const invitations = await getPendingInvitations(parentToken);
        const requestedFamily = new URLSearchParams(window.location.search).get(
          "familyId",
        );
        const selected =
          loadedFamilies.find((family) => family.id === requestedFamily) ??
          loadedFamilies[0];
        const loadedChildren = selected
          ? await getChildren(selected.id, parentToken)
          : [];
        const pinStatus = selected
          ? await getManagementPinStatus(selected.id, parentToken)
          : { configured: false };
        if (cancelled) {
          return;
        }
        setToken(parentToken);
        setFamilies(loadedFamilies);
        setPendingInvitations(invitations);
        setFamilyId(selected?.id ?? null);
        setChildren(loadedChildren);
        setManagementPinConfigured(pinStatus.configured);
        setLoadState("ready");
      } catch {
        if (cancelled) {
          return;
        }
        setToken(null);
        setFamilies([]);
        setPendingInvitations([]);
        setFamilyId(null);
        setChildren([]);
        setManagementPinConfigured(false);
        setLoadState("error");
      }
    };

    void loadFamilyWorkspace();
    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  const retryLoadingFamilyWorkspace = () => {
    setLoadState("loading");
    setLoadRequest((current) => current + 1);
  };

  const selectFamily = async (nextFamilyId: string) => {
    const previousFamilyId = familyId;
    setFamilyId(nextFamilyId);
    setChildren([]);
    setManagementUnlock(null);
    setManagementPinValue("");
    setManagementPinConfigured(false);
    if (token) {
      setStatus("working");
      try {
        const nextChildren = await getChildren(nextFamilyId, token);
        const pinStatus = await getManagementPinStatus(nextFamilyId, token);
        setChildren(nextChildren);
        setManagementPinConfigured(pinStatus.configured);
        setStatus("idle");
      } catch {
        setFamilyId(previousFamilyId);
        setChildren([]);
        setManagementPinConfigured(false);
        setStatus("error");
      }
    }
  };

  const addFamily = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !newFamilyName.trim()) {
      return;
    }
    setStatus("working");
    try {
      const family = await createFamily(
        newFamilyName,
        token,
        `family-${crypto.randomUUID()}`,
      );
      setFamilies((current) => [...current, family]);
      setFamilyId(family.id);
      setChildren([]);
      setNewFamilyName("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const addChild = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !familyId) {
      return;
    }
    setStatus("working");
    try {
      const child = await createChild(
        familyId,
        newChild,
        token,
        `child-${crypto.randomUUID()}`,
      );
      setChildren((current) => [...current, child]);
      setNewChild({
        nickname: "",
        grade_stage: "",
        pin: "",
        ui_language: language,
      });
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (token && familyId) {
      setStatus("working");
      try {
        await createFamilyInvitation(
          familyId,
          inviteEmail,
          token,
          `invite-${familyId}-${inviteEmail.toLowerCase()}`,
        );
      } catch {
        setStatus("error");
        return;
      }
    }
    setInviteSent(true);
    setStatus("idle");
  };

  const savePin = async (childId: string) => {
    if (!token || newPin.length !== 6 || !managementUnlock) {
      return;
    }
    setStatus("working");
    try {
      await updateChildPin(childId, newPin, token, managementUnlock);
      setPinEditor(null);
      setNewPin("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const saveChildLanguage = async (
    childId: string,
    uiLanguage: Language,
  ) => {
    if (!token) {
      return;
    }
    setStatus("working");
    try {
      const updated = await updateChildLanguage(
        childId,
        uiLanguage,
        token,
      );
      setChildren((current) =>
        current.map((child) => (child.id === childId ? updated : child)),
      );
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const configureManagementPin = async () => {
    if (!token || !familyId || managementPin.length !== 6) {
      return;
    }
    setStatus("working");
    try {
      await setManagementPin(familyId, managementPin, token);
      const unlocked = await unlockFamilyManagement(
        familyId,
        managementPin,
        token,
      );
      setManagementUnlock(unlocked.access_token);
      setManagementPinConfigured(true);
      setManagementPinValue("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const unlockManagement = async () => {
    if (!token || !familyId || managementPin.length !== 6) {
      return;
    }
    setStatus("working");
    try {
      const unlocked = await unlockFamilyManagement(
        familyId,
        managementPin,
        token,
      );
      setManagementUnlock(unlocked.access_token);
      setManagementPinValue("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const selectedFamily = families.find((family) => family.id === familyId);

  const acceptInvitation = async (invitation: PendingInvitation) => {
    if (!token) {
      return;
    }
    setStatus("working");
    try {
      const family = await acceptFamilyInvitation(invitation.id, token);
      setFamilies((current) =>
        current.some((item) => item.id === family.id)
          ? current
          : [...current, family],
      );
      setPendingInvitations((current) =>
        current.filter((item) => item.id !== invitation.id),
      );
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("family.eyebrow")}</p>
          <h1>
            {selectedFamily?.name ??
              (token ? t("family.createTitle") : t("family.loadingTitle"))}
          </h1>
          <p className="lede">{t("family.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {loadState === "error" ? (
        <section className="continue-card">
          <div className="continue-copy" role="alert">
            <p className="form-error">{t("family.loadError")}</p>
            <button
              className="button primary"
              onClick={retryLoadingFamilyWorkspace}
              type="button"
            >
              {t("history.retry")}
            </button>
          </div>
        </section>
      ) : (
        <>
          {token ? (
            <>
          <section
            className="filter-row"
            aria-label={t("family.switcherLabel")}
          >
            <select
              aria-label={t("family.currentLabel")}
              onChange={(event) => void selectFamily(event.target.value)}
              value={familyId ?? ""}
            >
              <option value="">{t("family.choose")}</option>
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
            <form onSubmit={addFamily}>
              <input
                aria-label={t("family.newNameLabel")}
                onChange={(event) => setNewFamilyName(event.target.value)}
                placeholder={t("family.newNamePlaceholder")}
                value={newFamilyName}
              />
              <button className="button ghost" type="submit">
                {t("family.add")}
              </button>
            </form>
          </section>
          {pendingInvitations.map((invitation) => (
            <section className="invite-ready" key={invitation.id}>
              <Shield />
              <span>
                {t("family.invitation", {
                  email: invitation.email,
                  date: new Intl.DateTimeFormat(
                    languageLocales[language],
                  ).format(new Date(invitation.expires_at)),
                })}
              </span>
              <button
                className="button primary"
                onClick={() => void acceptInvitation(invitation)}
                type="button"
              >
                {t("family.accept")}
              </button>
            </section>
          ))}
            </>
          ) : null}

          <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-heading">
            <UserRoundPlus />
            <div>
              <p className="eyebrow">{t("family.children")}</p>
              <h2>{t("family.profilesPin")}</h2>
            </div>
          </div>
          {token && familyId ? (
            <div className="invite-form">
              <label>
                {t("family.managementPin")}
                <input
                  aria-label={t("family.managementPin")}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setManagementPinValue(
                      event.target.value.replace(/\D/g, ""),
                    )
                  }
                  placeholder={t("family.sixDigits")}
                  value={managementPin}
                />
              </label>
              <button
                className="button ghost"
                disabled={managementPin.length !== 6}
                onClick={() =>
                  void (managementPinConfigured
                    ? unlockManagement()
                    : configureManagementPin())
                }
                type="button"
              >
                {managementUnlock
                  ? t("family.managementUnlocked")
                  : managementPinConfigured
                    ? t("family.unlockPin")
                    : t("family.setManagementPin")}
              </button>
              <p className="settings-note">
                {t("family.managementNote")}
              </p>
            </div>
          ) : null}
          {children.map((child) => (
            <article className="member-row" key={child.id}>
              <span className="child-avatar">
                {child.nickname.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{child.nickname}</strong>
                <small>
                  {child.grade_stage} ·{" "}
                  {t("family.uiLanguage", {
                    language: child.ui_language.toUpperCase(),
                  })}
                </small>
                <label className="member-language-control">
                  <span className="sr-only">
                    {t("family.languageFor", { name: child.nickname })}
                  </span>
                  <select
                    aria-label={t("family.languageFor", {
                      name: child.nickname,
                    })}
                    disabled={status === "working"}
                    onChange={(event) =>
                      void saveChildLanguage(
                        child.id,
                        event.target.value as Language,
                      )
                    }
                    value={child.ui_language}
                  >
                    {childLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {familyId ? (
                <div>
                  <Link
                    className="quiet-link"
                    href={`/parent/create/?familyId=${encodeURIComponent(familyId)}&childId=${encodeURIComponent(child.id)}`}
                  >
                    {t("family.createPractice")}
                  </Link>
                  <Link
                    className="quiet-link"
                    href={`/child/login/?childId=${encodeURIComponent(child.id)}`}
                  >
                    {t("family.childSignIn")}
                  </Link>
                </div>
              ) : null}
              {pinEditor === child.id ? (
                <div>
                  <input
                    aria-label={t("family.newPinFor", {
                      name: child.nickname,
                    })}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setNewPin(event.target.value.replace(/\D/g, ""))
                    }
                    placeholder={t("family.pinPlaceholder")}
                    value={newPin}
                  />
                  <button
                    className="button ghost"
                    disabled={newPin.length !== 6 || !managementUnlock}
                    onClick={() => void savePin(child.id)}
                    type="button"
                  >
                    {t("family.savePin")}
                  </button>
                </div>
              ) : (
                <button
                  className="button ghost"
                  disabled={!managementUnlock}
                  onClick={() => setPinEditor(child.id)}
                  type="button"
                >
                  {t("family.managePin")}
                </button>
              )}
            </article>
          ))}
          {token && familyId ? (
            <form className="invite-form" onSubmit={addChild}>
              <label>
                {t("family.childName")}
                <input
                  onChange={(event) =>
                    setNewChild((current) => ({
                      ...current,
                      nickname: event.target.value,
                    }))
                  }
                  required
                  value={newChild.nickname}
                />
              </label>
              <label>
                {t("family.grade")}
                <input
                  onChange={(event) =>
                    setNewChild((current) => ({
                      ...current,
                      grade_stage: event.target.value,
                    }))
                  }
                  required
                  value={newChild.grade_stage}
                />
              </label>
              <label>
                {t("family.sixDigitPin")}
                <input
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setNewChild((current) => ({
                      ...current,
                      pin: event.target.value.replace(/\D/g, ""),
                    }))
                  }
                  pattern="\d{6}"
                  required
                  value={newChild.pin}
                />
              </label>
              <label>
                {t("family.childUiLanguage")}
                <select
                  aria-label={t("family.childUiLanguage")}
                  onChange={(event) =>
                    setNewChild((current) => ({
                      ...current,
                      ui_language: event.target.value as Language,
                    }))
                  }
                  value={newChild.ui_language}
                >
                  {childLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button ghost full-button" type="submit">
                {t("family.addChild")}
              </button>
            </form>
          ) : null}
        </section>

        <section className="settings-card">
          <div className="settings-heading">
            <MailPlus />
            <div>
              <p className="eyebrow">{t("family.parents")}</p>
              <h2>{t("family.inviteParent")}</h2>
            </div>
          </div>
          <p className="settings-note">{t("family.inviteNote")}</p>
          <form className="invite-form" onSubmit={invite}>
            <label>
              {t("family.parentEmail")}
              <input
                onChange={(event) => {
                  setInviteEmail(event.target.value);
                  setInviteSent(false);
                }}
                required
                type="email"
                value={inviteEmail}
              />
            </label>
            <button
              className="button primary"
              disabled={status === "working"}
              type="submit"
            >
              {t("family.createInvite")}
            </button>
          </form>
          {inviteSent ? (
            <div className="invite-ready" role="status">
              <Shield />
              <span>{t("family.inviteCreated", { email: inviteEmail })}</span>
            </div>
          ) : null}
        </section>
          </div>
          {status === "error" ? (
            <p className="form-error" role="alert">
              {t("family.saveError")}
            </p>
          ) : null}
          <Link className="button ghost account-link" href="/parent/account/">
            {t("family.accountSettings")}
          </Link>
        </>
      )}
    </>
  );
}
