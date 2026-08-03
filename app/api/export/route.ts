import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    const projects = await query(
      `SELECT id, key, name, description, created_at, updated_at
       FROM projects
       WHERE NOT is_archived AND ($1::uuid IS NULL OR id = $1)
       ORDER BY name`,
      [projectId]
    );
    const output = [];
    for (const project of projects.rows) {
      const items = await query(
        `SELECT wi.*, assignee.display_name AS assignee_name,
                reporter.display_name AS report_to_name
         FROM work_items wi
         LEFT JOIN users assignee ON assignee.id = wi.assignee_id
         LEFT JOIN users reporter ON reporter.id = wi.report_to_id
         WHERE wi.project_id = $1 AND NOT wi.is_archived
         ORDER BY wi.type, wi.created_at`,
        [project.id]
      );
      const comments = await query(
        `SELECT c.*, u.display_name AS author_name
         FROM comments c
         JOIN users u ON u.id = c.author_id
         JOIN work_items wi ON wi.id = c.work_item_id
         WHERE wi.project_id = $1
         ORDER BY c.created_at`,
        [project.id]
      );
      const attachments = await query(
        `SELECT a.id, a.work_item_id, a.original_filename, a.media_type,
                a.byte_size, a.created_at
         FROM attachments a
         JOIN work_items wi ON wi.id = a.work_item_id
         WHERE wi.project_id = $1 AND a.upload_state = 'complete' AND a.removed_at IS NULL`,
        [project.id]
      );
      const commentMap = new Map<string, unknown[]>();
      for (const comment of comments.rows) {
        const list = commentMap.get(comment.work_item_id) ?? [];
        list.push(rowToCamel(comment));
        commentMap.set(comment.work_item_id, list);
      }
      const attachmentMap = new Map<string, unknown[]>();
      for (const attachment of attachments.rows) {
        const list = attachmentMap.get(attachment.work_item_id) ?? [];
        list.push(rowToCamel(attachment));
        attachmentMap.set(attachment.work_item_id, list);
      }
      type ExportItem = Record<string, unknown> & {
        id: string;
        type: string;
        parentId: string | null;
      };
      const rows: ExportItem[] = items.rows.map((row) => {
        const mapped = rowToCamel(row) as ExportItem;
        return {
          ...mapped,
          comments: commentMap.get(row.id) ?? [],
          attachments: attachmentMap.get(row.id) ?? []
        };
      });
      const tickets = rows
        .filter((row) => row.type === "ticket")
        .map((ticket) => ({
          ...ticket,
          subtasks: rows.filter((row) => row.parentId === ticket.id)
        }));
      output.push({ ...rowToCamel(project), tickets });
    }
    return NextResponse.json({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      projects: output
    });
  } catch (error) {
    return jsonError(error);
  }
}
