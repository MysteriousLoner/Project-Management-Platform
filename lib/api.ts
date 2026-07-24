import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details ?? {} } },
      { status: error.status }
    );
  }
  if ((error as ZodError)?.issues) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: (error as ZodError).issues[0]?.message ?? "Invalid request.",
          details: (error as ZodError).issues
        }
      },
      { status: 422 }
    );
  }
  const pgCode = (error as { code?: string })?.code;
  if (pgCode === "23505") {
    return NextResponse.json(
      { error: { code: "DUPLICATE", message: "That value already exists.", details: {} } },
      { status: 409 }
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: {} } },
    { status: 500 }
  );
}

export function actorId(request: Request): string {
  const value = request.headers.get("x-actor-id");
  if (!value) throw new ApiError(400, "ACTOR_REQUIRED", "Select a user before making changes.");
  return value;
}

export async function requestJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}
