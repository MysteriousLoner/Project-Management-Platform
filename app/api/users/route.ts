import { requirePrincipal } from "@/lib/auth-session";
import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { normalizeName, query, rowToCamel, transaction } from "@/lib/db";
import { requireActiveDepartment, requireActor } from "@/lib/domain";
import { userInputSchema } from "@/lib/validation";
import { insertAccount, initialPassword } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePrincipal(request);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const departmentId = new URL(request.url).searchParams.get("departmentId");
    const result = await query(
      `SELECT u.id, u.display_name, u.avatar_color, u.is_archived, u.created_at, u.updated_at,
              COALESCE(array_agg(ud.department_id ORDER BY ud.department_id)
                FILTER (WHERE ud.department_id IS NOT NULL), '{}') AS department_ids
       FROM users u
       LEFT JOIN user_departments ud ON ud.user_id = u.id
       WHERE ($1::boolean OR u.is_archived = false)
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM user_departments scope
           WHERE scope.user_id = u.id AND scope.department_id = $2
         ))
       GROUP BY u.id
       ORDER BY u.is_archived, u.display_name`,
      [includeArchived, departmentId]
    );
    return NextResponse.json({ users: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePrincipal(request);
    const input = userInputSchema.parse(await requestJson(request));
    await requireActiveDepartment(input.departmentId);
    const colors = ["#5b5bd6", "#0e9384", "#d97706", "#dc2626", "#7c3aed", "#0284c7"];
    const color = input.avatarColor ?? colors[Math.floor(Math.random() * colors.length)];
    const user = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO users (display_name, normalized_name, avatar_color)
         VALUES ($1, $2, $3)
         RETURNING id, display_name, avatar_color, is_archived, created_at, updated_at`,
        [input.displayName, normalizeName(input.displayName), color]
      );
      await client.query(
        "INSERT INTO user_departments (user_id, department_id) VALUES ($1, $2)",
        [result.rows[0].id, input.departmentId]
      );
      await insertAccount(client, result.rows[0].id, initialPassword(), input.displayName);
      return { ...result.rows[0], department_ids: [input.departmentId] };
    });
    return NextResponse.json({ user: rowToCamel(user) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requirePrincipal(request);
    await requireActor(await actorId(request));
    const body = await requestJson(request);
    const id = String(body.id ?? "");
    if (!id) throw new ApiError(422, "ID_REQUIRED", "A user ID is required.");
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.displayName !== undefined) {
      const displayName = userInputSchema.shape.displayName.parse(body.displayName);
      values.push(displayName);
      updates.push(`display_name = $${values.length}`);
      values.push(normalizeName(displayName));
      updates.push(`normalized_name = $${values.length}`);
    }
    if (body.isArchived !== undefined) {
      values.push(Boolean(body.isArchived));
      updates.push(`is_archived = $${values.length}`);
    }
    if (!updates.length) throw new ApiError(422, "NO_CHANGES", "No supported changes were provided.");
    values.push(id);
    const result = await query(
      `UPDATE users SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING id, display_name, avatar_color, is_archived, created_at, updated_at`,
      values
    );
    if (!result.rowCount) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
    const memberships = await query(
      "SELECT department_id FROM user_departments WHERE user_id = $1 ORDER BY department_id",
      [id]
    );
    return NextResponse.json({
      user: rowToCamel({
        ...result.rows[0],
        department_ids: memberships.rows.map((row) => row.department_id)
      })
    });
  } catch (error) {
    return jsonError(error);
  }
}
