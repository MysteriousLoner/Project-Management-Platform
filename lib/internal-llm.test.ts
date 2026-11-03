import { afterEach, describe, expect, it, vi } from "vitest";
import { callInternalModel } from "./internal-llm";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function gateway(response: () => Promise<Response>) {
  vi.stubEnv("LLM_API_BASE_URL", "https://synthetic-gateway.invalid/v1");
  vi.stubEnv("LLM_API_KEY", "synthetic-test-only");
  const request = vi.fn(response); vi.stubGlobal("fetch", request); return request;
}
describe("internal model failure boundaries", () => {
  it("rejects excessive input before contacting the model", async () => {
    const request = gateway(async () => Response.json({}));
    await expect(callInternalModel("Summarize", { work: "x".repeat(96001) })).rejects.toMatchObject({ code: "PROCESSING_INPUT_TOO_LARGE" });
    expect(request).not.toHaveBeenCalled();
  });
  it("maps timeouts and rate limits to recoverable failures", async () => {
    gateway(async () => { throw new DOMException("Synthetic timeout", "TimeoutError"); });
    await expect(callInternalModel("Summarize", {})).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
    gateway(async () => new Response(null, { status: 429 }));
    await expect(callInternalModel("Summarize", {})).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });
  it("rejects invalid or truncated JSON instead of publishing partial output", async () => {
    gateway(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{invalid" } }] }));
    await expect(callInternalModel("Summarize", {})).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
    gateway(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"bullets":[]}' } }] }));
    await expect(callInternalModel("Summarize", {})).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
  });
});
