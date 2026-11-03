import { requireMcpAuth } from "@better-auth/mcp";
import { auth, applicationUrl, mcpResource, requireAuthConfiguration } from "@/lib/auth";
import { principalForAuthUser } from "@/lib/auth-session";
import { knowledgeHandler } from "@/lib/mcp-server";
import { query } from "@/lib/db";
import { jsonError, ApiError } from "@/lib/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const protectedHandler = requireMcpAuth(auth, async (request, claims) => {
  try {
    if (typeof claims.sub !== "string" || typeof claims.sid !== "string") throw new ApiError(401, "SESSION_REQUIRED", "Reconnect Codex through browser sign-in.");
    const session = await query(`SELECT id FROM auth_sessions WHERE id=$1 AND "userId"=$2 AND "expiresAt">now()`, [claims.sid, claims.sub]);
    if (!session.rowCount) throw new ApiError(401, "SESSION_REVOKED", "This connection expired or was revoked. Sign in again.");
    const principal = await principalForAuthUser(claims.sub);
    return knowledgeHandler(principal, new Set(String(claims.scope ?? "").split(/\s+/))).fetch(request);
  } catch (e) {
    const response = jsonError(e);
    if (e instanceof ApiError && e.status === 401) response.headers.set("WWW-Authenticate", `Bearer resource_metadata="${applicationUrl}/.well-known/oauth-protected-resource/mcp"`);
    return response;
  }
}, { resource: mcpResource, requiredScopes: ["mcp:read"], challengeScopes: ["mcp:read", "mcp:write", "reports:read", "reports:generate", "offline_access"] });

async function handle(request: Request) {
  requireAuthConfiguration();
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(applicationUrl).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return Response.json({ error: "Request too large" }, { status: 413 });
  return protectedHandler(request);
}
export { handle as POST, handle as GET, handle as DELETE };
