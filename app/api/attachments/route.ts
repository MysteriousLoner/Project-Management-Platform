import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";
import { requireActor } from "@/lib/domain";
import { beginMultipart } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const workItemId = new URL(request.url).searchParams.get("workItemId");
    if (!workItemId) throw new ApiError(422, "WORK_ITEM_REQUIRED", "A work item ID is required.");
    const result = await query(
      `SELECT id, work_item_id, original_filename, media_type, byte_size::float8 AS byte_size,
              upload_state, created_at
       FROM attachments
       WHERE work_item_id = $1 AND removed_at IS NULL AND upload_state = 'complete'
       ORDER BY created_at DESC`,
      [workItemId]
    );
    return NextResponse.json({ attachments: result.rows.map(rowToCamel) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const workItemId = String(body.workItemId ?? "");
    const originalFilename = String(body.filename ?? "").trim();
    const mediaType = String(body.mediaType ?? "application/octet-stream");
    const byteSize = Number(body.byteSize ?? 0);
    if (!workItemId || !originalFilename) {
      throw new ApiError(422, "ATTACHMENT_FIELDS_REQUIRED", "Work item and filename are required.");
    }
    if (!mediaType.startsWith("image/") && !mediaType.startsWith("video/")) {
      throw new ApiError(422, "MEDIA_TYPE_NOT_ALLOWED", "Only image and video files are supported.");
    }
    const item = await query("SELECT project_id FROM work_items WHERE id = $1", [workItemId]);
    if (!item.rowCount) throw new ApiError(404, "WORK_ITEM_NOT_FOUND", "Work item not found.");
    const id = randomUUID();
    const objectKey = `${item.rows[0].project_id}/${workItemId}/${id}`;
    const uploadId = await beginMultipart(objectKey, mediaType);
    const result = await query(
      `INSERT INTO attachments (
        id, work_item_id, object_key, original_filename, media_type,
        byte_size, upload_state, upload_id, uploaded_by_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'initiated', $7, $8)
      RETURNING id, work_item_id, original_filename, media_type, byte_size,
                upload_state, created_at`,
      [id, workItemId, objectKey, originalFilename, mediaType, byteSize, uploadId, actor]
    );
    return NextResponse.json(
      { attachment: rowToCamel(result.rows[0]), uploadId, chunkSize: 16 * 1024 * 1024 },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
