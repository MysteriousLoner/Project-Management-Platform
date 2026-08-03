import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel, transaction } from "@/lib/db";
import { audit, mapRows, requireActor, workItemSelect } from "@/lib/domain";
import { sendPushToUser } from "@/lib/push";
import { STATUS_LABELS, SUBTASK_STATUSES, type WorkStatus } from "@/lib/types";
import { workItemInputSchema, workItemPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (params.get("id")) add("wi.id = ?", params.get("id"));
    if (params.get("projectId")) add("wi.project_id = ?", params.get("projectId"));
    if (params.get("parentId")) add("wi.parent_id = ?", params.get("parentId"));
    if (params.get("type")) add("wi.type = ?::work_item_type", params.get("type"));
    if (params.get("status")) add("wi.status = ?::work_item_status", params.get("status"));
    if (params.get("assigneeId")) add("wi.assignee_id = ?", params.get("assigneeId"));
    if (params.get("search")) {
      values.push(params.get("search"));
      const index = values.length;
      conditions.push(
        `(wi.key ILIKE '%' || $${index} || '%'
          OR wi.title ILIKE '%' || $${index} || '%'
          OR wi.description ILIKE '%' || $${index} || '%')`
      );
    }
    if (params.get("blockedOnly") === "true") conditions.push("wi.status = 'blocked'");
    if (params.get("reviewOnly") === "true") {
      conditions.push("wi.type = 'ticket' AND wi.status = 'ready_for_review'");
    }
    if (params.get("includeArchived") !== "true") conditions.push("wi.is_archived = false");
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 200), 1), 500);
    values.push(limit);
    const result = await query(
      `${workItemSelect}
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY
         CASE wi.status
           WHEN 'blocked' THEN 0
           WHEN 'ready_for_review' THEN 1
           ELSE 2
         END,
         wi.updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    const items = mapRows(result.rows);
    if (params.get("id")) {
      if (!items.length) throw new ApiError(404, "WORK_ITEM_NOT_FOUND", "Work item not found.");
      return NextResponse.json({ item: items[0] });
    }
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const input = workItemInputSchema.parse(await requestJson(request));
    const item = await transaction(async (client) => {
      let key: string;
      let ticketNumber: number | null = null;
      if (input.type === "ticket") {
        const project = await client.query(
          `UPDATE projects
           SET next_ticket_number = next_ticket_number + 1, updated_at = updated_at
           WHERE id = $1 AND is_archived = false
           RETURNING key, next_ticket_number - 1 AS ticket_number`,
          [input.projectId]
        );
        if (!project.rowCount) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
        ticketNumber = Number(project.rows[0].ticket_number);
        key = `${project.rows[0].key}-${ticketNumber}`;
      } else {
        const parent = await client.query(
          `SELECT id, project_id, key FROM work_items
           WHERE id = $1 AND type = 'ticket' AND is_archived = false
           FOR UPDATE`,
          [input.parentId]
        );
        if (!parent.rowCount) throw new ApiError(404, "PARENT_NOT_FOUND", "Parent ticket not found.");
        if (parent.rows[0].project_id !== input.projectId) {
          throw new ApiError(422, "PROJECT_MISMATCH", "The subtask project must match its parent.");
        }
        const count = await client.query(
          "SELECT count(*)::int AS count FROM work_items WHERE parent_id = $1",
          [input.parentId]
        );
        key = `${parent.rows[0].key}-S${Number(count.rows[0].count) + 1}`;
      }
      const result = await client.query(
        `INSERT INTO work_items (
          project_id, type, parent_id, ticket_number, key, title, description, status,
          assignee_id, report_to_id, created_by_id, updated_by_id, blocked_reason,
          estimated_completion_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13)
        RETURNING *`,
        [
          input.projectId,
          input.type,
          input.parentId ?? null,
          ticketNumber,
          key,
          input.title,
          input.description,
          input.status,
          input.assigneeId ?? null,
          input.type === "ticket" ? input.reportToId ?? null : null,
          actor,
          input.blockedReason ?? null,
          input.estimatedCompletionDate ?? null
        ]
      );
      await audit(client, {
        projectId: input.projectId,
        workItemId: result.rows[0].id,
        actorId: actor,
        action: "created",
        newValue: { key, title: input.title, type: input.type, status: input.status }
      });
      return rowToCamel(result.rows[0]);
    });
    return NextResponse.json({ item }, { status: 201 });
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
    if (!id) throw new ApiError(422, "ID_REQUIRED", "A work item ID is required.");
    const patch = workItemPatchSchema.parse(body);
    const result = await transaction(async (client) => {
      const existing = await client.query("SELECT * FROM work_items WHERE id = $1 FOR UPDATE", [id]);
      if (!existing.rowCount) throw new ApiError(404, "WORK_ITEM_NOT_FOUND", "Work item not found.");
      const current = existing.rows[0];
      if (current.type === "subtask" && patch.reportToId !== undefined) {
        throw new ApiError(422, "REPORT_TO_NOT_ALLOWED", "Report To is only available for tickets.");
      }
      const statusChanged = Boolean(patch.status && patch.status !== current.status);
      const progressForTicket = async (ticketId: string) => {
        const progress = await client.query(
          `SELECT
             count(*) FILTER (WHERE NOT is_archived)::int AS total,
             count(*) FILTER (WHERE NOT is_archived AND status = 'completed')::int AS completed,
             count(*) FILTER (WHERE NOT is_archived AND status <> 'descoped')::int AS active
           FROM work_items WHERE parent_id = $1`,
          [ticketId]
        );
        const total = Number(progress.rows[0].total);
        const completed = Number(progress.rows[0].completed);
        const active = Number(progress.rows[0].active);
        return active > 0 ? Math.round((completed * 100) / active) : total > 0 ? null : 0;
      };
      const previousParentProgress =
        current.type === "subtask" && statusChanged
          ? await progressForTicket(current.parent_id)
          : null;
      if (
        current.type === "subtask" &&
        patch.status &&
        !SUBTASK_STATUSES.includes(patch.status as never)
      ) {
        throw new ApiError(
          422,
          "SUBTASK_STATUS_NOT_ALLOWED",
          "Ready for Review is not available for subtasks."
        );
      }
      const nextStatus = patch.status ?? current.status;
      const nextBlockedReason =
        nextStatus === "blocked" ? patch.blockedReason ?? current.blocked_reason : null;
      if (nextStatus === "blocked" && !String(nextBlockedReason ?? "").trim()) {
        throw new ApiError(422, "BLOCKED_REASON_REQUIRED", "A blocked reason is required.");
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      const fieldMap = {
        title: "title",
        description: "description",
        status: "status",
        assigneeId: "assignee_id",
        reportToId: "report_to_id",
        blockedReason: "blocked_reason",
        estimatedCompletionDate: "estimated_completion_date",
        isArchived: "is_archived"
      } as const;
      for (const [field, column] of Object.entries(fieldMap)) {
        if (patch[field as keyof typeof patch] !== undefined) {
          values.push(patch[field as keyof typeof patch]);
          updates.push(`${column} = $${values.length}`);
        }
      }
      if (patch.status !== undefined && patch.blockedReason === undefined) {
        values.push(nextBlockedReason);
        updates.push(`blocked_reason = $${values.length}`);
      }
      if (patch.status !== undefined) {
        updates.push(
          patch.status === "completed" ? "completed_at = now()" : "completed_at = NULL"
        );
      }
      if (!updates.length) throw new ApiError(422, "NO_CHANGES", "No supported changes were provided.");
      values.push(actor);
      updates.push(`updated_by_id = $${values.length}`, "updated_at = now()");
      values.push(id);
      const result = await client.query(
        `UPDATE work_items SET ${updates.join(", ")}
         WHERE id = $${values.length} RETURNING *`,
        values
      );
      await audit(client, {
        projectId: current.project_id,
        workItemId: id,
        actorId: actor,
        action: statusChanged ? "status_changed" : "updated",
        fieldName: statusChanged ? "status" : null,
        oldValue: rowToCamel(current),
        newValue: patch
      });
      let notification:
        | { userId: string; title: string; body: string; url: string; tag: string }
        | null = null;
      if (statusChanged && current.type === "ticket" && result.rows[0].report_to_id) {
        const project = await client.query("SELECT name FROM projects WHERE id = $1", [
          current.project_id
        ]);
        notification = {
          userId: result.rows[0].report_to_id,
          title: `${project.rows[0].name} · ${current.key}`,
          body: `${current.title}: ${STATUS_LABELS[current.status as WorkStatus]} → ${STATUS_LABELS[patch.status!]}`,
          url: `?ticket=${current.id}`,
          tag: `ticket-${current.id}-status`
        };
      }
      if (statusChanged && current.type === "subtask") {
        const parent = await client.query(
          `SELECT parent.id, parent.key, parent.title, parent.report_to_id, project.name AS project_name
           FROM work_items parent
           JOIN projects project ON project.id = parent.project_id
           WHERE parent.id = $1`,
          [current.parent_id]
        );
        if (parent.rows[0]?.report_to_id) {
          const nextProgress = await progressForTicket(current.parent_id);
          const progressChange =
            previousParentProgress === nextProgress
              ? ""
              : ` · ${previousParentProgress ?? "—"}% → ${nextProgress ?? "—"}%`;
          notification = {
            userId: parent.rows[0].report_to_id,
            title: `${parent.rows[0].project_name} · ${parent.rows[0].key}`,
            body: `${parent.rows[0].title}: ${current.key} ${STATUS_LABELS[current.status as WorkStatus]} → ${STATUS_LABELS[patch.status!]}${progressChange}`,
            url: `?ticket=${parent.rows[0].id}`,
            tag: `ticket-${parent.rows[0].id}-progress`
          };
        }
      }
      return { item: rowToCamel(result.rows[0]), notification };
    });
    let delivery = null;
    if (result.notification) {
      try {
        delivery = await sendPushToUser(result.notification.userId, result.notification);
      } catch (error) {
        console.error(
          "Push notification setup or delivery failed",
          error instanceof Error ? error.message : "unknown"
        );
      }
    }
    return NextResponse.json({ item: result.item, pushDelivery: delivery });
  } catch (error) {
    return jsonError(error);
  }
}
