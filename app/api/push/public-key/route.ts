import { requirePrincipal } from "@/lib/auth-session";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getPushPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requirePrincipal(request);
    return NextResponse.json({ publicKey: await getPushPublicKey() });
  } catch (error) {
    return jsonError(error);
  }
}

