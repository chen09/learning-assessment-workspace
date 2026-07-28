"use client";

import { MailPlus, Shield, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
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
  updateChildPin,
} from "@/lib/api-client";

const demoChildren: ChildProfile[] = [
  {
    id: "alex",
    family_id: "demo",
    nickname: "Alex",
    grade_stage: "Junior high 1",
    ui_language: "en",
  },
  {
    id: "emi",
    family_id: "demo",
    nickname: "Emi",
    grade_stage: "Grade 5",
    ui_language: "ja",
  },
];

export default function FamilySettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<
    PendingInvitation[]
  >([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>(demoChildren);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newChild, setNewChild] = useState({
    nickname: "",
    grade_stage: "",
    pin: "",
    ui_language: "en" as "zh" | "ja" | "en",
  });
  const [pinEditor, setPinEditor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const [managementPin, setManagementPinValue] = useState("");
  const [managementUnlock, setManagementUnlock] = useState<string | null>(null);
  const [managementPinConfigured, setManagementPinConfigured] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");

  useEffect(() => {
    void getParentAccessToken().then(async (parentToken) => {
      if (!parentToken) {
        return;
      }
      const loadedFamilies = await getFamilies(parentToken);
      setPendingInvitations(await getPendingInvitations(parentToken));
      setToken(parentToken);
      setFamilies(loadedFamilies);
      const requestedFamily = new URLSearchParams(window.location.search).get(
        "familyId",
      );
      const selected =
        loadedFamilies.find((family) => family.id === requestedFamily) ??
        loadedFamilies[0];
      if (selected) {
        setFamilyId(selected.id);
        setChildren(await getChildren(selected.id, parentToken));
        const pinStatus = await getManagementPinStatus(
          selected.id,
          parentToken,
        );
        setManagementPinConfigured(pinStatus.configured);
      } else {
        setChildren([]);
      }
    });
  }, []);

  const selectFamily = async (nextFamilyId: string) => {
    setFamilyId(nextFamilyId);
    setManagementUnlock(null);
    setManagementPinValue("");
    setManagementPinConfigured(false);
    if (token) {
      setChildren(await getChildren(nextFamilyId, token));
      const pinStatus = await getManagementPinStatus(nextFamilyId, token);
      setManagementPinConfigured(pinStatus.configured);
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
        ui_language: "en",
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
    <AppShell currentPath="/parent/family/" role="parent">
      <header className="page-header">
        <div>
          <p className="eyebrow">Family workspace</p>
          <h1>{selectedFamily?.name ?? "Maya's family"}</h1>
          <p className="lede">
            Parents share one family. Each member keeps an independent language
            preference.
          </p>
        </div>
        <LanguageSwitcher />
      </header>

      {token ? (
        <>
          <section className="filter-row" aria-label="Family switcher">
            <select
              aria-label="Current family"
              onChange={(event) => void selectFamily(event.target.value)}
              value={familyId ?? ""}
            >
              <option value="">Choose a family</option>
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
            <form onSubmit={addFamily}>
              <input
                aria-label="New family name"
                onChange={(event) => setNewFamilyName(event.target.value)}
                placeholder="New family name"
                value={newFamilyName}
              />
              <button className="button ghost" type="submit">
                Add family
              </button>
            </form>
          </section>
          {pendingInvitations.map((invitation) => (
            <section className="invite-ready" key={invitation.id}>
              <Shield />
              <span>
                A family invitation for {invitation.email} expires{" "}
                {new Intl.DateTimeFormat().format(
                  new Date(invitation.expires_at),
                )}
                .
              </span>
              <button
                className="button primary"
                onClick={() => void acceptInvitation(invitation)}
                type="button"
              >
                Accept
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
              <p className="eyebrow">Children</p>
              <h2>Profiles and PIN</h2>
            </div>
          </div>
          {token && familyId ? (
            <div className="invite-form">
              <label>
                Parent management PIN
                <input
                  aria-label="Parent management PIN"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setManagementPinValue(
                      event.target.value.replace(/\D/g, ""),
                    )
                  }
                  placeholder="6 digits"
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
                  ? "Management unlocked for 10 minutes"
                  : managementPinConfigured
                    ? "Unlock PIN controls"
                    : "Set management PIN"}
              </button>
              <p className="settings-note">
                A short management unlock is required before a child PIN can be
                changed.
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
                  {child.grade_stage} · {child.ui_language.toUpperCase()} UI
                </small>
              </div>
              {familyId ? (
                <div>
                  <Link
                    className="quiet-link"
                    href={`/parent/create/?familyId=${encodeURIComponent(familyId)}&childId=${encodeURIComponent(child.id)}`}
                  >
                    Create practice
                  </Link>
                  <Link
                    className="quiet-link"
                    href={`/child/login/?childId=${encodeURIComponent(child.id)}`}
                  >
                    Child sign in
                  </Link>
                </div>
              ) : null}
              {pinEditor === child.id ? (
                <div>
                  <input
                    aria-label={`New PIN for ${child.nickname}`}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setNewPin(event.target.value.replace(/\D/g, ""))
                    }
                    placeholder="6-digit PIN"
                    value={newPin}
                  />
                  <button
                    className="button ghost"
                    disabled={newPin.length !== 6 || !managementUnlock}
                    onClick={() => void savePin(child.id)}
                    type="button"
                  >
                    Save PIN
                  </button>
                </div>
              ) : (
                <button
                  className="button ghost"
                  disabled={!managementUnlock}
                  onClick={() => setPinEditor(child.id)}
                  type="button"
                >
                  Manage PIN
                </button>
              )}
            </article>
          ))}
          {token && familyId ? (
            <form className="invite-form" onSubmit={addChild}>
              <label>
                Child name
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
                Grade
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
                Six-digit PIN
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
              <button className="button ghost full-button" type="submit">
                Add child
              </button>
            </form>
          ) : null}
        </section>

        <section className="settings-card">
          <div className="settings-heading">
            <MailPlus />
            <div>
              <p className="eyebrow">Parents</p>
              <h2>Invite another parent</h2>
            </div>
          </div>
          <p className="settings-note">
            A family can have up to four parents. Invitations expire after
            seven days. The MVP does not send external email.
          </p>
          <form className="invite-form" onSubmit={invite}>
            <label>
              Parent email
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
              Create invite
            </button>
          </form>
          {inviteSent ? (
            <div className="invite-ready" role="status">
              <Shield />
              <span>
                Invite created for {inviteEmail}. They can accept it after
                signing in with that verified email.
              </span>
            </div>
          ) : null}
        </section>
      </div>
      {status === "error" ? (
        <p className="form-error" role="alert">
          The change could not be saved. Please check the details and try again.
        </p>
      ) : null}
      <Link className="button ghost account-link" href="/parent/account/">
        Open my sign-in and language settings
      </Link>
    </AppShell>
  );
}
