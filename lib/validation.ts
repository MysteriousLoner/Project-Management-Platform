import { z } from "zod";
import { SUBTASK_STATUSES, TICKET_STATUSES } from "./types";

export const idSchema = z.string().uuid();

export const userInputSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  avatarColor: z.string().trim().max(20).optional()
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: z.string().trim().min(2).max(10).regex(/^[A-Za-z][A-Za-z0-9]*$/),
  description: z.string().max(10000).optional().default("")
});

export const workItemInputSchema = z
  .object({
    projectId: idSchema,
    type: z.enum(["ticket", "subtask"]),
    parentId: idSchema.nullable().optional(),
    title: z.string().trim().min(1).max(250),
    description: z.string().max(100000).optional().default(""),
    status: z.enum(TICKET_STATUSES).optional().default("not_started"),
    assigneeId: idSchema.nullable().optional(),
    blockedReason: z.string().trim().max(10000).nullable().optional(),
    estimatedCompletionDate: z.iso.date().nullable().optional()
  })
  .superRefine((value, context) => {
    if (value.type === "subtask" && !value.parentId) {
      context.addIssue({ code: "custom", message: "A subtask requires a parent ticket." });
    }
    if (value.type === "ticket" && value.parentId) {
      context.addIssue({ code: "custom", message: "A ticket cannot have a parent." });
    }
    if (value.type === "subtask" && !SUBTASK_STATUSES.includes(value.status as never)) {
      context.addIssue({ code: "custom", message: "Ready for Review is not available for subtasks." });
    }
    if (value.status === "blocked" && !value.blockedReason) {
      context.addIssue({ code: "custom", message: "A blocked reason is required." });
    }
  });

export const workItemPatchSchema = z.object({
  title: z.string().trim().min(1).max(250).optional(),
  description: z.string().max(100000).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  assigneeId: idSchema.nullable().optional(),
  blockedReason: z.string().trim().max(10000).nullable().optional(),
  estimatedCompletionDate: z.iso.date().nullable().optional(),
  isArchived: z.boolean().optional()
});

export const commentInputSchema = z.object({
  workItemId: idSchema,
  body: z.string().trim().min(1).max(50000)
});
