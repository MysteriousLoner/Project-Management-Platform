import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel, transaction } from "@/lib/db";
import { audit, requireActor } from "@/lib/domain";
import { commentInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const workItemId = new URL(request.url).searchParams.get("workItemId");
    if (!workItemId) throw new ApiError(422, "WORK_ITEM_REQUIRED", "A work item ID is required.");
    const result = await query(
      `SELECT c.id, c.work_item_id, c.author_id, u.display_name AS author_name,
              c.body, c.created_at
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.work_item_id = $1
       ORDER BY c.created_at`,
      [workItemId]
    );
    return NextResponse.json({ comments: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const input = commentInputSchema.parse(await requestJson(request));
    const comment = await transaction(async (client) => {
      const item = await client.query(
        "SELECT id, project_id FROM work_items WHERE id = $1",
        [input.workItemId]
      );
      if (!item.rowCount) throw new ApiError(404, "WORK_ITEM_NOT_FOUND", "Work item not found.");
      const result = await client.query(
        `INSERT INTO comments (work_item_id, author_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, work_item_id, author_id, body, created_at`,
        [input.workItemId, actor, input.body]
      );
      await audit(client, {
        projectId: item.rows[0].project_id,
        workItemId: input.workItemId,
        actorId: actor,
        action: "commented",
        newValue: { body: input.body }
      });
      return result.rows[0];
    });
    const author = await query("SELECT display_name FROM users WHERE id = $1", [actor]);
    return NextResponse.json(
      {
        comment: rowToCamel({
          ...comment,
          author_name: author.rows[0].display_name
        })
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
