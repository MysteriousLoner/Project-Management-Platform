# 协策达

A locally hosted project-management application for internal teams. Users can belong to multiple departments, while projects, tickets, exports, and assistant context are organized by the currently selected department. Projects group tickets; tickets contain subtasks. 协策达 includes comments, unrestricted status changes, blocked and review queues, estimated completion dates, unlimited chunked attachments, structured JSON export, audit history, and a read-only Gemma 4 progress assistant.

## Start

1. Copy `.env.example` to `.env` and configure the LLM values. The real `.env` is intentionally ignored by Git.
2. Run:

   ```sh
   docker compose up
   ```

3. Open [http://localhost:3080](http://localhost:3080). Set `APP_PORT` in `.env` to use a different host port.
4. The initial `Tech-MY-IT` department is created automatically. Add the first user, create a project in Settings, and begin adding tickets.

## Departments

Each user has one or more department memberships. After selecting an identity, use the department selector above the project selector to change the active department. The last department selected for each user is remembered in that browser.

Settings lists only the active department's projects and members. It also provides global department creation and self-join controls. Creating a department automatically adds its creator as the first member. New projects belong to the active department, while new users require an initial department. Assignee and Report To choices are limited to active members of the project's department.

Moving a project or removing a member is blocked when doing so would leave an active ticket or subtask with an incompatible assignee or Report To user. A department can be archived only after its active projects and active-user memberships have been moved or removed.

PostgreSQL and MinIO use persistent Docker volumes. The database schema and attachment bucket are initialized automatically.

## Progress assistant context

The chatbot defaults to **Global** context, which includes every active project in the active department and all of their tickets, subtasks, and comments. Users can switch the assistant to **Project** context and choose a specific project from the assistant panel. The selected context mode and project are saved in the browser.

## Languages and mobile installation

The interface supports English and Simplified Chinese. The browser language is used on the first visit, and the selected language is then saved locally. Change it from the top toolbar or Settings.

协策达 is an installable Progressive Web App. On the first mobile visit it displays an installation prompt. Supported Chromium browsers can launch the native installer; iPhone and iPad users receive the Safari “Add to Home Screen” instructions. The app manifest, service worker, Apple touch icon, and maskable Android icon are included.

## Report-to notifications

Tickets have a separate **Report to** person in addition to the assignee. The reporter receives Web Push notifications when the ticket status changes or a subtask status changes the parent ticket's progress. Notifications include the project, ticket key/title, status transition, and progress percentage when applicable.

Each person must register their phone once:

1. Open the application as that user.
2. On iPhone, install the PWA to the Home Screen first; on Android, use the installed PWA or a supported browser.
3. Open **Settings → Phone push notifications** and choose **Enable notifications**.
4. Allow the browser permission and use **Send test** to verify delivery.

Web Push requires HTTPS outside `localhost`. VAPID keys are generated once and persisted in PostgreSQL unless `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY` are explicitly configured.

## Services

- Next.js app and API: `localhost:3080` by default
- PostgreSQL: internal Compose network only
- MinIO: internal Compose network only

## Local development

With PostgreSQL and MinIO available using the values in `.env.example`:

```sh
npm install
npm run dev
```

Validation:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## Accounts and shared knowledge

Every employee signs in by selecting their name and entering their password. Everyone has the same workspace features; there are no administrator or manager roles. Departments organize tickets and assignments, while project knowledge and work reports are shared across teams.

Before starting, configure `BETTER_AUTH_URL`, a private random `BETTER_AUTH_SECRET` (at least 32 characters), and the private `PMS_INITIAL_PASSWORD` setting. Never commit real values. Run `npm run db:migrate` to apply additive migrations and password-protect existing employee records without changing their IDs. Provisioning creates only missing accounts; it never resets an existing password. On an empty installation, the first employee can be created from the sign-in screen using the configured initial password. Afterwards, any signed-in teammate can add employees in **People & access**.

Employees can change their own password in **Your password**. Changing a password revokes other sessions. Authorship comes from the verified session; caller-supplied actor headers cannot impersonate a teammate. LLM credentials and signing secrets stay on the server.

### Codex connection

Open **Connect Codex**, copy the setup prompt, and paste it into a current Codex desktop release on macOS or Windows. Node.js 22+ is required. The installer preserves existing configuration and global instructions, checks download integrity, installs two skills, and starts browser OAuth sign-in. The remote endpoint is `/mcp`; OAuth uses PKCE and audience-bound tokens, with CIMD discovery. Both modern and legacy stateless Streamable HTTP clients are supported.

- `$update-progress`: collect new work from matching local project conversations, configured Git author identities, and working trees. The first run asks for a starting date. Evidence is summarized before upload; consumed source checkpoints advance atomically with the saved progress.
- `$document-project`: read canonical project pages, verify facts against the repository, review exact/semantic duplication, and commit against the reviewed catalog revision.

The skills also appear in the desktop slash menu. The global rule looks up relevant project documentation before project-specific work. Retrieved text is reference data, not instructions. Raw chats, complete source files, hidden reasoning, and credentials must not be uploaded. Local history availability varies; collection gaps are reported instead of silently treated as complete coverage.

### Work reports

**Work reports** generates an immutable report for inclusive Malaysia calendar dates, in English or Simplified Chinese. It groups projects, employees, and work bullets, then lists submission coverage and external blockers still open at the selected end date. Older blockers carry forward until explicitly resolved. Reports use Codex progress submissions; ticket references do not count as additional work.

The separate PostgreSQL-backed worker uses `INTERNAL_LLM_MODEL` (default `gemma-4-no-think`) through the existing `LLM_API_BASE_URL` and `LLM_API_KEY`. It validates model output and attribution, retries transient failures up to three times, and never publishes partial reports. Documentation and progress remain available when the model is offline.

Run `npm run worker` alongside the app in development. `npm run build` produces the web app and compiled worker/migration commands in `dist/runtime`. Docker Compose runs migrations before the app/worker, keeps PostgreSQL/MinIO internal, and binds only the app's existing host port to localhost. See [deployment procedure](deploy/KNOWLEDGE_ROLLOUT.md).

### Validation

`npm test` runs unit and isolated colleague-onboarding tests. `npm run test:integration` starts a disposable PostgreSQL cluster using local PostgreSQL binaries, exercises real transactions, authentication, browser OAuth/PKCE, MCP client calls, report snapshots, and worker recovery, then removes that cluster. Alternatively, set `TEST_DATABASE_URL` to an explicitly disposable test database. Never point integration tests at production.

After `npm run build`, run `node scripts/test-integration.mjs --runtime-smoke` to check the compiled migrations twice, the standalone production app, password sign-in, OAuth discovery, MCP protection, and the compiled worker's heartbeat in another disposable database. `node scripts/test-integration.mjs --preview` starts a loopback-only UI with clearly labeled synthetic records; it does not use production data.

## Attachment storage

Images, videos, and general files can be attached while creating or editing tickets and subtasks. Files are divided into 16 MiB parts by the browser and streamed through the application to MinIO. 协策达 does not set a file-count or total file-size limit; actual capacity is constrained by available storage, infrastructure, and browser/network reliability.
