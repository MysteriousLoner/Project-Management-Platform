import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Principal } from "../lib/knowledge-types";
import type { ClaimedJob } from "../lib/job-processing";
import type { ModelCall } from "../lib/internal-llm";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
let db: typeof import("../lib/db"), knowledge: typeof import("../lib/knowledge"), accounts: typeof import("../lib/accounts"), jobs: typeof import("../lib/job-processing"), reporting: typeof import("../lib/reporting"), authentication: typeof import("../lib/auth");
let firstEmployee: Principal, alice: Principal, bob: Principal, manager: Principal;
let server: Server;
const passwords = new Map<string, string>();
const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:31987";
const key = () => randomUUID();
let today: string;
const fakeModel: ModelCall = async (_system, raw) => {
  const input = raw as { entries?: { id: string; work: string }[]; bullets?: { text: string; source_entry_ids: string[] }[] };
  if (input.entries) return { bullets: input.entries.map((e) => ({ text: e.work, source_entry_ids: [e.id] })) };
  if (input.bullets) return { bullets: [{ text: input.bullets.map((b) => b.text).join("; ").slice(0, 1200), source_entry_ids: [...new Set(input.bullets.flatMap((b) => b.source_entry_ids))] }] };
  return { decision: "accept", reason: "Verified independent information." };
};
async function newProject(name = "Integration project") {
  return (await db.query("INSERT INTO projects(name,key,department_id,created_at) SELECT $1,$2,id,'2020-01-01' FROM departments WHERE normalized_name='tech-my-it' RETURNING id", [name, `T${randomBytes(4).toString("hex")}`])).rows[0].id as string;
}
function submission(projectId: string, clientId = key(), summary = "Implemented the evidence-backed change") {
  return { projectId, clientId, expectedCheckpointRevision: 0, baselineDate: today, entries: [{ workDate: today, summary, status: "completed", evidence: [{ id: `commit:${key()}`, kind: "commit", reference: "integration commit" }] }], blockers: [], sources: {}, idempotencyKey: key() };
}
async function claimed(id: string): Promise<ClaimedJob> {
  const attempt = key();
  return (await db.query("UPDATE kb_jobs SET state='running',attempt_token=$2,attempts=attempts+1,lease_until=now()+interval '90 seconds' WHERE id=$1 RETURNING *", [id, attempt])).rows[0] as ClaimedJob;
}
async function signIn(username: string) {
  const r = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ username, password: passwords.get(username) }) });
  if (!r.ok) throw new Error(`Sign-in failed with HTTP ${r.status}`);
  const cookies = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  expect(Boolean(cookies)).toBe(true);
  return cookies;
}

describe.skipIf(!enabled)("PostgreSQL, accounts, MCP, and worker integration", () => {
  beforeAll(async () => {
    db = await import("../lib/db"); authentication = await import("../lib/auth");
    await db.ensureSchema();
    const { getMigrations } = await import("better-auth/db/migration");
    await (await getMigrations(authentication.auth.options)).runMigrations();
    accounts = await import("../lib/accounts"); knowledge = await import("../lib/knowledge");
    jobs = await import("../lib/job-processing"); reporting = await import("../lib/reporting");
    today = (await import("../lib/knowledge-utils")).malaysiaToday();
    const initialPassword = process.env.PMS_INITIAL_PASSWORD!;
    const first = await accounts.createFirstEmployee({ displayName: "First Employee", password: initialPassword });
    const { principalForAuthUser } = await import("../lib/auth-session");
    const firstAuthId = (await db.query("SELECT auth_user_id FROM kb_account_links WHERE employee_id=$1", [first.employeeId])).rows[0].auth_user_id;
    firstEmployee = await principalForAuthUser(firstAuthId);
    const departmentId = (await db.query("SELECT id FROM departments WHERE normalized_name='tech-my-it'")).rows[0].id;
    const people: Principal[] = [];
    for (const name of ["Alice", "Bob", "Coordinator"]) {
      const created = await accounts.createEmployee(firstEmployee, { displayName: name, departmentId, idempotencyKey: key() });
      const username = accounts.loginUsername(created.employeeId); passwords.set(username, initialPassword);
      const authUserId = (await db.query("SELECT auth_user_id FROM kb_account_links WHERE employee_id=$1", [created.employeeId])).rows[0].auth_user_id;
      people.push(await principalForAuthUser(authUserId));
    }
    [alice, bob, manager] = people;
    const authRoute = await import("../app/api/auth/[...all]/route");
    const mcpRoute = await import("../app/mcp/route");
    const usersRoute = await import("../app/api/users/route");
    const projectsRoute = await import("../app/api/projects/route");
    const reportsRoute = await import("../app/api/reports/route");
    const meRoute = await import("../app/api/me/route");
    const itemsRoute = await import("../app/api/work-items/route");
    const commentsRoute = await import("../app/api/comments/route");
    const exportRoute = await import("../app/api/export/route");
    const departmentsRoute = await import("../app/api/departments/route");
    const attachmentsRoute = await import("../app/api/attachments/route");
    server = createServer(async (req, res) => {
      try {
        const buffers: Buffer[] = []; for await (const chunk of req) buffers.push(Buffer.from(chunk));
        const request = new Request(`${base}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, ...(!["GET", "HEAD"].includes(req.method ?? "GET") ? { body: Buffer.concat(buffers).toString() } : {}) });
        const path = new URL(request.url).pathname, method = request.method;
        let response: Response;
        if (path.startsWith("/api/auth/") || path.startsWith("/.well-known/")) response = await authRoute.GET(request);
        else if (path === "/mcp") response = await mcpRoute.POST(request);
        else if (path === "/api/users") response = method === "GET" ? await usersRoute.GET(request) : method === "POST" ? await usersRoute.POST(request) : await usersRoute.PATCH(request);
        else if (path === "/api/projects") response = method === "GET" ? await projectsRoute.GET(request) : await projectsRoute.POST(request);
        else if (path === "/api/reports") response = method === "GET" ? await reportsRoute.GET(request) : await reportsRoute.POST(request);
        else if (path === "/api/me") response = await meRoute.GET(request);
        else if (path === "/api/work-items") response = method === "GET" ? await itemsRoute.GET(request) : method === "POST" ? await itemsRoute.POST(request) : await itemsRoute.PATCH(request);
        else if (path === "/api/comments") response = method === "GET" ? await commentsRoute.GET(request) : await commentsRoute.POST(request);
        else if (path === "/api/export") response = await exportRoute.GET(request);
        else if (path === "/api/departments") response = await departmentsRoute.GET(request);
        else if (path === "/api/attachments") response = await attachmentsRoute.GET(request);
        else response = new Response(null, { status: 404 });
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
        if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.statusCode = 500; res.end("Integration request failed"); }
    });
    await new Promise<void>((resolve, reject) => { server.listen(Number(new URL(base).port), "127.0.0.1", resolve); server.on("error", reject); });
  }, 60000);
  afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } if (db) await db.pool.end(); });

  it("password-protects employee accounts and gives every employee access", async () => {
    expect(alice.usingInitialPassword).toBe(true);
    await expect(accounts.changeOwnPassword(alice, { currentPassword: process.env.PMS_INITIAL_PASSWORD, newPassword: process.env.PMS_INITIAL_PASSWORD, idempotencyKey: key() })).rejects.toMatchObject({ code: "PERSONAL_PASSWORD_REQUIRED" });
    expect(new Set([alice.employeeId, bob.employeeId, manager.employeeId]).size).toBe(3);
    const links = await db.query("SELECT count(*)::int AS count FROM kb_account_links"); expect(links.rows[0].count).toBe(4);
    const firstId = alice.employeeId;
    expect((await accounts.listAccounts(firstEmployee)).some((x) => x.id === firstId && x.passwordProtected)).toBe(true);
    const departmentId = (await db.query("SELECT id FROM departments LIMIT 1")).rows[0].id;
    const created = await accounts.createEmployee(alice, { displayName: "Another Teammate", departmentId, idempotencyKey: key() });
    expect(Boolean(created.employeeId)).toBe(true);

  });
  it("protects legacy reads, blocks public signup, and ignores spoofed authorship headers", async () => {
    expect((await fetch(`${base}/api/users`)).status).toBe(401);
    const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "Unauthorized", email: "unauthorized@integration.invalid", password: randomBytes(24).toString("hex") }) });
    expect(signup.ok).toBe(false);
    const cookie = await signIn(accounts.loginUsername(alice.employeeId));
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie, "X-Actor-Id": bob.employeeId } });
    expect((await me.json()).principal.employeeId).toBe(alice.employeeId);
    const create = await fetch(`${base}/api/users`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: "{}" });
    expect(create.status).toBe(422);
    const foreign = await fetch(`${base}/api/projects`, { method: "POST", headers: { Cookie: cookie, Origin: "https://unrelated.invalid", "Content-Type": "application/json" }, body: "{}" });
    expect(foreign.status).toBe(403);
  });
  it("backfills existing identities once and never resets a changed employee password", async () => {
    const legacyId = key();
    await db.query("INSERT INTO users(id,display_name,normalized_name) VALUES($1,'Legacy employee','legacy employee')", [legacyId]);
    await db.query("INSERT INTO user_departments(user_id,department_id) SELECT $1,id FROM departments LIMIT 1", [legacyId]);
    expect(await accounts.provisionEmployeeAccounts()).toBe(1);
    const username = accounts.loginUsername(legacyId); passwords.set(username, process.env.PMS_INITIAL_PASSWORD!);
    const cookie = await signIn(username);
    const { requirePrincipal } = await import("../lib/auth-session");
    const principal = await requirePrincipal(new Request(`${base}/api/me`, { headers: { Cookie: cookie } }));
    const newPassword = randomBytes(24).toString("hex");
    const change = { currentPassword: passwords.get(username), newPassword, idempotencyKey: key() };
    await accounts.changeOwnPassword(principal, change);
    expect(await accounts.changeOwnPassword(principal, change)).toMatchObject({ updated: true });
    const oldLogin = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: passwords.get(username) }) });
    expect(oldLogin.ok).toBe(false);
    passwords.set(username, newPassword);
    await signIn(username);
    expect(await accounts.provisionEmployeeAccounts()).toBe(0);
    await signIn(username);
    expect((await db.query("SELECT employee_id,must_change_password FROM kb_account_links WHERE auth_user_id=$1", [principal.authUserId])).rows[0]).toMatchObject({ employee_id: legacyId, must_change_password: false });
  });
  it("preserves authenticated ticket assignments, comments, export, and notification behavior", async () => {
    for (const path of ["work-items", "comments", "export", "departments", "attachments"]) expect((await fetch(`${base}/api/${path}`)).status).toBe(401);
    const cookie = await signIn(accounts.loginUsername(alice.employeeId));
    const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json", "X-Actor-Id": bob.employeeId };
    const departments = await (await fetch(`${base}/api/departments`, { headers })).json();
    const departmentId = (await db.query("SELECT id FROM departments WHERE normalized_name='tech-my-it'")).rows[0].id;
    expect(departments.departments.some((d: { id: string }) => d.id === departmentId)).toBe(true);
    const projectId = await newProject("Ticket regression project");
    const created = await fetch(`${base}/api/work-items`, { method: "POST", headers, body: JSON.stringify({ projectId, type: "ticket", title: "Preserved assignment", assigneeId: bob.employeeId, reportToId: manager.employeeId }) });
    expect(created.status).toBe(201); const ticket = (await created.json()).item;
    expect(ticket.createdById).toBe(alice.employeeId); expect(ticket.assigneeId).toBe(bob.employeeId);
    const updated = await fetch(`${base}/api/work-items`, { method: "PATCH", headers, body: JSON.stringify({ id: ticket.id, status: "in_progress" }) });
    expect(updated.status).toBe(200); expect((await updated.json()).pushDelivery).toEqual({ sent: 0, failed: 0 });
    const commented = await fetch(`${base}/api/comments`, { method: "POST", headers, body: JSON.stringify({ workItemId: ticket.id, body: "Signed-in employee comment" }) });
    expect(commented.status).toBe(201); expect((await commented.json()).comment.authorId).toBe(alice.employeeId);
    const attachmentId = key();
    await db.query("INSERT INTO attachments(id,work_item_id,original_filename,media_type,byte_size,object_key,uploaded_by_id,upload_state) VALUES($1,$2,'fixture.txt','text/plain',12,$3,$4,'complete')", [attachmentId, ticket.id, `synthetic/${attachmentId}`, alice.employeeId]);
    const attachments = await fetch(`${base}/api/attachments?workItemId=${ticket.id}`, { headers });
    expect(attachments.status).toBe(200); expect((await attachments.json()).attachments[0].id).toBe(attachmentId);
    const exported = await fetch(`${base}/api/export?departmentId=${departmentId}&projectId=${projectId}`, { headers });
    expect(exported.status).toBe(200); const data = await exported.json();
    expect(data.projects[0].tickets[0]).toMatchObject({ assigneeId: bob.employeeId, updatedById: alice.employeeId });
    expect(data.projects[0].tickets[0].comments).toHaveLength(1); expect(data.projects[0].tickets[0].attachments).toHaveLength(1);
  });
  it("commits simultaneous employee submissions and deduplicates a lost-response retry", async () => {
    const projectId = await newProject(), a = submission(projectId), b = submission(projectId);
    const [one, two] = await Promise.all([knowledge.submitProgress(alice, a), knowledge.submitProgress(bob, b)]);
    expect(one.entryIds.length + two.entryIds.length).toBe(2);
    const retried = await knowledge.submitProgress(alice, a); expect(retried).toEqual(one);
    await expect(knowledge.submitProgress(alice, { ...a, entries: [] })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    const result = await db.query("SELECT count(*)::int AS n FROM kb_progress WHERE project_id=$1", [projectId]); expect(result.rows[0].n).toBe(2);
  });
  it("serializes concurrent identical requests and rejects stale checkpoints without partial writes", async () => {
    const projectId = await newProject(), a = submission(projectId);
    const [one, two] = await Promise.all([knowledge.submitProgress(alice, a), knowledge.submitProgress(alice, a)]); expect(one).toEqual(two);
    await expect(knowledge.submitProgress(alice, { ...a, idempotencyKey: key(), entries: [{ ...a.entries[0], evidence: [{ ...a.entries[0].evidence[0], id: key() }] }] })).rejects.toMatchObject({ code: "CHECKPOINT_CHANGED" });
    expect((await db.query("SELECT count(*)::int AS n FROM kb_progress WHERE project_id=$1", [projectId])).rows[0].n).toBe(1);
  });
  it("deduplicates evidence across devices and preserves unavailable source checkpoints", async () => {
    const projectId = await newProject(), a = submission(projectId);
    a.sources = { chat: { kind: "conversation", cursor: "17", observedAt: new Date().toISOString() } };
    await knowledge.submitProgress(alice, a);
    const other = await knowledge.submitProgress(alice, { ...a, clientId: key(), idempotencyKey: key(), sources: {} });
    expect(other.duplicateEntriesSkipped).toBe(1);
    await knowledge.submitProgress(alice, { ...a, expectedCheckpointRevision: 1, entries: [], idempotencyKey: key(), sources: {}, collectionGaps: ["Conversation unavailable"] });
    const context = await knowledge.progressContext(alice, { projectId, clientId: a.clientId });
    expect((context.checkpoint?.sources as Record<string, { cursor: string }>).chat.cursor).toBe("17");
  });
  it("allows explicit corrections without erasing the original progress record", async () => {
    const projectId = await newProject(), a = submission(projectId);
    const first = await knowledge.submitProgress(alice, a);
    await knowledge.submitProgress(alice, { ...a, expectedCheckpointRevision: 1, idempotencyKey: key(), entries: [{ ...a.entries[0], summary: "Corrected factual description", supersedesId: first.entryIds[0] }] });
    const history = await knowledge.queryProgress({ projectId });
    expect(history.entries.length).toBe(1); expect(history.entries[0].summary).toBe("Corrected factual description");
    expect((await db.query("SELECT count(*)::int AS n FROM kb_progress WHERE project_id=$1", [projectId])).rows[0].n).toBe(2);
  });
  it("requires semantic review and refuses a stale documentation commit", async () => {
    const projectId = await newProject();
    const input = { projectId, expectedCatalogRevision: 0, changes: [{ topic: "overview", title: "Purpose", content: "An evidence-based manufacturing project.", evidence: [{ id: key(), kind: "file", reference: "README.md" }] }], idempotencyKey: key() };
    const one = await knowledge.prepareDocumentation(alice, input), two = await knowledge.prepareDocumentation(bob, { ...input, idempotencyKey: key(), changes: [{ ...input.changes[0], topic: "architecture", content: "A transactional API with a separate report worker." }] });
    await jobs.processClaimedJob(await claimed(one.id), fakeModel); await jobs.processClaimedJob(await claimed(two.id), fakeModel);
    const commit = await knowledge.commitDocumentation(alice, { proposalId: one.id, expectedCatalogRevision: 0, idempotencyKey: key() }); expect(commit.saved).toHaveLength(1);
    await expect(knowledge.commitDocumentation(bob, { proposalId: two.id, expectedCatalogRevision: 0, idempotencyKey: key() })).rejects.toMatchObject({ code: "CATALOG_CHANGED" });
    const duplicate = await knowledge.prepareDocumentation(alice, { ...input, expectedCatalogRevision: 1, idempotencyKey: key() });
    await jobs.processClaimedJob(await claimed(duplicate.id), fakeModel);
    const noOp = await knowledge.commitDocumentation(alice, { proposalId: duplicate.id, expectedCatalogRevision: 1, idempotencyKey: key() }); expect(noOp.duplicatesSkipped).toBe(1); expect(noOp.catalogRevision).toBe(1);
    const paraphrase = await jobs.reviewDocumentation({ ...input, changes: [{ ...input.changes[0], content: "Manufacturing work grounded in recorded evidence." }], documents: [{ ...input.changes[0], version: 1 }] }, async () => ({ decision: "duplicate", reason: "Same information in different words." }));
    expect(paraphrase.decisions[0].decision).toBe("duplicate");
  });
  it("blocks unresolved semantic conflicts without publishing a page", async () => {
    const projectId = await newProject();
    const proposal = await knowledge.prepareDocumentation(alice, { projectId, expectedCatalogRevision: 0, changes: ["overview", "architecture"].map((topic) => ({ topic, title: topic, content: `Overlapping ${topic} explanation.`, evidence: [{ id: key(), kind: "file", reference: "README.md" }] })), idempotencyKey: key() });
    await jobs.processClaimedJob(await claimed(proposal.id), async () => ({ decision: "conflict", reason: "Use the existing canonical explanation." }));
    await expect(knowledge.commitDocumentation(alice, { proposalId: proposal.id, expectedCatalogRevision: 0, idempotencyKey: key() })).rejects.toMatchObject({ code: "DOCUMENTATION_CONFLICT" });
    expect((await knowledge.readDocumentation({ projectId })).total).toBe(0);
  });
  it("carries earlier open blockers into reports and reconstructs their state at the end date", async () => {
    const projectId = await newProject("Historical blocker project"), a = submission(projectId);
    const yesterday = new Date(`${today}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1); const earlier = yesterday.toISOString().slice(0, 10);
    await knowledge.submitProgress(alice, { ...a, entries: [], blockers: [{ key: "management-approval", state: "open", effectiveDate: earlier, summary: "Waiting for management approval", outsideParty: "Management", actionNeeded: "Approve the release", affectedEmployeeIds: [alice.employeeId], evidence: [{ id: key(), kind: "note", reference: "Employee confirmation" }] }] });
    const context = await knowledge.progressContext(alice, { projectId, clientId: a.clientId });
    const expectedEventId = context.openBlockers[0].id;
    const openReport = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "en", idempotencyKey: key() });
    await knowledge.submitProgress(alice, { ...a, expectedCheckpointRevision: 1, entries: [], idempotencyKey: key(), blockers: [{ key: "management-approval", expectedEventId, state: "resolved", effectiveDate: today, summary: "Management approved the release", outsideParty: "Management", actionNeeded: "Approval received", affectedEmployeeIds: [alice.employeeId], evidence: [{ id: key(), kind: "note", reference: "Approval received" }] }] });
    const frozen = (await db.query("SELECT input FROM kb_jobs WHERE id=$1", [openReport.id])).rows[0].input;
    expect(frozen.blockers.some((b: { projectId: string }) => b.projectId === projectId)).toBe(true);
    const historical = await reporting.generateReport(manager, { startDate: earlier, endDate: earlier, language: "en", idempotencyKey: key() });
    const snap = (await db.query("SELECT input FROM kb_jobs WHERE id=$1", [historical.id])).rows[0].input;
    expect(snap.blockers.some((b: { projectId: string }) => b.projectId === projectId)).toBe(true);
    const latest = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "en", idempotencyKey: key() });
    expect((await db.query("SELECT input FROM kb_jobs WHERE id=$1", [latest.id])).rows[0].input.blockers.some((b: { projectId: string }) => b.projectId === projectId)).toBe(false);
    await db.query("UPDATE kb_jobs SET state='failed' WHERE id=ANY($1::uuid[])", [[openReport.id, historical.id, latest.id]]);
  });
  it("publishes a complete frozen report with coverage and supports both languages", async () => {
    const projectId = await newProject("Frozen project");
    await knowledge.submitProgress(alice, submission(projectId));
    const job = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "zh-CN", idempotencyKey: key() });
    await knowledge.submitProgress(bob, submission(projectId));
    const owned = await claimed(job.id); expect(await jobs.processClaimedJob(owned, fakeModel)).toBe(true);
    const result = await reporting.getReports(manager, { jobId: job.id });
    const report = "report" in result ? result.report : null;
    expect(Boolean(report)).toBe(true);
    const body = report!.report as { projects: { id: string; employees: { id: string }[] }[]; coverage: { projectsWithoutSubmissions: string[] } };
    expect(body.projects.find((p) => p.id === projectId)?.employees.map((e) => e.id)).toEqual([alice.employeeId]);
    expect(body.coverage.projectsWithoutSubmissions.length).toBeGreaterThan(0);
    expect(String(report!.markdown).startsWith("# 工作报告")).toBe(true);
    expect((await reporting.getReports(alice, {})).history?.length).toBeGreaterThan(0);
  });
  it("does not publish missing or fabricated source entries and exhausts bounded retries", async () => {
    const projectId = await newProject(); await knowledge.submitProgress(alice, submission(projectId));
    const job = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "en", idempotencyKey: key() });
    const invalid: ModelCall = async () => ({ bullets: [{ text: "Invented output", source_entry_ids: ["unknown"] }] });
    for (let i = 0; i < 3; i++) await jobs.processClaimedJob(await claimed(job.id), invalid);
    const state = await knowledge.getJob(manager, { jobId: job.id }); expect(state.state).toBe("failed"); expect(state.attempts).toBe(3);
    expect((await db.query("SELECT count(*)::int AS n FROM kb_report_versions WHERE job_id=$1", [job.id])).rows[0].n).toBe(0);
  });
  it("fences an expired worker and lets two workers claim different queue rows", async () => {
    await db.query("UPDATE kb_jobs SET state='failed' WHERE state IN ('queued','running')");
    const a = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "en", idempotencyKey: key() });
    const b = await reporting.generateReport(manager, { startDate: today, endDate: today, language: "en", idempotencyKey: key() });
    const [one, two] = await Promise.all([jobs.claimJob(), jobs.claimJob()]); expect(one!.id).not.toBe(two!.id);
    expect(new Set([one!.id, two!.id])).toEqual(new Set([a.id, b.id]));
    await db.query("UPDATE kb_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [one!.id]);
    const replacement = await jobs.claimJob(); expect(replacement!.id).toBe(one!.id);
    expect(await jobs.processClaimedJob(one!, fakeModel)).toBe(false);
    expect(await jobs.processClaimedJob(replacement!, fakeModel)).toBe(true);
    await jobs.processClaimedJob(two!, fakeModel);
  });
  it("completes browser OAuth with PKCE and calls MCP using the official client", async () => {
    const cookie = await signIn(accounts.loginUsername(manager.employeeId));
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`); expect(metadata.status).toBe(200);
    const discovery = await metadata.json(); expect(discovery.resource).toBe(`${base}/mcp`);
    const client = await authentication.auth.api.createOAuthClient({ headers: new Headers({ Cookie: cookie, Origin: base }), body: { client_name: "Integration Codex", redirect_uris: ["http://127.0.0.1:32456/callback"], token_endpoint_auth_method: "none", application_type: "native", grant_types: ["authorization_code", "refresh_token"], scope: "openid offline_access mcp:read mcp:write reports:read reports:generate" } });
    const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: "http://127.0.0.1:32456/callback", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "openid offline_access mcp:read mcp:write reports:read reports:generate", state: key(), resource: `${base}/mcp` });
    const authorize = await fetch(`${base}/api/auth/oauth2/authorize?${params}`, { redirect: "manual" });
    let location = authorize.headers.get("location");
    if (!location) { const body = await authorize.json(); location = body.url ?? body.redirect_uri; }
    expect(Boolean(location)).toBe(true);
    const loginUrl = new URL(location!, base);
    expect(loginUrl.pathname).toBe("/sign-in");
    const login = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ username: accounts.loginUsername(manager.employeeId), password: passwords.get(accounts.loginUsername(manager.employeeId)), oauth_query: loginUrl.searchParams.get("oauth_query") ?? loginUrl.search.slice(1) }), redirect: "manual" });
    const loginData = await login.json();
    const oauthCookie = login.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    expect(login.ok).toBe(true);
    const consentUrl = new URL(loginData.url ?? loginData.redirect_uri, base);
    const consent = await fetch(`${base}/api/auth/oauth2/consent`, { method: "POST", headers: { Cookie: oauthCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ accept: true, oauth_query: consentUrl.searchParams.get("oauth_query") ?? consentUrl.search.slice(1) }), redirect: "manual" });
    let callback = consent.headers.get("location");
    if (!callback) { const body = await consent.json(); callback = body.url ?? body.redirect_uri; }
    expect(Boolean(callback)).toBe(true);
    const code = new URL(callback!).searchParams.get("code"); expect(Boolean(code)).toBe(true);
    const token = await fetch(`${base}/api/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code: code!, code_verifier: verifier, redirect_uri: "http://127.0.0.1:32456/callback", resource: `${base}/mcp` }) });
    expect(token.status).toBe(200); const tokens = await token.json(); expect(Boolean(tokens.access_token)).toBe(true);
    const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
    const mcp = new Client({ name: "integration-test", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    const tools = await mcp.listTools(); expect(tools.tools.some((t) => t.name === "progress.submit")).toBe(true);
    const result = await mcp.callTool({ name: "identity.me", arguments: {} }); expect(result.isError).not.toBe(true);
    expect((result.structuredContent as Record<string, unknown>).employeeId).toBe(manager.employeeId);
    await accounts.changeAccount(firstEmployee, { employeeId: manager.employeeId, revokeSessions: true, idempotencyKey: key() });
    const revoked = await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: "{}" }); expect(revoked.status).toBe(401);
    await mcp.close();
  }, 30000);
});
