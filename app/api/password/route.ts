import { NextResponse } from "next/server";
import { changeOwnPassword } from "@/lib/accounts";
import { requirePrincipal } from "@/lib/auth-session";
import { jsonError, requestJson } from "@/lib/api";
export async function POST(request: Request) {
  try { return NextResponse.json(await changeOwnPassword(await requirePrincipal(request), await requestJson(request))); } catch (e) { return jsonError(e); }
}
