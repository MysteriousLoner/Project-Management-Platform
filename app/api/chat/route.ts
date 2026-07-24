import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";
import { requireActor } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireActor(actorId(request));
    const body = await requestJson(request);
    const question = String(body.question ?? "").trim();
    const projectId = body.projectId ? String(body.projectId) : null;
    if (!question) throw new ApiError(422, "QUESTION_REQUIRED", "Enter a question.");
    const baseUrl = process.env.LLM_API_BASE_URL?.replace(/\/$/, "");
    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL;
    if (!baseUrl || !apiKey || !model) {
      throw new ApiError(503, "LLM_NOT_CONFIGURED", "The chatbot has not been configured.");
    }

    const projectResult = await query(
      `SELECT id, key, name FROM projects
       WHERE NOT is_archived AND ($1::uuid IS NULL OR id = $1)
       ORDER BY name`,
      [projectId]
    );
    const itemResult = await query(
      `SELECT wi.id, wi.project_id, wi.type, wi.parent_id, wi.key, wi.title,
              wi.description, wi.status, wi.blocked_reason, wi.estimated_completion_date,
              wi.created_at, wi.updated_at, wi.completed_at,
              u.display_name AS assignee_name
       FROM work_items wi
       LEFT JOIN users u ON u.id = wi.assignee_id
       WHERE NOT wi.is_archived AND ($1::uuid IS NULL OR wi.project_id = $1)
       ORDER BY
         CASE wi.status WHEN 'blocked' THEN 0 WHEN 'ready_for_review' THEN 1 ELSE 2 END,
         wi.updated_at DESC
       LIMIT 200`,
      [projectId]
    );
    const projectIds = projectResult.rows.map((row) => row.id);
    const comments =
      projectIds.length > 0
        ? await query(
            `SELECT c.work_item_id, c.body, c.created_at, u.display_name AS author_name
             FROM comments c
             JOIN users u ON u.id = c.author_id
             JOIN work_items wi ON wi.id = c.work_item_id
             WHERE wi.project_id = ANY($1::uuid[])
             ORDER BY c.created_at DESC
             LIMIT 100`,
            [projectIds]
          )
        : { rows: [] };
    const context = {
      generatedAt: new Date().toISOString(),
      scope: projectId ? "selected project" : "all projects",
      projects: projectResult.rows.map(rowToCamel),
      workItems: itemResult.rows.map(rowToCamel),
      recentComments: comments.rows.map(rowToCamel)
    };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a read-only project progress assistant. Answer only from the supplied JSON. " +
              "Distinguish projects, tickets, and subtasks. Treat descoped work separately from completed work. " +
              "Mention ticket keys when discussing work. Never claim to inspect attachment contents. " +
              "If data is insufficient, say so. Include the scope and data timestamp in summaries."
          },
          {
            role: "user",
            content: `Project data:\n${JSON.stringify(context)}\n\nQuestion: ${question}`
          }
        ]
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const message = await response.text();
      console.error("LLM provider error", response.status, message.slice(0, 500));
      throw new ApiError(502, "LLM_ERROR", "The chatbot provider could not complete the request.");
    }
    const payload = await response.json();
    const answer = payload?.choices?.[0]?.message?.content;
    if (!answer) throw new ApiError(502, "LLM_INVALID_RESPONSE", "The chatbot returned an invalid response.");
    return NextResponse.json({
      answer,
      generatedAt: context.generatedAt,
      scope: context.scope
    });
  } catch (error) {
    return jsonError(error);
  }
}
