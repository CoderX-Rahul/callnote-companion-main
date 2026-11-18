import { describe, expect, it } from "vitest";
import {
  clientDraftKeyForSubmit,
  decideDraftAction,
  generateClientDraftId,
  nextClientDraftKeyAfterSuccess,
  runIdempotentDraft,
  sha256Note,
  type DraftRequestStore,
  type ExistingDraftRequest,
} from "@/lib/draft-idempotency";

const clientDraftId = "11111111-1111-4111-8111-111111111111";
const noteSha = "a".repeat(64);

describe("draft idempotency decisions", () => {
  it("claims a missing request", () => {
    expect(decideDraftAction(null, noteSha, 10_000, 100)).toEqual({ action: "claim" });
  });

  it("reuses only a completed request with the same hash and report id", () => {
    expect(decideDraftAction(request("done", 9_000, "report-1"), noteSha, 10_000, 100)).toEqual({
      action: "reuse",
      reportId: "report-1",
    });
    expect(decideDraftAction(request("done", 9_000, null), noteSha, 10_000, 100).action).toBe(
      "invalid",
    );
  });

  it("rejects a key reused for a different exact-note hash", () => {
    expect(decideDraftAction(request("failed", 9_000), "b".repeat(64), 10_000, 100)).toEqual({
      action: "key_reuse_conflict",
    });
  });

  it("returns in progress before the stale boundary and takes over at the boundary", () => {
    const processing = request("processing", 9_000);
    const processingNearBoundary = request("processing", 10_000);
    expect(decideDraftAction(processingNearBoundary, noteSha, 10_099, 100)).toEqual({
      action: "in_progress",
      retryAfterMs: 1,
    });
    expect(decideDraftAction(processingNearBoundary, noteSha, 10_100, 100)).toEqual({
      action: "takeover",
    });
  });

  it("allows a failed request to retry", () => {
    expect(decideDraftAction(request("failed", 9_000), noteSha, 10_000, 100)).toEqual({
      action: "retry",
    });
  });
});

describe("client draft UUID lifecycle", () => {
  it("uses randomUUID when available", () => {
    expect(
      generateClientDraftId({
        randomUUID: () => clientDraftId,
        getRandomValues: (bytes) => bytes,
      }),
    ).toBe(clientDraftId);
  });

  it("creates a valid v4 UUID with the getRandomValues fallback", () => {
    const fallback = generateClientDraftId({
      getRandomValues: (bytes) => {
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(0);
        return bytes;
      },
    });
    expect(fallback).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps a key for the same submitted text and rotates for changed text and after success", () => {
    let generated = 0;
    const createKey = () => `new-key-${++generated}`;
    expect(clientDraftKeyForSubmit("note", "note", "same-key", createKey)).toBe("same-key");
    expect(clientDraftKeyForSubmit("edited", "note", "same-key", createKey)).toBe("new-key-1");
    expect(nextClientDraftKeyAfterSuccess(createKey)).toBe("new-key-2");
    expect(clientDraftKeyForSubmit("first submit", null, "initial-key", createKey)).toBe(
      "initial-key",
    );
  });

  it("hashes exact note bytes without trimming or newline changes", async () => {
    expect(await sha256Note(" note\n")).toBe(
      "f5e09ac76f10c483f9aeef7a7fa7f001d3101aebeaeb0c77ad93709e197f358f",
    );
  });
});

describe("idempotent draft flow with a fake request store", () => {
  it("allows only one model call across simultaneous duplicate submits", async () => {
    const store = new FakeStore();
    let modelCalls = 0;
    let releaseModel!: () => void;
    const modelGate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const first = runIdempotentDraft({
      clientDraftId,
      noteSha,
      staleAfterMs: 120_000,
      store,
      now: () => 50_000,
      getErrorKind: () => "unknown",
      createReport: async () => {
        modelCalls++;
        await modelGate;
        store.reports.set(clientDraftId, "report-double-submit");
        return { reportId: "report-double-submit" };
      },
    });
    await Promise.resolve();
    const second = await runIdempotentDraft({
      clientDraftId,
      noteSha,
      staleAfterMs: 120_000,
      store,
      now: () => 50_000,
      getErrorKind: () => "unknown",
      createReport: async () => {
        modelCalls++;
        return { reportId: "unexpected" };
      },
    });
    expect(second).toMatchObject({ status: "in_progress" });
    expect(modelCalls).toBe(1);
    releaseModel();
    expect(await first).toMatchObject({ status: "done", reused: false });
  });

  it("returns an existing draft after a lost response without another model call", async () => {
    const store = new FakeStore();
    let modelCalls = 0;
    const run = () =>
      runIdempotentDraft({
        clientDraftId,
        noteSha,
        staleAfterMs: 120_000,
        store,
        now: () => 50_000,
        getErrorKind: () => "unknown",
        createReport: async () => {
          modelCalls++;
          store.reports.set(clientDraftId, "report-reused");
          return { reportId: "report-reused" };
        },
      });
    expect(await run()).toMatchObject({ status: "done", reused: false });
    expect(await run()).toEqual({ status: "done", reportId: "report-reused", reused: true });
    expect(modelCalls).toBe(1);
  });

  it("marks a failed claim and permits a later model retry", async () => {
    const store = new FakeStore();
    let modelCalls = 0;
    const run = () =>
      runIdempotentDraft({
        clientDraftId,
        noteSha,
        staleAfterMs: 120_000,
        store,
        now: () => 50_000,
        getErrorKind: (error) => (error instanceof Error ? "provider_unavailable" : "unknown"),
        createReport: async () => {
          modelCalls++;
          if (modelCalls === 1) throw new Error("fake model failure");
          store.reports.set(clientDraftId, "report-after-retry");
          return { reportId: "report-after-retry" };
        },
      });
    expect(await run()).toMatchObject({ status: "failed", kind: "provider_unavailable" });
    expect(store.row?.status).toBe("failed");
    expect(await run()).toMatchObject({ status: "done", reportId: "report-after-retry" });
    expect(modelCalls).toBe(2);
  });

  it("returns a stable conflict without calling the model when a key hash differs", async () => {
    const store = new FakeStore();
    store.row = request("processing", 50_000);
    let modelCalls = 0;
    const result = await runIdempotentDraft({
      clientDraftId,
      noteSha: "b".repeat(64),
      staleAfterMs: 120_000,
      store,
      now: () => 50_000,
      getErrorKind: () => "unknown",
      createReport: async () => {
        modelCalls++;
        return { reportId: "unexpected" };
      },
    });
    expect(result).toEqual({ status: "error", kind: "key_reuse_conflict" });
    expect(modelCalls).toBe(0);
  });
});

function request(
  status: ExistingDraftRequest["status"],
  updatedAt: number,
  reportId: string | null = null,
): ExistingDraftRequest {
  return {
    note_sha256: noteSha,
    status,
    report_id: reportId,
    updated_at: new Date(updatedAt).toISOString(),
  };
}

class FakeStore implements DraftRequestStore {
  row: ExistingDraftRequest | null = null;
  reports = new Map<string, string>();

  async claim(_clientDraftId: string, sha: string) {
    if (this.row) return { inserted: false, row: this.row };
    this.row = {
      note_sha256: sha,
      status: "processing",
      report_id: null,
      updated_at: new Date(50_000).toISOString(),
    };
    return { inserted: true, row: this.row };
  }

  async get() {
    return this.row;
  }

  async compareAndSetProcessing(
    _clientDraftId: string,
    sha: string,
    expected: ExistingDraftRequest,
    updatedAt: string,
    staleBefore?: string,
  ) {
    if (
      !this.row ||
      this.row.status !== expected.status ||
      this.row.updated_at !== expected.updated_at
    )
      return null;
    if (staleBefore && Date.parse(this.row.updated_at) > Date.parse(staleBefore)) return null;
    this.row = { note_sha256: sha, status: "processing", report_id: null, updated_at: updatedAt };
    return this.row;
  }

  async complete(
    _clientDraftId: string,
    leaseUpdatedAt: string,
    reportId: string,
    updatedAt: string,
  ) {
    if (!this.row || this.row.status !== "processing" || this.row.updated_at !== leaseUpdatedAt)
      return false;
    this.row = { ...this.row, status: "done", report_id: reportId, updated_at: updatedAt };
    return true;
  }

  async fail(
    _clientDraftId: string,
    leaseUpdatedAt: string,
    _errorKind: string,
    updatedAt: string,
  ) {
    if (this.row?.status === "processing" && this.row.updated_at === leaseUpdatedAt)
      this.row = { ...this.row, status: "failed", report_id: null, updated_at: updatedAt };
  }

  async findReport(clientId: string) {
    return this.reports.get(clientId) ?? null;
  }
}
