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

## Identity and security

Selecting a user records the actor for changes and comments. It is not authentication. Department selection is organizational filtering rather than a security boundary: anyone who can reach the application can select any active user, join departments, or call APIs with another department ID. Keep the application on a trusted internal network.

LLM credentials are read only by the server. They are never sent to the browser or returned by an API.

## Attachment storage

Images, videos, and general files can be attached while creating or editing tickets and subtasks. Files are divided into 16 MiB parts by the browser and streamed through the application to MinIO. 协策达 does not set a file-count or total file-size limit; actual capacity is constrained by available storage, infrastructure, and browser/network reliability.
