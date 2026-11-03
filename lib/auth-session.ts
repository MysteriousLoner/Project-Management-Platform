import { auth, applicationUrl, requireAuthConfiguration } from "./auth";
import { ApiError } from "./errors";
import { query } from "./db";
import type { Principal } from "./knowledge-types";

export async function principalForAuthUser(authUserId: string): Promise<Principal> {
  const result = await query(
    `SELECT l.auth_user_id,l.employee_id,l.must_change_password,u.display_name
     FROM kb_account_links l JOIN users u ON u.id=l.employee_id
     WHERE l.auth_user_id=$1 AND NOT u.is_archived`, [authUserId]);
  if (!result.rowCount) throw new ApiError(403, "ACCOUNT_UNAVAILABLE", "Your employee account is unavailable. Ask a teammate to check its status.");
  const row = result.rows[0];
  return { authUserId: row.auth_user_id, employeeId: row.employee_id, displayName: row.display_name, usingInitialPassword: row.must_change_password };
}

export function requireSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(applicationUrl).origin) throw new ApiError(403, "INVALID_ORIGIN", "This request came from an unrecognized origin.");
  // Browser session mutations must originate from our application. MCP uses bearer auth instead.
  if (!origin) throw new ApiError(403, "ORIGIN_REQUIRED", "An application Origin header is required for this operation.");
}

export async function requirePrincipal(request: Request): Promise<Principal> {
  requireAuthConfiguration();
  requireSameOrigin(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  return { ...await principalForAuthUser(session.user.id), sessionId: session.session.id };
}
