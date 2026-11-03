import { NextResponse } from "next/server";
import { requirePrincipal } from "@/lib/auth-session";
import { listAccounts, createEmployee, changeAccount } from "@/lib/accounts";
import { jsonError, requestJson } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return NextResponse.json({ accounts: await listAccounts(await requirePrincipal(request)) }); } catch (e) { return jsonError(e); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(await createEmployee(await requirePrincipal(request), await requestJson(request))); } catch (e) { return jsonError(e); }
}
export async function PATCH(request: Request) {
  try { return NextResponse.json(await changeAccount(await requirePrincipal(request), await requestJson(request))); } catch (e) { return jsonError(e); }
}
