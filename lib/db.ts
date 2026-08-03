import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalDb = globalThis as unknown as {
  pool?: Pool;
  schemaReady?: Promise<void>;
};

export const pool =
  globalDb.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://project_manager:local-project-password@localhost:5432/project_manager",
    max: 20
  });

if (process.env.NODE_ENV !== "production") globalDb.pool = pool;

const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE work_item_type AS ENUM ('ticket', 'subtask');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE work_item_status AS ENUM (
    'not_started', 'in_progress', 'descoped', 'on_hold',
    'blocked', 'ready_for_review', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE attachment_state AS ENUM (
    'initiated', 'uploading', 'complete', 'failed', 'aborted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(100) NOT NULL,
  normalized_name varchar(100) NOT NULL UNIQUE,
  avatar_color varchar(20) NOT NULL DEFAULT '#5b5bd6',
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  key varchar(10) NOT NULL UNIQUE,
  description text,
  next_ticket_number bigint NOT NULL DEFAULT 1,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  type work_item_type NOT NULL,
  parent_id uuid REFERENCES work_items(id),
  ticket_number bigint,
  key varchar(32) NOT NULL UNIQUE,
  title varchar(250) NOT NULL,
  description text NOT NULL DEFAULT '',
  status work_item_status NOT NULL DEFAULT 'not_started',
  assignee_id uuid REFERENCES users(id),
  report_to_id uuid REFERENCES users(id),
  created_by_id uuid NOT NULL REFERENCES users(id),
  updated_by_id uuid NOT NULL REFERENCES users(id),
  blocked_reason text,
  estimated_completion_date date,
  position bigint NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT item_parent_shape CHECK (
    (type = 'ticket' AND parent_id IS NULL AND ticket_number IS NOT NULL)
    OR (type = 'subtask' AND parent_id IS NOT NULL)
  ),
  CONSTRAINT subtask_review_status CHECK (
    type = 'ticket' OR status <> 'ready_for_review'
  ),
  CONSTRAINT blocked_reason_required CHECK (
    status <> 'blocked' OR length(trim(coalesce(blocked_reason, ''))) > 0
  )
);

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS report_to_id uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS push_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL DEFAULT 0,
  upload_state attachment_state NOT NULL DEFAULT 'initiated',
  upload_id text,
  uploaded_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  removed_at timestamptz,
  removed_by_id uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id),
  work_item_id uuid REFERENCES work_items(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  action varchar(50) NOT NULL,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_status
  ON work_items(project_id, status, is_archived);
CREATE INDEX IF NOT EXISTS idx_work_items_parent
  ON work_items(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee
  ON work_items(assignee_id, status, is_archived);
CREATE INDEX IF NOT EXISTS idx_work_items_report_to
  ON work_items(report_to_id, status, is_archived);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_work_item
  ON comments(work_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_work_item
  ON attachments(work_item_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_audit_project
  ON audit_events(project_id, created_at DESC);
`;

export async function ensureSchema() {
  if (!globalDb.schemaReady) {
    globalDb.schemaReady = pool.query(schemaSql).then(() => undefined);
  }
  await globalDb.schemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  await ensureSchema();
  return pool.query<T>(text, values);
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function normalizeName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function rowToCamel(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const normalizedValue =
        key.endsWith("_date") && value instanceof Date
          ? value.toISOString().slice(0, 10)
          : value;
      return [
        key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()),
        normalizedValue
      ];
    })
  );
}
