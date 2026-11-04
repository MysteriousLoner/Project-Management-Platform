# Shared knowledge v1 validation

Validated locally on 4 November 2026. Production has not been changed by this implementation.

## Completed checks

- Type checking, ESLint, and the production build pass. Build artifacts include the standalone Next.js app and compiled migration/worker commands.
- 23 unit/onboarding tests pass. These cover existing validation, Malaysia date boundaries, repository normalization, model timeout/rate-limit/invalid-output boundaries, excessive model input, configuration preservation, resumable evidence, nested repository isolation, untracked file edits, secret redaction, unavailable history, and first-login password routing with safe OAuth/page continuation.
- 15 PostgreSQL integration tests pass in a disposable local cluster. They exercise equal employee access, account backfill and password changes, authenticated legacy ticket/comment/export/attachment-metadata behavior, assignment and attribution, concurrent progress/idempotency/checkpoints, multiple devices, corrections, documentation duplicates/conflicts/revision checks, historical blockers, report snapshots, source attribution, bounded failures, worker claims/fencing, and OAuth PKCE with an official MCP client.
- The compiled runtime smoke check passes on Node 22.23.4 (the container's Node 22 major) as well as the local Node runtime. It applies migrations twice, starts the standalone app and worker, signs in a synthetic employee, checks reports/OAuth discovery/MCP protection, and verifies the worker heartbeat against another disposable database.
- A live `gemma-4-no-think` check through the existing configured gateway completed a synthetic report, retained source IDs and a blocker, and classified a paraphrased documentation duplicate. No production records were written by that check.
- Desktop and mobile report previews use clearly labeled synthetic records. The independent UI reviewer scored mobile navigation wrapping and print exclusion of the password reminder resolved. The colleague installer also passed an independent retest of six previously identified preservation/isolation/redaction issues.
- The production dependency audit reports zero vulnerabilities at the moderate threshold.

First-login follow-up: initial-password accounts now open a password-change prompt after browser sign-in. Successful changes resume the requested workspace page or local Codex consent flow. The integration suite verifies the initial-password state and rejects retaining the same initial password; the compiled runtime smoke check verifies the prompt is rendered. Changed personal passwords are preserved by provisioning. The updated default is held only in the private runtime setting.

## Rollout checks still required

- Build and start the Docker image on the target server. The local Docker daemon did not respond; the compiled app and worker were tested directly instead.
- Verify the actual Codex desktop connection, installer, browser sign-in, and skill invocation on both macOS and Windows after deployment. Cross-platform implementation and isolated installer tests do not substitute for native Windows validation.
- Verify real MinIO upload/download and push delivery after deployment; local regression tests cover authentication, attachment metadata/export, and notification behavior with no push subscriptions, without contacting those production services.
- Back up the database, record the previous image, recheck ports/proxy, and run the production smoke steps in [KNOWLEDGE_ROLLOUT.md](KNOWLEDGE_ROLLOUT.md) after approval. Preserve employee IDs, assignments, volumes, and additive records.

Semantic duplicate review is model judged and can return uncertainty. It does not mathematically guarantee that every paraphrase is detected. Unresolved review conflicts are not published.
