import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getPushPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ publicKey: await getPushPublicKey() });
  } catch (error) {
    return jsonError(error);
  }
}

