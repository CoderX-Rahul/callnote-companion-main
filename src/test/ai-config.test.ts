import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_LIMITS,
  AI_SDK_MAX_RETRIES,
  classifyAiError,
  normalizeGeminiRequestBody,
  prefilterMaster,
  resolveAiConfig,
  resolveAiLimits,
  withAiRetry,
} from "@/lib/ai.server";

describe("resolveAiConfig", () => {
  it("preserves the current Lovable gateway configuration when no override key is set", () => {
    expect(resolveAiConfig({ LOVABLE_API_KEY: "unit-test-placeholder" })).toEqual({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      model: "openai/gpt-6-astra",
      apiKey: "unit-test-placeholder",
      useChatCompletions: false,
      headers: {
        "Lovable-API-Key": "unit-test-placeholder",
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
      limits: { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
    });
  });

  it("uses an OpenAI-compatible override without Lovable headers or reasoning options by default", () => {
    const config = resolveAiConfig({
      AI_API_KEY: "unit-test-placeholder",
      AI_MODEL: "compatible-model",
    });
    expect(config).toEqual({
      baseURL: "https://api.openai.com/v1",
      model: "compatible-model",
      apiKey: "unit-test-placeholder",
      useChatCompletions: false,
      headers: undefined,
      providerOptions: { openai: { store: false } },
      limits: { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
    });
  });

  it("honors a custom base URL and includes reasoning options only when enabled", () => {
    const config = resolveAiConfig({
      AI_API_KEY: "unit-test-placeholder",
      AI_MODEL: "compatible-model",
      AI_BASE_URL: "https://provider.example.invalid/v1",
      AI_REASONING: "true",
    });
    expect(config.baseURL).toBe("https://provider.example.invalid/v1");
    expect(config.useChatCompletions).toBe(true);
    expect(config.headers).toBeUndefined();
    expect(config.providerOptions?.openai).toMatchObject({
      forceReasoning: true,
      reasoningEffort: "low",
    });
  });

  it("selects Chat Completions for Google's OpenAI-compatible Gemini endpoint", () => {
    const config = resolveAiConfig({
      AI_API_KEY: "unit-test-placeholder",
      AI_MODEL: "gemini-2.5-flash",
      AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      AI_REASONING: "false",
    });
    expect(config).toMatchObject({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-2.5-flash",
      useChatCompletions: true,
      providerOptions: { openai: { reasoningEffort: "none" } },
    });
    expect(config.providerOptions?.openai).toEqual({ reasoningEffort: "none" });
    expect("fetch" in config && config.fetch).toBeTypeOf("function");
  });

  it("uses the documented extraction defaults", () => {
    expect(AI_DEFAULT_LIMITS).toEqual({
      timeoutMs: 45_000,
      maxRetries: 2,
      totalDeadlineMs: 90_000,
    });
  });

  it("normalizes OpenAI strict JSON Schema fields for Gemini while retaining nullable types", () => {
    const normalized = normalizeGeminiRequestBody({
      model: "gemini-2.5-flash",
      store: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extract",
          strict: true,
          schema: {
            type: "object",
            properties: {
              count: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
              label: { type: ["string", "null"] },
            },
            required: ["count", "label"],
            additionalProperties: false,
            $schema: "http://json-schema.org/draft-07/schema#",
          },
        },
      },
    });

    const format = normalized["response_format"] as {
      json_schema: { strict?: boolean; schema: Record<string, any> };
    };
    expect(normalized["store"]).toBeUndefined();
    expect(format.json_schema.strict).toBeUndefined();
    expect(format.json_schema.schema["additionalProperties"]).toBeUndefined();
    expect(format.json_schema.schema["$schema"]).toBeUndefined();
    expect(format.json_schema.schema["properties"]["count"]).toEqual({
      type: ["integer", "null"],
      minimum: 0,
    });
    expect(format.json_schema.schema["properties"]["label"]).toEqual({ type: ["string", "null"] });
  });

  it("throws the standard configuration error when no key is configured", () => {
    expect(() => resolveAiConfig({})).toThrow("AI is not configured.");
  });

  it("requires a model when an override key is set", () => {
    expect(() => resolveAiConfig({ AI_API_KEY: "unit-test-placeholder" })).toThrow(
      "AI is not configured.",
    );
  });

  it("resolves defaults, valid values and invalid limit fallbacks", () => {
    expect(resolveAiLimits({})).toEqual({
      timeoutMs: 45_000,
      maxRetries: 2,
      totalDeadlineMs: 90_000,
    });
    expect(
      resolveAiLimits({
        AI_TIMEOUT_MS: "5000",
        AI_MAX_RETRIES: "4",
        AI_TOTAL_DEADLINE_MS: "180000",
      }),
    ).toEqual({ timeoutMs: 5000, maxRetries: 4, totalDeadlineMs: 180000 });
    expect(
      resolveAiLimits({ AI_TIMEOUT_MS: "junk", AI_MAX_RETRIES: "5", AI_TOTAL_DEADLINE_MS: "9" }),
    ).toEqual({ timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 });
  });

  it("disables SDK retries so only the wrapper retries", () => {
    expect(AI_SDK_MAX_RETRIES).toBe(0);
  });

  it("adds opt-in override reasoning effort only when configured", () => {
    const config = resolveAiConfig({
      AI_API_KEY: "unit-test-placeholder",
      AI_MODEL: "compatible",
      AI_REASONING_EFFORT: "low",
    });
    expect(config.providerOptions?.openai).toMatchObject({ reasoningEffort: "low" });
  });

  it("applies the same limit overrides to both configured paths", () => {
    const limits = { timeoutMs: 8_000, maxRetries: 1, totalDeadlineMs: 30_000 };
    expect(
      resolveAiConfig({
        LOVABLE_API_KEY: "unit-test-placeholder",
        AI_TIMEOUT_MS: "8000",
        AI_MAX_RETRIES: "1",
        AI_TOTAL_DEADLINE_MS: "30000",
      }).limits,
    ).toEqual(limits);
    expect(
      resolveAiConfig({
        AI_API_KEY: "unit-test-placeholder",
        AI_MODEL: "compatible",
        AI_TIMEOUT_MS: "8000",
        AI_MAX_RETRIES: "1",
        AI_TOTAL_DEADLINE_MS: "30000",
      }).limits,
    ).toEqual(limits);
  });

  it.each([
    [{ name: "TimeoutError", message: "timed out" }, "timeout", true],
    [{ statusCode: 429 }, "rate_limited", true],
    [{ statusCode: 429, responseHeaders: { "retry-after": "3" } }, "rate_limited", true],
    [{ statusCode: 408 }, "provider_unavailable", true],
    ...[500, 502, 503, 504].map((statusCode) => [{ statusCode }, "provider_unavailable", true]),
    ...[400, 401, 403, 404, 422].map((statusCode) => [
      { statusCode },
      statusCode === 400 || statusCode === 422 ? "bad_request" : "auth_or_config",
      false,
    ]),
    [{ message: "fetch failed" }, "provider_unavailable", true],
    [{ name: "NoObjectGeneratedError", message: "No object generated" }, "bad_output", true],
    [{ message: "safety blocked" }, "bad_output", false],
    [{ message: "odd" }, "unknown", false],
  ] as Array<[unknown, string, boolean]>)("classifies %j", (error, kind, retryable) => {
    expect(classifyAiError(error)).toMatchObject({ kind, retryable });
  });

  it("retries transient failures with full jitter and returns later success", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withAiRetry(
      async (_signal, attempt) => {
        calls = attempt;
        if (attempt < 3) throw { statusCode: 503 };
        return "ok";
      },
      { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 0.5,
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("retries timeout and honors Retry-After within the cap", async () => {
    const waits: number[] = [];
    let tries = 0;
    const result = await withAiRetry(
      async () => {
        tries++;
        if (tries === 1) throw { name: "TimeoutError", message: "timed out" };
        if (tries === 2) throw { statusCode: 429, headers: { "retry-after": "2" } };
        return "ready";
      },
      { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        random: () => 0,
      },
    );
    expect(result).toBe("ready");
    expect(waits).toEqual([0, 2_000]);
  });

  it("retries unparsable structured output at most once", async () => {
    let attempts = 0;
    await expect(
      withAiRetry(
        async () => {
          attempts++;
          throw { name: "NoObjectGeneratedError", message: "No object generated" };
        },
        { timeoutMs: 45_000, maxRetries: 4, totalDeadlineMs: 90_000 },
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ kind: "bad_output" });
    expect(attempts).toBe(2);
  });

  it("does not retry non-retryable errors and respects Retry-After caps", async () => {
    let calls = 0;
    await expect(
      withAiRetry(
        async () => {
          calls++;
          throw { statusCode: 400 };
        },
        { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ kind: "bad_request" });
    expect(calls).toBe(1);
    await expect(
      withAiRetry(
        async () => {
          throw { statusCode: 429, headers: { "retry-after": "9" } };
        },
        { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("stops when Retry-After cannot fit inside the remaining deadline", async () => {
    let now = 0;
    await expect(
      withAiRetry(
        async () => {
          now = 74_000;
          throw { statusCode: 429, headers: { "retry-after": "7" } };
        },
        { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
        { now: () => now, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({
      kind: "rate_limited",
      message: expect.stringContaining("7 seconds"),
    });
  });

  it("stops when the deadline has less than ten seconds remaining", async () => {
    let now = 0;
    let calls = 0;
    await expect(
      withAiRetry(
        async () => {
          calls++;
          now = 80_001;
          throw { statusCode: 503 };
        },
        { timeoutMs: 45_000, maxRetries: 2, totalDeadlineMs: 90_000 },
        { now: () => now, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toBe(1);
  });

  it("keeps full master lists at the threshold and caps deterministic filtering above it", () => {
    const doctors = Array.from({ length: 201 }, (_, i) => ({
      id: `D${i}`,
      name: i === 200 ? "Unique Specialist" : `Clinician ${i}`,
      specialty: i === 200 ? "Cardiology" : null,
      clinic: null,
      city: null,
    }));
    const products = Array.from({ length: 101 }, (_, i) => ({
      id: `P${i}`,
      name: i === 100 ? "TargetDrug" : `Item ${i}`,
    }));
    expect(
      prefilterMaster("unmatched note", {
        doctors: doctors.slice(0, 200),
        products: products.slice(0, 100),
      }).doctors,
    ).toHaveLength(200);
    const filtered = prefilterMaster("Cardiology TargetDrug", { doctors, products });
    expect(filtered.doctors.some((d) => d.id === "D200")).toBe(true);
    expect(filtered.products.some((p) => p.id === "P100")).toBe(true);
    expect(filtered.doctors.length).toBeLessThanOrEqual(120);
    expect(filtered.products.length).toBeLessThanOrEqual(80);
  });
});
