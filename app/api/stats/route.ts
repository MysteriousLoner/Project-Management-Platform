import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const result = await query(
      `SELECT
        count(*) FILTER (WHERE type = 'ticket' AND NOT is_archived)::int AS ticket_total,
        count(*) FILTER (WHERE type = 'ticket' AND status = 'completed' AND NOT is_archived)::int AS ticket_completed,
        count(*) FILTER (WHERE type = 'subtask' AND NOT is_archived)::int AS subtask_total,
        count(*) FILTER (WHERE type = 'subtask' AND status = 'completed' AND NOT is_archived)::int AS subtask_completed,
        count(*) FILTER (WHERE status = 'blocked' AND NOT is_archived)::int AS blocked_total,
        count(*) FILTER (WHERE type = 'ticket' AND status = 'ready_for_review' AND NOT is_archived)::int AS review_total,
        count(*) FILTER (
          WHERE status NOT IN ('completed', 'descoped')
            AND updated_at < now() - interval '14 days'
            AND NOT is_archived
        )::int AS stale_total
       FROM work_items
       WHERE ($1::uuid IS NULL OR project_id = $1)`,
      [projectId]
    );
    const byStatus = await query(
      `SELECT status, count(*)::int AS count
       FROM work_items
       WHERE type = 'ticket' AND NOT is_archived
         AND ($1::uuid IS NULL OR project_id = $1)
       GROUP BY status`,
      [projectId]
    );
    return NextResponse.json({
      stats: rowToCamel(result.rows[0]),
      byStatus: Object.fromEntries(byStatus.rows.map((row) => [row.status, row.count]))
    });
  } catch (error) {
    return jsonError(error);
  }
}
