"use client";
import { useRef, useState, type FormEvent } from "react";
import { appPath } from "@/lib/base-path";
export default function PasswordForm({ continueTo }: { continueTo?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [done, setDone] = useState(false); const pending = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    if (data.get("newPassword") !== data.get("confirm")) { setError("The new passwords do not match."); return; }
    setBusy(true); setError(""); pending.current ??= crypto.randomUUID();
    try {
      const r = await fetch(appPath("/api/password"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword"), idempotencyKey: pending.current }) });
      const result = await r.json(); if (!r.ok) { pending.current = null; throw new Error(result.error?.message ?? "Your password could not be changed."); }
      setDone(true); pending.current = null; form.reset();
      if (continueTo) window.location.assign(continueTo);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="password-settings">{done && <p role="status" className="alert">Your password was changed. Other signed-in sessions have been revoked; reconnect Codex if it asks you to sign in again.</p>}<form className="stack-form" onSubmit={submit} onChange={() => { pending.current = null; setDone(false); }}><label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label><label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><p className="muted">Use at least 8 characters.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? "Changing password…" : "Change password"}</button></form></div>;
}
