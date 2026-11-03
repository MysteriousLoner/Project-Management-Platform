import { pagePrincipal } from "@/lib/page-principal";
import { applicationUrl } from "@/lib/auth";
import WorkspaceFrame from "../workspace-frame";
import SetupPrompt from "./setup-prompt";
export const dynamic = "force-dynamic";
export default async function CodexSetupPage() {
  const principal = await pagePrincipal("/codex-setup");
  const prompt = `Set up my Codex desktop to use our Techmation project knowledge workspace at ${applicationUrl}.

Download ${applicationUrl}/codex/setup-codex.mjs to a temporary local directory, inspect it, and run it with Node.js 22 or newer:
node <downloaded-script> --server ${applicationUrl} --login

The installer must preserve my existing Codex configuration and instructions. It installs update-progress and document-project as user-level skills, adds the shared knowledge lookup rule to my active global AGENTS.md, and configures the techmationKnowledge remote MCP connection. It creates a backup before updating existing configuration. Do not paste passwords or tokens into this chat.

Complete browser sign-in by selecting my employee name and entering my password. If the Codex CLI is unavailable, use the Codex desktop MCP connection's sign-in action; reload/restart Codex if required. Verify identity.me identifies me. Resolve my current repository using projects.resolve; if no association exists, let me choose an existing project or create one in my department. Read its documentation. Confirm that $update-progress and $document-project are available; desktop also lists these skills in its slash command menu. Do not submit progress or change documentation during setup.`;
  return <WorkspaceFrame principal={principal} current="/codex-setup" title="Connect Codex" description="Give your Codex access to the same project knowledge as the rest of your team."><div className="setup-content"><section><h2>One setup prompt</h2><p>Paste this into Codex desktop on your Mac or Windows computer. You’ll sign in through your browser with your own account.</p><SetupPrompt prompt={prompt} /><p className="muted">Requires a current Codex desktop release and Node.js 22 or newer. The setup keeps your existing instructions and connections.</p></section><section><h2>Two workflows, one shared workspace</h2><p><strong>$update-progress</strong> collects your new work from available local project conversations and your own Git changes, then submits a dated update. On first use, choose how far back it should look.</p><p><strong>$document-project</strong> verifies the current project, compares its documentation with what is already shared, and publishes reviewed changes.</p><p>These skills also appear in the desktop slash menu. Your global rule retrieves relevant project documentation automatically when you work on a registered project.</p></section><section><h2>What your team receives</h2><p>Concise work summaries, canonical documentation, and evidence references. Raw conversations, complete source files, hidden reasoning, and credentials stay out of the shared knowledge base.</p><p>Only local conversations that Codex can access are included. Unavailable history is reported as a collection gap.</p></section></div></WorkspaceFrame>;
}
