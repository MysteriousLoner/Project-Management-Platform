import { z } from "zod";
import { ApiError } from "./errors";
import { query, rowToCamel } from "./db";
import { idempotent } from "./idempotency";
import { id, reportRequestSchema, type Principal, type ReportBody, type ReportSnapshot } from "./knowledge-types";
import { dateBounds, malaysiaToday } from "./knowledge-utils";

export async function generateReport(principal: Principal, raw: unknown) {
  const input = reportRequestSchema.parse(raw);
  if (input.endDate > malaysiaToday()) throw new ApiError(422, "FUTURE_REPORT", "Choose an end date up to today.");
  const { until } = dateBounds(input.startDate, input.endDate);
  return idempotent(principal.employeeId, "reports.generate", input.idempotencyKey, input, async (client) => {
    // All subqueries share one statement snapshot, including roster and historical blockers.
    const snapshot = await client.query(`SELECT jsonb_build_object(
      'capturedAt',statement_timestamp(),'startDate',$1::text,'endDate',$2::text,'language',$3::text,
      'employees',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) ORDER BY u.display_name)
        FROM users u WHERE ((u.created_at<$4::timestamptz AND NOT u.is_archived) OR EXISTS(SELECT 1 FROM kb_progress p WHERE p.employee_id=u.id AND p.work_date BETWEEN $1::date AND $2::date))),'[]'),
      'projects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'key',pr.key) ORDER BY pr.name)
        FROM projects pr WHERE ((pr.created_at<$4::timestamptz AND NOT pr.is_archived) OR EXISTS(SELECT 1 FROM kb_progress p WHERE p.project_id=pr.id AND p.work_date BETWEEN $1::date AND $2::date)
          OR EXISTS(SELECT 1 FROM kb_blockers b WHERE b.project_id=pr.id))),'[]'),
      'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'projectId',p.project_id,'employeeId',p.employee_id,
        'workDate',p.work_date,'summary',p.summary,'status',p.status,'evidence',p.evidence) ORDER BY p.work_date,p.recorded_at)
        FROM kb_progress p WHERE p.work_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS(SELECT 1 FROM kb_progress n WHERE n.supersedes_id=p.id)),'[]'),
      'blockers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'projectId',b.project_id,'summary',e.summary,
        'outsideParty',e.outside_party,'actionNeeded',e.action_needed,'affectedEmployeeIds',e.affected_employee_ids,
        'projectName',(SELECT name FROM projects WHERE id=b.project_id),
        'affectedEmployees',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name)) FROM users u WHERE u.id=ANY(e.affected_employee_ids)),'[]')))
        FROM kb_blockers b JOIN LATERAL(SELECT * FROM kb_blocker_events WHERE blocker_id=b.id AND effective_date<=$2::date
          ORDER BY effective_date DESC,recorded_at DESC,id DESC LIMIT 1)e ON true WHERE e.state='open'),'[]')
      ) AS snapshot`, [input.startDate, input.endDate, input.language, until]);
    const data: ReportSnapshot = snapshot.rows[0].snapshot;
    if (data.entries.length > 10000) throw new ApiError(422, "REPORT_TOO_LARGE", "Choose a shorter period; a report supports up to 10,000 progress entries.");
    const job = await client.query("INSERT INTO kb_jobs(kind,requested_by,input) VALUES('report',$1,$2::jsonb) RETURNING id,state", [principal.employeeId, JSON.stringify(data)]);
    return job.rows[0];
  });
}

export async function getReports(principal: Principal, raw: unknown) {
  void principal; // The caller has already authenticated; every teammate has report access.
  const input = z.object({ reportId: id.optional(), jobId: id.optional(), offset: z.number().int().nonnegative().default(0) }).strict().parse(raw);
  if (input.reportId || input.jobId) {
    const result = await query("SELECT * FROM kb_report_versions WHERE ($1::uuid IS NULL OR id=$1) AND ($2::uuid IS NULL OR job_id=$2)", [input.reportId ?? null, input.jobId ?? null]);
    if (!result.rowCount) throw new ApiError(404, "REPORT_NOT_READY", "The completed report is not available yet.");
    return { report: rowToCamel(result.rows[0]) };
  }
  const result = await query(`SELECT j.id AS job_id,j.state,j.error_code,j.attempts,j.created_at,j.updated_at,r.id AS report_id,
    j.input->>'startDate' AS start_date,j.input->>'endDate' AS end_date,j.input->>'language' AS language
    FROM kb_jobs j LEFT JOIN kb_report_versions r ON r.job_id=j.id WHERE j.kind='report'
    ORDER BY j.created_at DESC,j.id DESC OFFSET $1 LIMIT 50`, [input.offset]);
  return { history: result.rows.map(rowToCamel), nextOffset: result.rowCount === 50 ? input.offset + 50 : null };
}

const inline = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#|]/g, (x) => `\\${x}`);
export function renderReportMarkdown(snapshot: ReportSnapshot, body: ReportBody): string {
  const zh = snapshot.language === "zh-CN";
  const lines = [`# ${zh ? "工作报告" : "Work report"}`, "", `${snapshot.startDate} — ${snapshot.endDate} · Asia/Kuala_Lumpur`, ""];
  for (const project of body.projects) {
    lines.push(`## ${inline(project.name)}`, "");
    if (!project.employees.length) lines.push(zh ? "此期间未提交工作进展。" : "No progress submitted in this period.", "");
    for (const employee of project.employees) {
      lines.push(`### ${inline(employee.name)}`, "");
      for (const bullet of employee.bullets) lines.push(`- ${inline(bullet.text)}`);
      lines.push("");
    }
  }
  lines.push(`## ${zh ? "提交覆盖情况" : "Submission coverage"}`, "");
  lines.push(`- ${zh ? "未提交进展的项目" : "Projects without submissions"}: ${body.coverage.projectsWithoutSubmissions.map(inline).join(", ") || (zh ? "无" : "None")}`);
  lines.push(`- ${zh ? "未提交进展的员工" : "Employees without submissions"}: ${body.coverage.employeesWithoutSubmissions.map(inline).join(", ") || (zh ? "无" : "None")}`, "");
  lines.push(`## ${zh ? "外部阻碍" : "Blockers"}`, "");
  if (!body.blockers.length) lines.push(zh ? "截至所选结束日期，没有报告尚未解决的外部阻碍。" : "No unresolved external blockers reported as of the selected end date.");
  for (const blocker of body.blockers) lines.push(`- ${inline(blocker.project)} — ${blocker.employees.map(inline).join(", ")}: ${inline(blocker.summary)}; ${zh ? "外部相关方" : "outside party"}: ${inline(blocker.outsideParty)}; ${zh ? "所需行动" : "action needed"}: ${inline(blocker.actionNeeded)}`);
  return lines.join("\n");
}
