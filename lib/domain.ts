import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, rowToCamel } from "./db";

export async function requireActor(id: string) {
  const result = await query(
    "SELECT id, display_name FROM users WHERE id = $1 AND is_archived = false",
    [id]
  );
  if (!result.rowCount) {
    throw new ApiError(400, "ACTOR_INVALID", "The selected user no longer exists or is archived.");
  }
  return result.rows[0];
}

export async function requireActiveDepartment(id: string) {
  const result = await query(
    "SELECT id, name FROM departments WHERE id = $1 AND is_archived = false",
    [id]
  );
  if (!result.rowCount) {
    throw new ApiError(400, "DEPARTMENT_INVALID", "The selected department does not exist or is archived.");
  }
  return result.rows[0];
}

export async function requireMembership(userId: string, departmentId: string) {
  const result = await query(
    `SELECT 1 FROM user_departments ud
     JOIN departments d ON d.id = ud.department_id AND NOT d.is_archived
     WHERE ud.user_id = $1 AND ud.department_id = $2`,
    [userId, departmentId]
  );
  if (!result.rowCount) {
    throw new ApiError(422, "DEPARTMENT_MEMBERSHIP_REQUIRED", "The selected user is not a member of this department.");
  }
}

export async function validateProjectPeople(
  client: PoolClient,
  projectId: string,
  people: { assigneeId?: string | null; reportToId?: string | null }
) {
  const ids = [...new Set([people.assigneeId, people.reportToId].filter(Boolean))] as string[];
  if (!ids.length) return;
  const result = await client.query(
    `SELECT u.id
     FROM users u
     JOIN user_departments ud ON ud.user_id = u.id
     JOIN projects p ON p.department_id = ud.department_id
     WHERE p.id = $1 AND u.id = ANY($2::uuid[]) AND NOT u.is_archived`,
    [projectId, ids]
  );
  if (result.rowCount !== ids.length) {
    throw new ApiError(
      422,
      "PROJECT_DEPARTMENT_USER_REQUIRED",
      "Assignee and Report To users must be active members of the project's department."
    );
  }
}

export async function audit(
  client: PoolClient,
  input: {
    projectId?: string | null;
    workItemId?: string | null;
    actorId: string;
    action: string;
    fieldName?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `INSERT INTO audit_events
      (project_id, work_item_id, actor_id, action, field_name, old_value, new_value, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
    [
      input.projectId ?? null,
      input.workItemId ?? null,
      input.actorId,
      input.action,
      input.fieldName ?? null,
      input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      input.newValue === undefined ? null : JSON.stringify(input.newValue),
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export function mapRows<T = Record<string, unknown>>(rows: Record<string, unknown>[]) {
  return rows.map((row) => rowToCamel(row) as T);
}

export const workItemSelect = `
  SELECT
    wi.id, wi.project_id, wi.type, wi.parent_id, wi.key, wi.title, wi.description,
    wi.status, wi.assignee_id, assignee.display_name AS assignee_name,
    wi.report_to_id, reporter.display_name AS report_to_name,
    wi.created_by_id, creator.display_name AS created_by_name,
    wi.updated_by_id, updater.display_name AS updated_by_name,
    wi.blocked_reason, wi.estimated_completion_date, wi.is_archived,
    wi.created_at, wi.updated_at, wi.completed_at,
    COALESCE(progress.subtask_total, 0)::int AS subtask_total,
    COALESCE(progress.subtask_completed, 0)::int AS subtask_completed,
    CASE
      WHEN COALESCE(progress.subtask_active, 0) > 0
        THEN round(progress.subtask_completed * 100.0 / progress.subtask_active)::int
      WHEN COALESCE(progress.subtask_total, 0) > 0 THEN NULL
      WHEN wi.status = 'completed' THEN 100
      WHEN wi.status = 'descoped' THEN NULL
      ELSE 0
    END AS progress_percent
  FROM work_items wi
  JOIN users creator ON creator.id = wi.created_by_id
  JOIN users updater ON updater.id = wi.updated_by_id
  LEFT JOIN users assignee ON assignee.id = wi.assignee_id
  LEFT JOIN users reporter ON reporter.id = wi.report_to_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE NOT child.is_archived)::int AS subtask_total,
      count(*) FILTER (
        WHERE NOT child.is_archived AND child.status = 'completed'
      )::int AS subtask_completed,
      count(*) FILTER (
        WHERE NOT child.is_archived AND child.status <> 'descoped'
      )::int AS subtask_active
    FROM work_items child
    WHERE child.parent_id = wi.id
  ) progress ON true
`;
