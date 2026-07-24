# Local Project Management Platform — Implementation Plan

## 1. Purpose

Build a locally hosted project management application for internal use. The product should provide Jira-like ticket tracking without authentication, support tickets and nested work through subtasks, store arbitrarily large image/video attachments subject only to available infrastructure capacity, expose structured project data through an API, and include an on-screen AI assistant that can summarize progress.

This document is written as an execution plan for delegation to implementation agents. Each task includes scope, dependencies, implementation notes, and acceptance criteria. Agents should not silently change the architecture or product rules described here; unresolved decisions must be recorded and escalated.

## 2. Product Scope

### 2.1 Required capabilities

1. Select the current user when opening the application.
2. Add and manage users from a configuration page.
3. Create, view, edit, and archive tickets.
4. Create, view, edit, and archive subtasks belonging to tickets.
5. Assign tickets and subtasks to configured users.
6. Change ticket status among:
   - Not Started
   - In Progress
   - Descoped
   - On Hold
   - Blocked
   - Ready for Review
   - Completed
7. Change subtask status among the same statuses except Ready for Review.
8. Upload and view images and videos on both tickets and subtasks.
9. Do not impose an application-level attachment size limit.
10. Show one queue containing all blocked tickets and blocked subtasks.
11. Show one review queue containing all tickets that are Ready for Review.
12. Expose tickets and subtasks as structured JSON through an API.
13. Provide an on-screen chatbot that can access project data and summarize progress.
14. Record enough history to explain changes and calculate progress over time.
15. Add timestamped user comments to both tickets and subtasks.
16. Store and display an estimated completion date on both tickets and subtasks.
17. Run locally through a documented, repeatable deployment process.

### 2.2 Explicit interpretation of ambiguous requirements

- **Review queue:** Confirmed: Ready for Review does not apply to subtasks. The review queue contains tickets only.
- **No login:** Selecting a user identifies the actor for display and audit history; it is not authentication and provides no access control.
- **No attachment size limit:** The application will not define a maximum file size. Actual capacity remains limited by disk space, filesystem limits, network stability, reverse-proxy timeouts, and object-store configuration.
- **Subtasks:** Version 1 supports one level of subtasks. A subtask cannot contain another subtask.
- **Progress:** Ticket progress is derived from its subtasks when subtasks exist; otherwise it is derived from ticket status. The exact formula is defined in Section 7.7.
- **Archive instead of hard delete:** Users and work items are archived so audit history and chatbot summaries remain consistent. Attachment deletion may be supported separately.
- **Comments:** Comments are part of MVP for tickets and subtasks. Comments are append-only in the first implementation; editing and deletion require a later explicit product decision so conversation history remains trustworthy.
- **Estimated completion date:** This is a user-maintained forecast date, not an automatically calculated promise or time estimate. It is separate from the actual completion timestamp.
- **Kanban:** A Kanban board is not required. The primary work views are searchable lists, detail screens, dashboard, and queues.
- **AI provider:** The chatbot connects through an API to the locally hosted Gemma 4 model served by Ollama. The Ollama URL and exact configured model name remain environment settings.
- **Hierarchy:** Confirmed: a project is a container/group for multiple tickets. Each ticket belongs to one project, and each subtask belongs to one ticket.

### 2.3 Out of scope for version 1

- Authentication, passwords, single sign-on, roles, and permissions
- External/public internet hosting
- Email, Slack, or other notifications
- Sprints, epics, story points, time tracking, billing, and roadmaps
- Kanban board and drag/drop status management
- Multiple independent organizations or tenants
- Offline-first synchronization
- Native mobile applications
- Real-time multi-user editing
- Full-text extraction or transcription from uploaded media
- Virus scanning unless specifically added later
- Arbitrary custom workflows or custom statuses

## 3. Product Decisions Required

Resolve the following before the referenced implementation milestone. Defaults allow work to begin without blocking.

| ID | Question | Proposed default | Needed by |
|---|---|---|---|
| D-01 | Is a project separate from a ticket? | **Confirmed:** Yes; a project groups multiple tickets, and tickets contain subtasks | P1.2 |
| D-02 | Should subtasks ever use Ready for Review? | **Confirmed:** No; tickets only | P1.2 |
| D-03 | Which AI provider should power the chatbot? | **Confirmed:** Locally hosted Gemma 4 through the Ollama API; keep URL/model configurable | P5.1 |
| D-04 | Must all data, including AI processing, remain on the local network? | Yes by default; remote AI is opt-in | P5.1 |
| D-05 | May attachments be deleted permanently? | Yes, through an explicit confirmation; metadata remains in audit history | P3.3 |
| D-06 | Should users be able to comment on work items? | **Confirmed:** Yes, on tickets and subtasks in MVP | P1.3 |
| D-07 | How should ticket identifiers look? | Project key plus sequence, for example `OPS-104` | P2.2 |
| D-08 | Which host operating systems are required? | Linux server via Docker Compose; macOS/Windows development supported through Docker Desktop | P6.1 |
| D-09 | Is HTTPS required on the local network? | Optional in MVP, documented as recommended | P6.2 |
| D-10 | Should a ticket auto-complete when all subtasks complete? | No; show a suggestion but require an explicit ticket status change | P2.4 |
| D-11 | Can archived users remain assigned to existing work? | Yes; they are hidden from new assignment lists but retained historically | P2.1 |
| D-12 | Should there be a global default project? | Use the last selected project; require explicit choice on first use | P2.2 |
| D-13 | Is a Kanban board required? | **Confirmed:** No | P2.7 |
| D-14 | Do tickets and subtasks need a forecast date? | **Confirmed:** Yes, `estimatedCompletionDate` on both | P1.2 |
| D-15 | Does Not Started need a separate backlog/proposed state? | **Confirmed:** No; Not Started is sufficient | P1.2 |
| D-16 | What happens when ticket review fails? | **Confirmed:** Return the ticket to In Progress | P1.4 |
| D-17 | Should workflow transitions be enforced? | **Confirmed:** No; users may freely select any status allowed for that item type | P1.4 |

## 4. Recommended Architecture

### 4.1 Technology stack

Use a TypeScript monorepo so frontend, backend, validation schemas, and API types can be shared.

- **Monorepo:** pnpm workspaces
- **Frontend:** React, Vite, TypeScript, React Router, TanStack Query
- **UI:** Tailwind CSS plus an accessible component library such as shadcn/ui
- **Backend:** Node.js, Fastify, TypeScript
- **Validation/API contract:** TypeBox or Zod, with OpenAPI generation
- **Database:** PostgreSQL
- **Database access/migrations:** Drizzle ORM
- **Attachment storage:** MinIO using the S3 API
- **Reverse proxy:** Caddy
- **AI integration:** provider adapter for an OpenAI-compatible Chat Completions API
- **Local model default:** Ollama, configured separately rather than bundled into the core application
- **Testing:** Vitest, React Testing Library, Playwright, and API integration tests against disposable services
- **Deployment:** Docker Compose
- **Logging:** structured JSON logs with request IDs

Do not add Redis or a background worker until an actual asynchronous workload requires it. Large uploads should stream directly to object storage and should not be buffered in application memory.

### 4.2 Repository layout

```text
/
├── apps/
│   ├── web/                  # React frontend
│   └── api/                  # Fastify API
├── packages/
│   ├── contracts/            # Shared DTOs, enums, JSON schemas
│   ├── database/             # Drizzle schema, migrations, seeds
│   ├── ui/                   # Shared UI primitives if needed
│   └── config/               # Shared lint/TypeScript configuration
├── tests/
│   └── e2e/                  # Playwright cross-application flows
├── infra/
│   ├── caddy/
│   ├── compose/
│   └── scripts/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── operations/
│   └── decisions/
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

### 4.3 Runtime topology

```text
Browser
  |
  v
Caddy reverse proxy
  |----------------------|
  v                      v
React static app       Fastify API
                         |       |
                         v       v
                    PostgreSQL  MinIO
                         |
                         v
              AI provider adapter
                         |
                 Ollama or approved
              OpenAI-compatible service
```

### 4.4 Architectural rules

1. The browser never connects directly to PostgreSQL or MinIO with permanent credentials.
2. The API validates all inputs at the boundary with shared schemas.
3. Status rules are enforced by the backend, not only hidden in the frontend.
4. User selection is sent as an actor header or session identifier and validated against active/configured users, but it must never be described as authentication.
5. Upload bytes must stream to MinIO; no complete file buffering in browser JavaScript beyond the browser's normal file handling or in API memory.
6. All attachment and work-item references use stable UUIDs internally.
7. Human-readable ticket keys are immutable after creation.
8. All timestamps are stored in UTC and rendered in the browser's local timezone.
9. API JSON uses ISO 8601 timestamps and stable lowercase enum values.
10. Destructive business operations use archive/soft-delete unless specifically documented otherwise.
11. Every mutation writes an audit event in the same database transaction as the mutation where possible.
12. Chatbot context is assembled server-side; the AI provider does not receive database credentials or direct tool access.

## 5. Data Model

### 5.1 Enumerations

`work_item_status`:

```text
not_started
in_progress
descoped
on_hold
blocked
ready_for_review
completed
```

`work_item_type`:

```text
ticket
subtask
```

`audit_action`:

```text
created
updated
status_changed
assigned
unassigned
archived
restored
attachment_added
attachment_removed
user_selected
```

### 5.2 Tables

#### `users`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `display_name` | varchar(100) | Required, trimmed |
| `normalized_name` | varchar(100) | Required, unique among non-archived users |
| `avatar_color` | varchar(20) | Required, generated default |
| `is_archived` | boolean | Default false |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |

#### `projects`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | varchar(120) | Required |
| `key` | varchar(10) | Required, uppercase, unique |
| `description` | text | Optional |
| `next_ticket_number` | bigint | Required, starts at 1 |
| `is_archived` | boolean | Default false |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |

Ticket numbers must be allocated transactionally to avoid duplicate keys.

#### `work_items`

Use one table for tickets and subtasks so queues, history, assignment, attachments, and chatbot queries remain consistent.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Required FK to projects |
| `type` | enum | `ticket` or `subtask` |
| `parent_id` | UUID | Null for tickets; required FK to a ticket for subtasks |
| `ticket_number` | bigint | Required for tickets; null for subtasks |
| `key` | varchar(32) | Required and unique for tickets; subtasks use a display suffix or UUID |
| `title` | varchar(250) | Required, trimmed |
| `description` | text | Optional; Markdown |
| `status` | enum | Required |
| `assignee_id` | UUID | Optional FK to users |
| `created_by_id` | UUID | Required FK to users |
| `updated_by_id` | UUID | Required FK to users |
| `blocked_reason` | text | Required when status is blocked |
| `position` | numeric/string rank | Ordering within a ticket |
| `estimated_completion_date` | date | Optional user-maintained forecast date |
| `is_archived` | boolean | Default false |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |
| `completed_at` | timestamptz | Set when changed to completed; cleared when leaving completed |

Database constraints:

- Tickets have `parent_id IS NULL`.
- Subtasks have `parent_id IS NOT NULL`.
- A subtask's parent must be a ticket in the same project. Enforce in service logic and transaction tests; use a database trigger only if needed.
- `ready_for_review` is rejected for subtasks.
- `blocked_reason` must be non-empty when status is `blocked`.
- Archived work items are excluded from default lists but retrievable explicitly.

#### `attachments`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `work_item_id` | UUID | Required FK |
| `object_key` | text | Required, unique, never derived only from filename |
| `original_filename` | text | Required, sanitized for display |
| `media_type` | text | Required; server-detected/validated where possible |
| `byte_size` | bigint | Required after successful upload |
| `etag` | text | Optional storage checksum/identifier |
| `upload_state` | enum | `initiated`, `uploading`, `complete`, `failed`, `aborted` |
| `uploaded_by_id` | UUID | Required FK |
| `created_at` | timestamptz | Required |
| `completed_at` | timestamptz | Optional |
| `removed_at` | timestamptz | Optional |
| `removed_by_id` | UUID | Optional FK |

#### `comments`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `work_item_id` | UUID | Required FK to ticket or subtask |
| `author_id` | UUID | Required FK to users |
| `body` | text | Required, trimmed Markdown; raw HTML disabled |
| `created_at` | timestamptz | Required |

MVP comments are append-only. If editing/deletion is approved later, add `edited_at`, soft-delete metadata, and audit events rather than overwriting history.

#### `audit_events`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Optional for user/config events |
| `work_item_id` | UUID | Optional |
| `actor_id` | UUID | Optional only for system events |
| `action` | enum | Required |
| `field_name` | text | Optional |
| `old_value` | jsonb | Optional |
| `new_value` | jsonb | Optional |
| `metadata` | jsonb | Required, default `{}` |
| `created_at` | timestamptz | Required |

#### `chat_sessions`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `actor_id` | UUID | Required FK |
| `project_id` | UUID | Optional; null means all projects |
| `title` | text | Optional |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |

#### `chat_messages`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `session_id` | UUID | Required FK |
| `role` | enum | `user`, `assistant`, `system` |
| `content` | text | Required |
| `context_snapshot` | jsonb | For assistant messages; item IDs/version timestamps used |
| `created_at` | timestamptz | Required |

### 5.3 Indexes

At minimum:

- `work_items(project_id, is_archived, updated_at DESC)`
- `work_items(project_id, status, is_archived)`
- `work_items(parent_id, position)` for subtasks
- `work_items(assignee_id, status, is_archived)`
- Unique partial index for project ticket number/key
- `attachments(work_item_id, removed_at)`
- `comments(work_item_id, created_at)`
- `audit_events(work_item_id, created_at DESC)`
- `audit_events(project_id, created_at DESC)`
- `chat_messages(session_id, created_at)`
- PostgreSQL trigram or full-text index on work-item title/description if search is included in MVP

## 6. API Contract

### 6.1 General conventions

- Base path: `/api/v1`
- JSON keys: `camelCase`
- Enum values: lowercase snake case
- Actor header: `X-Actor-Id: <user UUID>`
- Pagination: cursor-based for potentially large collections
- Error shape:

```json
{
  "error": {
    "code": "SUBTASK_STATUS_NOT_ALLOWED",
    "message": "Ready for review is not available for subtasks.",
    "details": {},
    "requestId": "..."
  }
}
```

- Mutating endpoints require a valid `X-Actor-Id`.
- Read endpoints may require a selected actor for consistent UI behavior, but this remains identity selection, not security.
- Generate and publish an OpenAPI document at `/api/v1/openapi.json`.

### 6.2 User endpoints

```text
GET    /users
POST   /users
GET    /users/:userId
PATCH  /users/:userId
POST   /users/:userId/archive
POST   /users/:userId/restore
```

### 6.3 Project endpoints

```text
GET    /projects
POST   /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
POST   /projects/:projectId/archive
```

### 6.4 Ticket endpoints

```text
GET    /tickets
POST   /tickets
GET    /tickets/:ticketId
PATCH  /tickets/:ticketId
POST   /tickets/:ticketId/status
POST   /tickets/:ticketId/archive
POST   /tickets/:ticketId/restore
GET    /tickets/:ticketId/history
```

Supported filters on `GET /tickets`:

```text
projectId
status (repeatable)
assigneeId
createdById
updatedAfter
search
includeArchived
cursor
limit
sort
```

### 6.5 Subtask endpoints

```text
GET    /tickets/:ticketId/subtasks
POST   /tickets/:ticketId/subtasks
GET    /subtasks/:subtaskId
PATCH  /subtasks/:subtaskId
POST   /subtasks/:subtaskId/status
POST   /subtasks/:subtaskId/archive
POST   /subtasks/:subtaskId/restore
GET    /subtasks/:subtaskId/history
```

### 6.6 Comment endpoints

```text
GET  /work-items/:workItemId/comments
POST /work-items/:workItemId/comments
```

Comments are returned oldest-first with author identity and timestamp. Creating a comment requires a selected actor and writes a corresponding audit event. Editing and deletion are not available in MVP.

### 6.7 Queue and summary endpoints

```text
GET /queues/blocked
GET /queues/ready-for-review
GET /progress/summary
GET /activity
```

`GET /queues/blocked` returns both item types and supports project, assignee, and age filters. Each result includes `type`, parent ticket details for subtasks, blocked reason, assignee, and time blocked.

`GET /queues/ready-for-review` returns tickets only.

`GET /progress/summary` returns counts by status, completion percentage, blocked items, review items, recently completed items, and stale items. It supports project and date-range filters.

### 6.8 Attachment endpoints

Use S3-compatible multipart uploads so files are streamed and resumable.

```text
POST   /work-items/:workItemId/attachments/initiate
POST   /attachments/:attachmentId/parts/sign
POST   /attachments/:attachmentId/complete
POST   /attachments/:attachmentId/abort
GET    /attachments/:attachmentId
GET    /attachments/:attachmentId/content
DELETE /attachments/:attachmentId
```

Required upload behavior:

1. Initiate creates attachment metadata and a multipart upload in MinIO.
2. Client uploads chunks using short-lived signed URLs or streams chunks through the API if local network policy forbids browser-to-MinIO traffic.
3. Client retries individual failed chunks.
4. Complete verifies part list and records final byte size.
5. Abandoned multipart uploads are cleaned through a documented scheduled maintenance command or MinIO lifecycle policy.
6. Downloads use short-lived signed URLs or API streaming.
7. Image/video previews must not require loading the complete file into memory.

### 6.9 Structured export endpoint

```text
GET /export/projects/:projectId
GET /export/all
```

Example top-level response:

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-07-24T10:00:00.000Z",
  "filters": {
    "includeArchived": false
  },
  "projects": [
    {
      "id": "uuid",
      "key": "OPS",
      "name": "Operations",
      "tickets": [
        {
          "id": "uuid",
          "key": "OPS-104",
          "title": "Example ticket",
          "description": "Markdown text",
          "status": "in_progress",
          "estimatedCompletionDate": "2026-09-30",
          "assignee": {
            "id": "uuid",
            "displayName": "Example User"
          },
          "progress": {
            "completed": 2,
            "total": 4,
            "percent": 50
          },
          "subtasks": [],
          "attachments": [],
          "comments": [],
          "createdAt": "2026-07-24T09:00:00.000Z",
          "updatedAt": "2026-07-24T09:30:00.000Z"
        }
      ]
    }
  ]
}
```

For large datasets, also support pagination or newline-delimited JSON. The normal endpoint must not construct an unbounded export entirely in memory.

### 6.10 Chat endpoints

```text
GET    /chat/sessions
POST   /chat/sessions
GET    /chat/sessions/:sessionId/messages
POST   /chat/sessions/:sessionId/messages
DELETE /chat/sessions/:sessionId
```

Assistant responses should stream to the client through Server-Sent Events. The chat API must return a clear configured/unavailable error if no AI provider is enabled.

## 7. Business Rules

### 7.1 Actor selection

1. On first visit, show a blocking user picker over the application shell.
2. The picker lists active users and allows creation of a username.
3. Store the selected user ID in browser local storage.
4. On later visits, validate that user against the API before continuing.
5. If the user is archived or missing, return to the picker.
6. The application header always shows the selected user and provides “Switch user.”
7. Usernames are case-insensitively unique after trimming and Unicode normalization.
8. Make it visually clear in Settings that this is identification, not secure login.

### 7.2 Work-item creation

- Ticket requires project and title.
- Subtask requires parent ticket and title.
- Creator and last updater come from the selected actor.
- Default status is `not_started`.
- Assignee is optional.
- A subtask inherits project from its parent; the client cannot override it.
- Editing a ticket project after creation is out of scope to preserve its key and subtask consistency.

### 7.3 Status transitions

All statuses can transition to any other status allowed for that item type. The backend must not enforce a transition sequence or require an intermediate status. Audit every change.

Additional rules:

- `blocked` requires `blockedReason`.
- Leaving `blocked` preserves the prior reason in history but clears the active `blockedReason`.
- `ready_for_review` is rejected for subtasks with HTTP 422.
- Setting `completed` records `completedAt`.
- Leaving `completed` clears `completedAt` and records both changes.
- Archiving does not alter status.
- Descoped items do not count against completion progress.

### 7.4 Recommended status workflow

The status set is practical if each exception status has a precise meaning. The diagrams and tables below describe normal team usage, not enforced transitions. Users remain free to select any status allowed for the item type.

#### Ticket workflow

```text
Not Started → In Progress → Ready for Review → Completed
      |             |               |
      ├─────────────┼──→ Blocked ───┤
      ├─────────────┼──→ On Hold ───┤
      └─────────────┴──→ Descoped
```

- **Not Started:** Accepted into the system, but active execution has not begun.
- **In Progress:** At least one person is actively advancing the ticket/project.
- **Ready for Review:** Delivery work is believed complete and is waiting for final ticket-level acceptance.
- **Completed:** Review/acceptance is finished and no remaining work is expected.
- **Blocked:** Work should be active, but a concrete dependency or impediment prevents progress. A blocked reason is mandatory.
- **On Hold:** Work is intentionally paused by a decision, capacity change, or timing choice; no external impediment is required.
- **Descoped:** The work is no longer part of the committed scope. It is treated as inactive for reporting unless later changed.

Recommended ticket transitions:

| Current | Normal next statuses | Notes |
|---|---|---|
| Not Started | In Progress, Blocked, On Hold, Descoped | A ticket may be blocked before work begins |
| In Progress | Ready for Review, Completed, Blocked, On Hold, Descoped | Direct completion is allowed; review is optional |
| Ready for Review | Completed, In Progress, Blocked, On Hold | Return to In Progress when review requests changes |
| Blocked | Previous active status, On Hold, Descoped | UI should provide “Resolve blocker” and remember the prior status |
| On Hold | Not Started, In Progress, Descoped | Resume according to whether execution had previously begun |
| Completed | Any allowed ticket status | Reopening is allowed and audited |
| Descoped | Any allowed ticket status | Restoring scope is allowed and audited |

#### Subtask workflow

```text
Not Started → In Progress → Completed
      |             |
      ├─────────────┼──→ Blocked
      ├─────────────┼──→ On Hold
      └─────────────┴──→ Descoped
```

Subtasks never enter Ready for Review. Any subtask-level checking or discussion happens through comments while the subtask remains In Progress; final acceptance happens on the parent ticket.

Recommended subtask transitions:

| Current | Normal next statuses | Notes |
|---|---|---|
| Not Started | In Progress, Blocked, On Hold, Descoped | Same definitions as tickets |
| In Progress | Completed, Blocked, On Hold, Descoped | Completion means the subtask contributor considers it finished |
| Blocked | Previous active status, On Hold, Descoped | A blocked reason is mandatory |
| On Hold | Not Started, In Progress, Descoped | Intentional pause, not an impediment |
| Completed | In Progress | Reopen when more work is discovered |
| Descoped | Not Started, In Progress | Restore only when it returns to scope |

Workflow guardrails:

- Moving a ticket to Ready for Review should warn, but not hard-block, when active subtasks remain incomplete. A hard block would make legitimate exceptions cumbersome.
- Moving a ticket to Completed may show a non-blocking warning if active subtasks remain incomplete.
- Reopening Completed or Descoped work may prompt for an explanatory comment, but the comment is optional and must not block the status change.
- Blocked requires a current blocked reason. On Hold should optionally record a hold reason and expected resume date in a comment.
- The audit timeline records every transition, actor, timestamp, old status, new status, and reason/comment.
- Status dropdowns should group the normal forward state separately from Blocked, On Hold, and Descoped to discourage accidental misuse.
- Warnings and grouping are usability guidance only; they never disable an otherwise allowed status.

### 7.5 Example end-to-end workflow for assessment

Example project: **“Customer Reporting Portal”**  
Example ticket: **“Launch reporting portal”**, estimated completion date 30 September.

1. Create the ticket as Not Started and add subtasks for requirements, design, API implementation, UI implementation, testing, and deployment.
2. When execution begins, move the ticket to In Progress. Move only the currently active subtasks to In Progress; leave future work Not Started.
3. The design subtask cannot proceed because brand assets have not arrived. Move it to Blocked and record “Waiting for approved brand assets from Marketing.” It appears in the global Blocked screen.
4. API implementation is deliberately paused while an urgent production issue is handled. Move it to On Hold. This is not Blocked because nothing external prevents the work; the team intentionally paused it.
5. Marketing decides a planned export format is no longer required. Move that subtask to Descoped. It is excluded from the completion denominator, but remains visible in history.
6. Complete each remaining subtask as its work finishes. Comments record decisions, progress updates, and handoffs.
7. When delivery work is complete, move the ticket to Ready for Review. It appears in the Review Queue. The ticket can still have comments and attachments during review.
8. If review finds a defect, comment with the finding, move the ticket back to In Progress, and either reopen a relevant subtask or create a new one.
9. After acceptance, move the ticket to Completed. Record the actual completion timestamp while retaining the original/latest estimated completion date for schedule comparison.

This is an example workflow, not a restriction. Confirmed decisions are that Not Started is sufficient, failed review returns to In Progress, and Ready for Review is optional rather than a required gate.

### 7.6 Parent/subtask behavior

- A ticket's status does not automatically change its subtasks.
- A subtask's status does not automatically change the ticket.
- When every non-descoped subtask is complete, the UI prompts the user to update the ticket but does not do so automatically.
- Archiving a ticket hides its subtasks from normal queues without individually archiving them.
- Restoring a ticket restores visibility of its non-archived subtasks.
- A ticket cannot be hard-deleted while it has subtasks, attachments, or audit history.

### 7.7 Progress calculation

For a ticket with at least one active subtask:

```text
denominator = count(active subtasks excluding descoped)
numerator = count(completed active subtasks)
progress percent = numerator / denominator * 100
```

If all active subtasks are descoped, progress is not applicable rather than 100%.

For a ticket with no active subtasks:

- Completed: 100%
- Descoped: not applicable
- All other statuses: 0%

Project progress uses the same formula over active tickets, excluding descoped tickets. Display both overall ticket completion and subtask completion so the chatbot and users do not mistake one metric for the other.

### 7.8 Stale work

Default definition: a non-completed, non-descoped item whose `updatedAt` is older than 14 days. Make the threshold configurable through environment/config in a later enhancement; use 14 days in MVP.

### 7.9 Attachments

- Accept image and video MIME types in MVP.
- The application does not impose a byte limit.
- Store original filename as metadata; generate object keys from UUIDs.
- Sanitize filenames before including them in headers.
- Use `Content-Disposition: inline` only for safe supported media types.
- Set `X-Content-Type-Options: nosniff`.
- Do not render uploaded HTML/SVG as active content in MVP.
- Provide upload progress, retry, cancel, failure, and resumable multipart behavior.
- Generate image thumbnails if feasible without blocking the upload completion response.
- For video, use the browser's native streaming controls and HTTP range requests.
- Display unsupported codecs as downloadable files with a clear message.
- Before permanent attachment deletion, require confirmation.

## 8. User Experience and Screens

### 8.1 Application shell

- Left navigation: Dashboard, Tickets, Blocked, Review Queue, Activity, Settings
- Project selector near the top of navigation
- Persistent current-user control in the header
- Global “Create ticket” action
- Chatbot launcher fixed at the lower-right, expandable into a side panel
- Responsive layout supporting desktop and tablet; mobile read/use is desirable but not a release blocker

### 8.2 User picker

- First-run state explains that no users exist and offers “Add first user.”
- Existing-user state provides search and selection.
- Add-user form validates duplicate and empty names.
- Successful selection proceeds to the last/default project or project creation.

### 8.3 Dashboard

- Count cards by status
- Overall ticket completion
- Subtask completion
- Blocked count and oldest blocked item
- Ready-for-review count
- Recently completed tickets
- Stale in-progress/on-hold items
- Assignee workload summary
- All cards link to filtered lists

### 8.4 Ticket list

- Search by key/title/description
- Filter by project, status, assignee, and updated date
- Sort by updated date, created date, key, title, status
- Columns: key, title, status, assignee, progress, subtasks, updated time
- URL-backed filters so views can be bookmarked
- Empty, loading, error, and no-results states
- Create-ticket modal or page

### 8.5 Ticket detail

- Key, editable title, Markdown description, status, assignee, and estimated completion date
- Visible creator, created time, updater, updated time
- Progress derived from subtasks
- Subtask list with quick add, inline status, and assignee controls
- Attachment gallery/list with upload dropzone and progress
- Image lightbox and video player
- Append-only comment timeline and add-comment form
- Activity/history timeline
- Archive action with confirmation
- Clear blocked reason when blocked

### 8.6 Subtask detail

- May be a modal/drawer or dedicated route
- Editable title, description, assignee, estimated completion date, and allowed status
- No Ready for Review option
- Parent ticket link and key
- Attachments, comments, and history
- Blocked reason behavior identical to tickets

### 8.7 Blocked queue

- Combined list of tickets and subtasks
- Type badge
- Parent ticket link for every subtask
- Blocked reason, assignee, project, time blocked, last updated
- Filter by project, type, assignee, and blocked age
- Quick status change/unblock action

### 8.8 Review queue

- Tickets only
- Project, assignee, submitter/last updater, time waiting, progress
- Open detail, mark completed, return to in progress, or block
- UI text explicitly says subtasks do not enter this queue

### 8.9 Settings

- User list, create, edit, archive, restore
- Project list, create, edit, archive
- AI provider status and configuration guidance; secrets remain server-side
- Storage health/usage summary if MinIO exposes usable metrics
- Clear warning that user selection is not authentication
- Application version and API link

### 8.10 Chatbot

- Collapsible side panel available on every main screen
- Project scope selector: current project or all projects
- Suggested prompts:
  - “Summarize progress this week.”
  - “What is blocked and who owns it?”
  - “Which tickets are waiting for review?”
  - “What has not changed in two weeks?”
  - “Summarize progress for each assignee.”
- Stream responses.
- Link cited ticket keys and subtask titles back to their detail views.
- Display scope and “data current as of” timestamp.
- Never claim to have read attachment contents unless attachment analysis is implemented later.
- MVP assistant is read-only and cannot create or modify tickets.

## 9. Chatbot Design

### 9.1 Retrieval approach

Start with deterministic structured retrieval, not embeddings.

1. Classify the user's request into supported summary intents:
   - overall progress
   - blockers
   - ready for review
   - assignee workload
   - recent changes/completions
   - stale work
   - specific ticket lookup
2. Query the database through internal read-only service functions using the chosen project and reasonable bounded date ranges.
3. Build a compact JSON context containing:
   - relevant item IDs/keys/titles
   - statuses and assignees
   - progress counts
   - blocked reasons
   - relevant audit events and bounded recent comments when they help answer the question
   - query timestamp and filters
4. Send the system prompt, user question, and structured context to the configured model.
5. Require the answer to cite item keys in a machine-detectable form.
6. Validate cited keys against the supplied context and turn them into UI links.
7. Store the question, response, and IDs/timestamps included in the context snapshot.

For broad questions, aggregate in SQL first and include only a bounded set of representative or exceptional items. Do not send the entire database to the model on every question.

### 9.2 Provider interface

Define an internal interface resembling:

```ts
interface ChatProvider {
  healthCheck(): Promise<ProviderHealth>;
  streamCompletion(input: ChatCompletionInput): AsyncIterable<ChatChunk>;
}
```

Environment variables:

```text
AI_ENABLED=false
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_API_KEY=
AI_MODEL=<exact Ollama model name for the hosted Gemma 4 instance>
AI_TIMEOUT_MS=120000
AI_MAX_CONTEXT_ITEMS=200
```

Do not expose `AI_API_KEY` through frontend configuration or logs.

### 9.3 System prompt requirements

The assistant must:

- Answer only from supplied project context.
- Distinguish tickets from subtasks.
- State when data is insufficient.
- Avoid inventing dates, owners, progress, or status changes.
- Treat descoped items separately from completed work.
- Mention the time range and project scope when summarizing.
- Cite ticket keys and identify subtask titles/IDs.
- Refuse mutation requests in MVP and explain that it is read-only.
- Never imply that user selection authenticates a person.

### 9.4 Chatbot evaluation

Create a fixed evaluation dataset with seeded project data and at least these questions:

1. List all blocked work and owners.
2. Summarize completed tickets in the last seven days.
3. Which tickets are ready for review?
4. What is stale?
5. Summarize one project by status.
6. Compare workload by assignee.
7. Ask about a nonexistent ticket.
8. Ask the assistant to modify a ticket.
9. Ask it to summarize attachment contents.
10. Ask an ambiguous “How are we doing?” question.

Score factual coverage, unsupported claims, citation correctness, scope correctness, and refusal behavior.

## 10. Security, Reliability, and Operations

### 10.1 Security posture

Even on a trusted local network:

- Bind services to intended interfaces only.
- Keep PostgreSQL and MinIO admin ports off the public interface where possible.
- Use separate least-privilege database and object-store credentials.
- Validate UUIDs, enums, text lengths, and filenames.
- Escape/sanitize rendered Markdown; do not allow raw HTML.
- Add CSRF protection if cookie-based state is introduced.
- Add rate limits for mutation, upload initiation, and chat endpoints.
- Do not log secrets, signed URLs, message bodies by default, or full attachment metadata unnecessarily.
- Restrict CORS to the configured application origin.
- Add common security headers through Caddy/API.
- Document clearly that anyone who can reach the app can impersonate any configured user.

### 10.2 Backup and restore

Backups must include PostgreSQL and MinIO objects from a consistent window.

- Provide a documented `backup` command/script.
- Provide a documented `restore` command/script.
- Use timestamped backup directories.
- Include application/schema version metadata.
- Verify checksums.
- Test restore into a clean environment before release.
- Never claim a backup succeeded based only on command exit; verify expected artifacts.
- Recommend copying backups to a separate disk.

### 10.3 Observability

- `/health/live`: API process alive
- `/health/ready`: database and object storage reachable; AI reported separately and does not make core API unready
- Request IDs propagated through API logs
- Structured logs with level, timestamp, route, duration, status, actor ID where present
- Log upload lifecycle events without signed URLs
- Basic metrics: request latency/error count, active/failed uploads, storage errors, AI latency/errors
- UI health message when AI is unavailable while ticket management remains functional

### 10.4 Large-upload reliability

- Caddy and API request-body limits must not set an application maximum for upload chunks.
- Use fixed-size multipart chunks (for example 16–64 MiB) rather than one unbounded HTTP request.
- Upload chunks concurrently with a conservative default such as three.
- Persist client-side upload session metadata so a page reload can offer resume where supported.
- Configure long enough timeouts for slow local connections.
- MinIO lifecycle rules clean incomplete multipart uploads after a documented period.
- Monitor free disk space and fail initiation with a useful error if storage is critically low when that information is available.

### 10.5 Data retention

- Audit history is retained indefinitely in MVP.
- Chat history is retained until the user deletes a session.
- Removed attachments are deleted from object storage after explicit confirmation; retain a metadata/audit tombstone.
- Archived users/projects/work items remain in PostgreSQL.

## 11. Testing Strategy

### 11.1 Unit tests

- Status validation by item type
- Blocked reason requirements
- Progress formulas including empty and all-descoped cases
- Ticket key allocation
- User normalization/duplicate rules
- Estimated completion date validation and schedule comparisons
- Comment validation and Markdown sanitization
- Attachment filename/content-disposition sanitization
- Chat context bounding and citation parsing
- AI provider error mapping

### 11.2 API integration tests

Run against real disposable PostgreSQL and MinIO services.

- User/project CRUD and archive behavior
- Ticket/subtask CRUD
- Ticket/subtask comment creation and ordering
- All allowed status transitions
- Rejection of Ready for Review for subtasks
- Rejection of blocked status without a reason
- Combined blocked queue correctness
- Ticket-only review queue correctness
- Export schema and pagination
- Multipart initiate, part upload, complete, abort, resume, and delete
- Audit event atomicity
- Actor validation
- Concurrent ticket key creation
- Range request/download behavior

### 11.3 Frontend tests

- First-run user creation and selection
- Returning user validation
- User switch
- Ticket and subtask forms
- Estimated completion date and comment forms
- Status menus differ by type
- Blocked reason form
- Upload progress/retry/cancel states
- Queue filters and links
- Chat unavailable/streaming/error states
- Accessibility of dialogs, keyboard navigation, forms, and status indicators

### 11.4 End-to-end tests

Critical Playwright journeys:

1. Start with empty system, create user and project, create ticket.
2. Add multiple subtasks and verify calculated progress.
3. Block ticket and subtask and see both in blocked queue.
4. Attempt to set subtask Ready for Review and verify it is unavailable/rejected.
5. Put ticket in Ready for Review and complete it from review queue.
6. Upload image and video, reload, preview/play/download them.
7. Switch users and verify new audit actors.
8. Add comments as two users and verify authors, ordering, and sanitized rendering.
9. Ask chatbot for blockers and verify seeded items are referenced.
10. Stop AI provider and verify core app works with a clear chat error.
11. Archive user/work item and verify historical display.

### 11.5 Non-functional tests

- Upload a generated sparse/test file larger than typical proxy limits without committing it to the repository.
- Interrupt a multipart upload and resume.
- Test simultaneous uploads.
- Seed at least 10,000 tickets and 50,000 subtasks; measure list, queue, dashboard, and export performance.
- Confirm list and queue endpoints remain paginated.
- Test AI response cancellation and provider timeout.
- Restore a backup into a clean Compose stack and compare record/object counts.

## 12. Definition of Done

A task is complete only when:

1. Code is implemented and formatted.
2. Types and lint checks pass.
3. Relevant automated tests pass.
4. New behavior has error, loading, empty, and permission-free identity edge cases addressed.
5. API changes update shared contracts and OpenAPI output.
6. Database changes include forward migrations and rollback/mitigation notes.
7. User-facing behavior is documented where needed.
8. Secrets are not committed.
9. No unrelated files are changed.
10. Acceptance criteria for the task are demonstrated in the handoff.

The product release is complete only when:

- All P0–P6 release-gating tasks are complete.
- Critical E2E flows pass from a clean environment.
- Backup and restore have been tested.
- A large interrupted upload has resumed successfully.
- The chatbot passes the factual evaluation threshold agreed in P5.4.
- Setup and operator documentation work on the target host.
- No critical or high-severity known defects remain.

## 13. Delegation Rules for Implementation Agents

Every delegated task prompt should include:

- Task ID and exact scope from this plan
- Relevant file/directory ownership
- Dependencies that are assumed complete
- Acceptance criteria
- Commands to run for validation
- Instruction not to redesign unrelated modules
- Instruction to report uncertainties instead of inventing product rules

Agents must:

- Read the root README, architecture decisions, shared contracts, and relevant package README before editing.
- Inspect current code rather than assuming earlier tasks match this plan exactly.
- Add/update tests with implementation.
- Avoid introducing new dependencies without justification.
- Avoid changing shared schemas without identifying downstream consumers.
- Provide a concise handoff: changed files, behavior, tests run, and remaining risks.

Prefer delegating one task at a time per agent unless tasks share the same files and are intentionally combined. Do not parallelize tasks that edit the same schema, route group, or screen.

## 14. Detailed Work Breakdown

### Phase P0 — Product and architecture foundation

#### P0.1 — Record product decisions

**Dependencies:** None  
**Owner profile:** Product/technical lead  
**Scope:**

- Review D-01 through D-17 with the product owner.
- Create `docs/decisions/product-decisions.md`.
- Mark each decision accepted, changed, or deferred.
- Turn changed decisions into explicit rules and update affected acceptance criteria.

**Acceptance criteria:**

- No decision needed by P1.2 remains unresolved.
- Review queue/subtask status contradiction is resolved in writing.
- AI data locality and deployment OS are explicit.

#### P0.2 — Create architecture decision records

**Dependencies:** P0.1  
**Scope:**

- Add ADRs for monorepo/stack, unified work-item model, attachment storage/multipart uploads, identity-without-auth, and AI retrieval/provider design.
- Include context, decision, alternatives, consequences, and status.

**Acceptance criteria:**

- ADRs match this plan or clearly document approved deviations.
- Operational consequences of no authentication and unlimited-size attachments are explicit.

#### P0.3 — Scaffold monorepo

**Dependencies:** P0.2  
**Scope:**

- Create pnpm workspace and directories from Section 4.2.
- Configure TypeScript strict mode, ESLint, Prettier, Vitest, shared scripts, and environment validation.
- Scaffold React/Vite web app and Fastify API.
- Add CI-equivalent local commands: `lint`, `typecheck`, `test`, `build`.

**Acceptance criteria:**

- Fresh install succeeds from documented commands.
- All four validation commands pass.
- Web app can call an API health endpoint in development.
- `.env.example` contains placeholders only.

#### P0.4 — Create local infrastructure

**Dependencies:** P0.3  
**Scope:**

- Add Docker Compose services for PostgreSQL, MinIO, API, web/Caddy.
- Add named volumes and health checks.
- Create least-privilege application database and MinIO credentials through initialization.
- Keep AI optional.

**Acceptance criteria:**

- A clean `docker compose up` reaches a healthy app.
- PostgreSQL and MinIO persist data across restart.
- Core app starts when AI is disabled/unavailable.
- Service ports and default credentials are documented and safe for local development.

#### P0.5 — Shared contracts and API conventions

**Dependencies:** P0.3  
**Scope:**

- Implement shared enums, ID/timestamp schemas, pagination, error envelope, actor header parsing, and OpenAPI generation.
- Add request ID middleware and normalized error handling.

**Acceptance criteria:**

- Backend and frontend import the same status/type contracts.
- OpenAPI endpoint renders valid JSON.
- Invalid requests return the documented error shape.
- Subtask contract omits/rejects Ready for Review.

### Phase P1 — Database and domain services

#### P1.1 — Database framework and migrations

**Dependencies:** P0.4  
**Scope:**

- Configure Drizzle, migration scripts, test database utilities, and transaction helpers.
- Implement initial users and projects schema.
- Add seed command with deterministic development data.

**Acceptance criteria:**

- Empty database migrates successfully.
- Migration is repeatable and recorded.
- Seed creates users/projects without duplicate rerun failures or clearly documents reset behavior.

#### P1.2 — Work-item schema

**Dependencies:** P0.1, P1.1  
**Scope:**

- Add work-items table, enums, constraints, relationships, and indexes.
- Implement transactional ticket number allocation.
- Add repository methods for tickets and subtasks.

**Acceptance criteria:**

- Concurrent ticket creation cannot duplicate keys.
- A subtask cannot point to another subtask or another project.
- Ready for Review is impossible for subtasks at the service boundary and preferably constrained at the database boundary.
- Query plans use expected indexes for status/project/parent lists.

#### P1.3 — Attachments, comments, audit, and chat schema

**Dependencies:** P1.2  
**Scope:**

- Add attachment lifecycle, append-only comments, audit events, chat sessions/messages, indexes, and repositories.
- Provide retention-aware delete methods.

**Acceptance criteria:**

- Metadata supports multipart upload lifecycle.
- Comments retain work item, author, content, and immutable creation time.
- Audit data stores before/after values as JSON safely.
- Chat messages can store a context snapshot without storing secrets.

#### P1.4 — Domain services and progress calculation

**Dependencies:** P1.2, P1.3  
**Scope:**

- Implement user, project, ticket, subtask, comment, status, archive, forecast-date, and progress services.
- Add audit writes in transactions.
- Implement stale work calculation.

**Acceptance criteria:**

- All Section 7 rules have unit tests.
- Comments are sanitized/validated and cannot be silently overwritten.
- Estimated completion dates work for tickets and subtasks independently.
- Mutation and audit event commit or roll back together.
- Descoped and all-descoped cases match Section 7.7.

### Phase P2 — Core API and frontend

#### P2.1 — Users, actor selection, and settings API

**Dependencies:** P0.5, P1.4  
**Scope:**

- Implement user endpoints and actor middleware.
- Support create/edit/archive/restore.
- Implement duplicate normalization.

**Acceptance criteria:**

- Mutations reject missing/unknown/archived actor IDs with clear errors.
- Archived users remain visible on historical assignments.
- Duplicate names differing only by case/spacing are rejected.

#### P2.2 — Projects and tickets API

**Dependencies:** P2.1  
**Scope:**

- Implement project endpoints and ticket CRUD/list/filter/status/history endpoints.
- Add cursor pagination and stable sorting.

**Acceptance criteria:**

- Required filters work alone and in combination.
- Human-readable keys are stable.
- Blocking requires a reason.
- Status/history behavior matches Sections 6 and 7.

#### P2.3 — Subtasks and comments API

**Dependencies:** P2.2  
**Scope:**

- Implement subtask CRUD/list/status/archive/history endpoints.
- Implement list/create comment endpoints for tickets and subtasks.
- Enforce parent and project rules.

**Acceptance criteria:**

- Ready for Review is rejected even if called directly.
- Ticket response can include paginated/appropriately bounded subtask data.
- Parent links and progress update correctly.
- Comments are returned oldest-first with author identity and create an audit event.

#### P2.4 — Queue, dashboard, activity, and export API

**Dependencies:** P2.3  
**Scope:**

- Implement blocked queue, review queue, progress summary, activity, and structured export.
- Use bounded queries/pagination/streaming for large data.

**Acceptance criteria:**

- Blocked queue returns both types and correct parent details.
- Review queue returns tickets only.
- Summary counts match seeded fixtures.
- Export validates against a versioned JSON schema.
- Large export does not require building the entire payload in memory.

#### P2.5 — Application shell and user picker

**Dependencies:** P0.5, P2.1  
**Scope:**

- Build navigation shell, routes, query client, API client, global error handling, and selected-user state.
- Implement first-run/add/select/switch flows.

**Acceptance criteria:**

- No user produces the first-run experience.
- Invalid stored user returns to picker.
- Current user is always visible.
- Actor header is attached to API mutations.
- UI labels selection as identification, not authentication.

#### P2.6 — Project selection and settings UI

**Dependencies:** P2.2, P2.5  
**Scope:**

- Implement project picker and project/user management screens.
- Handle archived records and first-project flow.

**Acceptance criteria:**

- First project can be created without manual API calls.
- Last project selection persists and is validated.
- User/project archive actions require confirmation.

#### P2.7 — Ticket list and create flow

**Dependencies:** P2.2, P2.5  
**Scope:**

- Build list, URL filters, pagination, search, sort, empty/error/loading states, and create form.

**Acceptance criteria:**

- Refresh preserves filters.
- Create validation is consistent with API.
- Created ticket opens or appears immediately with correct key.
- Keyboard and screen-reader basics pass automated accessibility checks.

#### P2.8 — Ticket/subtask detail and editing

**Dependencies:** P2.3, P2.7  
**Scope:**

- Build ticket detail, subtask list/create/detail, editing, estimated completion dates, status, assignee, blocked reason, progress, comments, history, and archive behavior.

**Acceptance criteria:**

- Subtasks never show Ready for Review.
- Direct API validation errors display clearly.
- Progress updates after subtask changes without full reload.
- Audit timeline shows actors and changes accurately.
- Comments render safe Markdown, retain their author/timestamp, and update without a full reload.
- Complete-all-subtasks suggestion does not auto-complete ticket.

#### P2.9 — Dashboard, blocked, review, and activity screens

**Dependencies:** P2.4, P2.5  
**Scope:**

- Implement screens in Sections 8.3, 8.7, 8.8, and relevant activity view.
- Link cards/results to filtered lists and detail views.

**Acceptance criteria:**

- Combined blocked queue distinguishes item types and links parent tickets.
- Review screen says it contains tickets only.
- Dashboard counts match API.
- Loading, empty, error, filtering, and pagination states are complete.

### Phase P3 — Attachments

#### P3.1 — Object storage adapter

**Dependencies:** P0.4, P1.3  
**Scope:**

- Implement MinIO/S3 client wrapper, bucket initialization check, object-key generation, signed part URLs, completion, abort, range download, and delete.
- Hide provider-specific behavior behind an interface.

**Acceptance criteria:**

- No permanent object-store credentials reach the browser.
- Object keys do not trust user filenames.
- Range downloads work.
- Unit/integration tests cover provider errors and cleanup.

#### P3.2 — Multipart attachment API

**Dependencies:** P3.1, P2.3  
**Scope:**

- Implement endpoints in Section 6.8, metadata transitions, ownership/actor audit, idempotent completion, and abandoned-upload cleanup.

**Acceptance criteria:**

- Initiate/complete/abort lifecycle is consistent under retries.
- API never buffers a complete large file.
- Failed completion does not mark attachment complete.
- Cleanup handles stale incomplete uploads without deleting completed objects.

#### P3.3 — Upload UI

**Dependencies:** P3.2, P2.8  
**Scope:**

- Build drag/drop and file picker, multipart chunking, progress, bounded concurrency, retry, cancel, and resume support.
- Attach to ticket and subtask views.

**Acceptance criteria:**

- Image and video uploads work on both item types.
- Refresh/interruption offers resume where session state and object parts remain available.
- Multiple upload progress bars are independent.
- No frontend constant defines a maximum total file size.

#### P3.4 — Media gallery and playback

**Dependencies:** P3.3  
**Scope:**

- Add safe image preview/lightbox, video playback, range support, fallback download, metadata, and delete confirmation.

**Acceptance criteria:**

- Large video starts without full download.
- Unsupported formats show a useful fallback.
- Removed attachment disappears and produces an audit event.
- Active-content formats are not rendered unsafely.

#### P3.5 — Attachment reliability tests

**Dependencies:** P3.4  
**Scope:**

- Add automated and documented manual tests for large, interrupted, resumed, concurrent, failed, and deleted uploads.
- Check memory behavior during a large upload.

**Acceptance criteria:**

- A file above common proxy defaults succeeds.
- Interrupted multipart upload resumes.
- API memory does not scale linearly with total file size.
- Incomplete uploads are cleaned according to policy.

### Phase P4 — Quality and usability hardening

#### P4.1 — Search, sorting, and deep-link consistency

**Dependencies:** P2.9  
**Scope:**

- Verify search indexing and all URL-backed list/queue states.
- Add database search index if performance requires it.

**Acceptance criteria:**

- Search works on key/title/description.
- Shared links reproduce filters.
- Seeded performance dataset meets targets established in P4.4.

#### P4.2 — Accessibility and responsive pass

**Dependencies:** P3.4, P2.9  
**Scope:**

- Audit keyboard navigation, focus management, labels, dialogs, color contrast, status non-color cues, and tablet layout.

**Acceptance criteria:**

- Critical flows are keyboard-operable.
- Automated accessibility checks have no serious/critical findings.
- Status is never conveyed by color alone.

#### P4.3 — Error recovery and optimistic update audit

**Dependencies:** P3.4, P2.9  
**Scope:**

- Standardize API errors/toasts, retry behavior, rollback of optimistic changes, offline/network errors, and conflict behavior.

**Acceptance criteria:**

- Failed mutations do not leave false UI state.
- Upload and chat failures do not crash ticket pages.
- Error messages include actionable retry/correction guidance.

#### P4.4 — Performance baseline

**Dependencies:** P4.1  
**Scope:**

- Create scalable seed generator.
- Measure API p95 locally for lists/queues/dashboard at 10k tickets/50k subtasks.
- Inspect query plans and fix N+1 queries.
- Define practical target hardware and record results.

**Proposed targets on a documented modern local server:**

- Normal paginated list/queue API p95 under 500 ms
- Dashboard summary p95 under 1 second
- Detail page initial API response p95 under 500 ms excluding media
- No unbounded collection response

**Acceptance criteria:**

- Dataset, hardware, commands, results, and query improvements are documented.
- Any missed target has an explicit mitigation/release decision.

### Phase P5 — Chatbot

#### P5.1 — Provider adapter and configuration

**Dependencies:** P0.1, P0.5  
**Scope:**

- Implement OpenAI-compatible provider adapter, health check, timeouts, streaming, cancellation, environment validation, and disabled state.
- Verify compatibility with the selected local provider/model.

**Acceptance criteria:**

- AI-disabled core application remains healthy.
- Secrets never appear in client responses or logs.
- Provider timeouts/cancellation produce controlled errors.
- Settings can show configured/healthy/unavailable without exposing secrets.

#### P5.2 — Chat retrieval/context service

**Dependencies:** P2.4, P5.1  
**Scope:**

- Implement supported intents, structured queries, context bounding, aggregation, context snapshots, system prompt, and key citation validation.

**Acceptance criteria:**

- Broad requests do not dump all tickets into the prompt.
- Queries respect project/time scope.
- Citations can only link items present in supplied context.
- Descoped/completed distinctions are preserved.
- Service is read-only.

#### P5.3 — Chat API and UI

**Dependencies:** P5.2, P2.5  
**Scope:**

- Implement session/message endpoints, SSE streaming, chat side panel, scope selector, suggested prompts, citations, history, cancellation, and unavailable state.

**Acceptance criteria:**

- Streaming text can be cancelled.
- Citation links open correct work items.
- “Data current as of” and scope are visible.
- Provider failure does not lose the user's submitted question.
- Assistant refuses mutations and attachment-content claims.

#### P5.4 — Factual evaluation and prompt hardening

**Dependencies:** P5.3  
**Scope:**

- Build deterministic seed/evaluation cases from Section 9.4.
- Define scoring script or repeatable rubric.
- Tune context and prompts against the selected model.

**Proposed release thresholds:**

- 100% correct project/time scope
- 100% valid item citations
- Zero invented tickets/users/statuses in the fixed evaluation set
- At least 90% required fact coverage
- 100% correct refusal for mutations and unsupported attachment analysis

**Acceptance criteria:**

- Results and model/version are recorded.
- Thresholds pass or product owner explicitly accepts documented gaps.

### Phase P6 — Deployment, backup, and release

#### P6.1 — Production-like Docker Compose

**Dependencies:** P3.5, P5.3  
**Scope:**

- Pin images, configure Caddy, health checks, restart policies, volumes, log rotation, environment templates, and optional AI connection.
- Ensure large multipart chunks and range requests work through proxy.

**Acceptance criteria:**

- Clean target host installation works from README.
- Restart preserves all data.
- Database/object store are not unnecessarily exposed.
- Upload and media playback work through the production proxy path.

#### P6.2 — Local-network hardening and HTTPS guidance

**Dependencies:** P6.1  
**Scope:**

- Document bind addresses, firewall, trusted-network assumptions, DNS hostname, and optional internal HTTPS.
- Add secure headers and CORS settings.

**Acceptance criteria:**

- Operator can restrict access to the intended LAN.
- Impersonation/no-auth warning is prominent.
- HTTPS procedure is tested if required by D-09.

#### P6.3 — Backup and restore tooling

**Dependencies:** P6.1  
**Scope:**

- Add safe scripts/commands for database and object backup, manifest/checksums, restore, and verification.
- Avoid destructive defaults; restore targets must be explicit.

**Acceptance criteria:**

- Backup and clean restore are demonstrated.
- Restored record counts, attachment metadata, and object counts match.
- Failure halfway through is reported clearly.
- Operations guide covers scheduling and separate-disk copies.

#### P6.4 — Operator and user documentation

**Dependencies:** P6.2, P6.3  
**Scope:**

- Write install, upgrade, rollback, environment, storage, backup, restore, user guide, AI configuration, troubleshooting, and known-limitations docs.

**Acceptance criteria:**

- A person unfamiliar with the repository can install from a clean machine.
- Docs cover disk-full behavior, AI outage, unfinished uploads, user impersonation, and recovery.
- API/OpenAPI and JSON export are discoverable.

#### P6.5 — Release verification

**Dependencies:** All release-gating tasks  
**Scope:**

- Run lint/type/build/unit/integration/E2E.
- Run manual large-upload interruption/resume test.
- Run backup/restore test.
- Run chatbot evaluation.
- Create release checklist and known-issues list.

**Acceptance criteria:**

- Definition of Done in Section 12 is met.
- Versioned images/configuration are recorded.
- Rollback steps are tested or explicitly documented.

## 15. Optional Post-MVP Backlog

Keep these out of core tasks unless the product owner promotes them:

1. Comment editing/deletion and `@mentions`
2. Saved filters/views
3. Kanban board and drag/drop status changes
4. Ticket dependencies and links
5. Labels, priorities, estimates, and custom fields
6. Notifications
7. Full-text search across comments/attachments
8. Image OCR and video transcription for chatbot context
9. Chatbot actions with explicit confirmation
10. Authentication and role-based access
11. Multiple teams/organizations
12. Import/export from Jira
13. Webhooks and integrations
14. Automated thumbnails/transcoding worker
15. Configurable workflows/statuses
16. Database/object-store encryption at rest
17. High-availability deployment

## 16. Recommended Execution Order and Parallelism

Primary dependency chain:

```text
P0.1 → P0.2 → P0.3 → P0.4/P0.5
P0.4 → P1.1 → P1.2 → P1.3 → P1.4
P1.4/P0.5 → P2.1 → P2.2 → P2.3 → P2.4
P2.1 → P2.5 → P2.6/P2.7 → P2.8 → P2.9
P1.3/P0.4 → P3.1 → P3.2 → P3.3 → P3.4 → P3.5
P2.4/P5.1 → P5.2 → P5.3 → P5.4
P3.5/P5.3 → P6.1 → P6.2/P6.3 → P6.4 → P6.5
```

Safe parallel opportunities after foundations stabilize:

- P2.1 API and early P3.1 storage adapter can proceed in parallel.
- P2.6 and P2.7 can proceed in parallel if route/layout ownership is agreed.
- P2.9 can proceed alongside P3.2 after P2.4 contracts are stable.
- P4.2 and P4.4 can proceed in parallel.
- P5.1 can begin after AI decisions and shared API conventions, while core UI work continues.
- P6.2 and P6.3 can proceed in parallel after P6.1.

Avoid parallel edits to:

- Database schema/migration files
- Shared status/DTO contracts
- Root routing/application shell
- Docker Compose/environment definitions
- The same API route group

## 17. Suggested Milestones

### Milestone M1 — Runnable foundation

Includes P0 and P1.1. A clean environment starts, migrates, and exposes health/OpenAPI.

### Milestone M2 — Core tracking

Includes P1, P2.1–P2.8. Users can select identity, manage projects, tickets, subtasks, statuses, and history.

### Milestone M3 — Queues and media

Includes P2.9 and P3. Blocked/review workflows and reliable large image/video attachments work.

### Milestone M4 — AI summaries

Includes P5. Chatbot produces evaluated, cited, read-only progress summaries.

### Milestone M5 — Operational release

Includes P4 and P6. Performance, accessibility, backup/restore, documentation, and release checks pass.

## 18. Remaining Questions for the Product Owner

Answers should update Section 3 and the relevant rules/tasks:

1. Which machine/OS will host the production instance, and how many concurrent users do you expect?
2. Roughly how many projects, tickets, subtasks, and total attachment storage do you expect after one year?
3. Do comments need editing, deletion, `@mentions`, or attachments, or is append-only text/Markdown sufficient for MVP?
4. Besides estimated completion date, should tickets or subtasks have priority, labels, or effort estimates?
5. Is one subtask level enough?
6. Should any user be able to edit/archive all work and manage configuration, given there is no login?
7. Should attachment deletion be allowed, and if so must deleted files be recoverable for a period?
8. Is importing existing tickets from Jira/CSV required?
