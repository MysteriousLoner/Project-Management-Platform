# Shared knowledge rollout

Production deployment requires user approval after the code and validation results are reviewed. Use the existing Git repository and deploy a specific reviewed commit. Do not upload a working directory or copy credential files into Git.

## Before deployment

- Confirm the checkout is clean and record its commit and current application image ID. Recheck listening ports and the application Compose configuration. The intended mapping is `127.0.0.1:3080` to container `3000`; the worker publishes no port.
- Preserve the existing PostgreSQL and MinIO volumes and their current credentials. Do not stop or modify unrelated containers.
- With explicit approval for the private environment update, add `BETTER_AUTH_URL=https://pms.techmation.my`, a freshly generated `BETTER_AUTH_SECRET`, the user-selected `PMS_INITIAL_PASSWORD`, and `INTERNAL_LLM_MODEL=gemma-4-no-think` directly to the private runtime environment. Never print values or put them in Git. Preserve the existing LLM key/base URL and chat model.
- Back up the application's PostgreSQL database to a private file using the existing database container's environment. Do not print the connection string or password. Confirm the dump completed and retain its path privately.
- Build the reviewed application image with `docker compose build app`. This produces the app, worker, migration command, and onboarding bundle from the same source revision.

## Apply and verify

1. Start the migration service with `docker compose up --no-build migrate` and require a successful exit. It adds knowledge/authentication tables and creates password hashes only for employees without accounts. It preserves employee IDs, assignments, history, attachments, and changed passwords.
2. Start the application and worker with `docker compose up -d --no-build app worker`. Their dependencies enforce migration completion. Keep the existing reverse proxy at the root of `pms.techmation.my`; the deployed app has no `/xieceda` base path.
3. Verify `/api/health`, application sign-in, and access to the ticket tracker, reports, people, and password settings. Test password changes with a designated test employee, not by resetting another person's credentials.
4. Confirm OAuth protected-resource and authorization-server discovery reach the auth handler through the existing proxy. Verify browser OAuth sign-in from Codex and `identity.me` attribution. Validate the client on macOS and Windows before broad onboarding.
5. With designated test records, check simultaneous progress submissions, documentation review/commit, and a complete report through the existing Gemma gateway. Check worker health and bounded retries. Do not include actual credentials or raw conversations in test submissions.

The existing proxy forwards all paths to the application. Streaming MCP responses must not be buffered if a future operation emits notifications. OAuth metadata, `/api/auth/*`, `/mcp`, and `/codex/*` must not be blocked by an interactive proxy challenge.

## Recovery

Keep the previous application image and Git revision. If rollout verification fails, stop only this application's worker and restore the previous application image while preserving all volumes and additive tables. Do not erase progress, reports, or document revisions. The previous application predates authentication: restrict its proxy access while investigating rather than accidentally reopening it to a wider audience. Retain the database backup; restoring it requires separate approval because it can discard writes made after the backup.

Failed model jobs have a visible retry action. Worker leases recover interrupted jobs, and attempt tokens prevent an expired worker from publishing. A model outage should not trigger a database rollback or stop documentation reads/progress submissions.
