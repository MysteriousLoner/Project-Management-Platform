import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const result = await query(
      `SELECT ae.id, ae.project_id, ae.work_item_id, ae.action, ae.field_name,
              ae.old_value, ae.new_value, ae.metadata, ae.created_at,
              u.display_name AS actor_name, wi.key AS work_item_key, wi.title AS work_item_title
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_id
       LEFT JOIN work_items wi ON wi.id = ae.work_item_id
       WHERE ($1::uuid IS NULL OR ae.project_id = $1)
       ORDER BY ae.created_at DESC
       LIMIT 200`,
      [projectId]
    );
    return NextResponse.json({ events: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}
