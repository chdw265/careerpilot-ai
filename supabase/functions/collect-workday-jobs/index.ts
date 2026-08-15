import { createClient } from "npm:@supabase/supabase-js@2";
import { syncEmployer, type QueuedEmployer } from "./workday.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let SERVER_KEY = legacyKey;
if (!SERVER_KEY && secretKeysJson) {
  try { SERVER_KEY = String(JSON.parse(secretKeysJson).default || ""); } catch { /* handled below */ }
}

const supabase = createClient(SUPABASE_URL, SERVER_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-careerpilot-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS });
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4000);
}

function int(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(Math.trunc(parsed), max)) : fallback;
}

async function enabled() {
  const { data, error } = await supabase.rpc("applystronger_collector_enabled", { p_provider: "workday" });
  if (error) throw new Error(`Could not read Workday collector gate: ${message(error)}`);
  return data === true;
}

async function finish(queueId: number, success: boolean, error: string | null, stats: Record<string, number>) {
  const { error: finishError } = await supabase.rpc("applystronger_finish_workday_queue", {
    p_queue_id: queueId,
    p_success: success,
    p_error: error,
    p_jobs_fetched: stats.fetched || 0,
    p_jobs_saved: stats.saved || 0,
    p_jobs_retired: stats.retired || 0,
    p_jobs_skipped: stats.skipped || 0,
  });
  if (finishError) console.error("Could not checkpoint Workday queue item:", finishError);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ success: false, provider: "Workday", error: "Method not allowed." }, 405);

  const expected = Deno.env.get("CAREERPILOT_ROUTE_WORKER_SECRET") || "";
  const supplied = request.headers.get("x-careerpilot-worker-secret") || "";
  if (!expected || supplied !== expected) return json({ success: false, provider: "Workday", error: "Unauthorized collector request." }, 401);

  try {
    if (!SUPABASE_URL || !SERVER_KEY) throw new Error("Supabase server configuration is missing.");
    if (!(await enabled())) {
      return json({
        success: false,
        provider: "Workday",
        disabled: true,
        error: "Workday production collection is disabled by policy. No jobs were read or written.",
      }, 409);
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch { /* empty scheduled body is valid */ }

    const action = String(body.action || "work").trim().toLowerCase();
    if (action === "enqueue") {
      const limit = int(body.limit, 5, 1, 100);
      const { data, error } = await supabase.rpc("applystronger_enqueue_workday_run", { p_limit: limit });
      if (error) throw new Error(`Could not enqueue Workday run: ${message(error)}`);
      return json({ success: true, provider: "Workday", action, result: data });
    }
    if (action !== "work") return json({ success: false, provider: "Workday", error: "Unsupported action. Use enqueue or work." }, 400);

    const workerId = `workday-${crypto.randomUUID()}`;
    const claimLimit = int(body.limit, 1, 1, 2);
    const detailLimit = int(body.detail_limit, 400, 0, 1000);
    const { data, error } = await supabase.rpc("applystronger_claim_workday_queue", {
      p_worker_id: workerId,
      p_limit: claimLimit,
    });
    if (error) throw new Error(`Could not claim Workday queue: ${message(error)}`);

    const claimed = (Array.isArray(data) ? data : []) as QueuedEmployer[];
    if (!claimed.length) return json({ success: true, provider: "Workday", action, claimed: 0, message: "No Workday employers are currently due." });

    const results = [];
    for (const employer of claimed) {
      try {
        const result = await syncEmployer(supabase, employer, detailLimit);
        results.push(result);
        await finish(Number(employer.queue_id), true, null, result);
      } catch (error) {
        const err = message(error);
        const result = { employer_id: employer.employer_id, employer: employer.employer_name, success: false, fetched: 0, saved: 0, retired: 0, skipped: 0, error: err };
        results.push(result);
        await finish(Number(employer.queue_id), false, err, result);
      }
    }

    return json({
      success: results.every((result) => result.success),
      provider: "Workday",
      action,
      claimed: claimed.length,
      detail_limit_per_employer: detailLimit,
      results,
    });
  } catch (error) {
    console.error("ApplyStronger Workday collector failed:", error);
    return json({ success: false, provider: "Workday", error: message(error) }, 500);
  }
});
