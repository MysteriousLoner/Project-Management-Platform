import { pagePrincipal } from "@/lib/page-principal";
import { reportDefaults } from "@/lib/knowledge-utils";
import WorkspaceFrame from "../workspace-frame";
import ReportsView from "./reports-view";
export const dynamic = "force-dynamic";
export default async function ReportsPage() {
  const principal = await pagePrincipal("/reports");
  return <WorkspaceFrame principal={principal} current="/reports" title="Work reports" description="A shared view of work across every project and department."><ReportsView defaults={reportDefaults()} /></WorkspaceFrame>;
}
