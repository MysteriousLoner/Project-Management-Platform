import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
nextEnv.loadEnvConfig(process.cwd());
async function main() {
  const { buildReport, reviewDocumentation } = await import("../lib/job-processing");
  const { malaysiaToday } = await import("../lib/knowledge-utils");
  const { pool } = await import("../lib/db");
  const projectId = randomUUID(), employeeId = randomUUID(), entryId = randomUUID(), today = malaysiaToday();
  try {
    const report = await buildReport({ capturedAt: new Date().toISOString(), startDate: today, endDate: today, language: "en", employees: [{ id: employeeId, name: "Synthetic employee" }], projects: [{ id: projectId, name: "Synthetic project", key: "SYNTH" }], entries: [{ id: entryId, projectId, employeeId, workDate: today, summary: "Implemented a login form and verified password validation.", status: "completed", evidence: [{ id: "synthetic:commit", kind: "commit", reference: "Synthetic verification only" }] }], blockers: [{ id: randomUUID(), projectId, summary: "Waiting for approval", outsideParty: "Management", actionNeeded: "Approve the release", affectedEmployeeIds: [employeeId] }] });
    const review = await reviewDocumentation({ projectId, expectedCatalogRevision: 1, idempotencyKey: randomUUID(), documents: [{ topic: "overview", title: "Purpose", content: "The application stores project documentation and work progress centrally.", version: 1 }], changes: [{ topic: "overview", title: "Purpose", content: "Project documentation and progress updates are kept in a central application.", evidence: [{ id: "synthetic:file", kind: "file", reference: "Synthetic verification only" }] }] });
    console.log(JSON.stringify({ reportCompleted: report.projects[0].employees[0].bullets.length > 0, sourceAttributionValid: report.projects[0].employees[0].bullets.every((b) => b.sourceEntryIds.includes(entryId)), blockersIncluded: report.blockers.length === 1, semanticDuplicateDecision: review.decisions[0].decision }));
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Synthetic Gemma verification failed; credentials and provider response bodies are not logged."); process.exitCode = 1; });
