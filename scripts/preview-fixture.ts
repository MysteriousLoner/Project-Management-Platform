/** Disposable loopback-only UI fixture. No production data, password, model key, or service is used. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ensureSchema, pool, query } from "../lib/db";
import { auth } from "../lib/auth";
import { getMigrations } from "better-auth/db/migration";
import { createEmployee, createFirstEmployee } from "../lib/accounts";
import { principalForAuthUser } from "../lib/auth-session";
import { submitProgress } from "../lib/knowledge";
import { generateReport } from "../lib/reporting";
import { processClaimedJob, type ClaimedJob } from "../lib/job-processing";
import { reportDefaults } from "../lib/knowledge-utils";

async function main() {
  await ensureSchema(); await (await getMigrations(auth.options)).runMigrations();
  const first = await createFirstEmployee({ displayName: "Synthetic · Team member", password: process.env.PMS_INITIAL_PASSWORD });
  const authId = (await query("SELECT auth_user_id FROM kb_account_links WHERE employee_id=$1", [first.employeeId])).rows[0].auth_user_id;
  const principal = await principalForAuthUser(authId);
  const departmentId = (await query("SELECT id FROM departments LIMIT 1")).rows[0].id;
  const second = await createEmployee(principal, { displayName: "Synthetic · Second teammate", departmentId, idempotencyKey: randomUUID() });
  const project = (await query("INSERT INTO projects(name,key,department_id) VALUES('Synthetic · Manufacturing portal','PORTAL',$1) RETURNING id", [departmentId])).rows[0].id;
  await query("INSERT INTO projects(name,key,department_id) VALUES('Synthetic · Device integration','DEVICE',$1)", [departmentId]);
  const dates = reportDefaults();
  await submitProgress(principal, { projectId: project, clientId: randomUUID(), expectedCheckpointRevision: 0, baselineDate: dates.startDate,
    entries: [
      { workDate: dates.endDate, summary: "Implemented employee sign-in and preserved the existing project assignments.", status: "completed", evidence: [{ id: randomUUID(), kind: "note", reference: "Synthetic preview fixture" }] },
      { workDate: dates.endDate, summary: "Validated simultaneous progress submissions and safe retries after a lost response.", status: "completed", evidence: [{ id: randomUUID(), kind: "note", reference: "Synthetic preview fixture" }] }
    ], blockers: [{ key: "release-approval", state: "open", effectiveDate: dates.endDate, summary: "Release is waiting for management approval.", outsideParty: "Management", actionNeeded: "Confirm the release date.", affectedEmployeeIds: [first.employeeId, second.employeeId], evidence: [{ id: randomUUID(), kind: "note", reference: "Synthetic preview fixture" }] }], sources: {}, idempotencyKey: randomUUID() });
  const job = await generateReport(principal, { ...dates, language: "en", idempotencyKey: randomUUID() });
  const token = randomUUID();
  const claimed = (await query("UPDATE kb_jobs SET state='running',attempts=1,attempt_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1 RETURNING *", [job.id, token])).rows[0] as ClaimedJob;
  await processClaimedJob(claimed, async (_system, raw) => {
    const value = raw as { entries?: { id: string; work: string }[]; summary?: string; outsideParty?: string; actionNeeded?: string };
    if (value.entries) return { bullets: value.entries.map((e) => ({ text: e.work, source_entry_ids: [e.id] })) };
    return { summary: value.summary, outsideParty: value.outsideParty, actionNeeded: value.actionNeeded };
  });
  await pool.end();
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "31987", "-H", "127.0.0.1"], { stdio: "inherit", env: process.env });
  process.on("SIGTERM", () => app.kill("SIGTERM"));
  process.on("SIGINT", () => app.kill("SIGTERM"));
  process.exitCode = await new Promise<number>((resolve) => app.on("exit", (code) => resolve(code ?? 1)));
}
main().catch(() => { console.error("Synthetic preview could not start."); process.exitCode = 1; });
