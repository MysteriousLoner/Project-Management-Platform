import { NextResponse } from "next/server";
import { createFirstEmployee } from "@/lib/accounts";
import { requireSameOrigin } from "@/lib/auth-session";
import { jsonError, requestJson } from "@/lib/api";
export async function POST(request: Request) {
  try { requireSameOrigin(request); return NextResponse.json(await createFirstEmployee(await requestJson(request))); } catch (e) { return jsonError(e); }
}
