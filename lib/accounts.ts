import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { auth, requireAuthConfiguration } from "./auth";
import { ApiError } from "./errors";
import { query, transaction, normalizeName } from "./db";
import { idempotent } from "./idempotency";
import { id, key, type Principal } from "./knowledge-types";

export const loginUsername = (employeeId: string) => `employee-${employeeId}`;
export function initialPassword() {
  const value = process.env.PMS_INITIAL_PASSWORD;
  if (!value || value.length < 8) throw new ApiError(503, "INITIAL_PASSWORD_NOT_CONFIGURED", "Configure the private initial account password before provisioning employees.");
  return value;
}

export async function insertAccount(client: PoolClient, employeeId: string, password: string, displayName: string) {
  const context = await auth.$context;
  const passwordHash = await context.password.hash(password);
  const authUserId = randomUUID();
  // Stable internal identifiers preserve existing employee names without requiring email collection.
  await client.query(`INSERT INTO auth_users(id,name,email,"emailVerified",username,"displayUsername","createdAt","updatedAt")
    VALUES($1,$2,$3,true,$4,$2,now(),now())`, [authUserId, displayName, `${employeeId}@employees.invalid`, loginUsername(employeeId)]);
  await client.query(`INSERT INTO auth_accounts(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
    VALUES($1,$2::text,'credential',$2::uuid,$3,now(),now())`, [randomUUID(), authUserId, passwordHash]);
  await client.query("INSERT INTO kb_account_links(auth_user_id,employee_id) VALUES($1,$2)", [authUserId, employeeId]);
  return authUserId;
}

/** Runs once per unlinked employee; subsequent deploys never reset changed passwords. */
export async function provisionEmployeeAccounts() {
  const password = initialPassword();
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(183704,3)");
    const employees = await client.query(`SELECT u.id,u.display_name FROM users u WHERE
      NOT EXISTS(SELECT 1 FROM kb_account_links l WHERE l.employee_id=u.id) ORDER BY u.id FOR UPDATE`);
    for (const employee of employees.rows) await insertAccount(client, employee.id, password, employee.display_name);
    return employees.rowCount ?? 0;
  });
}

export async function createEmployee(principal: Principal, raw: unknown) {
  const input = z.object({ displayName: z.string().trim().min(1).max(100), departmentId: id, idempotencyKey: key }).strict().parse(raw);
  const password = initialPassword();
  return idempotent(principal.employeeId, "accounts.create", input.idempotencyKey, input, async (client) => {
    const department = await client.query("SELECT 1 FROM departments WHERE id=$1 AND NOT is_archived", [input.departmentId]);
    if (!department.rowCount) throw new ApiError(422, "DEPARTMENT_NOT_FOUND", "Choose an active department.");
    const employee = await client.query("INSERT INTO users(display_name,normalized_name) VALUES($1,$2) RETURNING id", [input.displayName, normalizeName(input.displayName)]);
    const employeeId = employee.rows[0].id;
    await client.query("INSERT INTO user_departments(user_id,department_id) VALUES($1,$2)", [employeeId, input.departmentId]);
    await insertAccount(client, employeeId, password, input.displayName);
    await client.query("INSERT INTO audit_events(actor_id,action,metadata) VALUES($1,'employee_account_created',$2::jsonb)", [principal.employeeId, JSON.stringify({ employeeId })]);
    return { employeeId, created: true };
  });
}

export async function listAccounts(principal: Principal) {
  void principal;
  return (await query(`SELECT u.id,u.display_name AS "displayName",u.is_archived AS "isArchived",l.auth_user_id IS NOT NULL AS "passwordProtected"
    FROM users u LEFT JOIN kb_account_links l ON l.employee_id=u.id ORDER BY u.display_name`)).rows;
}

export async function changeAccount(principal: Principal, raw: unknown) {
  const input = z.object({ employeeId: id, revokeSessions: z.literal(true), idempotencyKey: key }).strict().parse(raw);
  return idempotent(principal.employeeId, "accounts.revoke", input.idempotencyKey, input, async (client) => {
    const found = await client.query("SELECT auth_user_id FROM kb_account_links WHERE employee_id=$1", [input.employeeId]);
    if (!found.rowCount) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "This employee account is not available.");
    await client.query(`DELETE FROM auth_sessions WHERE "userId"=$1`, [found.rows[0].auth_user_id]);
    await client.query("INSERT INTO audit_events(actor_id,action,metadata) VALUES($1,'sessions_revoked',$2::jsonb)", [principal.employeeId, JSON.stringify({ employeeId: input.employeeId })]);
    return { updated: true };
  });
}

export async function changeOwnPassword(principal: Principal, raw: unknown) {
  const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128), idempotencyKey: key }).strict().parse(raw);
  if (principal.usingInitialPassword && input.newPassword === input.currentPassword) throw new ApiError(422, "PERSONAL_PASSWORD_REQUIRED", "Choose a personal password different from the initial password.");
  requireAuthConfiguration();
  // Do not persist a fast, guessable fingerprint of the password values.
  const privateDigest = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(JSON.stringify([input.currentPassword, input.newPassword])).digest("hex");
  const context = await auth.$context;
  const hash = await context.password.hash(input.newPassword);
  return idempotent(principal.employeeId, "accounts.password", input.idempotencyKey, { privateDigest }, async (client) => {
    const credential = await client.query(`SELECT id,password FROM auth_accounts WHERE "userId"=$1 AND "providerId"='credential' FOR UPDATE`, [principal.authUserId]);
    if (!credential.rowCount || !await context.password.verify({ hash: credential.rows[0].password, password: input.currentPassword })) throw new ApiError(400, "INCORRECT_PASSWORD", "The current password is incorrect.");
    await client.query("UPDATE auth_accounts SET password=$2,\"updatedAt\"=now() WHERE id=$1", [credential.rows[0].id, hash]);
    await client.query("UPDATE kb_account_links SET must_change_password=false WHERE employee_id=$1", [principal.employeeId]);
    await client.query(`DELETE FROM auth_sessions WHERE "userId"=$1 AND ($2::uuid IS NULL OR id<>$2::uuid)`, [principal.authUserId, principal.sessionId ?? null]);
    await client.query("INSERT INTO audit_events(actor_id,action) VALUES($1,'password_changed')", [principal.employeeId]);
    return { updated: true };
  });
}

/** The empty-workspace setup also requires knowledge of the configured initial password. */
export async function createFirstEmployee(raw: unknown) {
  const input = z.object({ displayName: z.string().trim().min(1).max(100), password: z.string().min(1).max(128) }).strict().parse(raw);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(input.password), digest(initialPassword()))) throw new ApiError(400, "INCORRECT_PASSWORD", "The initial workspace password is incorrect.");
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(183704,3)");
    if ((await client.query("SELECT 1 FROM users WHERE NOT is_archived LIMIT 1")).rowCount) throw new ApiError(409, "WORKSPACE_ALREADY_CONFIGURED", "An employee account already exists. Sign in with it to add teammates.");
    const employeeId = randomUUID();
    await client.query("INSERT INTO users(id,display_name,normalized_name) VALUES($1,$2,$3)", [employeeId, input.displayName, normalizeName(input.displayName)]);
    await client.query("INSERT INTO user_departments(user_id,department_id) SELECT $1,id FROM departments WHERE normalized_name='tech-my-it'", [employeeId]);
    await insertAccount(client, employeeId, initialPassword(), input.displayName);
    return { employeeId, username: loginUsername(employeeId) };
  });
}
