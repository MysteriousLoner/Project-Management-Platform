import { describe, expect, it } from "vitest";
import { dateBounds, fingerprint, normalizeRemote, rejectSecrets, reportDefaults } from "./knowledge-utils";
describe("project identity and report dates", () => {
  it("maps SSH and credential-bearing HTTPS remotes to the same credential-free identity", () => {
    expect(normalizeRemote("git@example.com:team/project.git")).toBe("example.com/team/project");
    expect(normalizeRemote("https://user:private@example.com/team/project.git?token=private")).toBe("example.com/team/project");
    expect(() => normalizeRemote("/local/project")).toThrow();
  });
  it("retains case-sensitive facts while normalizing whitespace", () => {
    expect(fingerprint("Same  explanation\n")).toBe(fingerprint("Same explanation"));
    expect(fingerprint("GET /Users")).not.toBe(fingerprint("GET /users"));
  });
  it("uses inclusive Malaysia dates and Monday defaults across a UTC day boundary", () => {
    expect(reportDefaults(new Date("2026-11-01T18:00:00Z"))).toEqual({ startDate: "2026-11-02", endDate: "2026-11-02" });
    expect(dateBounds("2026-11-02", "2026-11-04")).toEqual({ from: "2026-11-01T16:00:00.000Z", until: "2026-11-04T16:00:00.000Z" });
  });
  it("rejects accidental secret assignments", () => {
    expect(() => rejectSecrets({ content: "API_KEY=abcdefghijklmnopqrstuvwxyz" })).toThrow();
    expect(() => rejectSecrets({ content: "Use the API_KEY environment variable." })).not.toThrow();
  });
});
