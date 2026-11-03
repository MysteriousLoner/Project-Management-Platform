import { auth, requireAuthConfiguration } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  requireAuthConfiguration();
  return auth.handler(request);
}
