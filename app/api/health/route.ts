import { NextResponse } from "next/server";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    await query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
