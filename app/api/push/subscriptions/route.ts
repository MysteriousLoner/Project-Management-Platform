import { NextResponse } from "next/server";
import { actorId, ApiError, jsonError, requestJson } from "@/lib/api";
import { query } from "@/lib/db";
import { requireActor } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    await requireActor(actor);
    const body = await requestJson(request);
    const endpoint = String(body.endpoint ?? "");
    const p256dh = String(body.keys?.p256dh ?? "");
    const auth = String(body.keys?.auth ?? "");
    if (!endpoint || !p256dh || !auth) {
      throw new ApiError(422, "PUSH_SUBSCRIPTION_INVALID", "The push subscription is incomplete.");
    }
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         updated_at = now()`,
      [actor, endpoint, p256dh, auth, request.headers.get("user-agent")]
    );
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireActor(actorId(request));
    const endpoint = String((await requestJson(request)).endpoint ?? "");
    if (!endpoint) throw new ApiError(422, "ENDPOINT_REQUIRED", "A push endpoint is required.");
    await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    return NextResponse.json({ subscribed: false });
  } catch (error) {
    return jsonError(error);
  }
}

