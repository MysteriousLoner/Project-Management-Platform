import { z } from "zod";
import type { PoolClient } from "pg";
import { ApiError } from "./errors";
import { query, rowToCamel } from "./db";
import { idempotent } from "./idempotency";
import { id, key, prepareDocumentationSchema, progressSubmissionSchema, type Principal } from "./knowledge-types";
import { fingerprint, malaysiaToday, normalizeRemote, rejectSecrets } from "./knowledge-utils";

export async function activeProject(client: Pick<PoolClient, "query">, projectId: string) {
  const result = await client.query("SELECT id,name,key FROM projects WHERE id=$1 AND NOT is_archived", [projectId]);
  if (!result.rowCount) throw new ApiError(404, "PROJECT_NOT_FOUND", "Select an active project.");
  return result.rows[0];
}

export async function resolveProject(raw: unknown) {
  const input = z.object({ remote: z.string().max(1500).optional(), query: z.string().max(200).optional() }).strict().parse(raw);
  if (input.remote) {
    const alias = normalizeRemote(input.remote);
    const found = await query(`SELECT p.id,p.name,p.key,p.department_id AS "departmentId" FROM kb_repository_aliases a JOIN projects p ON p.id=a.project_id WHERE a.normalized_remote=$1 AND NOT p.is_archived`, [alias]);
    if (found.rowCount) return { matched: true, projects: found.rows, normalizedRemote: alias };
  }
  const projects = await query(`SELECT p.id,p.name,p.key,p.department_id AS "departmentId",d.name AS department
    FROM projects p JOIN departments d ON d.id=p.department_id WHERE NOT p.is_archived
    AND ($1::text IS NULL OR p.name ILIKE '%'||$1||'%' OR p.key ILIKE '%'||$1||'%') ORDER BY p.name LIMIT 100`, [input.query || null]);
  return { matched: false, projects: projects.rows, ...(input.remote ? { normalizedRemote: normalizeRemote(input.remote) } : {}) };
}

export async function bindProject(principal: Principal, raw: unknown) {
  const input = z.object({
    remote: z.string().max(1500), projectId: id.optional(),
    create: z.object({ name: z.string().trim().min(1).max(120), key: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/), departmentId: id }).strict().optional(),
    idempotencyKey: key
  }).strict().refine((x) => Boolean(x.projectId) !== Boolean(x.create), "Choose an existing project or supply a new project").parse(raw);
  const remote = normalizeRemote(input.remote);
  return idempotent(principal.employeeId, "projects.bind", input.idempotencyKey, { ...input, remote }, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [remote]);
    const existing = await client.query("SELECT project_id FROM kb_repository_aliases WHERE normalized_remote=$1", [remote]);
    if (existing.rowCount) {
      if (input.projectId && existing.rows[0].project_id !== input.projectId) throw new ApiError(409, "REMOTE_ALREADY_BOUND", "This repository is already associated with another project.");
      return { projectId: existing.rows[0].project_id, normalizedRemote: remote };
    }
    let projectId = input.projectId;
    if (input.create) {
      const membership = await client.query(`SELECT 1 FROM user_departments ud JOIN departments d ON d.id=ud.department_id
        WHERE ud.user_id=$1 AND ud.department_id=$2 AND NOT d.is_archived`, [principal.employeeId, input.create.departmentId]);
      if (!membership.rowCount) throw new ApiError(403, "DEPARTMENT_MEMBERSHIP_REQUIRED", "Create projects in a department you belong to.");
      const created = await client.query("INSERT INTO projects(name,key,department_id) VALUES($1,upper($2),$3) RETURNING id", [input.create.name, input.create.key, input.create.departmentId]);
      projectId = created.rows[0].id;
    }
    await activeProject(client, projectId!);
    await client.query("INSERT INTO kb_repository_aliases(normalized_remote,project_id,created_by) VALUES($1,$2,$3)", [remote, projectId, principal.employeeId]);
    await client.query("INSERT INTO audit_events(project_id,actor_id,action,metadata) VALUES($1,$2,'repository_bound',$3::jsonb)", [projectId, principal.employeeId, JSON.stringify({ remote })]);
    return { projectId, normalizedRemote: remote };
  });
}

export async function readDocumentation(raw: unknown) {
  const input = z.object({ projectId: id, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(7).default(7) }).strict().parse(raw);
  const result = await query(`SELECT p.id AS "projectId",p.name,coalesce(c.revision,0) AS "catalogRevision",
    coalesce((SELECT jsonb_agg(row_to_json(d)) FROM (
      SELECT id,topic,title,content,version,evidence,updated_by AS "updatedBy",updated_at AS "updatedAt"
      FROM kb_documents WHERE project_id=p.id ORDER BY topic OFFSET $2 LIMIT $3) d),'[]') AS documents,
    (SELECT count(*)::int FROM kb_documents WHERE project_id=p.id) AS total
    FROM projects p LEFT JOIN kb_catalogs c ON c.project_id=p.id WHERE p.id=$1`, [input.projectId, input.offset, input.limit]);
  if (!result.rowCount) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
  return result.rows[0];
}

export async function searchDocumentation(raw: unknown) {
  const input = z.object({ query: z.string().trim().min(1).max(200), projectId: id.optional(), offset: z.number().int().nonnegative().default(0) }).strict().parse(raw);
  const found = await query(`SELECT d.id,d.project_id AS "projectId",p.name AS "projectName",d.topic,d.title,d.version,
    left(d.content,1200) AS excerpt FROM kb_documents d JOIN projects p ON p.id=d.project_id
    WHERE ($2::uuid IS NULL OR d.project_id=$2) AND (d.title ILIKE '%'||$1||'%' OR d.content ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%')
    ORDER BY p.name,d.topic OFFSET $3 LIMIT 30`, [input.query, input.projectId ?? null, input.offset]);
  return { matches: found.rows, nextOffset: found.rowCount === 30 ? input.offset + 30 : null };
}

export async function prepareDocumentation(principal: Principal, raw: unknown) {
  const input = prepareDocumentationSchema.parse(raw);
  rejectSecrets(input.changes);
  if (new Set(input.changes.map((x) => x.topic)).size !== input.changes.length) throw new ApiError(422, "DUPLICATE_TOPIC", "Provide at most one change for each canonical topic.");
  return idempotent(principal.employeeId, "documentation.prepare", input.idempotencyKey, input, async (client) => {
    await activeProject(client, input.projectId);
    const snapshot = await client.query(`SELECT coalesce(c.revision,0) AS revision,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'topic',topic,'title',title,'content',content,'version',version))
        FROM kb_documents WHERE project_id=p.id),'[]') AS documents
      FROM projects p LEFT JOIN kb_catalogs c ON c.project_id=p.id WHERE p.id=$1`, [input.projectId]);
    if (snapshot.rows[0].revision !== input.expectedCatalogRevision) throw new ApiError(409, "CATALOG_CHANGED", "Documentation changed. Read it again and repeat duplicate review.");
    const job = await client.query(`INSERT INTO kb_jobs(kind,requested_by,input) VALUES('documentation_review',$1,$2::jsonb) RETURNING id,state`, [principal.employeeId, JSON.stringify({ ...input, documents: snapshot.rows[0].documents })]);
    return job.rows[0];
  });
}

type ReviewedChange = { index: number; decision: "new" | "update" | "duplicate" | "conflict"; reason: string };
export async function commitDocumentation(principal: Principal, raw: unknown) {
  const input = z.object({ proposalId: id, expectedCatalogRevision: z.number().int().nonnegative(), idempotencyKey: key }).strict().parse(raw);
  return idempotent(principal.employeeId, "documentation.commit", input.idempotencyKey, input, async (client) => {
    const job = await client.query("SELECT * FROM kb_jobs WHERE id=$1 AND kind='documentation_review' AND requested_by=$2 AND state='ready'", [input.proposalId, principal.employeeId]);
    if (!job.rowCount) throw new ApiError(409, "PROPOSAL_NOT_READY", "Wait for your documentation review to complete before committing it.");
    const proposal = { ...job.rows[0].input };
    delete proposal.documents;
    const prepared = prepareDocumentationSchema.parse(proposal);
    if (prepared.expectedCatalogRevision !== input.expectedCatalogRevision) throw new ApiError(409, "CATALOG_CHANGED", "Use the catalog revision that was reviewed.");
    await activeProject(client, prepared.projectId);
    await client.query("INSERT INTO kb_catalogs(project_id) VALUES($1) ON CONFLICT DO NOTHING", [prepared.projectId]);
    const catalog = await client.query("SELECT revision FROM kb_catalogs WHERE project_id=$1 FOR UPDATE", [prepared.projectId]);
    if (catalog.rows[0].revision !== input.expectedCatalogRevision) throw new ApiError(409, "CATALOG_CHANGED", "Another employee updated documentation. Read it again and repeat duplicate review.");
    const decisions = job.rows[0].result?.decisions as ReviewedChange[];
    if (!Array.isArray(decisions) || decisions.length !== prepared.changes.length || decisions.some((x) => x.decision === "conflict")) throw new ApiError(409, "DOCUMENTATION_CONFLICT", "Resolve the duplicate-review questions before preparing a new proposal.");
    const saved = [];
    for (const decision of decisions) {
      if (decision.decision === "duplicate") continue;
      const change = prepared.changes[decision.index];
      const current = await client.query("SELECT * FROM kb_documents WHERE project_id=$1 AND topic=$2", [prepared.projectId, change.topic]);
      const version = current.rowCount ? current.rows[0].version + 1 : 1;
      const result = await client.query(`INSERT INTO kb_documents(project_id,topic,title,content,fingerprint,version,evidence,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
        ON CONFLICT(project_id,topic) DO UPDATE SET title=excluded.title,content=excluded.content,fingerprint=excluded.fingerprint,
          version=excluded.version,evidence=excluded.evidence,updated_by=excluded.updated_by,updated_at=now() RETURNING id,topic,version`,
      [prepared.projectId, change.topic, change.title, change.content, fingerprint(change.content), version, JSON.stringify(change.evidence), principal.employeeId]);
      const document = result.rows[0];
      await client.query("INSERT INTO kb_document_revisions(document_id,version,title,content,evidence,author_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [document.id, version, change.title, change.content, JSON.stringify(change.evidence), principal.employeeId]);
      saved.push(document);
    }
    if (saved.length) {
      await client.query("UPDATE kb_catalogs SET revision=revision+1 WHERE project_id=$1", [prepared.projectId]);
      await client.query("INSERT INTO audit_events(project_id,actor_id,action,metadata) VALUES($1,$2,'documentation_updated',$3::jsonb)", [prepared.projectId, principal.employeeId, JSON.stringify({ proposalId: input.proposalId, saved })]);
    }
    return { catalogRevision: input.expectedCatalogRevision + (saved.length ? 1 : 0), saved, duplicatesSkipped: decisions.filter((x) => x.decision === "duplicate").length };
  });
}

export async function progressContext(principal: Principal, raw: unknown) {
  const input = z.object({ projectId: id, clientId: z.string().min(8).max(100) }).strict().parse(raw);
  const [checkpoint, recent, blockers, departments] = await Promise.all([
    query("SELECT revision,baseline_date AS \"baselineDate\",sources,updated_at AS \"updatedAt\" FROM kb_checkpoints WHERE employee_id=$1 AND project_id=$2 AND client_id=$3", [principal.employeeId, input.projectId, input.clientId]),
    query(`SELECT p.id,p.work_date AS "workDate",p.summary,p.status,p.evidence FROM kb_progress p WHERE p.project_id=$1 AND p.employee_id=$2
      AND NOT EXISTS(SELECT 1 FROM kb_progress n WHERE n.supersedes_id=p.id) ORDER BY p.work_date DESC,p.recorded_at DESC LIMIT 100`, [input.projectId, principal.employeeId]),
    query(`SELECT b.key,b.id AS blocker_id,e.* FROM kb_blockers b JOIN LATERAL (SELECT * FROM kb_blocker_events WHERE blocker_id=b.id AND effective_date<=$2::date ORDER BY effective_date DESC,recorded_at DESC,id DESC LIMIT 1) e ON true WHERE b.project_id=$1 AND e.state='open'`, [input.projectId, malaysiaToday()]),
    query("SELECT d.id,d.name FROM departments d JOIN user_departments ud ON ud.department_id=d.id WHERE ud.user_id=$1 AND NOT d.is_archived", [principal.employeeId])
  ]);
  return { employeeId: principal.employeeId, checkpoint: checkpoint.rowCount ? rowToCamel(checkpoint.rows[0]) : null, recentProgress: recent.rows, openBlockers: blockers.rows.map(rowToCamel), departments: departments.rows, today: malaysiaToday(), timezone: "Asia/Kuala_Lumpur" };
}

export async function submitProgress(principal: Principal, raw: unknown) {
  const input = progressSubmissionSchema.parse(raw);
  rejectSecrets({ entries: input.entries, blockers: input.blockers });
  const today = malaysiaToday();
  if (input.baselineDate > today || input.entries.some((e) => e.workDate > today || (!e.supersedesId && e.workDate < input.baselineDate)) || input.blockers.some((b) => b.effectiveDate > today)) throw new ApiError(422, "INVALID_WORK_DATE", "Work dates must be within the collection period and cannot be in the future.");
  if (new Set(input.blockers.map((b) => b.key)).size !== input.blockers.length) throw new ApiError(422, "DUPLICATE_BLOCKER", "Submit only one event for each blocker at a time.");
  return idempotent(principal.employeeId, "progress.submit", input.idempotencyKey, input, async (client) => {
    await activeProject(client, input.projectId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [`${principal.employeeId}:${input.projectId}`]);
    await client.query("INSERT INTO kb_checkpoints(employee_id,project_id,client_id,baseline_date) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [principal.employeeId, input.projectId, input.clientId, input.baselineDate]);
    const checkpoint = await client.query("SELECT revision,baseline_date FROM kb_checkpoints WHERE employee_id=$1 AND project_id=$2 AND client_id=$3 FOR UPDATE", [principal.employeeId, input.projectId, input.clientId]);
    if (checkpoint.rows[0].revision !== input.expectedCheckpointRevision) throw new ApiError(409, "CHECKPOINT_CHANGED", "Another update advanced this checkpoint. Retrieve your context again before submitting.");
    if (String(checkpoint.rows[0].baseline_date instanceof Date ? checkpoint.rows[0].baseline_date.toISOString().slice(0, 10) : checkpoint.rows[0].baseline_date) !== input.baselineDate) throw new ApiError(409, "BASELINE_CHANGED", "Preserve this source's original collection start date.");
    const saved: string[] = []; let skipped = 0;
    for (const entry of input.entries) {
      const sourceIds = [...new Set(entry.evidence.map((e) => e.id))];
      const known = await client.query("SELECT source_id,progress_id FROM kb_progress_evidence WHERE employee_id=$1 AND project_id=$2 AND source_id=ANY($3::text[])", [principal.employeeId, input.projectId, sourceIds]);
      if (entry.supersedesId) {
        const previous = await client.query(`SELECT id FROM kb_progress WHERE id=$1 AND employee_id=$2 AND project_id=$3
          AND NOT EXISTS(SELECT 1 FROM kb_progress n WHERE n.supersedes_id=$1) FOR UPDATE`, [entry.supersedesId, principal.employeeId, input.projectId]);
        if (!previous.rowCount) throw new ApiError(409, "CORRECTION_CONFLICT", "Correct only your current progress entry in this project.");
        if (known.rows.some((r) => r.progress_id !== entry.supersedesId)) throw new ApiError(409, "EVIDENCE_OVERLAP", "Some evidence already belongs to another progress entry.");
      } else if (known.rowCount) {
        if (known.rowCount === sourceIds.length) { skipped++; continue; }
        throw new ApiError(409, "EVIDENCE_OVERLAP", "Separate new evidence from already reported work, or explicitly correct the previous entry.");
      }
      const row = await client.query("INSERT INTO kb_progress(project_id,employee_id,work_date,summary,status,evidence,supersedes_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id", [input.projectId, principal.employeeId, entry.workDate, entry.summary, entry.status, JSON.stringify(entry.evidence), entry.supersedesId ?? null]);
      const progressId = row.rows[0].id;
      for (const sourceId of sourceIds) await client.query(`INSERT INTO kb_progress_evidence(employee_id,project_id,source_id,progress_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(employee_id,project_id,source_id) DO UPDATE SET progress_id=excluded.progress_id`, [principal.employeeId, input.projectId, sourceId, progressId]);
      saved.push(progressId);
    }
    // Every writer takes shared blocker locks in the same order, including across employees.
    for (const blocker of [...input.blockers].sort((a, b) => a.key.normalize("NFKC").trim().toLowerCase().localeCompare(b.key.normalize("NFKC").trim().toLowerCase()))) {
      const affected = await client.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [blocker.affectedEmployeeIds]);
      if (affected.rowCount !== new Set(blocker.affectedEmployeeIds).size) throw new ApiError(422, "UNKNOWN_EMPLOYEE", "A blocker references an unknown employee.");
      const normalizedKey = blocker.key.normalize("NFKC").trim().toLowerCase();
      await client.query("INSERT INTO kb_blockers(project_id,key) VALUES($1,$2) ON CONFLICT DO NOTHING", [input.projectId, normalizedKey]);
      const row = await client.query("SELECT id FROM kb_blockers WHERE project_id=$1 AND key=$2 FOR UPDATE", [input.projectId, normalizedKey]);
      const latest = await client.query("SELECT id FROM kb_blocker_events WHERE blocker_id=$1 ORDER BY effective_date DESC,recorded_at DESC,id DESC LIMIT 1", [row.rows[0].id]);
      if ((latest.rows[0]?.id ?? null) !== blocker.expectedEventId) throw new ApiError(409, "BLOCKER_CHANGED", "This blocker changed. Reload progress context before updating its state.");
      if (!latest.rowCount && blocker.state === "resolved") throw new ApiError(422, "BLOCKER_NOT_FOUND", "An external blocker must be opened before it can be resolved.");
      await client.query(`INSERT INTO kb_blocker_events(blocker_id,employee_id,state,effective_date,summary,outside_party,action_needed,affected_employee_ids,evidence,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,clock_timestamp())`, [row.rows[0].id, principal.employeeId, blocker.state, blocker.effectiveDate, blocker.summary, blocker.outsideParty, blocker.actionNeeded, [...new Set(blocker.affectedEmployeeIds)], JSON.stringify(blocker.evidence)]);
    }
    await client.query(`UPDATE kb_checkpoints SET revision=revision+1,sources=sources || $4::jsonb,updated_at=now()
      WHERE employee_id=$1 AND project_id=$2 AND client_id=$3`, [principal.employeeId, input.projectId, input.clientId, JSON.stringify(input.sources)]);
    await client.query("INSERT INTO audit_events(project_id,actor_id,action,metadata) VALUES($1,$2,'progress_submitted',$3::jsonb)", [input.projectId, principal.employeeId, JSON.stringify({ entryIds: saved, duplicateEntriesSkipped: skipped, collectionGaps: input.collectionGaps, clientId: input.clientId })]);
    return { entryIds: saved, duplicateEntriesSkipped: skipped, checkpointRevision: input.expectedCheckpointRevision + 1, collectionGaps: input.collectionGaps, message: saved.length || input.blockers.length ? "Progress saved" : "No new progress" };
  });
}

export async function queryProgress(raw: unknown) {
  const input = z.object({ projectId: id.optional(), employeeId: id.optional(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), offset: z.number().int().nonnegative().default(0) }).strict().parse(raw);
  const result = await query(`SELECT p.*,u.display_name AS employee_name,pr.name AS project_name FROM kb_progress p
    JOIN users u ON u.id=p.employee_id JOIN projects pr ON pr.id=p.project_id
    WHERE ($1::uuid IS NULL OR p.project_id=$1) AND ($2::uuid IS NULL OR p.employee_id=$2)
    AND ($3::date IS NULL OR p.work_date >= $3) AND ($4::date IS NULL OR p.work_date <= $4)
    AND NOT EXISTS(SELECT 1 FROM kb_progress n WHERE n.supersedes_id=p.id)
    ORDER BY p.work_date DESC,p.recorded_at DESC OFFSET $5 LIMIT 100`, [input.projectId ?? null, input.employeeId ?? null, input.startDate ?? null, input.endDate ?? null, input.offset]);
  return { entries: result.rows.map(rowToCamel), nextOffset: result.rowCount === 100 ? input.offset + 100 : null };
}

export async function getJob(principal: Principal, raw: unknown) {
  void principal; // Processing results are shared with every authenticated teammate.
  const { jobId } = z.object({ jobId: id }).strict().parse(raw);
  const job = await query("SELECT id,kind,state,attempts,result,error_code,created_at,updated_at FROM kb_jobs WHERE id=$1", [jobId]);
  if (!job.rowCount) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found.");
  return rowToCamel(job.rows[0]);
}
