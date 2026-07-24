import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";
import { requireActor } from "@/lib/domain";
import { projectInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const result = await query(
      `SELECT id, name, key, description, is_archived, created_at, updated_at
       FROM projects
       WHERE ($1::boolean OR is_archived = false)
       ORDER BY is_archived, name`,
      [includeArchived]
    );
    return NextResponse.json({ projects: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const input = projectInputSchema.parse(await requestJson(request));
    const result = await query(
      `INSERT INTO projects (name, key, description)
       VALUES ($1, upper($2), $3)
       RETURNING id, name, key, description, is_archived, created_at, updated_at`,
      [input.name, input.key, input.description]
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
    const actor = actorId(request);
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
    if (!updates.length) throw new ApiError(422, "NO_CHANGES", "No supported changes were provided.");
    values.push(id);
    const result = await query(
      `UPDATE projects SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING id, name, key, description, is_archived, created_at, updated_at`,
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
