import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError } from "@/lib/api";
import { query, transaction } from "@/lib/db";
import { audit, requireActor } from "@/lib/domain";
import { abortMultipart, deleteObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const { id } = await context.params;
    const attachment = await query(
      `SELECT a.*, wi.project_id
       FROM attachments a
       JOIN work_items wi ON wi.id = a.work_item_id
       WHERE a.id = $1 AND a.removed_at IS NULL`,
      [id]
    );
    if (!attachment.rowCount) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    const row = attachment.rows[0];
    if (row.upload_id) await abortMultipart(row.object_key, row.upload_id).catch(() => undefined);
    if (row.upload_state === "complete") await deleteObject(row.object_key);
    await transaction(async (client) => {
      await client.query(
        `UPDATE attachments
         SET removed_at = now(), removed_by_id = $2, upload_state =
           CASE WHEN upload_state = 'complete' THEN upload_state ELSE 'aborted' END
         WHERE id = $1`,
        [id, actor]
      );
      await audit(client, {
        projectId: row.project_id,
        workItemId: row.work_item_id,
        actorId: actor,
        action: "attachment_removed",
        oldValue: { attachmentId: id, filename: row.original_filename }
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
