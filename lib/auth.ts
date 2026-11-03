import { betterAuth } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { pool } from "./db";
import { APIError } from "better-auth/api";

export const applicationUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3080").replace(/\/$/, "");
export const mcpResource = `${applicationUrl}/mcp`;

export function requireAuthConfiguration() {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("Set BETTER_AUTH_SECRET to a private random value of at least 32 characters before starting the application.");
  }
}

function createAuth() { return betterAuth({
  appName: "协策达",
  baseURL: applicationUrl,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  user: { modelName: "auth_users" },
  session: { modelName: "auth_sessions", expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
  account: { modelName: "auth_accounts" },
  verification: { modelName: "auth_verifications" },
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  disabledPaths: ["/change-password", "/set-password", "/delete-user", "/update-user", "/change-email"],
  databaseHooks: { session: { create: { before: async (session) => {
    const linked = await pool.query("SELECT 1 FROM kb_account_links l JOIN users u ON u.id=l.employee_id WHERE l.auth_user_id=$1 AND NOT u.is_archived", [session.userId]);
    if (!linked.rowCount) throw new APIError("FORBIDDEN", { message: "This employee account is not active. Ask a teammate to check its status." });
    return { data: session };
  } } } },
  advanced: { database: { generateId: "uuid" }, useSecureCookies: applicationUrl.startsWith("https:") },
  trustedOrigins: [applicationUrl],
  // Never let a provider/adapter exception log credential-bearing parameters.
  logger: { level: "error", log: () => { console.error("Authentication service error; verify schema and configuration."); } },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 120, customRules: { "/sign-in/username": { window: 60, max: 30 } } },
  plugins: [
    username({ minUsernameLength: 1, maxUsernameLength: 100, usernameValidator: (value) => /^employee-[a-f0-9-]{36}$/.test(value) }),
    jwt(),
    mcp({
      resource: mcpResource,
      loginPage: "/sign-in",
      consentPage: "/consent",
      scopes: ["openid", "profile", "offline_access", "mcp:read", "mcp:write", "reports:read", "reports:generate"],
      accessTokenExpiresIn: 3600,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" })
  ]
}); }

type WorkspaceAuth = ReturnType<typeof createAuth>;
let instance: WorkspaceAuth | undefined;
// Next.js imports route modules during builds. Initialize only for actual auth operations.
export const auth = new Proxy({} as WorkspaceAuth, { get(_target, property) {
  requireAuthConfiguration();
  instance ??= createAuth();
  return Reflect.get(instance, property);
} });
