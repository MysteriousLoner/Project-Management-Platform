import { z } from "zod";

export type Principal = { authUserId: string; employeeId: string; displayName: string; usingInitialPassword: boolean; sessionId?: string };
export const id = z.uuid();
export const date = z.iso.date();
export const key = z.string().min(8).max(200);
export const evidenceSchema = z.object({
  id: z.string().min(1).max(300),
  kind: z.enum(["conversation", "commit", "working_tree", "ticket", "file", "note"]),
  reference: z.string().min(1).max(1000)
}).strict();
export const topicSchema = z.enum(["overview", "architecture", "setup", "interfaces", "deployment", "decisions", "operating-notes"]);
export const documentChangeSchema = z.object({
  topic: topicSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(24000),
  evidence: z.array(evidenceSchema).min(1).max(100)
}).strict();
export const prepareDocumentationSchema = z.object({
  projectId: id,
  expectedCatalogRevision: z.number().int().nonnegative(),
  changes: z.array(documentChangeSchema).min(1).max(7),
  idempotencyKey: key
}).strict();
export const progressSubmissionSchema = z.object({
  projectId: id,
  clientId: z.string().min(8).max(100),
  expectedCheckpointRevision: z.number().int().nonnegative(),
  baselineDate: date,
  entries: z.array(z.object({
    workDate: date,
    summary: z.string().trim().min(1).max(4000),
    status: z.enum(["completed", "in_progress"]),
    evidence: z.array(evidenceSchema).min(1).max(100),
    supersedesId: id.optional()
  }).strict()).max(250),
  blockers: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    expectedEventId: id.nullable().default(null),
    state: z.enum(["open", "resolved"]),
    effectiveDate: date,
    summary: z.string().trim().min(1).max(2000),
    outsideParty: z.string().trim().min(1).max(300),
    actionNeeded: z.string().trim().min(1).max(2000),
    affectedEmployeeIds: z.array(id).min(1).max(100),
    evidence: z.array(evidenceSchema).min(1).max(50)
  }).strict()).max(100),
  sources: z.record(z.string().min(1).max(300), z.object({
    kind: z.enum(["conversation", "git", "working_tree"]),
    cursor: z.string().max(100000),
    observedAt: z.iso.datetime()
  }).strict().superRefine((source, context) => {
    let valid = false;
    if (source.kind === "conversation") valid = /^\d{1,12}$/.test(source.cursor);
    if (source.kind === "working_tree") valid = /^[a-f0-9]{64}$/.test(source.cursor);
    if (source.kind === "git") {
      try { valid = z.object({ frontier: z.array(z.string().regex(/^[a-f0-9]{40,64}$/)).max(1000) }).strict().safeParse(JSON.parse(source.cursor)).success; } catch { /* Invalid opaque data must not be uploaded as a cursor. */ }
    }
    if (!valid) context.addIssue({ code: "custom", message: "Use a helper-generated source position, not message or file content" });
  })).refine((x) => Object.keys(x).length <= 2000 && JSON.stringify(x).length <= 500000, "Too many source checkpoints"),
  collectionGaps: z.array(z.string().max(500)).max(100).default([]),
  idempotencyKey: key
}).strict();
export const reportRequestSchema = z.object({
  startDate: date,
  endDate: date,
  language: z.enum(["en", "zh-CN"]),
  idempotencyKey: key
}).strict().refine((v) => v.startDate <= v.endDate, "Start date must be on or before end date");

export type ProgressEntry = {
  id: string; projectId: string; employeeId: string; workDate: string;
  summary: string; status: "completed" | "in_progress"; evidence: z.infer<typeof evidenceSchema>[];
};
export type ReportSnapshot = {
  capturedAt: string;
  startDate: string; endDate: string; language: "en" | "zh-CN";
  employees: { id: string; name: string }[];
  projects: { id: string; name: string; key: string }[];
  entries: ProgressEntry[];
  blockers: { id: string; projectId: string; projectName?: string; summary: string; outsideParty: string; actionNeeded: string; affectedEmployeeIds: string[]; affectedEmployees?: { id: string; name: string }[] }[];
};
export type ReportBody = {
  projects: { id: string; name: string; employees: { id: string; name: string; bullets: { text: string; sourceEntryIds: string[] }[] }[] }[];
  coverage: { projectsWithoutSubmissions: string[]; employeesWithoutSubmissions: string[] };
  blockers: { project: string; employees: string[]; summary: string; outsideParty: string; actionNeeded: string }[];
};
