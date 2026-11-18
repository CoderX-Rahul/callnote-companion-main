import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { PHARMA_GLOSSARY } from "./pharma-glossary";
import { extractedCompetitorSchema, extractedBarrierSchema } from "./report-intelligence";
import {
  extractedSampleSchema,
  extractedCollateralSchema,
  extractedCommitmentSchema,
} from "./report-effectiveness";
import { extractedPobLineSchema } from "./pob";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
export const AI_DEFAULT_LIMITS = {
  timeoutMs: 45_000,
  maxRetries: 2,
  totalDeadlineMs: 90_000,
} as const;
export const AI_SDK_MAX_RETRIES = 0;
const AI_MIN_REMAINING_MS = 10_000;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 8_000;
const TIMING_LOGS =
  process.env["NODE_ENV"] !== "production" && process.env["AI_TIMING_LOGS"] !== "false";

export type AiErrorKind =
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "auth_or_config"
  | "bad_request"
  | "bad_output"
  | "unknown";
export type AiErrorClassification = {
  kind: AiErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
};
export class AiResilienceError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AiResilienceError";
  }
}

export function logAiTiming(event: string, values: Record<string, number | string | undefined>) {
  if (TIMING_LOGS) console.info(`[ai-timing] ${event}`, values);
}
const logTiming = logAiTiming;

function readLimits(env: AiConfigEnvironment) {
  const parse = (
    name: string,
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      logTiming("invalid-limit", { name, fallback });
      return fallback;
    }
    return value;
  };
  return {
    timeoutMs: parse(
      "AI_TIMEOUT_MS",
      env.AI_TIMEOUT_MS,
      AI_DEFAULT_LIMITS.timeoutMs,
      5_000,
      120_000,
    ),
    maxRetries: parse("AI_MAX_RETRIES", env.AI_MAX_RETRIES, AI_DEFAULT_LIMITS.maxRetries, 0, 4),
    totalDeadlineMs: parse(
      "AI_TOTAL_DEADLINE_MS",
      env.AI_TOTAL_DEADLINE_MS,
      AI_DEFAULT_LIMITS.totalDeadlineMs,
      10_000,
      180_000,
    ),
  };
}

export function resolveAiLimits(env: AiConfigEnvironment) {
  return readLimits(env);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers && typeof headers === "object") {
    const h = headers as { get?: (key: string) => string | null; [key: string]: unknown };
    const fromGetter = typeof h.get === "function" ? h.get(name) : null;
    if (fromGetter) return fromGetter;
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
    const value = key ? h[key] : undefined;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function classifyAiError(error: unknown, nowMs?: number): AiErrorClassification {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as Record<string, unknown>;
    chain.push(item);
    current = item["cause"];
  }
  const status = chain
    .map((e) => Number(e["statusCode"] ?? e["status"]))
    .find((n) => Number.isFinite(n) && n > 0);
  const message = chain
    .map((e) => (typeof e["message"] === "string" ? (e["message"] as string) : ""))
    .join(" ")
    .toLowerCase();
  const name = chain
    .map((e) => (typeof e["name"] === "string" ? (e["name"] as string) : ""))
    .join(" ")
    .toLowerCase();
  if (/safety|blocked|content.?filter/.test(message))
    return { kind: "bad_output", retryable: false };
  const retryAfter = chain
    .map((e) => headerValue(e["responseHeaders"] ?? e["headers"], "retry-after"))
    .find(Boolean);
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(seconds)) retryAfterMs = Math.max(0, seconds * 1_000);
    else if (Number.isFinite(date) && nowMs !== undefined) retryAfterMs = Math.max(0, date - nowMs);
  }
  if (status === 429)
    return {
      kind: "rate_limited",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  if ([408, 500, 502, 503, 504].includes(status ?? -1))
    return { kind: "provider_unavailable", retryable: true };
  if ([400, 401, 403, 404, 422, 402].includes(status ?? -1))
    return {
      kind: status === 400 || status === 422 ? "bad_request" : "auth_or_config",
      retryable: false,
    };
  if (
    /noobjectgenerated|no object generated|unparsable structured output/.test(`${name} ${message}`)
  )
    return { kind: "bad_output", retryable: true };
  if (/timeout|timed out|aborterror|timeouterror/.test(`${name} ${message}`))
    return { kind: "timeout", retryable: true };
  if (
    /fetch failed|network|econnreset|enotfound|socket|connection refused/.test(`${name} ${message}`)
  )
    return { kind: "provider_unavailable", retryable: true };
  return { kind: "unknown", retryable: false };
}

export async function withAiRetry<T>(
  attempt: (signal: AbortSignal, attemptNumber: number) => Promise<T>,
  limits: { timeoutMs: number; maxRetries: number; totalDeadlineMs: number },
  options: {
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
    signal?: AbortSignal;
    onAttempt?: (number: number) => void;
  } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const started = now();
  const deadline = started + limits.totalDeadlineMs;
  let unparsableOutputRetries = 0;
  for (let number = 1; ; number++) {
    if (options.signal?.aborted)
      throw new AiResilienceError("unknown", "The request was cancelled.");
    const remaining = deadline - now();
    if (remaining < AI_MIN_REMAINING_MS)
      throw new AiResilienceError("timeout", "The AI request took too long. Please try again.");
    const duration = Math.min(limits.timeoutMs, remaining);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("AI attempt timed out", "TimeoutError")),
      duration,
    );
    const onCallerAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    options.onAttempt?.(number);
    try {
      return await attempt(controller.signal, number);
    } catch (error) {
      if (options.signal?.aborted)
        throw new AiResilienceError("unknown", "The request was cancelled.");
      const classification = classifyAiError(error, now());
      const retriesUsed = number - 1;
      const badOutputRetryExhausted =
        classification.kind === "bad_output" && unparsableOutputRetries >= 1;
      if (
        !classification.retryable ||
        retriesUsed >= limits.maxRetries ||
        badOutputRetryExhausted
      ) {
        const kind = classification.kind;
        throw new AiResilienceError(kind, safeAiMessage(kind, classification.retryAfterMs));
      }
      if (classification.kind === "bad_output") unparsableOutputRetries++;
      const remainingAfter = deadline - now();
      const delay =
        classification.retryAfterMs ??
        Math.floor(random() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** retriesUsed));
      if (
        classification.retryAfterMs !== undefined &&
        (delay > RETRY_CAP_MS || delay + AI_MIN_REMAINING_MS > remainingAfter)
      ) {
        throw new AiResilienceError("rate_limited", safeAiMessage("rate_limited", delay));
      }
      if (remainingAfter - delay < AI_MIN_REMAINING_MS)
        throw new AiResilienceError("timeout", safeAiMessage("timeout"));
      await sleep(delay);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

function safeAiMessage(kind: AiErrorKind, waitMs?: number) {
  if (kind === "rate_limited")
    return `The AI service is busy. Please wait about ${Math.max(1, Math.ceil((waitMs ?? 1_000) / 1_000))} seconds and try again.`;
  if (kind === "timeout")
    return "The AI service took too long. Your note is safe; please try again.";
  if (kind === "auth_or_config")
    return "The AI service is not available right now. Please contact support.";
  if (kind === "bad_request")
    return "The AI could not process this note. Please check it and try again.";
  if (kind === "bad_output") return "The AI could not read this note. Please try rephrasing.";
  if (kind === "provider_unavailable")
    return "The AI service is having trouble. Your note is safe; please retry.";
  return "The draft could not be created. Your note is safe; please retry.";
}

export type AiConfigEnvironment = {
  LOVABLE_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_REASONING?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_RETRIES?: string;
  AI_TOTAL_DEADLINE_MS?: string;
  AI_REASONING_EFFORT?: string;
};

type JsonRecord = Record<string, unknown>;

/** Gemini's OpenAI-compatible endpoint accepts a smaller JSON Schema subset. */
export function normalizeGeminiRequestBody(body: JsonRecord): JsonRecord {
  const normalizedBody = { ...body };
  delete normalizedBody["store"];
  const responseFormat = normalizedBody["response_format"];
  if (!responseFormat || typeof responseFormat !== "object" || Array.isArray(responseFormat))
    return normalizedBody;
  const format = responseFormat as JsonRecord;
  const jsonSchema = format["json_schema"];
  if (!jsonSchema || typeof jsonSchema !== "object" || Array.isArray(jsonSchema))
    return normalizedBody;
  const wrapper = jsonSchema as JsonRecord;
  const schema = wrapper["schema"];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return normalizedBody;

  const normalizeSchema = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalizeSchema);
    if (!value || typeof value !== "object") return value;

    const source = value as JsonRecord;
    const nullableBranches = source["anyOf"];
    if (Array.isArray(nullableBranches) && nullableBranches.length === 2) {
      const nullIndex = nullableBranches.findIndex(
        (branch) =>
          !!branch &&
          typeof branch === "object" &&
          !Array.isArray(branch) &&
          (branch as JsonRecord)["type"] === "null",
      );
      const valueIndex = nullIndex === 0 ? 1 : nullIndex === 1 ? 0 : -1;
      if (valueIndex >= 0) {
        const nonNull = normalizeSchema(nullableBranches[valueIndex]);
        if (nonNull && typeof nonNull === "object" && !Array.isArray(nonNull)) {
          const normalized = nonNull as JsonRecord;
          return {
            ...normalized,
            type: Array.isArray(normalized["type"])
              ? [...normalized["type"], "null"]
              : [normalized["type"], "null"],
          };
        }
      }
    }

    const result: JsonRecord = {};
    for (const [key, child] of Object.entries(source)) {
      if (key === "additionalProperties" || key === "$schema") continue;
      result[key] = normalizeSchema(child);
    }
    return result;
  };

  const normalizedJsonSchema: JsonRecord = { ...wrapper, schema: normalizeSchema(schema) };
  // Gemini's compatibility endpoint does not need OpenAI's strict-mode hint;
  // validation remains enforced locally by extractionSchema.
  delete normalizedJsonSchema["strict"];
  return { ...normalizedBody, response_format: { ...format, json_schema: normalizedJsonSchema } };
}

function geminiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof init?.body !== "string") return fetch(input, init);
  try {
    const body = JSON.parse(init.body) as JsonRecord;
    const normalized = normalizeGeminiRequestBody(body);
    return fetch(input, { ...init, body: JSON.stringify(normalized) });
  } catch {
    return fetch(input, init);
  }
}

function lovableProviderOptions() {
  return {
    openai: {
      forceReasoning: true,
      reasoningEffort: "low" as const,
      reasoningSummary: "auto" as const,
      store: false,
      include: ["reasoning.encrypted_content"],
    },
  };
}

/** Resolve the existing Lovable gateway or an explicit OpenAI-compatible provider. */
export function resolveAiConfig(env: AiConfigEnvironment) {
  const limits = readLimits(env);
  const overrideKey = env.AI_API_KEY?.trim();
  if (!overrideKey) {
    if (!env.LOVABLE_API_KEY) throw new Error("AI is not configured.");
    return {
      baseURL: GATEWAY,
      model: MODEL,
      apiKey: env.LOVABLE_API_KEY,
      useChatCompletions: false,
      headers: { "Lovable-API-Key": env.LOVABLE_API_KEY, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      providerOptions: lovableProviderOptions(),
      limits,
    };
  }

  const model = env.AI_MODEL?.trim();
  if (!model) throw new Error("AI is not configured.");
  const reasoning = env.AI_REASONING === "true";
  const baseURL = env.AI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const isGemini = /generativelanguage\.googleapis\.com/i.test(baseURL);
  return {
    baseURL,
    model,
    apiKey: overrideKey,
    useChatCompletions: !/^https:\/\/api\.openai\.com\/v1\/?$/i.test(
      env.AI_BASE_URL?.trim() || "https://api.openai.com/v1",
    ),
    ...(isGemini ? { fetch: geminiFetch } : {}),
    headers: undefined,
    providerOptions: isGemini
      ? reasoning
        ? undefined
        : { openai: { reasoningEffort: "none" as const } }
      : reasoning
        ? lovableProviderOptions()
        : { openai: { store: false } },
    ...(env.AI_REASONING_EFFORT?.trim()
      ? {
          providerOptions: {
            openai: {
              ...(reasoning ? { forceReasoning: true } : {}),
              reasoningEffort: env.AI_REASONING_EFFORT.trim(),
              store: false,
            },
          },
        }
      : {}),
    limits,
  };
}

export const extractionSchema = z.object({
  doctor_mention: z
    .string()
    .nullable()
    .describe("Doctor name exactly as written in the note, or null"),
  doctor_candidate_ids: z
    .array(z.string())
    .describe("IDs from the doctor master list that could match the mention"),
  product_mentions: z.array(
    z.object({
      mention: z.string(),
      candidate_ids: z.array(z.string()),
    }),
  ),
  call_date: z
    .string()
    .nullable()
    .describe("YYYY-MM-DD only if stated or clearly derivable (e.g. 'yesterday')"),
  call_time: z.string().nullable().describe("HH:MM 24h only if stated"),
  purpose: z.string().nullable(),
  feedback: z.string().nullable().describe("Doctor feedback and questions, only as stated"),
  materials_requested: z.string().nullable(),
  follow_up_action: z.string().nullable(),
  follow_up_due: z.string().nullable().describe("YYYY-MM-DD only if stated or clearly derivable"),
  clarifying_questions: z
    .array(z.string())
    .describe("Short questions for missing/ambiguous required info"),
  competitors: z.array(extractedCompetitorSchema),
  barriers: z.array(extractedBarrierSchema),
  samples: z.array(extractedSampleSchema),
  collateral: z.array(extractedCollateralSchema),
  commitments: z.array(extractedCommitmentSchema),
  hcp_tier: z
    .string()
    .nullable()
    .describe("A, B or C only if the note explicitly states the doctor's tier; otherwise null"),
  access_quality: z
    .string()
    .describe("Access quality only if explicitly described; otherwise Unknown"),
  pob: z.array(extractedPobLineSchema).max(30),
});
export type Extraction = z.infer<typeof extractionSchema>;

type Master = {
  doctors: {
    id: string;
    name: string;
    specialty: string | null;
    clinic: string | null;
    city?: string | null;
  }[];
  products: { id: string; name: string }[];
};

export async function extractFromNote(
  note: string,
  master: Master,
  today: string,
  originalNote = note,
  deadlineStartedAt = Date.now(),
): Promise<Extraction> {
  const requestStarted = Date.now();
  const config = resolveAiConfig(process.env);
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    ...(config.headers ? { headers: config.headers } : {}),
    ...("fetch" in config && config.fetch ? { fetch: config.fetch } : {}),
  });

  const promptMaster = prefilterMaster(note, master);
  const promptBuildStarted = Date.now();
  const doctorList = promptMaster.doctors
    .map((d) => `${d.id} | ${d.name} | ${d.specialty ?? ""} | ${d.clinic ?? ""}`)
    .join("\n");
  const productList = promptMaster.products.map((p) => `${p.id} | ${p.name}`).join("\n");
  const instructions = `You extract structured pharmaceutical doctor-call reports from a medical representative's note.
Today is ${today} (timezone Asia/Kolkata).
STRICT RULES:
- Never invent doctors, products, feedback, dates, times or numbers. If not in the note, return null.
- Doctor and product candidates MUST be IDs from the master lists below. If a mention matches several entries (e.g. only a surname), return all of them. If nothing matches, return an empty list.
- Do not include any patient-level information.
- Keep text fields concise, in the MR's meaning, no embellishment.
- Required fields: doctor, call date, at least one product, purpose. For each missing or ambiguous required field, add one short clarifying question. Exact call time is optional: return null if unstated and never ask for it as a requirement.
- Terminology glossary: ${PHARMA_GLOSSARY.map((entry) => `${entry.term}: ${entry.meaning}`).join("; ")}. Honorific Mr. is not the acronym MR.
- Competitors and prescribing barriers are OPTIONAL: return empty arrays when not discussed; never ask for missing intelligence as a required clarification.
- Extract multiple competitors only when explicitly mentioned as alternatives/competitors. Preserve original brand mentions; candidate_ids may ONLY use matching product master IDs. External brands need no master ID. Mark ambiguous true for uncertain or multiple possible identities; do not resolve uncertainty by guessing.
- Competitor sentiment describes the doctor's attitude toward that competitor (not our product). Uncertain statements have Unknown sentiment/preference. Reasons and barriers must be explicit, never inferred from a competitor mention alone.
- Every competitor/barrier evidence must be a short verbatim quote from the original note supplied below, not normalized text. No evidence means Unknown sentiment/reason/category/status. Keep preference_detail faithful; distinguish price advantage from clinical evidence, affordability from price sensitivity.
- Barrier status: Open only for an explicitly current obstacle, Resolved only if explicitly resolved, Not discussed only if explicitly stated, otherwise Unknown. At most one primary barrier, and only if the note identifies it as the main barrier.
- suggested_followup_action: extract only a follow-up stated in the note; do not invent advice or tasks. Null when unstated.
- Samples, collateral, commitments, HCP tier and access quality are OPTIONAL: return empty arrays/null/Unknown when not discussed; never ask for them as required clarifications.
- Samples: only products from the master list via candidate_ids. Quantity only when an explicit number is stated; otherwise null — never estimate. Distributed only when samples were actually handed over; Planned when only intended; otherwise Unknown. Evidence must be a verbatim quote from the original note.
- Collateral: record only materials explicitly mentioned, using the standard material types; detail only as stated.
- Commitments: capture only commitments explicitly stated. Distinguish a doctor's commitment, an MR follow-up, a confirmed product trial and an actual prescription conversion. A commitment is NEVER a prescription; never claim conversion or ROI unless an explicit outcome is stated. commitment_date and trial_patient_count only when stated, else null.
- hcp_tier: record A, B or C only when the note explicitly states the doctor's tier; never infer or assign a tier from the conversation. Otherwise null.
- access_quality: choose from the allowed values only when the interaction is explicitly described; otherwise Unknown.
- Orders / POB are OPTIONAL: return an empty array unless an order or order intent is explicitly discussed. Do not treat samples, prescriptions, or a doctor's interest as a booked order.
- For each order, preserve the exact product mention and candidate IDs only from the product list. Quantity, status, scheme mention, stated unit price, and evidence must come from the original note; use null or Unknown when unstated. Status is Booked only for an explicit order commitment, Tentative for an explicitly tentative order, otherwise Unknown. Evidence must be an exact quote of at least five characters from the original note. Never infer MRP, scheme, quantity, order value, or free goods.

DOCTORS:
${doctorList}

PRODUCTS:
${productList}`;

  const prompt = `Normalized note:\n${note}\n\nOriginal note (use for verbatim intelligence and order evidence):\n${originalNote}`;
  logTiming("prompt-built", {
    durationMs: Date.now() - promptBuildStarted,
    noteLength: originalNote.length,
    promptLength: instructions.length + prompt.length,
    doctorListLength: doctorList.length,
    productListLength: productList.length,
  });

  try {
    const result = await withAiRetry(
      async (signal, attemptNumber) => {
        const attemptStarted = Date.now();
        try {
          const result = await generateText({
            model: config.useChatCompletions
              ? provider.chat(config.model)
              : provider.responses(config.model),
            instructions,
            messages: [{ role: "user", content: prompt }],
            output: Output.object({ schema: extractionSchema }),
            ...(config.providerOptions ? { providerOptions: config.providerOptions } : {}),
            abortSignal: signal,
            maxRetries: AI_SDK_MAX_RETRIES, // Keep this wrapper as the only retry layer.
          });
          logTiming("model-attempt", {
            attempt: attemptNumber,
            durationMs: Date.now() - attemptStarted,
            statusClass: "success",
          });
          return result.output as Extraction;
        } catch (error) {
          const classification = classifyAiError(error, Date.now());
          const statusCode =
            error && typeof error === "object"
              ? Number(
                  (error as { statusCode?: unknown; status?: unknown }).statusCode ??
                    (error as { status?: unknown }).status,
                )
              : NaN;
          logTiming("model-attempt", {
            attempt: attemptNumber,
            durationMs: Date.now() - attemptStarted,
            statusClass: Number.isFinite(statusCode)
              ? `${Math.floor(statusCode / 100)}xx`
              : undefined,
            kind: classification.kind,
          });
          throw error;
        }
      },
      {
        ...config.limits,
        totalDeadlineMs: config.limits.totalDeadlineMs - (Date.now() - deadlineStartedAt),
      },
    );
    const validationStarted = Date.now();
    const validated = extractionSchema.parse(result);
    logTiming("validation-normalization", { durationMs: Date.now() - validationStarted });
    logTiming("extraction-complete", { durationMs: Date.now() - requestStarted });
    return validated;
  } catch (e) {
    logTiming("extraction-complete", {
      durationMs: Date.now() - requestStarted,
      result: "failure",
    });
    if (e instanceof AiResilienceError) throw e;
    const classification = classifyAiError(e, Date.now());
    throw new AiResilienceError(
      classification.kind,
      safeAiMessage(classification.kind, classification.retryAfterMs),
    );
  }
}

export const MASTER_PREFILTER_THRESHOLDS = {
  doctors: 200,
  products: 100,
  doctorCap: 120,
  productCap: 80,
  fallback: 20,
} as const;
type PromptMaster = { doctors: Master["doctors"]; products: Master["products"] };
export function prefilterMaster(note: string, master: Master): PromptMaster {
  const words = new Set(note.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const pick = <T extends { name: string }>(
    entries: T[],
    threshold: number,
    cap: number,
    fields: (entry: T) => string[],
  ) => {
    if (entries.length <= threshold) return entries;
    const selected = entries.filter((entry) =>
      fields(entry).some((field) =>
        (field.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some(
          (token) => token.length > 1 && words.has(token),
        ),
      ),
    );
    const matchedCount = selected.length;
    for (const item of entries) {
      if (selected.length >= Math.min(cap, matchedCount + MASTER_PREFILTER_THRESHOLDS.fallback))
        break;
      if (!selected.includes(item)) selected.push(item);
    }
    return selected.slice(0, cap);
  };
  return {
    doctors: pick(
      master.doctors,
      MASTER_PREFILTER_THRESHOLDS.doctors,
      MASTER_PREFILTER_THRESHOLDS.doctorCap,
      (d) => [d.name, d.specialty ?? "", d.clinic ?? "", d.city ?? ""],
    ),
    products: pick(
      master.products,
      MASTER_PREFILTER_THRESHOLDS.products,
      MASTER_PREFILTER_THRESHOLDS.productCap,
      (p) => [p.name],
    ),
  };
}
