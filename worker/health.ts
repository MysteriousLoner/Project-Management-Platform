import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
try {
  const result = await pool.query("SELECT 1 FROM kb_worker_heartbeat WHERE last_seen>now()-interval '60 seconds' LIMIT 1");
  if (!result.rowCount) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await pool.end(); }
