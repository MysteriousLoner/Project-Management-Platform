"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  SUBTASK_STATUSES,
  TICKET_STATUSES,
  type Attachment,
  type Comment,
  type Project,
  type User,
  type WorkItem,
  type WorkStatus
} from "@/lib/types";
import { type Locale, useI18n } from "@/lib/i18n";

type View = "dashboard" | "tickets" | "blocked" | "review" | "activity" | "settings";
type Stats = {
  ticketTotal: number;
  ticketCompleted: number;
  subtaskTotal: number;
  subtaskCompleted: number;
  blockedTotal: number;
  reviewTotal: number;
  staleTotal: number;
};
type ActivityEvent = {
  id: string;
  action: string;
  actorName: string | null;
  workItemKey: string | null;
  workItemTitle: string | null;
  createdAt: string;
  newValue?: Record<string, unknown>;
};

const EMPTY_STATS: Stats = {
  ticketTotal: 0,
  ticketCompleted: 0,
  subtaskTotal: 0,
  subtaskCompleted: 0,
  blockedTotal: 0,
  reviewTotal: 0,
  staleTotal: 0
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value?: string | null, withTime = false, locale: Locale = "en") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(new Date(value));
}

function relativeTime(value: string, locale: Locale = "en") {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function api<T>(
  path: string,
  options: RequestInit = {},
  actorId?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (actorId) headers.set("X-Actor-Id", actorId);
  if (options.body && !(options.body instanceof Blob)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return payload;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function uploadAttachmentsToItem({
  workItemId,
  files,
  actorId,
  onProgress
}: {
  workItemId: string;
  files: File[];
  actorId: string;
  onProgress?: (key: string, progress: number) => void;
}) {
  const errors: string[] = [];
  for (const file of files) {
    const key = fileKey(file);
    try {
      onProgress?.(key, 0);
      const initiated = await api<{ attachment: Attachment; chunkSize: number }>(
        "/api/attachments",
        {
          method: "POST",
          body: JSON.stringify({
            workItemId,
            filename: file.name,
            mediaType: file.type || "application/octet-stream",
            byteSize: file.size
          })
        },
        actorId
      );
      const parts: { partNumber: number; etag: string }[] = [];
      const partCount = Math.max(1, Math.ceil(file.size / initiated.chunkSize));
      for (let index = 0; index < partCount; index += 1) {
        const start = index * initiated.chunkSize;
        const end = Math.min(start + initiated.chunkSize, file.size);
        const result = await api<{ partNumber: number; etag: string }>(
          `/api/attachments/${initiated.attachment.id}/parts/${index + 1}`,
          { method: "PUT", body: file.slice(start, end) },
          actorId
        );
        parts.push(result);
        onProgress?.(key, Math.round(((index + 1) / partCount) * 100));
      }
      await api(
        `/api/attachments/${initiated.attachment.id}/complete`,
        { method: "POST", body: JSON.stringify({ parts }) },
        actorId
      );
    } catch (cause) {
      errors.push(`${file.name}: ${(cause as Error).message}`);
    }
  }
  return errors;
}

function StatusPill({ status }: { status: WorkStatus }) {
  const { t } = useI18n();
  return <span className={`status status-${status}`}>{t(`status.${status}`)}</span>;
}

function Avatar({ user, small = false }: { user: Pick<User, "displayName" | "avatarColor">; small?: boolean }) {
  return (
    <span
      className={`avatar ${small ? "avatar-small" : ""}`}
      style={{ backgroundColor: user.avatarColor }}
      aria-hidden="true"
    >
      {initials(user.displayName)}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function ProjectManager() {
  const { locale, setLocale, t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actor, setActor] = useState<User | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  const actorId = actor?.id ?? null;
  const projectId = project?.id ?? null;

  const showMessage = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  }, []);

  const loadIdentity = useCallback(async () => {
    const payload = await api<{ users: User[] }>("/api/users");
    setUsers(payload.users);
    const stored =
      localStorage.getItem("xieceda.actorId") ?? localStorage.getItem("planeo.actorId");
    const current = payload.users.find((user) => user.id === stored) ?? null;
    setActor(current);
    setShowUserPicker(!current);
  }, []);

  const loadProjects = useCallback(async () => {
    const payload = await api<{ projects: Project[] }>("/api/projects");
    setProjects(payload.projects);
    const stored =
      localStorage.getItem("xieceda.projectId") ?? localStorage.getItem("planeo.projectId");
    const current = payload.projects.find((entry) => entry.id === stored) ?? payload.projects[0] ?? null;
    setProject(current);
    if (current) localStorage.setItem("xieceda.projectId", current.id);
  }, []);

  const loadProjectData = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setStats(EMPTY_STATS);
      return;
    }
    const [workPayload, statsPayload] = await Promise.all([
      api<{ items: WorkItem[] }>(`/api/work-items?projectId=${projectId}&limit=500`),
      api<{ stats: Stats; byStatus: Record<string, number> }>(`/api/stats?projectId=${projectId}`)
    ]);
    setItems(workPayload.items);
    setStats(statsPayload.stats);
    setByStatus(statsPayload.byStatus);
  }, [projectId]);

  const loadActivity = useCallback(async () => {
    if (!projectId) return;
    const payload = await api<{ events: ActivityEvent[] }>(`/api/activity?projectId=${projectId}`);
    setActivity(payload.events);
  }, [projectId]);

  useEffect(() => {
    // Async bootstrap synchronizes client state with the server on first mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([loadIdentity(), loadProjects()])
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [loadIdentity, loadProjects]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjectData().catch((cause) => setError(cause.message));
  }, [loadProjectData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view === "activity") loadActivity().catch((cause) => setError(cause.message));
  }, [view, loadActivity]);

  async function refreshAll(message?: string) {
    await Promise.all([loadProjectData(), loadProjects(), loadIdentity()]);
    if (selected) {
      const payload = await api<{ item: WorkItem }>(`/api/work-items?id=${selected.id}`);
      setSelected(payload.item);
    }
    if (message) showMessage(message);
  }

  function selectActor(user: User) {
    localStorage.setItem("xieceda.actorId", user.id);
    setActor(user);
    setShowUserPicker(false);
  }

  function selectProject(projectIdToSelect: string) {
    const next = projects.find((entry) => entry.id === projectIdToSelect) ?? null;
    setProject(next);
    if (next) localStorage.setItem("xieceda.projectId", next.id);
  }

  const tickets = useMemo(
    () =>
      items.filter(
        (item) =>
          item.type === "ticket" &&
          (!search ||
            `${item.key} ${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase())) &&
          (!statusFilter || item.status === statusFilter)
      ),
    [items, search, statusFilter]
  );
  const blocked = items.filter((item) => item.status === "blocked");
  const review = items.filter(
    (item) => item.type === "ticket" && item.status === "ready_for_review"
  );
  const selectedActor = users.find((user) => user.id === actorId);

  if (loading) {
    return (
      <main className="center-page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="picker-brand-image" src="/icons/icon-192.png" alt="" />
        <p>{t("loading.workspace")}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-app-icon" src="/icons/icon-192.png" alt="" />
          <span>协策达</span>
        </div>
        <label className="project-select-label">
          <span>{t("sidebar.currentProject")}</span>
          <select
            value={projectId ?? ""}
            onChange={(event) => selectProject(event.target.value)}
            aria-label={t("sidebar.currentProject")}
          >
            {!projects.length && <option value="">{t("sidebar.noProjects")}</option>}
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.key} · {entry.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="nav-list" aria-label={t("sidebar.navigation")}>
          {(
            [
              ["dashboard", "⌂", t("nav.dashboard")],
              ["tickets", "▤", t("nav.tickets")],
              ["blocked", "!", t("nav.blocked")],
              ["review", "✓", t("nav.review")],
              ["activity", "↻", t("nav.activity")],
              ["settings", "⚙", t("nav.settings")]
            ] as [View, string, string][]
          ).map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? "nav-active" : ""}
              onClick={() => setView(id)}
            >
              <span>{icon}</span>
              {label}
              {id === "blocked" && stats.blockedTotal > 0 && (
                <b className="nav-count nav-count-danger">{stats.blockedTotal}</b>
              )}
              {id === "review" && stats.reviewTotal > 0 && (
                <b className="nav-count">{stats.reviewTotal}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="user-control" onClick={() => setShowUserPicker(true)}>
            {selectedActor && <Avatar user={selectedActor} />}
            <span>
              <small>{t("identity.workingAs")}</small>
              <strong>{actor?.displayName ?? t("identity.selectUser")}</strong>
            </span>
            <span>⌄</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {project ? `${project.key} ${t("header.projectSuffix")}` : t("header.workspace")}
            </span>
            <h1>
              {view === "dashboard"
                ? t("header.overview")
                : view === "review"
                  ? t("header.review")
                  : t(`nav.${view}`)}
            </h1>
          </div>
          <div className="topbar-actions">
            <label className="language-switcher">
              <span>{t("language.switch")}</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </label>
            <a
              className="button button-ghost"
              href={`/api/export${projectId ? `?projectId=${projectId}` : ""}`}
              target="_blank"
            >
              {t("header.jsonApi")}
            </a>
            <button
              className="button button-primary"
              onClick={() => setShowTicketForm(true)}
              disabled={!project || !actor}
            >
              {t("header.newTicket")}
            </button>
          </div>
        </header>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}
        {!projects.length && view !== "settings" ? (
          <EmptyProject onOpenSettings={() => setView("settings")} />
        ) : (
          <>
            {view === "dashboard" && (
              <Dashboard
                stats={stats}
                byStatus={byStatus}
                items={items}
                onOpenItem={setSelected}
                onNavigate={setView}
              />
            )}
            {view === "tickets" && (
              <TicketsView
                tickets={tickets}
                users={users}
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                onOpen={setSelected}
              />
            )}
            {view === "blocked" && (
              <QueueView
                title={t("queue.blockedTitle")}
                subtitle={t("queue.blockedSubtitle")}
                items={blocked}
                allItems={items}
                empty={t("queue.blockedEmpty")}
                onOpen={setSelected}
              />
            )}
            {view === "review" && (
              <QueueView
                title={t("queue.reviewTitle")}
                subtitle={t("queue.reviewSubtitle")}
                items={review}
                allItems={items}
                empty={t("queue.reviewEmpty")}
                onOpen={setSelected}
              />
            )}
            {view === "activity" && <ActivityView events={activity} />}
            {view === "settings" && (
              <SettingsView
                users={users}
                projects={projects}
                actorId={actorId}
                onChanged={refreshAll}
                onError={(message) => setError(message)}
              />
            )}
          </>
        )}
      </main>

      <button className="chat-launcher" onClick={() => setChatOpen(true)} aria-label={t("chat.open")}>
        <span>✦</span>
        {t("chat.askBrand")}
      </button>

      {showUserPicker && (
        <UserPicker
          users={users}
          onSelect={selectActor}
          onUsersChanged={loadIdentity}
          onClose={actor ? () => setShowUserPicker(false) : undefined}
        />
      )}
      {showTicketForm && project && actor && (
        <WorkItemForm
          title={t("form.createTicket")}
          projectId={project.id}
          users={users}
          actorId={actor.id}
          type="ticket"
          onClose={() => setShowTicketForm(false)}
          onCreated={async (item, uploadErrors = []) => {
            setShowTicketForm(false);
            await refreshAll(
              uploadErrors.length
                ? `${t("form.createTicket")} · ${uploadErrors.length} attachment(s) failed`
                : t("form.createTicket")
            );
            uploadErrors.forEach((message) => setError(message));
            const payload = await api<{ item: WorkItem }>(`/api/work-items?id=${item.id}`);
            setSelected(payload.item);
          }}
        />
      )}
      {selected && actor && (
        <WorkItemDetail
          key={selected.id}
          initialItem={selected}
          actor={actor}
          users={users}
          onClose={() => setSelected(null)}
          onChanged={async (message) => {
            await refreshAll(message);
          }}
          onOpenItem={setSelected}
          onError={setError}
        />
      )}
      {chatOpen && actor && (
        <ChatPanel
          actorId={actor.id}
          project={project}
          onClose={() => setChatOpen(false)}
        />
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function EmptyProject({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  return (
    <section className="empty-project">
      <div className="empty-icon">◇</div>
      <h2>{t("empty.title")}</h2>
      <p>{t("empty.description")}</p>
      <button className="button button-primary" onClick={onOpenSettings}>
        {t("empty.openSettings")}
      </button>
    </section>
  );
}

function UserPicker({
  users,
  onSelect,
  onUsersChanged,
  onClose
}: {
  users: User[];
  onSelect: (user: User) => void;
  onUsersChanged: () => Promise<void>;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(users.length === 0);
  const [error, setError] = useState("");

  async function addUser(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = await api<{ user: User }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ displayName: name })
      });
      await onUsersChanged();
      onSelect(payload.user);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="modal-backdrop user-picker-backdrop">
      <section className="user-picker" role="dialog" aria-modal="true" aria-label={t("identity.dialog")}>
        {onClose && (
          <button className="icon-button picker-close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="picker-brand-image" src="/icons/icon-192.png" alt="" />
        <span className="eyebrow">{t("identity.selection")}</span>
        <h1>{t("identity.question")}</h1>
        <p className="muted">{t("identity.description")}</p>
        {!adding ? (
          <>
            <div className="user-grid">
              {users.map((user) => (
                <button key={user.id} className="user-card" onClick={() => onSelect(user)}>
                  <Avatar user={user} />
                  <strong>{user.displayName}</strong>
                </button>
              ))}
            </div>
            <button className="button button-secondary full-width" onClick={() => setAdding(true)}>
              {t("identity.addAnother")}
            </button>
          </>
        ) : (
          <form onSubmit={addUser} className="stack-form">
            <label>
              {t("identity.displayName")}
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("identity.namePlaceholder")}
                maxLength={100}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button-primary full-width" type="submit">
              {t("identity.addContinue")}
            </button>
            {!!users.length && (
              <button className="button button-ghost full-width" type="button" onClick={() => setAdding(false)}>
                {t("identity.back")}
              </button>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

function Dashboard({
  stats,
  byStatus,
  items,
  onOpenItem,
  onNavigate
}: {
  stats: Stats;
  byStatus: Record<string, number>;
  items: WorkItem[];
  onOpenItem: (item: WorkItem) => void;
  onNavigate: (view: View) => void;
}) {
  const { t } = useI18n();
  const ticketProgress = stats.ticketTotal
    ? Math.round((stats.ticketCompleted / stats.ticketTotal) * 100)
    : 0;
  const subtaskProgress = stats.subtaskTotal
    ? Math.round((stats.subtaskCompleted / stats.subtaskTotal) * 100)
    : 0;
  const recent = items.filter((item) => item.type === "ticket").slice(0, 6);

  return (
    <div className="dashboard">
      <section className="metrics-grid">
        <Metric
          label={t("metric.tickets")}
          value={stats.ticketTotal}
          detail={t("metric.completed", { count: stats.ticketCompleted })}
        />
        <Metric
          label={t("metric.blocked")}
          value={stats.blockedTotal}
          detail={stats.blockedTotal ? t("metric.needsAttention") : t("metric.allClear")}
          tone={stats.blockedTotal ? "danger" : "good"}
          onClick={() => onNavigate("blocked")}
        />
        <Metric
          label={t("metric.inReview")}
          value={stats.reviewTotal}
          detail={t("metric.approvals")}
          tone="purple"
          onClick={() => onNavigate("review")}
        />
        <Metric label={t("metric.stale")} value={stats.staleTotal} detail={t("metric.staleDetail")} />
      </section>
      <section className="dashboard-grid">
        <article className="panel progress-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("dashboard.delivery")}</span>
              <h2>{t("dashboard.overall")}</h2>
            </div>
          </div>
          <div className="progress-pair">
            <ProgressRing value={ticketProgress} label={t("metric.tickets")} />
            <ProgressRing value={subtaskProgress} label={t("dashboard.subtasks")} />
          </div>
          <div className="status-breakdown">
            {TICKET_STATUSES.map((status) => (
              <div key={status}>
                <span className={`status-dot dot-${status}`} />
                <span>{t(`status.${status}`)}</span>
                <strong>{byStatus[status] ?? 0}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("dashboard.recent")}</span>
              <h2>{t("dashboard.latest")}</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate("tickets")}>
              {t("dashboard.viewAll")}
            </button>
          </div>
          <div className="compact-list">
            {recent.map((item) => (
              <button key={item.id} onClick={() => onOpenItem(item)}>
                <span>
                  <b>{item.key}</b>
                  <strong>{item.title}</strong>
                </span>
                <StatusPill status={item.status} />
              </button>
            ))}
            {!recent.length && <p className="empty-copy">{t("dashboard.noTickets")}</p>}
          </div>
        </article>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
  onClick
}: {
  label: string;
  value: number;
  detail: string;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  return onClick ? (
    <button className={`metric metric-${tone ?? "default"}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className={`metric metric-${tone ?? "default"}`}>{content}</article>
  );
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  return (
    <div className="ring-wrap">
      <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
        <span>{value}%</span>
      </div>
      <strong>{label}</strong>
    </div>
  );
}

function TicketsView({
  tickets,
  users,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onOpen
}: {
  tickets: WorkItem[];
  users: User[];
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onOpen: (item: WorkItem) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("tickets.search")}
            aria-label={t("tickets.searchLabel")}
          />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">{t("tickets.allStatuses")}</option>
          {TICKET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("tickets.columnTicket")}</th>
              <th>{t("tickets.columnStatus")}</th>
              <th>{t("tickets.columnAssignee")}</th>
              <th>{t("tickets.columnProgress")}</th>
              <th>{t("tickets.columnEstimate")}</th>
              <th>{t("tickets.columnUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((item) => {
              const assigned = users.find((user) => user.id === item.assigneeId);
              return (
                <tr key={item.id} onClick={() => onOpen(item)}>
                  <td>
                    <span className="ticket-key">{item.key}</span>
                    <strong>{item.title}</strong>
                  </td>
                  <td>
                    <StatusPill status={item.status} />
                  </td>
                  <td>
                    {assigned ? (
                      <span className="person">
                        <Avatar user={assigned} small />
                        {assigned.displayName}
                      </span>
                    ) : (
                      <span className="muted">{t("unassigned")}</span>
                    )}
                  </td>
                  <td>
                    <div className="mini-progress">
                      <span style={{ width: `${item.progressPercent ?? 0}%` }} />
                    </div>
                    <small>
                      {item.subtaskCompleted}/{item.subtaskTotal}
                    </small>
                  </td>
                  <td>{formatDate(item.estimatedCompletionDate, false, locale)}</td>
                  <td>{relativeTime(item.updatedAt, locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!tickets.length && <div className="table-empty">{t("tickets.empty")}</div>}
    </section>
  );
}

function QueueView({
  title,
  subtitle,
  items,
  allItems,
  empty,
  onOpen
}: {
  title: string;
  subtitle: string;
  items: WorkItem[];
  allItems: WorkItem[];
  empty: string;
  onOpen: (item: WorkItem) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <section>
      <div className="section-intro">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="queue-list">
        {items.map((item) => {
          const parent = item.parentId ? allItems.find((candidate) => candidate.id === item.parentId) : null;
          return (
            <button key={item.id} className="queue-card" onClick={() => onOpen(item)}>
              <span className={`type-badge type-${item.type}`}>{t(item.type)}</span>
              <span className="queue-main">
                <span>
                  <b>{item.key}</b>
                  {parent && <small>{t("queue.under", { key: parent.key })}</small>}
                </span>
                <strong>{item.title}</strong>
                {item.blockedReason && <p>{item.blockedReason}</p>}
              </span>
              <span className="queue-meta">
                <StatusPill status={item.status} />
                <small>{item.assigneeName ?? t("unassigned")}</small>
                <small>{relativeTime(item.updatedAt, locale)}</small>
              </span>
            </button>
          );
        })}
        {!items.length && <div className="queue-empty">✓ {empty}</div>}
      </div>
    </section>
  );
}

function ActivityView({ events }: { events: ActivityEvent[] }) {
  const { locale, t } = useI18n();
  return (
    <section className="panel activity-panel">
      <div className="section-intro">
        <h2>{t("activity.title")}</h2>
        <p>{t("activity.description")}</p>
      </div>
      <div className="timeline">
        {events.map((event) => (
          <div className="timeline-event" key={event.id}>
            <span className="timeline-dot" />
            <div>
              <p>
                <strong>{event.actorName ?? t("system")}</strong> {event.action.replaceAll("_", " ")}
                {event.workItemKey && (
                  <>
                    {" "}
                    <b>{event.workItemKey}</b>
                  </>
                )}
              </p>
              {event.workItemTitle && <small>{event.workItemTitle}</small>}
            </div>
            <time>{formatDate(event.createdAt, true, locale)}</time>
          </div>
        ))}
        {!events.length && <p className="empty-copy">{t("activity.empty")}</p>}
      </div>
    </section>
  );
}

function WorkItemForm({
  title,
  projectId,
  parentId,
  users,
  actorId,
  type,
  onClose,
  onCreated
}: {
  title: string;
  projectId: string;
  parentId?: string;
  users: User[];
  actorId: string;
  type: "ticket" | "subtask";
  onClose: () => void;
  onCreated: (item: WorkItem, uploadErrors?: string[]) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    title: "",
    description: "",
    assigneeId: "",
    estimatedCompletionDate: ""
  });
  const [files, setFiles] = useState<File[]>([]);
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = await api<{ item: WorkItem }>(
        "/api/work-items",
        {
          method: "POST",
          body: JSON.stringify({
            projectId,
            parentId: parentId ?? null,
            type,
            title: form.title,
            description: form.description,
            assigneeId: form.assigneeId || null,
            estimatedCompletionDate: form.estimatedCompletionDate || null
          })
        },
        actorId
      );
      const uploadErrors = await uploadAttachmentsToItem({
        workItemId: payload.item.id,
        files,
        actorId,
        onProgress: (key, progress) =>
          setFileProgress((current) => ({ ...current, [key]: progress }))
      });
      onCreated(payload.item, uploadErrors);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="modal-body stack-form">
        <label>
          {t("form.title")}
          <input
            autoFocus
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder={t(type === "ticket" ? "form.ticketPlaceholder" : "form.subtaskPlaceholder")}
            required
            maxLength={250}
          />
        </label>
        <label>
          {t("form.description")}
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder={t("form.descriptionPlaceholder")}
            rows={5}
          />
        </label>
        <section className="form-attachments">
          <div>
            <strong>{t("form.attachments")}</strong>
            <small>{t("form.attachmentsHelp")}</small>
          </div>
          <label className="button button-secondary file-label">
            {t("form.chooseFiles")}
            <input
              type="file"
              multiple
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files ?? []);
                setFiles((current) => [...current, ...selectedFiles]);
                event.target.value = "";
              }}
            />
          </label>
          {!!files.length && (
            <>
              <p className="queued-file-summary">
                {t("form.queuedFiles", { count: files.length })}
              </p>
              <div className="queued-file-list">
                {files.map((file, index) => {
                  const progress = fileProgress[fileKey(file)];
                  return (
                    <div key={`${fileKey(file)}:${index}`}>
                      <span aria-hidden="true">{file.type.startsWith("image/") ? "▧" : file.type.startsWith("video/") ? "▶" : "📎"}</span>
                      <span>
                        <strong>{file.name}</strong>
                        <small>{bytes(file.size)}</small>
                      </span>
                      {progress === undefined ? (
                        <button
                          type="button"
                          className="icon-button danger-button"
                          aria-label={t("form.removeFile", { name: file.name })}
                          onClick={() =>
                            setFiles((current) => current.filter((_, candidate) => candidate !== index))
                          }
                        >
                          ×
                        </button>
                      ) : (
                        <b>{progress}%</b>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
        <div className="form-row">
          <label>
            {t("form.assignee")}
            <select
              value={form.assigneeId}
              onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}
            >
              <option value="">{t("unassigned")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("form.estimated")}
            <input
              type="date"
              value={form.estimatedCompletionDate}
              onChange={(event) =>
                setForm({ ...form, estimatedCompletionDate: event.target.value })
              }
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="button button-primary" disabled={saving}>
            {saving && files.length
              ? t("form.uploadingFiles", {
                  progress: Math.round(
                    Object.values(fileProgress).reduce((sum, value) => sum + value, 0) /
                      Math.max(files.length, 1)
                  )
                })
              : saving
                ? t("form.creating")
                : t("form.create", { type: t(type) })}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WorkItemDetail({
  initialItem,
  actor,
  users,
  onClose,
  onChanged,
  onOpenItem,
  onError
}: {
  initialItem: WorkItem;
  actor: User;
  users: User[];
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onOpenItem: (item: WorkItem) => void;
  onError: (message: string) => void;
}) {
  const { locale, t } = useI18n();
  const [item, setItem] = useState(initialItem);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [subtasks, setSubtasks] = useState<WorkItem[]>([]);
  const [comment, setComment] = useState("");
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [showBlockedForm, setShowBlockedForm] = useState(false);
  const [blockedReasonDraft, setBlockedReasonDraft] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const loadRelated = useCallback(async () => {
    const [commentPayload, attachmentPayload, subtaskPayload] = await Promise.all([
      api<{ comments: Comment[] }>(`/api/comments?workItemId=${item.id}`),
      api<{ attachments: Attachment[] }>(`/api/attachments?workItemId=${item.id}`),
      item.type === "ticket"
        ? api<{ items: WorkItem[] }>(`/api/work-items?parentId=${item.id}`)
        : Promise.resolve({ items: [] })
    ]);
    setComments(commentPayload.comments);
    setAttachments(attachmentPayload.attachments);
    setSubtasks(subtaskPayload.items);
  }, [item.id, item.type]);

  useEffect(() => {
    // Keep joined names/progress synchronized after parent-level refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItem(initialItem);
  }, [initialItem]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRelated().catch((cause) => onError(cause.message));
  }, [loadRelated, onError]);

  async function patch(changes: Record<string, unknown>, message = "Work item updated") {
    setSaving(true);
    try {
      const payload = await api<{ item: WorkItem }>(
        "/api/work-items",
        { method: "PATCH", body: JSON.stringify({ id: item.id, ...changes }) },
        actor.id
      );
      setItem({ ...item, ...payload.item });
      await onChanged(message);
    } catch (cause) {
      onError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status: WorkStatus) {
    if (status === "blocked") {
      setBlockedReasonDraft(item.blockedReason ?? "");
      setShowBlockedForm(true);
      return;
    }
    await patch({ status, blockedReason: null }, `${t("detail.status")}: ${t(`status.${status}`)}`);
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    try {
      await api(
        "/api/comments",
        {
          method: "POST",
          body: JSON.stringify({ workItemId: item.id, body: comment })
        },
        actor.id
      );
      setComment("");
      await loadRelated();
      await onChanged("Comment added");
    } catch (cause) {
      onError((cause as Error).message);
    }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const errors = await uploadAttachmentsToItem({
      workItemId: item.id,
      files,
      actorId: actor.id,
      onProgress: (key, progress) =>
        setUploadProgress((current) => ({ ...current, [key]: progress }))
    });
    if (files.length > errors.length) {
      await loadRelated();
      await onChanged(`${files.length - errors.length} attachment(s) uploaded`);
    }
    errors.forEach(onError);
    setUploadProgress({});
    event.target.value = "";
  }

  async function removeAttachment(attachment: Attachment) {
    if (!window.confirm(`Permanently delete ${attachment.originalFilename}?`)) return;
    try {
      await api(`/api/attachments/${attachment.id}`, { method: "DELETE" }, actor.id);
      await loadRelated();
      await onChanged("Attachment deleted");
    } catch (cause) {
      onError((cause as Error).message);
    }
  }

  const statuses = item.type === "ticket" ? TICKET_STATUSES : SUBTASK_STATUSES;

  return (
    <>
      <Modal title={`${item.key} · ${t(item.type)}`} onClose={onClose} wide>
        <div className="detail-layout">
          <section className="detail-main">
            <input
              className="detail-title"
              value={item.title}
              onChange={(event) => setItem({ ...item, title: event.target.value })}
              onBlur={() => {
                if (item.title !== initialItem.title) patch({ title: item.title });
              }}
              aria-label={t("form.title")}
            />
            <textarea
              className="detail-description"
              value={item.description}
              onChange={(event) => setItem({ ...item, description: event.target.value })}
              onBlur={() => {
                if (item.description !== initialItem.description) patch({ description: item.description });
              }}
              rows={6}
              placeholder={t("detail.addDescription")}
              aria-label={t("form.description")}
            />
            {item.blockedReason && (
              <div className="blocked-callout">
                <strong>{t("status.blocked")}</strong>
                <p>{item.blockedReason}</p>
              </div>
            )}

            {item.type === "ticket" && (
              <section className="detail-section">
                <div className="section-title-row">
                  <h3>{t("detail.subtasks")}</h3>
                  <button className="text-button" onClick={() => setShowSubtaskForm(true)}>
                    {t("detail.addSubtask")}
                  </button>
                </div>
                <div className="subtask-list">
                  {subtasks.map((subtask) => (
                    <button
                      key={subtask.id}
                      onClick={() => onOpenItem(subtask)}
                      className="subtask-row"
                    >
                      <span className={subtask.status === "completed" ? "check checked" : "check"}>
                        {subtask.status === "completed" ? "✓" : ""}
                      </span>
                      <span>
                        <small>{subtask.key}</small>
                        <strong>{subtask.title}</strong>
                      </span>
                      <StatusPill status={subtask.status} />
                    </button>
                  ))}
                  {!subtasks.length && <p className="empty-copy">{t("detail.noSubtasks")}</p>}
                </div>
              </section>
            )}

            <section className="detail-section">
              <div className="section-title-row">
                <h3>{t("detail.attachments")}</h3>
                <label className="text-button file-label">
                  {t("detail.upload")}
                  <input type="file" multiple onChange={uploadFiles} />
                </label>
              </div>
              <p className="attachment-help">{t("detail.attachmentHelp")}</p>
              {Object.entries(uploadProgress).map(([key, progress]) => (
                <div className="upload-row" key={key}>
                  <span>{key.split(":")[0]}</span>
                  <div className="upload-progress">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <b>{progress}%</b>
                </div>
              ))}
              <div className="attachment-grid">
                {attachments.map((attachment) => (
                  <article className="attachment-card" key={attachment.id}>
                    <a
                      href={`/api/attachments/${attachment.id}/content`}
                      target="_blank"
                      download={
                        attachment.mediaType.startsWith("image/") ||
                        attachment.mediaType.startsWith("video/")
                          ? undefined
                          : attachment.originalFilename
                      }
                    >
                      {attachment.mediaType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/attachments/${attachment.id}/content`}
                          alt={attachment.originalFilename}
                        />
                      ) : attachment.mediaType.startsWith("video/") ? (
                        <video
                          src={`/api/attachments/${attachment.id}/content`}
                          controls
                          preload="metadata"
                        />
                      ) : (
                        <span className="file-attachment-preview">
                          <b aria-hidden="true">📎</b>
                          <small>{t("detail.fileAttachment")}</small>
                        </span>
                      )}
                    </a>
                    <div>
                      <span>
                        <strong title={attachment.originalFilename}>{attachment.originalFilename}</strong>
                        <small>{bytes(attachment.byteSize)}</small>
                      </span>
                      <button
                        className="icon-button danger-button"
                        onClick={() => removeAttachment(attachment)}
                        aria-label={`Delete ${attachment.originalFilename}`}
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!attachments.length && !Object.keys(uploadProgress).length && (
                <p className="empty-copy">{t("detail.noAttachments")}</p>
              )}
            </section>

            <section className="detail-section">
              <h3>{t("detail.comments")}</h3>
              <form className="comment-form" onSubmit={addComment}>
                <Avatar user={actor} small />
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={t("detail.commentPlaceholder")}
                  rows={3}
                />
                <button className="button button-secondary" disabled={!comment.trim()}>
                  {t("detail.comment")}
                </button>
              </form>
              <div className="comment-list">
                {comments.map((entry) => (
                  <article key={entry.id}>
                    <div className="comment-avatar">{initials(entry.authorName)}</div>
                    <div>
                      <header>
                        <strong>{entry.authorName}</strong>
                        <time>{formatDate(entry.createdAt, true, locale)}</time>
                      </header>
                      <p>{entry.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <aside className="detail-sidebar">
            <label>
              {t("detail.status")}
              <select value={item.status} onChange={(event) => changeStatus(event.target.value as WorkStatus)}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("form.assignee")}
              <select
                value={item.assigneeId ?? ""}
                onChange={(event) => patch({ assigneeId: event.target.value || null }, "Assignee updated")}
              >
                <option value="">{t("unassigned")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("form.estimated")}
              <input
                type="date"
                value={item.estimatedCompletionDate?.slice(0, 10) ?? ""}
                onChange={(event) =>
                  patch(
                    { estimatedCompletionDate: event.target.value || null },
                    "Estimate updated"
                  )
                }
              />
            </label>
            {item.type === "ticket" && (
              <div className="side-progress">
                <span>
                  <b>{t("detail.progress")}</b>
                  <strong>{item.progressPercent ?? "—"}%</strong>
                </span>
                <div className="mini-progress large">
                  <span style={{ width: `${item.progressPercent ?? 0}%` }} />
                </div>
                <small>
                  {t("detail.subtasksComplete", {
                    completed: item.subtaskCompleted,
                    total: item.subtaskTotal
                  })}
                </small>
              </div>
            )}
            <dl className="metadata">
              <div>
                <dt>{t("detail.createdBy")}</dt>
                <dd>{item.createdByName}</dd>
              </div>
              <div>
                <dt>{t("detail.created")}</dt>
                <dd>{formatDate(item.createdAt, true, locale)}</dd>
              </div>
              <div>
                <dt>{t("detail.updatedBy")}</dt>
                <dd>{item.updatedByName}</dd>
              </div>
              <div>
                <dt>{t("detail.updated")}</dt>
                <dd>{formatDate(item.updatedAt, true, locale)}</dd>
              </div>
            </dl>
            <button
              className="button button-danger-outline full-width"
              disabled={saving}
              onClick={() => {
                if (window.confirm(t("detail.archiveConfirm", { key: item.key }))) {
                  patch({ isArchived: true }, "Work item archived").then(onClose);
                }
              }}
            >
              {t("detail.archive", { type: t(item.type) })}
            </button>
          </aside>
        </div>
      </Modal>
      {showSubtaskForm && (
        <WorkItemForm
          title={t("form.createSubtask")}
          projectId={item.projectId}
          parentId={item.id}
          users={users}
          actorId={actor.id}
          type="subtask"
          onClose={() => setShowSubtaskForm(false)}
          onCreated={async (_, uploadErrors = []) => {
            setShowSubtaskForm(false);
            await loadRelated();
            await onChanged("Subtask created");
            uploadErrors.forEach(onError);
          }}
        />
      )}
      {showBlockedForm && (
        <Modal title={t("detail.blockTitle", { key: item.key })} onClose={() => setShowBlockedForm(false)}>
          <form
            className="modal-body stack-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!blockedReasonDraft.trim()) return;
              await patch(
                { status: "blocked", blockedReason: blockedReasonDraft.trim() },
                "Work item blocked"
              );
              setShowBlockedForm(false);
            }}
          >
            <p className="muted">{t("detail.blockHelp")}</p>
            <label>
              {t("detail.blockReason")}
              <textarea
                autoFocus
                value={blockedReasonDraft}
                onChange={(event) => setBlockedReasonDraft(event.target.value)}
                rows={4}
                required
                placeholder={t("detail.blockPlaceholder")}
              />
            </label>
            <div className="modal-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setShowBlockedForm(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="button button-primary"
                disabled={!blockedReasonDraft.trim() || saving}
              >
                {t("detail.markBlocked")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function SettingsView({
  users,
  projects,
  actorId,
  onChanged,
  onError
}: {
  users: User[];
  projects: Project[];
  actorId: string | null;
  onChanged: (message?: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const [projectForm, setProjectForm] = useState({ name: "", key: "", description: "" });
  const [userName, setUserName] = useState("");

  async function createProject(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = await api<{ project: Project }>(
        "/api/projects",
        { method: "POST", body: JSON.stringify(projectForm) },
        actorId
      );
      setProjectForm({ name: "", key: "", description: "" });
      localStorage.setItem("xieceda.projectId", payload.project.id);
      await onChanged("Project created");
    } catch (cause) {
      onError((cause as Error).message);
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ displayName: userName })
      });
      setUserName("");
      await onChanged("User created");
    } catch (cause) {
      onError((cause as Error).message);
    }
  }

  async function toggleArchive(kind: "users" | "projects", id: string, isArchived: boolean) {
    try {
      await api(
        `/api/${kind}`,
        { method: "PATCH", body: JSON.stringify({ id, isArchived: !isArchived }) },
        actorId
      );
      await onChanged(isArchived ? "Restored" : "Archived");
    } catch (cause) {
      onError((cause as Error).message);
    }
  }

  return (
    <div className="settings-grid">
      <section className="panel settings-section">
        <span className="eyebrow">{t("settings.projects")}</span>
        <h2>{t("settings.projectGroups")}</h2>
        <p className="muted">{t("settings.projectDescription")}</p>
        <form className="stack-form inset-form" onSubmit={createProject}>
          <div className="form-row">
            <label>
              {t("settings.projectName")}
              <input
                value={projectForm.name}
                onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
                placeholder={t("settings.projectNamePlaceholder")}
                required
              />
            </label>
            <label className="key-field">
              {t("settings.key")}
              <input
                value={projectForm.key}
                onChange={(event) =>
                  setProjectForm({ ...projectForm, key: event.target.value.toUpperCase() })
                }
                placeholder="PORTAL"
                required
                maxLength={10}
              />
            </label>
          </div>
          <label>
            {t("form.description")}
            <textarea
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm({ ...projectForm, description: event.target.value })
              }
              rows={2}
              placeholder={t("settings.descriptionPlaceholder")}
            />
          </label>
          <button className="button button-secondary">{t("settings.createProject")}</button>
        </form>
        <div className="settings-list">
          {projects.map((entry) => (
            <div key={entry.id}>
              <span className="project-key-box">{entry.key}</span>
              <span>
                <strong>{entry.name}</strong>
                <small>{entry.description || t("settings.noDescription")}</small>
              </span>
              <button className="text-button danger-text" onClick={() => toggleArchive("projects", entry.id, entry.isArchived)}>
                {t("archive")}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel settings-section">
        <span className="eyebrow">{t("settings.people")}</span>
        <h2>{t("settings.users")}</h2>
        <p className="muted">{t("settings.usersDescription")}</p>
        <form className="inline-form inset-form" onSubmit={createUser}>
          <input
            value={userName}
            onChange={(event) => setUserName(event.target.value)}
            placeholder={t("settings.newName")}
            required
          />
          <button className="button button-secondary">{t("settings.addUser")}</button>
        </form>
        <div className="settings-list">
          {users.map((user) => (
            <div key={user.id}>
              <Avatar user={user} />
              <span>
                <strong>{user.displayName}</strong>
                <small>{t("settings.activeUser")}</small>
              </span>
              <button
                className="text-button danger-text"
                disabled={user.id === actorId}
                title={user.id === actorId ? t("settings.archiveHint") : undefined}
                onClick={() => toggleArchive("users", user.id, user.isArchived)}
              >
                {t("archive")}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel settings-section">
        <span className="eyebrow">{t("language.switch").toUpperCase()}</span>
        <h2>{t("settings.language")}</h2>
        <p className="muted">{t("settings.languageDescription")}</p>
        <label className="stack-form inset-form">
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>
      </section>

      <section className="panel settings-section settings-wide">
        <span className="eyebrow">{t("settings.integrations")}</span>
        <h2>{t("settings.assistant")}</h2>
        <div className="integration-row">
          <span className="integration-icon">✦</span>
          <div>
            <strong>{t("settings.llm")}</strong>
            <p>{t("settings.llmDescription")}</p>
          </div>
          <span className="health-badge">{t("configured")}</span>
        </div>
      </section>
    </div>
  );
}

function ChatPanel({
  actorId,
  project,
  onClose
}: {
  actorId: string;
  project: Project | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string; meta?: string }[]
  >([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const suggestions = [
    t("chat.suggestionSummary"),
    t("chat.suggestionBlocked"),
    t("chat.suggestionReview"),
    t("chat.suggestionStale")
  ];

  async function ask(value?: string) {
    const prompt = (value ?? question).trim();
    if (!prompt || sending) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setSending(true);
    try {
      const payload = await api<{ answer: string; generatedAt: string; scope: string }>(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({ question: prompt, projectId: project?.id ?? null })
        },
        actorId
      );
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.answer,
          meta: `${payload.scope} · ${formatDate(payload.generatedAt, true, locale)}`
        }
      ]);
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: t("chat.error", { message: (cause as Error).message })
        }
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="chat-panel" aria-label={t("chat.label")}>
      <header>
        <div>
          <span className="chat-symbol">✦</span>
          <span>
            <strong>{t("chat.assistant")}</strong>
            <small>{project ? project.name : t("chat.allProjects")}</small>
          </span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t("chat.close")}>
          ×
        </button>
      </header>
      <div className="chat-messages">
        {!messages.length && (
          <div className="chat-welcome">
            <span className="chat-symbol large">✦</span>
            <h3>{t("chat.help")}</h3>
            <p>{t("chat.description")}</p>
            <div>
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => ask(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <article key={index} className={`chat-message chat-${message.role}`}>
            <p>{message.content}</p>
            {message.meta && <small>{message.meta}</small>}
          </article>
        ))}
        {sending && <div className="typing"><span /><span /><span /></div>}
      </div>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask();
            }
          }}
          placeholder={t("chat.placeholder")}
          rows={2}
        />
        <button disabled={!question.trim() || sending} aria-label={t("chat.send")}>
          ↑
        </button>
      </form>
      <footer>{t("chat.footer")}</footer>
    </aside>
  );
}
