import { NextResponse } from "next/server";
import { requirePrincipal } from "@/lib/auth-session";
import { jsonError } from "@/lib/api";
import { query, rowToCamel } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal(request);
    const user = await query(`SELECT u.*, ARRAY(SELECT department_id FROM user_departments WHERE user_id=u.id) AS department_ids FROM users u WHERE u.id=$1`, [principal.employeeId]);
    return NextResponse.json({ principal, user: rowToCamel(user.rows[0]) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
