import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { normalizeName, query, rowToCamel, transaction } from "@/lib/db";
import { requireActor } from "@/lib/domain";
import { departmentInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const result = await query(
      `SELECT d.id, d.name, d.is_archived, d.created_at, d.updated_at,
              count(DISTINCT p.id) FILTER (WHERE NOT p.is_archived)::int AS project_count,
              count(DISTINCT u.id) FILTER (WHERE NOT u.is_archived)::int AS user_count
       FROM departments d
       LEFT JOIN projects p ON p.department_id = d.id
       LEFT JOIN user_departments ud ON ud.department_id = d.id
       LEFT JOIN users u ON u.id = ud.user_id
       WHERE ($1::boolean OR NOT d.is_archived)
       GROUP BY d.id
       ORDER BY d.is_archived, d.name`,
      [includeArchived]
    );
    return NextResponse.json({ departments: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const input = departmentInputSchema.parse(await requestJson(request));
    const department = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO departments (name, normalized_name)
         VALUES ($1, $2)
         RETURNING id, name, is_archived, created_at, updated_at`,
        [input.name, normalizeName(input.name)]
      );
      await client.query(
        "INSERT INTO user_departments (user_id, department_id) VALUES ($1, $2)",
        [actor, result.rows[0].id]
      );
      await client.query(
        `INSERT INTO audit_events (actor_id, action, metadata)
         VALUES ($1, 'department_created', $2::jsonb)`,
        [actor, JSON.stringify({ departmentId: result.rows[0].id, name: input.name })]
      );
      return { ...result.rows[0], project_count: 0, user_count: 1 };
    });
    return NextResponse.json({ department: rowToCamel(department) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const id = String(body.id ?? "");
    if (!id) throw new ApiError(422, "ID_REQUIRED", "A department ID is required.");
    const isArchived = Boolean(body.isArchived);
    if (isArchived) {
      const linked = await query(
        `SELECT
           EXISTS (SELECT 1 FROM projects WHERE department_id = $1 AND NOT is_archived) AS has_projects,
           EXISTS (
             SELECT 1 FROM user_departments ud
             JOIN users u ON u.id = ud.user_id
             WHERE ud.department_id = $1 AND NOT u.is_archived
           ) AS has_users`,
        [id]
      );
      if (linked.rows[0]?.has_projects || linked.rows[0]?.has_users) {
        throw new ApiError(422, "DEPARTMENT_NOT_EMPTY", "Move active projects and remove active user memberships before archiving this department.");
      }
    }
    const result = await query(
      `UPDATE departments SET is_archived = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, name, is_archived, created_at, updated_at`,
      [isArchived, id]
    );
    if (!result.rowCount) throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department not found.");
    await query(
      `INSERT INTO audit_events (actor_id, action, metadata)
       VALUES ($1, $2, $3::jsonb)`,
      [actor, isArchived ? "department_archived" : "department_restored", JSON.stringify({ departmentId: id })]
    );
    return NextResponse.json({ department: rowToCamel(result.rows[0]) });
  } catch (error) {
    return jsonError(error);
  }
}
