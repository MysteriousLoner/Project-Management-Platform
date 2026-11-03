"use client";
import { appPath } from "@/lib/base-path";
export default function SignOut() {
  return <button className="sign-out-button" onClick={async () => { const r = await fetch(appPath("/api/auth/sign-out"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (r.ok) window.location.assign(appPath("/sign-in")); }}>Sign out</button>;
}
