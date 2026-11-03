import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { ApiError } from "./errors";
import { callInternalModel, internalModel, validatedModel, type ModelCall } from "./internal-llm";
import { fingerprint } from "./knowledge-utils";
import { prepareDocumentationSchema, type ReportSnapshot, type ReportBody } from "./knowledge-types";
import { renderReportMarkdown } from "./reporting";

export type ClaimedJob = { id: string; kind: "report" | "documentation_review"; requested_by: string; input: unknown; attempt_token: string; attempts: number };

export async function claimJob(): Promise<ClaimedJob | null> {
  return transaction(async (client) => {
    await client.query(`UPDATE kb_jobs SET state='failed',error_code='WORKER_LEASE_EXPIRED',updated_at=now()
      WHERE state='running' AND lease_until<now() AND attempts>=3`);
    const result = await client.query(`WITH candidate AS (
      SELECT id FROM kb_jobs WHERE attempts<3 AND ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()))
      ORDER BY CASE kind WHEN 'documentation_review' THEN 0 ELSE 1 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE kb_jobs j SET state='running',attempts=attempts+1,attempt_token=$1,lease_until=now()+interval '90 seconds',updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`, [randomUUID()]);
    return result.rows[0] ?? null;
  });
}

export async function renewLease(job: ClaimedJob) {
  const result = await query("UPDATE kb_jobs SET lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND attempt_token=$2 AND state='running' AND lease_until>now() RETURNING id", [job.id, job.attempt_token]);
  return Boolean(result.rowCount);
}

function chunks<T>(items: T[], size: number, weight: (item: T) => number, maxWeight: number) {
  const result: T[][] = []; let current: T[] = [], length = 0;
  for (const item of items) {
    const next = weight(item);
    if (current.length && (current.length >= size || length + next > maxWeight)) { result.push(current); current = []; length = 0; }
    current.push(item); length += next;
  }
  if (current.length) result.push(current);
  return result;
}

const bulletOutput = z.object({ bullets: z.array(z.object({ text: z.string().trim().min(1).max(1200), source_entry_ids: z.array(z.string()).min(1) }).strict()).min(1).max(100) }).strict();
type ModelBullet = z.infer<typeof bulletOutput>["bullets"][number];
async function summarize(call: ModelCall, input: unknown, expected: Set<string>, language: string, consolidate = false) {
  const result = await validatedModel(call,
    `Produce concise management work bullets in ${language === "zh-CN" ? "Simplified Chinese" : "English"}. ${consolidate ? "Consolidate overlapping bullets without losing any work." : "Summarize only the supplied work, combining overlaps."} Preserve completed versus in-progress status. Never invent accomplishments, dates, blockers, or people. Every supplied source entry ID must appear in at least one bullet; use only supplied IDs. Format: {"bullets":[{"text":"work done","source_entry_ids":["e1"]}]}.`, input, bulletOutput);
  const seen = new Set<string>();
  for (const bullet of result.bullets) for (const sourceId of bullet.source_entry_ids) {
    if (!expected.has(sourceId)) throw new ApiError(502, "LLM_INVALID_ATTRIBUTION", "The model referenced an unknown progress entry.");
    seen.add(sourceId);
  }
  if (seen.size !== expected.size) throw new ApiError(502, "LLM_INCOMPLETE", "The model omitted submitted work.");
  return result.bullets;
}

export async function buildReport(snapshot: ReportSnapshot, call: ModelCall = callInternalModel): Promise<ReportBody> {
  const body: ReportBody = { projects: [], coverage: { projectsWithoutSubmissions: [], employeesWithoutSubmissions: [] }, blockers: [] };
  const contributors = new Set<string>();
  for (const project of snapshot.projects) {
    const projectBody: ReportBody["projects"][number] = { id: project.id, name: project.name, employees: [] };
    for (const employee of snapshot.employees) {
      const entries = snapshot.entries.filter((e) => e.projectId === project.id && e.employeeId === employee.id);
      if (!entries.length) continue;
      if (entries.length > 2000) throw new ApiError(422, "REPORT_TOO_LARGE", "Choose a shorter date range for this employee.");
      contributors.add(employee.id);
      const aliases = new Map(entries.map((e, i) => [`e${i + 1}`, e.id]));
      const source = entries.map((e, i) => ({ id: `e${i + 1}`, date: e.workDate, work: e.summary, status: e.status }));
      let groups: ModelBullet[][] = [];
      for (const batch of chunks(source, 25, (e) => e.work.length + 100, 14000)) groups.push(await summarize(call, { entries: batch }, new Set(batch.map((e) => e.id)), snapshot.language));
      while (groups.length > 1) {
        const next: ModelBullet[][] = [];
        for (let i = 0; i < groups.length; i += 2) {
          if (!groups[i + 1]) { next.push(groups[i]); continue; }
          const bullets = [...groups[i], ...groups[i + 1]];
          next.push(await summarize(call, { bullets }, new Set(bullets.flatMap((b) => b.source_entry_ids)), snapshot.language, true));
        }
        groups = next;
      }
      projectBody.employees.push({ id: employee.id, name: employee.name, bullets: groups[0].map((b) => ({ text: b.text, sourceEntryIds: [...new Set(b.source_entry_ids)].map((x) => aliases.get(x)!) })) });
    }
    body.projects.push(projectBody);
    if (!projectBody.employees.length) body.coverage.projectsWithoutSubmissions.push(project.name);
  }
  body.coverage.employeesWithoutSubmissions = snapshot.employees.filter((e) => !contributors.has(e.id)).map((e) => e.name);
  for (const blocker of snapshot.blockers) {
    const translated = await validatedModel(call,
      `Translate or concisely restate this external blocker in ${snapshot.language === "zh-CN" ? "Simplified Chinese" : "English"}. Preserve meaning, named organizations, and the action required; do not invent details. Return {"summary":"...","outsideParty":"...","actionNeeded":"..."}.`,
      { summary: blocker.summary, outsideParty: blocker.outsideParty, actionNeeded: blocker.actionNeeded },
      z.object({ summary: z.string().min(1).max(2000), outsideParty: z.string().min(1).max(300), actionNeeded: z.string().min(1).max(2000) }).strict());
    body.blockers.push({ project: blocker.projectName ?? snapshot.projects.find((p) => p.id === blocker.projectId)?.name ?? (snapshot.language === "zh-CN" ? "已归档项目" : "Archived project"), employees: blocker.affectedEmployeeIds.map((id) => blocker.affectedEmployees?.find((e) => e.id === id)?.name ?? snapshot.employees.find((e) => e.id === id)?.name ?? (snapshot.language === "zh-CN" ? "前员工" : "Former employee")), ...translated });
  }
  return body;
}

type ExistingDocument = { topic: string; title: string; content: string; version: number };
const reviewOutput = z.object({ decision: z.enum(["accept", "duplicate", "conflict"]), reason: z.string().trim().min(1).max(1500) }).strict();
export async function reviewDocumentation(raw: unknown, call: ModelCall = callInternalModel) {
  const { documents = [], ...proposal } = raw as Record<string, unknown>;
  const input = prepareDocumentationSchema.parse(proposal);
  const existing = documents as ExistingDocument[];
  const decisions: { index: number; decision: "new" | "update" | "duplicate" | "conflict"; reason: string }[] = [];
  for (const [index, change] of input.changes.entries()) {
    const current = existing.find((d) => d.topic === change.topic);
    const exact = existing.find((d) => fingerprint(d.content) === fingerprint(change.content));
    if (exact) { decisions.push({ index, decision: "duplicate", reason: `This information already exists in ${exact.topic}.` }); continue; }
    const finalOthers = [
      ...existing.filter((d) => d.topic !== change.topic && !input.changes.some((c) => c.topic === d.topic)),
      ...input.changes.slice(0, index).filter((_, i) => decisions[i]?.decision !== "duplicate")
    ];
    let duplicate = false, conflict: string | undefined;
    if (current) {
      const sameTopic = await validatedModel(call, `Compare proposed documentation with its existing version. Return decision duplicate only when it adds no new facts and changes no facts, including paraphrases. Return accept for a supported factual update. Return conflict for incompatible claims whose intended meaning cannot be determined from the supplied evidence. JSON: {"decision":"accept|duplicate|conflict","reason":"brief explanation"}.`, { proposed: change, current }, reviewOutput);
      duplicate = sameTopic.decision === "duplicate";
      if (sameTopic.decision === "conflict") conflict = sameTopic.reason;
    }
    if (!duplicate && !conflict) {
      for (const other of finalOthers) {
        const reviewed = await validatedModel(call, `Check the proposed page against another canonical page for the SAME PROJECT. Information should have one canonical explanation. Return duplicate if the entire proposal is already covered by the other page. Return conflict if part of the proposal repeats facts explained on that page (suggest using a reference), or contradicts it. References, topic navigation, and necessary entity names are not duplicated explanations. Otherwise return accept. JSON: {"decision":"accept|duplicate|conflict","reason":"brief explanation"}.`, { proposed: change, other }, reviewOutput);
        if (reviewed.decision === "duplicate") { duplicate = true; break; }
        if (reviewed.decision === "conflict") { conflict = reviewed.reason; break; }
      }
    }
    decisions.push({ index, decision: conflict ? "conflict" : duplicate ? "duplicate" : current ? "update" : "new", reason: conflict ?? (duplicate ? "Existing documentation already covers this information." : "Reviewed against the current project documentation.") });
  }
  return { catalogRevision: input.expectedCatalogRevision, decisions, needsClarification: decisions.some((d) => d.decision === "conflict") };
}

export async function processClaimedJob(job: ClaimedJob, call: ModelCall = callInternalModel) {
  try {
    const report = job.kind === "report" ? await buildReport(job.input as ReportSnapshot, call) : null;
    const review = job.kind === "documentation_review" ? await reviewDocumentation(job.input, call) : null;
    return await transaction(async (client) => {
      const owned = await client.query("SELECT id FROM kb_jobs WHERE id=$1 AND attempt_token=$2 AND state='running' AND lease_until>now() FOR UPDATE", [job.id, job.attempt_token]);
      if (!owned.rowCount) return false;
      let result: unknown = review;
      if (report) {
        const snapshot = job.input as ReportSnapshot;
        const reportId = randomUUID();
        await client.query(`INSERT INTO kb_report_versions(id,job_id,start_date,end_date,language,snapshot,report,markdown,model,created_by)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`, [reportId, job.id, snapshot.startDate, snapshot.endDate, snapshot.language, JSON.stringify(snapshot), JSON.stringify(report), renderReportMarkdown(snapshot, report), internalModel(), job.requested_by]);
        result = { reportId };
      }
      await client.query("UPDATE kb_jobs SET state='ready',result=$3::jsonb,error_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempt_token=$2", [job.id, job.attempt_token, JSON.stringify(result)]);
      return true;
    });
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "PROCESSING_FAILED";
    const permanent = ["LLM_CONFIGURATION_ERROR", "LLM_NOT_CONFIGURED", "REPORT_TOO_LARGE", "PROCESSING_INPUT_TOO_LARGE"].includes(code);
    await query(`UPDATE kb_jobs SET state=CASE WHEN attempts>=3 OR $3 THEN 'failed' ELSE 'queued' END,
      error_code=$4,available_at=now()+interval '5 seconds'*attempts,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND attempt_token=$2 AND state='running' AND lease_until>now()`, [job.id, job.attempt_token, permanent, code]);
    return false;
  }
}
