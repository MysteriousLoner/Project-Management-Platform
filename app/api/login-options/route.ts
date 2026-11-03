import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { loginUsername } from "@/lib/accounts";
import { jsonError } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const employees = await query("SELECT u.id,u.display_name FROM users u JOIN kb_account_links l ON l.employee_id=u.id WHERE NOT u.is_archived ORDER BY u.display_name");
    const existing = await query("SELECT 1 FROM users WHERE NOT is_archived LIMIT 1");
    return NextResponse.json({ employees: employees.rows.map((r) => ({ username: loginUsername(r.id), displayName: r.display_name })), needsFirstEmployee: !existing.rowCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
