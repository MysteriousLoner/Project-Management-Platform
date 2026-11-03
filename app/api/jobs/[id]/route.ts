import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { requirePrincipal } from "@/lib/auth-session";
import { getJob } from "@/lib/knowledge";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await getJob(await requirePrincipal(request), { jobId: (await context.params).id })); } catch (e) { return jsonError(e); }
}
