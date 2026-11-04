import { pagePrincipal } from "@/lib/page-principal";
import WorkspaceFrame from "../workspace-frame";
import PasswordForm from "./password-form";
import { localDestination } from "@/lib/sign-in-destination";
import { applicationUrl } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ firstLogin?: string; returnTo?: string }> }) {
  const principal = await pagePrincipal("/password");
  const params = await searchParams;
  const continueTo = params.firstLogin === "1" ? localDestination(params.returnTo ?? "/", applicationUrl) : undefined;
  return <WorkspaceFrame principal={principal} current="/password" title="Your password" description="Set a personal password for your employee account.">{principal.usingInitialPassword && <p className="alert no-print">Welcome. Your account is using the initial workspace password. Please choose a personal password before continuing.</p>}<PasswordForm continueTo={continueTo} /></WorkspaceFrame>;
}
