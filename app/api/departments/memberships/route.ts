import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, transaction } from "@/lib/db";
import { requireActiveDepartment, requireActor } from "@/lib/domain";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const userId = idSchema.parse(body.userId);
    const departmentId = idSchema.parse(body.departmentId);
    await requireActiveDepartment(departmentId);
    const user = await query("SELECT id FROM users WHERE id = $1 AND NOT is_archived", [userId]);
    if (!user.rowCount) throw new ApiError(404, "USER_NOT_FOUND", "Active user not found.");
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO user_departments (user_id, department_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, departmentId]
      );
      await client.query(
        `INSERT INTO audit_events (actor_id, action, metadata)
         VALUES ($1, 'department_member_added', $2::jsonb)`,
        [actor, JSON.stringify({ userId, departmentId })]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const userId = idSchema.parse(body.userId);
    const departmentId = idSchema.parse(body.departmentId);
    await transaction(async (client) => {
      const membership = await client.query(
        `SELECT u.is_archived,
                (SELECT count(*)::int FROM user_departments WHERE user_id = $1) AS membership_count
         FROM user_departments ud
         JOIN users u ON u.id = ud.user_id
         WHERE ud.user_id = $1 AND ud.department_id = $2
         FOR UPDATE OF ud`,
        [userId, departmentId]
      );
      if (!membership.rowCount) throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Department membership not found.");
      if (!membership.rows[0].is_archived && Number(membership.rows[0].membership_count) <= 1) {
        throw new ApiError(422, "LAST_DEPARTMENT", "An active user must belong to at least one department.");
      }
      const assigned = await client.query(
         `SELECT 1 FROM work_items wi
         JOIN projects p ON p.id = wi.project_id
         WHERE p.department_id = $1 AND NOT p.is_archived AND NOT wi.is_archived
           AND (wi.assignee_id = $2 OR wi.report_to_id = $2)
         LIMIT 1`,
        [departmentId, userId]
      );
      if (assigned.rowCount) {
        throw new ApiError(422, "MEMBER_HAS_ASSIGNMENTS", "Clear this user's active assignments before removing the membership.");
      }
      await client.query(
        "DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2",
        [userId, departmentId]
      );
      await client.query(
        `INSERT INTO audit_events (actor_id, action, metadata)
         VALUES ($1, 'department_member_removed', $2::jsonb)`,
        [actor, JSON.stringify({ userId, departmentId })]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
