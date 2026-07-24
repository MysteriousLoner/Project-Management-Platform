import { Readable } from "node:stream";
import { ApiError, jsonError } from "@/lib/api";
import { query } from "@/lib/db";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const attachment = await query(
      `SELECT object_key, original_filename, media_type, byte_size
       FROM attachments
       WHERE id = $1 AND upload_state = 'complete' AND removed_at IS NULL`,
      [id]
    );
    if (!attachment.rowCount) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    const row = attachment.rows[0];
    const range = request.headers.get("range");
    const object = await getObject(row.object_key, range);
    if (!object.Body) throw new Error("Object storage returned an empty response.");
    const canPreviewInline =
      (row.media_type.startsWith("image/") && row.media_type !== "image/svg+xml") ||
      row.media_type.startsWith("video/");
    const headers = new Headers({
      "Content-Type": row.media_type,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `${canPreviewInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`,
      "X-Content-Type-Options": "nosniff"
    });
    if (object.ContentLength !== undefined) headers.set("Content-Length", String(object.ContentLength));
    if (object.ContentRange) headers.set("Content-Range", object.ContentRange);
    return new Response(Readable.toWeb(object.Body as Readable) as ReadableStream, {
      status: range ? 206 : 200,
      headers
    });
  } catch (error) {
    return jsonError(error);
  }
}
