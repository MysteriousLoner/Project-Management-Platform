import { describe, expect, it } from "vitest";
import { localDestination, signInDestination } from "./sign-in-destination";
const origin = "https://workspace.invalid";
describe("first sign-in password prompt", () => {
  it("prompts initial-password accounts while retaining their intended page", () => {
    const url = new URL(signInDestination(true, "/reports", origin), origin);
    expect(url.pathname).toBe("/password");
    expect(url.searchParams.get("firstLogin")).toBe("1");
    expect(url.searchParams.get("returnTo")).toBe("/reports");
    expect(signInDestination(false, "/reports", origin)).toBe("/reports");
  });
  it("preserves local OAuth consent details and rejects external return links", () => {
    const next = `${origin}/consent?oauth_query=signed-query`;
    const url = new URL(signInDestination(true, next, origin), origin);
    expect(url.searchParams.get("returnTo")).toBe("/consent?oauth_query=signed-query");
    expect(localDestination("https://unrelated.invalid/path", origin)).toBe("/");
    expect(localDestination("//unrelated.invalid/path", origin)).toBe("/");
    expect(localDestination("/\\unrelated.invalid/path", origin)).toBe("/");
  });
});
