import { NextResponse } from "next/server";
import { jsonError, requestJson } from "@/lib/api";
import { requirePrincipal } from "@/lib/auth-session";
import { generateReport, getReports } from "@/lib/reporting";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return NextResponse.json(await getReports(await requirePrincipal(request), { ...(p.get("reportId") ? { reportId: p.get("reportId") } : {}), ...(p.get("jobId") ? { jobId: p.get("jobId") } : {}), offset: Number(p.get("offset") ?? 0) }));
  } catch (e) { return jsonError(e); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(await generateReport(await requirePrincipal(request), await requestJson(request)), { status: 202 }); } catch (e) { return jsonError(e); }
}
