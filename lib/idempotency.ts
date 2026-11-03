import type { PoolClient } from "pg";
import { ApiError } from "./errors";
import { transaction } from "./db";
import { hashRequest } from "./knowledge-utils";

/** Lock survives across every app instance; result and data commit together. */
export async function idempotent<T>(employeeId: string, operation: string, key: string, input: unknown, action: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${employeeId}:${operation}:${key}`]);
    const hash = hashRequest(input);
    const found = await client.query("SELECT request_hash,result FROM kb_idempotency WHERE employee_id=$1 AND operation=$2 AND key=$3", [employeeId, operation, key]);
    if (found.rowCount) {
      if (found.rows[0].request_hash !== hash) throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "This idempotency key was already used for different content.");
      return found.rows[0].result as T;
    }
    const result = await action(client);
    await client.query("INSERT INTO kb_idempotency(employee_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)", [employeeId, operation, key, hash, JSON.stringify(result)]);
    return result;
  });
}
