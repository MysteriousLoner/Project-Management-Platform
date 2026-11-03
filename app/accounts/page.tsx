import { pagePrincipal } from "@/lib/page-principal";
import { query } from "@/lib/db";
import WorkspaceFrame from "../workspace-frame";
import AccountsView from "./accounts-view";
export const dynamic = "force-dynamic";
export default async function AccountsPage() {
  const principal = await pagePrincipal("/accounts");
  const departments = (await query("SELECT id,name FROM departments WHERE NOT is_archived ORDER BY name")).rows as { id: string; name: string }[];
  return <WorkspaceFrame principal={principal} current="/accounts" title="People & access" description="Connect employee records to individual accounts and manage access."><AccountsView departments={departments} /></WorkspaceFrame>;
}
