"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { appPath } from "@/lib/base-path";
export default function ConsentForm() {
  const params = useSearchParams(); const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function respond(accept: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch(appPath("/api/auth/oauth2/consent"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept, oauth_query: params.get("oauth_query") ?? params.toString() }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error_description ?? data.message ?? "This connection request has expired. Start sign-in from Codex again.");
      if (data.url ?? data.redirect_uri) window.location.assign(data.url ?? data.redirect_uri);
      else throw new Error("No return address was provided. Start sign-in from Codex again.");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="stack-form"><p className="auth-help">Only approve a connection you started from Codex.</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="button button-secondary" disabled={busy} onClick={() => respond(false)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={() => respond(true)}>{busy ? "Connecting…" : "Allow connection"}</button></div></div>;
}
