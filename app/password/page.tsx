import { pagePrincipal } from "@/lib/page-principal";
import WorkspaceFrame from "../workspace-frame";
import PasswordForm from "./password-form";
export const dynamic = "force-dynamic";
export default async function PasswordPage() {
  const principal = await pagePrincipal("/password");
  return <WorkspaceFrame principal={principal} current="/password" title="Your password" description="Set a personal password for your employee account."><PasswordForm /></WorkspaceFrame>;
}
