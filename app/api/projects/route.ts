import { requirePrincipal } from "@/lib/auth-session";
import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";
import { requireActiveDepartment, requireActor, requireMembership } from "@/lib/domain";
import { projectInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePrincipal(request);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const departmentId = new URL(request.url).searchParams.get("departmentId");
    const result = await query(
      `SELECT p.id, p.name, p.key, p.description, p.department_id,
              d.name AS department_name, p.is_archived, p.created_at, p.updated_at
       FROM projects p
       JOIN departments d ON d.id = p.department_id
       WHERE ($1::boolean OR p.is_archived = false)
         AND ($2::uuid IS NULL OR p.department_id = $2)
       ORDER BY p.is_archived, p.name`,
      [includeArchived, departmentId]
    );
    return NextResponse.json({ projects: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePrincipal(request);
    const actor = await actorId(request);
    await requireActor(actor);
    const input = projectInputSchema.parse(await requestJson(request));
    await requireActiveDepartment(input.departmentId);
    await requireMembership(actor, input.departmentId);
    const result = await query(
      `INSERT INTO projects (name, key, description, department_id)
       VALUES ($1, upper($2), $3, $4)
       RETURNING id, name, key, description, department_id,
         (SELECT name FROM departments WHERE id = $4) AS department_name,
         is_archived, created_at, updated_at`,
      [input.name, input.key, input.description, input.departmentId]
    );
    await query(
      `INSERT INTO audit_events (project_id, actor_id, action, new_value)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [result.rows[0].id, actor, JSON.stringify({ name: input.name, key: input.key.toUpperCase() })]
    );
    return NextResponse.json({ project: rowToCamel(result.rows[0]) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requirePrincipal(request);
    const actor = await actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const id = String(body.id ?? "");
    if (!id) throw new ApiError(422, "ID_REQUIRED", "A project ID is required.");
    const current = await query("SELECT * FROM projects WHERE id = $1", [id]);
    if (!current.rowCount) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of [
      ["name", "name"],
      ["description", "description"],
      ["isArchived", "is_archived"]
    ] as const) {
      if (body[field] !== undefined) {
        values.push(body[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }
    if (body.departmentId !== undefined) {
      const departmentId = String(body.departmentId);
      await requireActiveDepartment(departmentId);
      const incompatible = await query(
        `SELECT 1
         FROM work_items wi
         WHERE wi.project_id = $1 AND NOT wi.is_archived
           AND (
             (wi.assignee_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM user_departments ud
               JOIN users u ON u.id = ud.user_id AND NOT u.is_archived
               WHERE ud.user_id = wi.assignee_id AND ud.department_id = $2
             ))
             OR
             (wi.report_to_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM user_departments ud
               JOIN users u ON u.id = ud.user_id AND NOT u.is_archived
               WHERE ud.user_id = wi.report_to_id AND ud.department_id = $2
             ))
           )
         LIMIT 1`,
        [id, departmentId]
      );
      if (incompatible.rowCount) {
        throw new ApiError(422, "PROJECT_MOVE_ASSIGNMENTS", "Clear or update incompatible assignments before moving this project.");
      }
      values.push(departmentId);
      updates.push(`department_id = $${values.length}`);
    }
    if (!updates.length) throw new ApiError(422, "NO_CHANGES", "No supported changes were provided.");
    values.push(id);
    const result = await query(
      `UPDATE projects SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING id, name, key, description, department_id,
         (SELECT name FROM departments WHERE id = department_id) AS department_name,
         is_archived, created_at, updated_at`,
      values
    );
    await query(
      `INSERT INTO audit_events (project_id, actor_id, action, old_value, new_value)
       VALUES ($1, $2, 'updated', $3::jsonb, $4::jsonb)`,
      [id, actor, JSON.stringify(rowToCamel(current.rows[0])), JSON.stringify(body)]
    );
    return NextResponse.json({ project: rowToCamel(result.rows[0]) });
  } catch (error) {
    return jsonError(error);
  }
}
