"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { appPath } from "@/lib/base-path";
type Account = { id: string; displayName: string; passwordProtected: boolean; isArchived: boolean };
async function request<T>(method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(appPath("/api/accounts"), { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message ?? "The account could not be updated."); return data;
}
export default function AccountsView({ departments }: { departments: { id: string; name: string }[] }) {
  const [accounts, setAccounts] = useState<Account[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const pending = useRef<string | null>(null);
  async function refresh() { setAccounts((await request<{ accounts: Account[] }>()).accounts); }
  useEffect(() => { request<{ accounts: Account[] }>().then((data) => setAccounts(data.accounts)).catch((e) => setError(e.message)); }, []);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, data = new FormData(form); pending.current ??= crypto.randomUUID();
    try {
      await request("POST", { displayName: data.get("name"), departmentId: data.get("department"), idempotencyKey: pending.current });
      pending.current = null; form.reset(); await refresh(); setNotice("Employee account created. They can sign in with the initial workspace password and change it afterwards.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(employeeId: string) {
    setError(""); setNotice("");
    try { await request("PATCH", { employeeId, revokeSessions: true, idempotencyKey: crypto.randomUUID() }); await refresh(); setNotice("Signed-in sessions revoked."); } catch (e) { setError((e as Error).message); }
  }
  return <div className="account-management">{error && <p className="alert alert-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="account-invite"><h2>Add a teammate</h2><p className="muted">Everyone has the same access. Existing employee records keep their assignments and history.</p><form className="account-invite-form" onSubmit={add} onChange={() => { pending.current = null; }}><label>Full name<input name="name" required maxLength={100} /></label><label>Initial department<select name="department" required>{departments.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><button className="button button-primary" disabled={busy}>{busy ? "Adding teammate…" : "Add teammate"}</button></form></section>
    <section><h2>Employee accounts</h2><div className="account-table-scroll"><table className="account-table"><thead><tr><th>Employee</th><th>Password protection</th><th>Sessions</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id}><td>{a.displayName}{a.isArchived && <span className="muted"> · archived</span>}</td><td>{a.passwordProtected ? "Protected" : "Provisioning required"}</td><td>{a.passwordProtected && <button className="button button-ghost" onClick={() => revoke(a.id)}>Revoke sessions</button>}</td></tr>)}</tbody></table></div></section>
  </div>;
}
