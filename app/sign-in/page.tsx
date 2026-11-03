import { Suspense } from "react";
import SignInForm from "./sign-in-form";
export default function SignInPage() {
  return <main className="auth-page"><section className="auth-panel"><div className="auth-brand">协策达</div><h1>Welcome back</h1><p className="muted">Sign in to your team’s project workspace.</p><Suspense fallback={<p>Loading sign-in…</p>}><SignInForm /></Suspense></section></main>;
}
