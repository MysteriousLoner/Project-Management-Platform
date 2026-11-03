import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const { ensureSchema, pool } = await import("../lib/db");
  const { auth, requireAuthConfiguration } = await import("../lib/auth");
  const { getMigrations } = await import("better-auth/db/migration");
  requireAuthConfiguration();
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(183704,2)");
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    const { provisionEmployeeAccounts } = await import("../lib/accounts");
    await provisionEmployeeAccounts();
    console.log("Application and authentication migrations completed.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(183704,2)"); client.release(); await pool.end();
  }
}
main().catch(() => { console.error("Migration failed. Verify database access and authentication configuration; no credentials are logged."); process.exitCode = 1; });
