export type DraftRequestStatus = "processing" | "done" | "failed";

export type ExistingDraftRequest = {
  note_sha256: string;
  status: DraftRequestStatus;
  report_id: string | null;
  updated_at: string;
};

export type DraftAction =
  | { action: "claim" }
  | { action: "reuse"; reportId: string }
  | { action: "key_reuse_conflict" }
  | { action: "in_progress"; retryAfterMs: number }
  | { action: "retry" }
  | { action: "takeover" }
  | { action: "invalid" };

/** Pure state decision. A request is stale exactly at the staleAfterMs boundary. */
export function decideDraftAction(
  existing: ExistingDraftRequest | null,
  noteSha: string,
  now: number,
  staleAfterMs: number,
): DraftAction {
  if (!existing) return { action: "claim" };
  if (existing.note_sha256 !== noteSha) return { action: "key_reuse_conflict" };
  if (existing.status === "done") {
    return existing.report_id
      ? { action: "reuse", reportId: existing.report_id }
      : { action: "invalid" };
  }
  if (existing.status === "failed") return { action: "retry" };

  const updatedAt = Date.parse(existing.updated_at);
  const ageMs = Number.isFinite(updatedAt) ? Math.max(0, now - updatedAt) : staleAfterMs;
  return ageMs >= staleAfterMs
    ? { action: "takeover" }
    : { action: "in_progress", retryAfterMs: Math.max(0, staleAfterMs - ageMs) };
}

export type IdempotentDraftResult =
  | { status: "done"; reportId: string; reused: boolean }
  | { status: "in_progress"; retryAfterMs: number }
  | { status: "error"; kind: "key_reuse_conflict" }
  | { status: "failed"; kind: string; message: string };

export type DraftRequestStore = {
  claim(
    clientDraftId: string,
    noteSha: string,
  ): Promise<{ inserted: boolean; row: ExistingDraftRequest | null }>;
  get(clientDraftId: string): Promise<ExistingDraftRequest | null>;
  compareAndSetProcessing(
    clientDraftId: string,
    noteSha: string,
    expected: ExistingDraftRequest,
    updatedAt: string,
    staleBefore?: string,
  ): Promise<ExistingDraftRequest | null>;
  complete(
    clientDraftId: string,
    leaseUpdatedAt: string,
    reportId: string,
    updatedAt: string,
  ): Promise<boolean>;
  fail(
    clientDraftId: string,
    leaseUpdatedAt: string,
    errorKind: string,
    updatedAt: string,
  ): Promise<void>;
  findReport(clientDraftId: string): Promise<string | null>;
};

/** Idempotent state machine with storage and model work injected for focused tests. */
export async function runIdempotentDraft(options: {
  clientDraftId: string;
  noteSha: string;
  staleAfterMs: number;
  store: DraftRequestStore;
  createReport: () => Promise<{ reportId: string; reused?: boolean }>;
  getErrorKind: (error: unknown) => string;
  getErrorMessage?: (error: unknown, kind: string) => string;
  now?: () => number;
}): Promise<IdempotentDraftResult> {
  const now = options.now ?? Date.now;
  const isoNow = () => new Date(now()).toISOString();

  const execute = async (lease: ExistingDraftRequest): Promise<IdempotentDraftResult> => {
    try {
      const previouslyInserted = await options.store.findReport(options.clientDraftId);
      if (previouslyInserted) {
        await options.store.complete(
          options.clientDraftId,
          lease.updated_at,
          previouslyInserted,
          isoNow(),
        );
        return { status: "done", reportId: previouslyInserted, reused: true };
      }

      const created = await options.createReport();
      const completed = await options.store.complete(
        options.clientDraftId,
        lease.updated_at,
        created.reportId,
        isoNow(),
      );
      if (!completed) {
        const racedReport = await options.store.findReport(options.clientDraftId);
        if (racedReport) return { status: "done", reportId: racedReport, reused: true };
        return { status: "in_progress", retryAfterMs: 1_000 };
      }
      return { status: "done", reportId: created.reportId, reused: !!created.reused };
    } catch (error) {
      try {
        await options.store.fail(
          options.clientDraftId,
          lease.updated_at,
          options.getErrorKind(error),
          isoNow(),
        );
      } catch {
        // Do not replace the safe result with database/provider details.
      }
      const kind = options.getErrorKind(error);
      return {
        status: "failed",
        kind,
        message:
          options.getErrorMessage?.(error, kind) ?? "The draft could not be created. Please retry.",
      };
    }
  };

  const first = await options.store.claim(options.clientDraftId, options.noteSha);
  if (first.inserted && first.row) return execute(first.row);
  let current = first.row ?? (await options.store.get(options.clientDraftId));

  for (let attempt = 0; attempt < 4; attempt++) {
    const decision = decideDraftAction(current, options.noteSha, now(), options.staleAfterMs);
    if (decision.action === "reuse")
      return { status: "done", reportId: decision.reportId, reused: true };
    if (decision.action === "key_reuse_conflict")
      return { status: "error", kind: "key_reuse_conflict" };
    if (decision.action === "in_progress")
      return { status: "in_progress", retryAfterMs: decision.retryAfterMs };
    if (decision.action === "invalid")
      return {
        status: "failed",
        kind: "unknown",
        message: "The draft could not be created. Please retry.",
      };

    if (decision.action === "claim") {
      const claimed = await options.store.claim(options.clientDraftId, options.noteSha);
      if (claimed.inserted && claimed.row) return execute(claimed.row);
      current = claimed.row ?? (await options.store.get(options.clientDraftId));
      continue;
    }

    if (!current) continue;
    const staleBefore =
      decision.action === "takeover"
        ? new Date(now() - options.staleAfterMs).toISOString()
        : undefined;
    const lease = await options.store.compareAndSetProcessing(
      options.clientDraftId,
      options.noteSha,
      current,
      isoNow(),
      staleBefore,
    );
    if (lease) return execute(lease);
    current = await options.store.get(options.clientDraftId);
  }

  const latest = await options.store.get(options.clientDraftId);
  const finalDecision = decideDraftAction(latest, options.noteSha, now(), options.staleAfterMs);
  return finalDecision.action === "in_progress"
    ? { status: "in_progress", retryAfterMs: finalDecision.retryAfterMs }
    : { status: "in_progress", retryAfterMs: 1_000 };
}

export type RandomCrypto = {
  randomUUID?: () => string;
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
};

/** UUID v4 generation works over local HTTP where crypto.randomUUID may be unavailable. */
export function generateClientDraftId(cryptoApi: RandomCrypto = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function clientDraftKeyForSubmit(
  note: string,
  lastSubmittedNote: string | null,
  currentKey: string,
  createKey: () => string = generateClientDraftId,
): string {
  return lastSubmittedNote === null || note === lastSubmittedNote ? currentKey : createKey();
}

export function nextClientDraftKeyAfterSuccess(
  createKey: () => string = generateClientDraftId,
): string {
  return createKey();
}

export async function sha256Note(
  note: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(note));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
