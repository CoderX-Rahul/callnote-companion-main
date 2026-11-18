import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMrProfile, scoped, scopedOwn, softDeleteReportQuery } from "./mr-auth";
import { EDITABLE_FIELDS, addDays, combineDateTime, dateFromCallDatetime, filterKnownIds, missingRequired, safeDate, todayIST } from "./report-rules";
import { toExportCsv } from "./report-export";
import { normalizePharmaNote } from "./pharma-glossary";
import { unresolvedQuestions } from "./doctor-search";
import { intelligenceSchema, normalizeIntelligence, readIntelligence, validateIntelligence } from "./report-intelligence";
import { effectivenessSchema, normalizeEffectiveness, readEffectiveness, validateEffectiveness } from "./report-effectiveness";
import { runIdempotentDraft, sha256Note, type DraftRequestStore, type ExistingDraftRequest } from "./draft-idempotency";
import { EXTRACTION_SCHEMA_VERSION, normalizePob, pobSchema, readPob, restoreAiStatedPrices, rollUpByDirectReport } from "./pob";
import { fetchPobTotals, loadPobCatalog, loadPobHierarchy, pobReportUpdate } from "./pob-db";

// Every privileged query runs through the service-role client, so each one applies
// an explicit ownership/organization scope (scoped() in mr-auth) derived from the verified session profile.
// Tables remain inaccessible to browser clients.
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Db = Awaited<ReturnType<typeof db>>;

type DraftRequestRow = ExistingDraftRequest & {
  mr_profile_id: string;
  client_draft_id: string;
  error_kind: string | null;
};
type IdempotencyDbError = { code?: string; message?: string };
type IdempotencyDbResponse<T> = { data: T | null; error: IdempotencyDbError | null };
type IdempotencyQuery<T> = {
  upsert(
    values: Record<string, unknown>,
    options: { onConflict: string; ignoreDuplicates: boolean },
  ): IdempotencyQuery<T>;
  insert(values: Record<string, unknown>): IdempotencyQuery<T>;
  update(values: Record<string, unknown>): IdempotencyQuery<T>;
  select(columns: string): IdempotencyQuery<T>;
  eq(column: string, value: unknown): IdempotencyQuery<T>;
  lte(column: string, value: string): IdempotencyQuery<T>;
  is(column: string, value: null): IdempotencyQuery<T>;
  maybeSingle(): PromiseLike<IdempotencyDbResponse<T>>;
  single(): PromiseLike<IdempotencyDbResponse<T>>;
};
type IdempotencyTables = {
  from(table: "ai_draft_requests"): IdempotencyQuery<DraftRequestRow>;
  from(table: "call_reports"): IdempotencyQuery<{ id: string }>;
};

// Keep the generated Supabase table-type gap for 0013 confined to this adapter.
function idempotencyTables(client: Db): IdempotencyTables {
  return client as unknown as IdempotencyTables;
}

function createDraftRequestStore(client: Db, profileId: string): DraftRequestStore {
  const requestTable = () => idempotencyTables(client).from("ai_draft_requests");
  const reportTable = () => idempotencyTables(client).from("call_reports");
  const requestFields =
    "mr_profile_id,client_draft_id,note_sha256,status,report_id,error_kind,created_at,updated_at";
  const findRequest = async (clientDraftId: string) => {
    const { data, error } = await requestTable()
      .select(requestFields)
      .eq("mr_profile_id", profileId)
      .eq("client_draft_id", clientDraftId)
      .maybeSingle();
    if (error) throw error;
    return data;
  };
  return {
    async claim(clientDraftId, noteSha) {
      const { data, error } = await requestTable()
        .upsert(
          {
            mr_profile_id: profileId,
            client_draft_id: clientDraftId,
            note_sha256: noteSha,
            status: "processing",
          },
          { onConflict: "mr_profile_id,client_draft_id", ignoreDuplicates: true },
        )
        .select(requestFields)
        .maybeSingle();
      if (error) throw error;
      return { inserted: !!data, row: data };
    },
    get: findRequest,
    async compareAndSetProcessing(clientDraftId, noteSha, expected, updatedAt, staleBefore) {
      let query = requestTable()
        .update({
          note_sha256: noteSha,
          status: "processing",
          report_id: null,
          error_kind: null,
          updated_at: updatedAt,
        })
        .eq("mr_profile_id", profileId)
        .eq("client_draft_id", clientDraftId)
        .eq("status", expected.status)
        .eq("updated_at", expected.updated_at);
      if (staleBefore) query = query.lte("updated_at", staleBefore);
      const { data, error } = await query.select(requestFields).maybeSingle();
      if (error) throw error;
      return data;
    },
    async complete(clientDraftId, leaseUpdatedAt, reportId, updatedAt) {
      const { data, error } = await requestTable()
        .update({
          status: "done",
          report_id: reportId,
          error_kind: null,
          updated_at: updatedAt,
        })
        .eq("mr_profile_id", profileId)
        .eq("client_draft_id", clientDraftId)
        .eq("status", "processing")
        .eq("updated_at", leaseUpdatedAt)
        .select("client_draft_id")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    async fail(clientDraftId, leaseUpdatedAt, errorKind, updatedAt) {
      const { error } = await requestTable()
        .update({
          status: "failed",
          report_id: null,
          error_kind: errorKind,
          updated_at: updatedAt,
        })
        .eq("mr_profile_id", profileId)
        .eq("client_draft_id", clientDraftId)
        .eq("status", "processing")
        .eq("updated_at", leaseUpdatedAt)
        .select("client_draft_id")
        .maybeSingle();
      if (error) throw error;
    },
    async findReport(clientDraftId) {
      const { data, error } = await scopedOwn(reportTable().select("id"), { id: profileId })
        .eq("client_draft_id", clientDraftId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  };
}

async function loadMaster() {
  const s = await db();
  const [d, catalog] = await Promise.all([
    s.from("doctors").select("id,name,specialty,clinic,city").order("name"),
    loadPobCatalog(s),
  ]);
  if (d.error) throw d.error;
  return { doctors: d.data, products: catalog.products, schemes: catalog.schemes };
}

export const getMasterData = createServerFn({ method: "GET" }).middleware([requireMrProfile]).handler(async () => loadMaster());

export const getDashboard = createServerFn({ method: "GET" }).middleware([requireMrProfile]).handler(async ({ context }) => {
  const s = await db();
  const { data, error } = await scoped(
    s.from("call_reports").select("id,mr_profile_id,status,follow_up_due,follow_up_done,follow_up_action,doctor_name,created_at"),
    context.profile,
  );
  if (error) throw error;
  const today = todayIST();
  const in7 = addDays(today, 7) ?? today;
  const p = context.profile;
  let teamSize: number;
  if (p.reportScope.kind === "profiles") {
    teamSize = Math.max(0, p.reportScope.profileIds.length - 1);
  } else {
    const { count: memberCount, error: memberError } = await s
      .from("mr_profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", p.organization_id);
    if (memberError) throw memberError;
    teamSize = Math.max(0, (memberCount ?? 0) - 1);
  }
  return {
    profile: {
      full_name: p.full_name,
      employee_code: p.employee_code,
      division: p.division,
      territory: p.territory,
      headquarters: p.headquarters,
      role: p.role,
      scopeLabel: p.role === "mr" || p.reportScope.kind === "profiles" && p.reportScope.profileIds.length === 1
        ? "Own reports"
        : `Team: ${teamSize} reps`,
    },
    total: data.length,
    drafts: data.filter((r) => r.status === "draft").length,
    approved: data.filter((r) => r.status === "approved").length,
    followUpsDue: data.filter(
      (r) => r.status === "approved" && !r.follow_up_done && r.follow_up_due && r.follow_up_due <= in7,
    ).length,
    overdue: data.filter((r) => r.status === "approved" && !r.follow_up_done && r.follow_up_due && r.follow_up_due < today)
      .length,
    recentDrafts: data
      .filter((r) => r.status === "draft" && r.mr_profile_id === p.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map(({ mr_profile_id: _ownerId, ...row }) => row),
  };
});

const monthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((value) => Number(value.slice(0, 4)) >= 1900) });
export const getPobSummary = createServerFn({ method: "GET" }).middleware([requireMrProfile])
  .inputValidator((input: { month: string }) => monthInput.parse(input))
  .handler(async ({ data, context }) => {
    const [year, month] = data.month.split("-").map(Number);
    const from = `${data.month}-01`;
    const to = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
    const s = await db();
    const { error: scopedReadError } = await scoped(
      s.from("call_reports").select("id"), context.profile,
    ).limit(1);
    if (scopedReadError) throw scopedReadError;
    const profileIds = context.profile.reportScope.kind === "profiles" ? context.profile.reportScope.profileIds : undefined;
    const hierarchy = await loadPobHierarchy(s, context.profile.organization_id, profileIds);
    const permitted = profileIds ?? hierarchy.map((row) => row.id);
    const totals = await fetchPobTotals(s, context.profile.organization_id, permitted, from, to);
    const total = { approved_calls: 0, booked_calls: 0, booked_lines: 0, booked_value: 0 as number | null };
    for (const id of permitted) {
      const row = totals.get(id);
      if (!row) continue;
      total.approved_calls += row.approved_calls;
      total.booked_calls += row.booked_calls;
      total.booked_lines += row.booked_lines;
      total.booked_value = total.booked_value === null || row.booked_value === null ? null : total.booked_value + row.booked_value;
    }
    const viewer = hierarchy.find((row) => row.id === context.profile.id) ?? {
      id: context.profile.id, reports_to: null, role: context.profile.role,
      full_name: context.profile.full_name, employee_code: context.profile.employee_code,
    };
    const breakdown = rollUpByDirectReport(viewer, hierarchy, totals);
    return { month: data.month, total, breakdown, role: context.profile.role };
  });

const listInput = z.object({
  q: z.string().optional(),
  status: z.enum(["all", "draft", "approved"]).optional(),
  doctorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const listReports = createServerFn({ method: "GET" }).middleware([requireMrProfile])
  .inputValidator((i: z.infer<typeof listInput>) => listInput.parse(i))
  .handler(async ({ data, context }) => {
    const s = await db();
    let q = scoped(
      s.from("call_reports")
        .select("id,status,call_datetime,call_date_only,doctor_name,doctor_id,product_names,purpose,rep_name,mr_profile_id,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      context.profile,
    );
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.doctorId) q = q.eq("doctor_id", data.doctorId);
    if (data.from && safeDate(data.from)) q = q.or(`call_date_only.gte.${data.from},and(call_date_only.is.null,call_datetime.gte.${data.from}T00:00:00+05:30)`);
    if (data.to && safeDate(data.to)) q = q.or(`call_date_only.lte.${data.to},and(call_date_only.is.null,call_datetime.lte.${data.to}T23:59:59+05:30)`);
    if (data.q?.trim()) {
      const t = data.q.trim().replace(/[%,()]/g, "");
      q = q.or(`doctor_name.ilike.%${t}%,purpose.ilike.%${t}%,original_note.ilike.%${t}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows.map(({ mr_profile_id, ...row }) => ({ ...row, is_owner: mr_profile_id === context.profile.id }));
  });

export const getReport = createServerFn({ method: "GET" }).middleware([requireMrProfile])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await db();
    const r = await scoped(s.from("call_reports").select("*").eq("id", data.id), context.profile).single();
    if (r.error) throw new Error("Report not found");
    const e = await s.from("report_edits").select("*").eq("report_id", data.id).order("edited_at", { ascending: false });
    if (e.error) throw e.error;
    return { report: { ...r.data, can_edit: r.data.mr_profile_id === context.profile.id }, edits: e.data ?? [] };
  });

export const createDraftFromNote = createServerFn({ method: "POST" })
  .middleware([requireMrProfile])
  .inputValidator((i: { note: string; clientDraftId: string }) =>
    z
      .object({
        note: z
          .string()
          .max(5000, "Notes must be 5,000 characters or fewer.")
          .refine((note) => note.trim().length >= 10, "Please enter at least 10 characters."),
        clientDraftId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const requestStarted = Date.now();
    try {
      const { logAiTiming, resolveAiLimits, classifyAiError, AiResilienceError } =
        await import("./ai.server");
      const noteSha = await sha256Note(data.note);
      const s = await db();
      const limits = resolveAiLimits(process.env);
      const store = createDraftRequestStore(s, context.profile.id);
      const result = await runIdempotentDraft({
        clientDraftId: data.clientDraftId,
        noteSha,
        staleAfterMs: limits.totalDeadlineMs + 30_000,
        store,
        now: Date.now,
        getErrorKind: (error) =>
          error instanceof AiResilienceError ? error.kind : classifyAiError(error).kind,
        getErrorMessage: (error, kind) => {
          if (error instanceof AiResilienceError) return error.message;
          const safeMessages: Record<string, string> = {
            timeout: "The AI service took too long. Your note is safe; please retry.",
            rate_limited: "The AI service is busy. Please wait a moment and retry.",
            provider_unavailable:
              "The AI service is having trouble. Your note is safe; please retry.",
            auth_or_config: "The AI service is not available right now. Please contact support.",
            bad_request: "The AI could not process this note. Please check it and try again.",
            bad_output: "The AI could not read this note. Please try rephrasing.",
            unknown: "The draft could not be created. Your note is safe; please retry.",
          };
          return (
            safeMessages[kind] ?? "The draft could not be created. Your note is safe; please retry."
          );
        },
        createReport: async () => {
          const masterStarted = Date.now();
          const master = await loadMaster();
          logAiTiming("master-data", {
            durationMs: Date.now() - masterStarted,
            doctors: master.doctors.length,
            products: master.products.length,
          });
          const today = todayIST();
          const promptStarted = Date.now();
          const normalized = normalizePharmaNote(data.note);
          logAiTiming("note-normalized", {
            durationMs: Date.now() - promptStarted,
            noteLength: data.note.length,
          });
          const { extractFromNote } = await import("./ai.server");
          const x = await extractFromNote(
            normalized.normalized,
            master,
            today,
            data.note,
            requestStarted,
          );

          const docIds = new Set(master.doctors.map((d) => d.id));
          const prodIds = new Set(master.products.map((p) => p.id));
          const pob = normalizePob(
            { lines: x.pob },
            data.note,
            safeDate(x.call_date),
            master.products,
            master.schemes,
          );
          const doctorCandidates = filterKnownIds(x.doctor_candidate_ids, docIds);
          const productGroups = x.product_mentions
            .map((m) => ({ mention: m.mention, ids: filterKnownIds(m.candidate_ids, prodIds) }))
            .filter((m) => m.ids.length > 0);
          const doctor =
            doctorCandidates.length === 1
              ? (master.doctors.find((d) => d.id === doctorCandidates[0]) ?? null)
              : null;
          const confirmedProducts = productGroups.flatMap((g) =>
            g.ids.length === 1 && g.ids[0] ? [g.ids[0]] : [],
          );
          const ambiguousProducts = productGroups.filter((g) => g.ids.length > 1);
          const questions = [...x.clarifying_questions];
          if (x.doctor_mention && doctorCandidates.length === 0)
            questions.unshift(
              `"${x.doctor_mention}" is not in the doctor list. Which doctor did you visit?`,
            );
          const unmatchedProducts = x.product_mentions.filter(
            (m) => filterKnownIds(m.candidate_ids, prodIds).length === 0,
          );
          for (const m of unmatchedProducts)
            questions.push(`"${m.mention}" is not a known product. Please pick the right one.`);
          const callDatetime = combineDateTime(x.call_date, x.call_time);
          const dateOnly = safeDate(x.call_date);
          const productNames = confirmedProducts.flatMap((id) => {
            const p = master.products.find((p) => p.id === id);
            return p ? [p.name] : [];
          });
          const unknown = [
            !doctor && "doctor",
            !callDatetime && "call_datetime",
            confirmedProducts.length === 0 && "products",
            !x.purpose && "purpose",
            !x.feedback && "feedback",
            !x.materials_requested && "materials_requested",
            !x.follow_up_action && "follow_up_action",
            !safeDate(x.follow_up_due) && "follow_up_due",
          ].filter(Boolean) as string[];
          const insert = await idempotencyTables(s)
            .from("call_reports")
            .insert({
              organization_id: context.profile.organization_id,
              mr_profile_id: context.profile.id,
              client_draft_id: data.clientDraftId,
              updated_by: context.userId,
              rep_name: context.profile.full_name,
              original_note: data.note,
              intelligence: normalizeIntelligence(x, data.note, prodIds),
              ai_intelligence: normalizeIntelligence(x, data.note, prodIds),
              effectiveness: normalizeEffectiveness(x, data.note, prodIds),
              ai_effectiveness: normalizeEffectiveness(x, data.note, prodIds),
              pob,
              ai_pob: pob,
              extraction_schema_version: EXTRACTION_SCHEMA_VERSION,
              normalized_note: normalized.normalized,
              glossary_version: normalized.version,
              original_doctor_mention: x.doctor_mention,
              call_datetime: callDatetime,
              call_date_only: dateOnly,
              doctor_id: doctor?.id ?? null,
              doctor_name: doctor?.name ?? null,
              specialty: doctor?.specialty ?? null,
              clinic: doctor?.clinic ?? null,
              product_ids: confirmedProducts,
              product_names: productNames,
              purpose: x.purpose,
              feedback: x.feedback,
              materials_requested: x.materials_requested,
              follow_up_action: x.follow_up_action,
              follow_up_due: safeDate(x.follow_up_due),
              ai_unknown_fields: unknown,
              ai_doctor_choices: doctorCandidates.length > 1 ? doctorCandidates : [],
              ai_product_choices: ambiguousProducts,
              ai_questions: unresolvedQuestions(
                Array.from(new Set(questions)),
                doctor?.id ?? null,
                !!dateOnly,
              ).slice(0, 6),
              status: "draft",
            })
            .select("id")
            .single();
          if (insert.error) {
            const error = insert.error;
            if (
              error.code === "23505" &&
              error.message?.includes("call_reports_mr_profile_client_draft_id_uidx")
            ) {
              const existingReport = await store.findReport(data.clientDraftId);
              if (existingReport) return { reportId: existingReport, reused: true };
            }
            throw insert.error;
          }
          if (!insert.data) throw new Error("Draft report insert returned no row.");
          return { reportId: insert.data.id };
        },
      });
      logAiTiming("request-complete", {
        durationMs: Date.now() - requestStarted,
        result: result.status,
      });
      if (result.status === "done")
        return { status: "done" as const, id: result.reportId, reused: result.reused };
      if (result.status === "in_progress") return result;
      if (result.status === "error") {
        return {
          status: "error" as const,
          error: {
            kind: result.kind,
            message: "This retry key belongs to a different note. Please submit again.",
          },
        };
      }
      return { status: "error" as const, error: { kind: result.kind, message: result.message } };
    } catch {
      const { logAiTiming } = await import("./ai.server");
      logAiTiming("request-complete", {
        durationMs: Date.now() - requestStarted,
        result: "failure",
      });
      return {
        status: "error" as const,
        error: {
          kind: "unknown",
          message: "The draft could not be created. Your note is safe; please retry.",
        },
      };
    }
  });

const updateInput = z.object({
  id: z.string().uuid(),
  fields: z.object({
    call_datetime: z.string().nullable(),
    call_date_only: z.string().nullable(),
    doctor_id: z.string().nullable(),
    product_ids: z.array(z.string()),
    purpose: z.string().nullable(),
    feedback: z.string().nullable(),
    materials_requested: z.string().nullable(),
    follow_up_action: z.string().nullable(),
    follow_up_due: z.string().nullable(),
  }),
  approve: z.boolean().optional(),
  intelligence: intelligenceSchema.optional(),
  effectiveness: effectivenessSchema.optional(),
  pob: pobSchema.optional(),
  expectedUpdatedAt: z.string().optional(),
});

function norm(v: unknown) {
  if (v == null || v === "") return null;
  if (typeof v === "object") return JSON.stringify(v);
  if (Array.isArray(v)) return [...v].sort().join(", ") || null;
  return String(v);
}

export const saveReport = createServerFn({ method: "POST" }).middleware([requireMrProfile])
  .inputValidator((i: z.infer<typeof updateInput>) => updateInput.parse(i))
  .handler(async ({ data, context }) => {
    const s = await db();
    const master = await loadMaster();
    const { data: current, error } = await scopedOwn(
      s.from("call_reports").select("*").eq("id", data.id),
      context.profile,
    ).single();
    if (error || !current) throw new Error("Report not found");
    if (current.status === "approved") throw new Error("Approved reports are locked.");
    if (data.expectedUpdatedAt && data.expectedUpdatedAt !== current.updated_at) throw new Error("Report changed. Reload before saving.");
    const intelligence = data.intelligence ?? readIntelligence(current.intelligence);
    validateIntelligence(intelligence, new Set(master.products.map((p) => p.id)));
    const effectiveness = data.effectiveness ?? readEffectiveness(current.effectiveness);
    validateEffectiveness(effectiveness, new Set(master.products.map((p) => p.id)));

    const f = { ...data.fields };
    const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
    f.purpose = clean(f.purpose);
    f.feedback = clean(f.feedback);
    f.materials_requested = clean(f.materials_requested);
    f.follow_up_action = clean(f.follow_up_action);
    f.follow_up_due = safeDate(f.follow_up_due);
    if (f.call_date_only && !safeDate(f.call_date_only)) throw new Error("Invalid call date");
    if (f.call_datetime && !dateFromCallDatetime(f.call_datetime)) throw new Error("Invalid call date or time");
    const datetimeDate = dateFromCallDatetime(f.call_datetime);
    if (datetimeDate && f.call_date_only && datetimeDate !== f.call_date_only) throw new Error("Call date and time disagree");
    f.call_date_only = safeDate(f.call_date_only) ?? datetimeDate;

    const doctor = f.doctor_id ? master.doctors.find((d) => d.id === f.doctor_id) : null;
    if (f.doctor_id && !doctor) throw new Error("Unknown doctor");
    const prodSet = new Set(master.products.map((p) => p.id));
    if (f.product_ids.some((id) => !prodSet.has(id))) throw new Error("Unknown product");
    const requestedPob = restoreAiStatedPrices(
      data.pob ?? readPob(Reflect.get(current, "pob")),
      Reflect.get(current, "ai_pob"),
    );
    const pob = normalizePob(
      requestedPob,
      current.original_note,
      safeDate(f.call_date_only) ?? dateFromCallDatetime(f.call_datetime),
      master.products,
      master.schemes,
    );

    const edits: { report_id: string; field: string; old_value: string | null; new_value: string | null }[] = [];
    for (const k of EDITABLE_FIELDS) {
      const previous = k === "pob" ? Reflect.get(current, "pob") : current[k as keyof typeof current];
      const before = k === "call_datetime" && previous ? new Date(String(previous)).toISOString() : previous;
      const fieldValue = k === "pob" ? pob : f[k as keyof typeof f];
      const after = k === "call_datetime" && fieldValue ? new Date(String(fieldValue)).toISOString() : fieldValue;
      if (norm(before) !== norm(after)) edits.push({ report_id: data.id, field: k, old_value: norm(before), new_value: norm(after) });
    }

    if (data.approve) {
      const missing = missingRequired(f);
      if (missing.length) throw new Error(`Please fill: ${missing.join(", ")}`);
    }

    const now = new Date().toISOString();
    const { error: upErr } = await scopedOwn(
      pobReportUpdate(s.from("call_reports"), {
          ...f,
          intelligence,
          effectiveness,
          pob,
          ai_questions: unresolvedQuestions(current.ai_questions, f.doctor_id, !!f.call_date_only),
          doctor_name: doctor?.name ?? null,
          specialty: doctor?.specialty ?? null,
          clinic: doctor?.clinic ?? null,
          product_names: f.product_ids.flatMap((id) => { const p = master.products.find((p) => p.id === id); return p ? [p.name] : []; }),
          updated_at: now,
          updated_by: context.userId,
          ...(data.approve ? { status: "approved", approved_at: now } : {}),
        })
        .eq("id", data.id)
        .eq("status", "draft")
        .eq("updated_at", current.updated_at),
      context.profile,
    )
      .select("id")
      .single();
    if (upErr) throw new Error("Report changed or was locked. Reload before saving.");
    return { ok: true, edits: edits.length };
  });

export const deleteDraft = createServerFn({ method: "POST" }).middleware([requireMrProfile])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await db();
    const { error } = await scopedOwn(
      softDeleteReportQuery(s.from("call_reports"), {
        deleted_at: new Date().toISOString(),
        deleted_by: context.userId,
        updated_by: context.userId,
      }).eq("id", data.id).eq("status", "draft"),
      context.profile,
    ).select("id").single();
    if (error) throw error;
    return { ok: true };
  });

export const listFollowUps = createServerFn({ method: "GET" }).middleware([requireMrProfile]).handler(async ({ context }) => {
  const s = await db();
  const { data, error } = await scoped(
    s.from("call_reports")
      .select("id,doctor_name,follow_up_action,follow_up_due,follow_up_done,product_names,rep_name,mr_profile_id")
      .eq("status", "approved")
      .not("follow_up_action", "is", null)
      .order("follow_up_due", { ascending: true, nullsFirst: false }),
    context.profile,
  );
  if (error) throw error;
  return data.map(({ mr_profile_id, ...row }) => ({ ...row, is_owner: mr_profile_id === context.profile.id }));
});

export const setFollowUpDone = createServerFn({ method: "POST" }).middleware([requireMrProfile])
  .inputValidator((i: { id: string; done: boolean }) => z.object({ id: z.string().uuid(), done: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await db();
    const { error } = await scopedOwn(
      s.from("call_reports")
        .update({ follow_up_done: data.done, updated_by: context.userId })
        .eq("id", data.id)
        .eq("status", "approved")
        .not("follow_up_action", "is", null),
      context.profile,
    )
      .select("id")
      .single();
    if (error) throw new Error("Approved follow-up not found or update failed.");
    return { ok: true };
  });

export const exportApprovedCsv = createServerFn({ method: "GET" }).middleware([requireMrProfile]).handler(async ({ context }) => {
  const s = await db();
  const { data, error } = await scoped(
    s.from("call_reports").select("*").eq("status", "approved").order("created_at", { ascending: false }),
    context.profile,
  );
  if (error) throw error;
  // Ordered by call date in code: SQL DESC puts NULL call_datetime (time unknown) first.
  return toExportCsv(data as Record<string, unknown>[]);
});
