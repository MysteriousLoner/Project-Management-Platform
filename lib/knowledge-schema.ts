/** Additive schema. All initialization is serialized with a PostgreSQL advisory lock. */
export const knowledgeSchemaSql = `
CREATE TABLE IF NOT EXISTS kb_account_links (
  auth_user_id uuid PRIMARY KEY,
  employee_id uuid NOT NULL UNIQUE REFERENCES users(id),
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kb_idempotency (
  employee_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, operation, key)
);
CREATE TABLE IF NOT EXISTS kb_repository_aliases (
  normalized_remote text PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kb_catalogs (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  revision integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  topic text NOT NULL CHECK (topic IN ('overview','architecture','setup','interfaces','deployment','decisions','operating-notes')),
  title text NOT NULL,
  content text NOT NULL,
  fingerprint text NOT NULL,
  version integer NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, topic),
  UNIQUE (project_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS kb_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES kb_documents(id),
  version integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  evidence jsonb NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, version)
);
CREATE TABLE IF NOT EXISTS kb_checkpoints (
  employee_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  client_id text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  baseline_date date NOT NULL,
  sources jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(employee_id, project_id, client_id)
);
CREATE TABLE IF NOT EXISTS kb_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  employee_id uuid NOT NULL REFERENCES users(id),
  work_date date NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK(status IN ('completed','in_progress')),
  evidence jsonb NOT NULL,
  supersedes_id uuid UNIQUE REFERENCES kb_progress(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_progress_project_date ON kb_progress(project_id, work_date, employee_id);
CREATE TABLE IF NOT EXISTS kb_progress_evidence (
  employee_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  source_id text NOT NULL,
  progress_id uuid NOT NULL REFERENCES kb_progress(id),
  PRIMARY KEY(employee_id, project_id, source_id)
);
CREATE TABLE IF NOT EXISTS kb_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,key)
);
CREATE TABLE IF NOT EXISTS kb_blocker_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES kb_blockers(id),
  employee_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK(state IN ('open','resolved')),
  effective_date date NOT NULL,
  summary text NOT NULL,
  outside_party text NOT NULL,
  action_needed text NOT NULL,
  affected_employee_ids uuid[] NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_blocker_history ON kb_blocker_events(blocker_id,effective_date DESC,recorded_at DESC);
CREATE TABLE IF NOT EXISTS kb_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('report','documentation_review')),
  requested_by uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','failed')),
  input jsonb NOT NULL,
  result jsonb,
  attempts integer NOT NULL DEFAULT 0,
  attempt_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_jobs_claim ON kb_jobs(state,available_at,created_at);
CREATE TABLE IF NOT EXISTS kb_report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES kb_jobs(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  language text NOT NULL CHECK(language IN ('en','zh-CN')),
  snapshot jsonb NOT NULL,
  report jsonb NOT NULL,
  markdown text NOT NULL,
  model text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kb_worker_heartbeat (
  worker_id text PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_migrations(key) VALUES ('2026-11-knowledge-v1') ON CONFLICT DO NOTHING;
`;
