"use client";
import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { appPath } from "@/lib/base-path";
export default function SignInForm() {
  const params = useSearchParams();
  const [employees, setEmployees] = useState<{ username: string; displayName: string }[]>([]);
  const [first, setFirst] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(appPath("/api/login-options")).then((r) => r.json()).then((data) => { setEmployees(data.employees ?? []); setFirst(Boolean(data.needsFirstEmployee)); }).catch(() => setError("The employee list could not be loaded. Refresh to try again.")); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const requested = params.get("returnTo") ?? "/";
    const returnTo = requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/";
    try {
      const oauthQuery = params.get("oauth_query") ?? (params.has("client_id") ? params.toString() : null);
      let username = form.get("username");
      if (first) {
        const created = await fetch(appPath("/api/first-account"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), password: form.get("password") }) });
        const account = await created.json();
        if (!created.ok) throw new Error(account.error?.message ?? "The first account could not be created. Refresh the employee list.");
        username = account.username;
      }
      const response = await fetch(appPath("/api/auth/sign-in/username"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: form.get("password"), callbackURL: `${window.location.origin}${appPath(returnTo)}`, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error_description ?? "Sign-in failed. Check your employee name and password.");
      const next = data.url ?? data.redirect_uri;
      if (next) window.location.assign(next); else window.location.assign(appPath(returnTo));
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  return <form className="stack-form" onSubmit={submit}>
    {first ? <label>Your full name<input name="displayName" maxLength={100} required autoFocus /></label> : <label>Employee<select name="username" autoComplete="username" required defaultValue=""><option value="" disabled>Select your name</option>{employees.map((employee) => <option value={employee.username} key={employee.username}>{employee.displayName}</option>)}</select></label>}
    <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <p className="auth-help">Use your personal password, or the initial workspace password for a new account. You can change it after signing in.</p>
  </form>;
}
