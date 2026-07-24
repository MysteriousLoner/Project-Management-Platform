export const TICKET_STATUSES = [
  "not_started",
  "in_progress",
  "descoped",
  "on_hold",
  "blocked",
  "ready_for_review",
  "completed"
] as const;

export const SUBTASK_STATUSES = TICKET_STATUSES.filter(
  (status) => status !== "ready_for_review"
);

export type WorkStatus = (typeof TICKET_STATUSES)[number];
export type WorkType = "ticket" | "subtask";

export type User = {
  id: string;
  displayName: string;
  avatarColor: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkItem = {
  id: string;
  projectId: string;
  type: WorkType;
  parentId: string | null;
  key: string;
  title: string;
  description: string;
  status: WorkStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  createdById: string;
  createdByName: string;
  updatedById: string;
  updatedByName: string;
  blockedReason: string | null;
  estimatedCompletionDate: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  subtaskTotal: number;
  subtaskCompleted: number;
  progressPercent: number | null;
};

export type Comment = {
  id: string;
  workItemId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type Attachment = {
  id: string;
  workItemId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  uploadState: "initiated" | "uploading" | "complete" | "failed" | "aborted";
  createdAt: string;
};

export const STATUS_LABELS: Record<WorkStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  descoped: "Descoped",
  on_hold: "On Hold",
  blocked: "Blocked",
  ready_for_review: "Ready for Review",
  completed: "Completed"
};
