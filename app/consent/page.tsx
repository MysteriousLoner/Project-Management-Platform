import { Suspense } from "react";
import { pagePrincipal } from "@/lib/page-principal";
import ConsentForm from "./consent-form";
export const dynamic = "force-dynamic";
export default async function ConsentPage() {
  const principal = await pagePrincipal("/consent");
  return <main className="auth-page"><section className="auth-panel"><div className="auth-brand">协策达</div><h1>Connect your Codex</h1><p className="muted">You are signing in as <strong>{principal.displayName}</strong>.</p><p>This connection can read project knowledge, update shared documentation, and submit your own work progress. Every signed-in teammate can use all workspace features.</p><Suspense fallback={<p>Loading connection details…</p>}><ConsentForm /></Suspense></section></main>;
}
