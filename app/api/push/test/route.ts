import { NextResponse } from "next/server";
import { actorId, jsonError } from "@/lib/api";
import { requireActor } from "@/lib/domain";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = actorId(request);
    const user = await requireActor(actor);
    const delivery = await sendPushToUser(actor, {
      title: "协策达 · Test notification",
      body: `Push notifications are enabled for ${user.display_name}.`,
      url: "",
      tag: `push-test-${actor}`
    });
    return NextResponse.json({ delivery });
  } catch (error) {
    return jsonError(error);
  }
}
