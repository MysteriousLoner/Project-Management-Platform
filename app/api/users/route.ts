import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { normalizeName, query, rowToCamel } from "@/lib/db";
import { requireActor } from "@/lib/domain";
import { userInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const result = await query(
      `SELECT id, display_name, avatar_color, is_archived, created_at, updated_at
       FROM users
       WHERE ($1::boolean OR is_archived = false)
       ORDER BY is_archived, display_name`,
      [includeArchived]
    );
    return NextResponse.json({ users: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = userInputSchema.parse(await requestJson(request));
    const colors = ["#5b5bd6", "#0e9384", "#d97706", "#dc2626", "#7c3aed", "#0284c7"];
    const color = input.avatarColor ?? colors[Math.floor(Math.random() * colors.length)];
    const result = await query(
      `INSERT INTO users (display_name, normalized_name, avatar_color)
       VALUES ($1, $2, $3)
       RETURNING id, display_name, avatar_color, is_archived, created_at, updated_at`,
      [input.displayName, normalizeName(input.displayName), color]
    );
    return NextResponse.json({ user: rowToCamel(result.rows[0]) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireActor(actorId(request));
    const body = await requestJson(request);
    const id = String(body.id ?? "");
    if (!id) throw new ApiError(422, "ID_REQUIRED", "A user ID is required.");
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.displayName !== undefined) {
      const input = userInputSchema.parse({ displayName: body.displayName });
      values.push(input.displayName);
      updates.push(`display_name = $${values.length}`);
      values.push(normalizeName(input.displayName));
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
    return NextResponse.json({ user: rowToCamel(result.rows[0]) });
  } catch (error) {
    return jsonError(error);
  }
}
