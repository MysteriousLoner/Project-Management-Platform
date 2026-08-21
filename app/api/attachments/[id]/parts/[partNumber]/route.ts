import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError } from "@/lib/api";
import { query } from "@/lib/db";
import { requireActor } from "@/lib/domain";
import { uploadPart } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; partNumber: string }> }
) {
  try {
    await requireActor(actorId(request));
    const { id, partNumber: rawPartNumber } = await context.params;
    const partNumber = Number(rawPartNumber);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isInteger(partNumber) || partNumber < 1 || !contentLength || !request.body) {
      throw new ApiError(422, "INVALID_UPLOAD_PART", "Part number, body, and content length are required.");
    }
    const attachment = await query(
      `SELECT object_key, upload_id, upload_state
       FROM attachments WHERE id = $1 AND removed_at IS NULL`,
      [id]
    );
    if (!attachment.rowCount) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    if (!attachment.rows[0].upload_id) {
      throw new ApiError(409, "UPLOAD_NOT_ACTIVE", "This upload is not active.");
    }
    await query("UPDATE attachments SET upload_state = 'uploading' WHERE id = $1", [id]);
    const result = await uploadPart({
      objectKey: attachment.rows[0].object_key,
      uploadId: attachment.rows[0].upload_id,
      partNumber,
      body: Readable.fromWeb(request.body as never),
      contentLength
    });
    if (!result.ETag) throw new Error("Object storage did not return an ETag.");
    return NextResponse.json({ partNumber, etag: result.ETag });
  } catch (error) {
    return jsonError(error);
  }
}
