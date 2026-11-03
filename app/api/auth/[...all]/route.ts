import { auth, requireAuthConfiguration } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  requireAuthConfiguration();
  return auth.handler(request);
}
export { handle as GET, handle as POST };
