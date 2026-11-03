import { createHash } from "node:crypto";
import { ApiError } from "./errors";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function fingerprint(value: string) {
  return createHash("sha256").update(value.normalize("NFKC").trim().replace(/\s+/g, " ")).digest("hex");
}
export function hashRequest(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }

export function normalizeRemote(value: string): string {
  const raw = value.trim();
  const scp = raw.match(/^(?:[^@\s]+@)?([\w.-]+):([^\s]+)$/);
  let host: string, path: string;
  if (scp && !raw.includes("://")) { host = scp[1]; path = scp[2]; }
  else {
    let url: URL;
    try { url = new URL(raw); } catch { throw new ApiError(422, "INVALID_REMOTE", "Use a Git repository URL, not a local path."); }
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) throw new ApiError(422, "INVALID_REMOTE", "Unsupported Git URL.");
    host = url.hostname + (url.port ? `:${url.port}` : ""); path = url.pathname;
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || !path || path.includes("..")) throw new ApiError(422, "INVALID_REMOTE", "A repository host and path are required.");
  // Hosting providers may have case-sensitive paths. Only their host is case-insensitive.
  return `${host.toLowerCase()}/${path}`;
}
export function malaysiaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function reportDefaults(now = new Date()) {
  const endDate = malaysiaToday(now), d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return { startDate: d.toISOString().slice(0, 10), endDate };
}
export function dateBounds(start: string, end: string) {
  const from = new Date(`${start}T00:00:00+08:00`);
  const until = new Date(new Date(`${end}T00:00:00+08:00`).getTime() + 86400000);
  return { from: from.toISOString(), until: until.toISOString() };
}

/** Guard accidental credentials; remote content is always treated as untrusted data. */
export function rejectSecrets(value: unknown) {
  const text = stableJson(value);
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b|(?:password|api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"',}]{12,}/i.test(text)) {
    throw new ApiError(422, "POSSIBLE_SECRET", "Remove credentials or secret values before uploading this content.");
  }
}
