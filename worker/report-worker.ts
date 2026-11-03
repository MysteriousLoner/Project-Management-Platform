import { randomUUID } from "node:crypto";
import { claimJob, processClaimedJob, renewLease, type ClaimedJob } from "../lib/job-processing";
import { ensureSchema, pool, query } from "../lib/db";

const workerId = randomUUID();
let stopping = false;
let active: ClaimedJob | null = null;
let heartbeatRunning = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function heartbeat() {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    await query("INSERT INTO kb_worker_heartbeat(worker_id) VALUES($1) ON CONFLICT(worker_id) DO UPDATE SET last_seen=now()", [workerId]);
    if (active && !await renewLease(active)) console.warn("Job lease lost; this attempt cannot publish", { jobId: active.id });
  } catch { console.error("Worker heartbeat failed"); }
  finally { heartbeatRunning = false; }
}
async function main() {
  await ensureSchema();
  await heartbeat();
  const interval = setInterval(heartbeat, 20000);
  try {
    while (!stopping) {
      active = await claimJob();
      if (active) { await processClaimedJob(active); active = null; }
      else await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    clearInterval(interval);
    await query("DELETE FROM kb_worker_heartbeat WHERE worker_id=$1", [workerId]);
    await pool.end();
  }
}
main().catch(() => { console.error("Worker stopped because of an infrastructure failure"); process.exitCode = 1; });
