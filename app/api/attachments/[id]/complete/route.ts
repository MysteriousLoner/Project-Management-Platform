import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, transaction } from "@/lib/db";
import { audit, requireActor } from "@/lib/domain";
import { completeMultipart } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const { id } = await context.params;
    const body = await requestJson(request);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length) throw new ApiError(422, "UPLOAD_PARTS_REQUIRED", "At least one uploaded part is required.");
    const attachment = await query(
      `SELECT a.*, wi.project_id
       FROM attachments a
       JOIN work_items wi ON wi.id = a.work_item_id
       WHERE a.id = $1 AND a.removed_at IS NULL`,
      [id]
    );
    if (!attachment.rowCount) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    const row = attachment.rows[0];
    if (row.upload_state === "complete") {
      return NextResponse.json({ attachment: { id, uploadState: "complete" } });
    }
    await completeMultipart(row.object_key, row.upload_id, parts);
    await transaction(async (client) => {
      await client.query(
        `UPDATE attachments
         SET upload_state = 'complete', completed_at = now(), upload_id = NULL
         WHERE id = $1`,
        [id]
      );
      await audit(client, {
        projectId: row.project_id,
        workItemId: row.work_item_id,
        actorId: actor,
        action: "attachment_added",
        newValue: { attachmentId: id, filename: row.original_filename, byteSize: Number(row.byte_size) }
      });
    });
    return NextResponse.json({ attachment: { id, uploadState: "complete" } });
  } catch (error) {
    return jsonError(error);
  }
}
