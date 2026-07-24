import { describe, expect, it } from "vitest";
import { rowToCamel } from "./db";
import { workItemInputSchema, workItemPatchSchema } from "./validation";

const projectId = "11111111-1111-4111-8111-111111111111";
const parentId = "22222222-2222-4222-8222-222222222222";

describe("work-item validation", () => {
  it("allows every ticket status without enforcing a transition sequence", () => {
    for (const status of [
      "not_started",
      "in_progress",
      "descoped",
      "on_hold",
      "ready_for_review",
      "completed"
    ]) {
      expect(workItemPatchSchema.parse({ status })).toEqual({ status });
    }
  });

  it("rejects Ready for Review when creating a subtask", () => {
    const result = workItemInputSchema.safeParse({
      projectId,
      parentId,
      type: "subtask",
      title: "Implement export",
      status: "ready_for_review"
    });
    expect(result.success).toBe(false);
  });

  it("requires a reason for blocked work", () => {
    const result = workItemInputSchema.safeParse({
      projectId,
      type: "ticket",
      title: "Implement export",
      status: "blocked"
    });
    expect(result.success).toBe(false);
  });

  it("accepts an estimated completion date on a subtask", () => {
    const result = workItemInputSchema.parse({
      projectId,
      parentId,
      type: "subtask",
      title: "Implement export",
      estimatedCompletionDate: "2026-09-30"
    });
    expect(result.estimatedCompletionDate).toBe("2026-09-30");
  });
});

describe("database response mapping", () => {
  it("serializes forecast dates as date-only values", () => {
    expect(
      rowToCamel({ estimated_completion_date: new Date("2026-09-30T00:00:00.000Z") })
    ).toEqual({ estimatedCompletionDate: "2026-09-30" });
  });
});
