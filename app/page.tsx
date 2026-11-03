import ProjectManager from "./project-manager";
import { pagePrincipal } from "@/lib/page-principal";

export const dynamic = "force-dynamic";
export default async function Home() {
  const principal = await pagePrincipal();
  return <ProjectManager employeeId={principal.employeeId} usingInitialPassword={principal.usingInitialPassword} />;
}
