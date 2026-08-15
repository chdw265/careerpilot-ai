import { createClient } from "npm:@supabase/supabase-js@2";

// ApplyStronger — Workday registered-employer collector pilot V1.0
//
// Safety model:
//   * This function performs no work unless applystronger_collector_enabled('workday') is true.
//   * The pilot migration installs Workday with automation_enabled=false and pending_review.
//   * No cron schedule is included in this package.
//   * One employer is claimed per worker by default because Workday boards can contain thousands of jobs.
//
// Cost/write model:
//   * The public Workday CXS listing endpoint is paged in batches.
//   * Every current listing is fingerprinted from lightweight source fields.
//   * Unchanged jobs do not rewrite descriptions/search documents; only last_seen_at is touched.
//   * New jobs are immediately searchable even if detail enrichment is deferred.
//   * Detail calls are capped per run, so large first-time boards cannot monopolize an Edge invocation.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS") || "";

let SUPABASE_SERVER_KEY = legacyServiceRoleKey;
if (!SUPABASE_SERVER_KEY && secretKeysJson) {
  try {
    const secretKeys = JSON.parse(secretKeysJson);
    SUPABASE_SERVER_KEY = String(secretKeys.default || "");
  } catch {
    console.error("Could not parse SUPABASE_SECRET_KEYS.");
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-careerpilot-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_SIZE = 20;
const MAX_BOARD_JOBS = 10_000;
const DEFAULT_DETAIL_LIMIT = 400;
const DETAIL_CONCURRENCY = 8;

type EmployerRecord = {
  id: string;
  name: string;
  industry: string | null;
  ats_identifier: string;
};

type QueuedEmployerRecord = EmployerRecord & {
  queue_id: number;
  run_id: string;
  attempt_count: number;
};

type WorkdayIdentifier = {
  host: string;
  tenant: string;
  site: string;
};

type WorkdayListJob = {
  title?: string | null;
  externalPath?: string | null;
  locationsText?: string | null;
  postedOn?: string | null;
  bulletFields?: string[] | null;
};

type WorkdayDetail = {
  title?: string | null;
  jobReqId?: string | null;
  postedOn?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timeType?: string | null;
  remoteType?: string | null;
  location?: string | null;
  additionalLocations?: string[] | null;
  jobDescription?: string | null;
  externalUrl?: string | null;
};

type ExistingJob = {
  id: string;
  external_job_id: string;
  source_content_hash: string | null;
  description: string | null;
};

type PreparedListing = {
  list: WorkdayListJob;
  externalPath: string;
  externalJobId: string;
  fingerprint: string;
  existing: ExistingJob | null;
  needsDetail: boolean;
};

type EmployerSyncResult = {
  employer_id: string;
  employer: string;
  success: boolean;
  reported_total: number;
  fetched: number;
  saved: number;
  unchanged: number;
  detail_enriched: number;
  detail_deferred: number;
  retired: number;
  skipped: number;
  error?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

function cleanString(value: unknown, maxLength = 20_000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 4_000);
  try {
    return JSON.stringify(error).slice(0, 4_000);
  } catch {
    return String(error).slice(0, 4_000);
  }
}

function validHttpUrl(value: unknown): string | null {
  const cleaned = cleanString(value, 2_000);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function safeIsoDate(value: unknown): string | null {
  const cleaned = cleanString(value, 200);
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseRelativePostedOn(value: unknown, now: Date): string | null {
  const cleaned = cleanString(value, 100)?.toLowerCase();
  if (!cleaned) return null;
  if (cleaned.includes("today")) return now.toISOString();
  if (cleaned.includes("yesterday")) return new Date(now.getTime() - 86_400_000).toISOString();
  const match = cleaned.match(/(\d+)\s+day/);
  if (match) return new Date(now.getTime() - Number(match[1]) * 86_400_000).toISOString();
  return safeIsoDate(value);
}

function parseIdentifier(value: string): WorkdayIdentifier {
  const [hostRaw, tenantRaw, siteRaw, ...extra] = value.split("|");
  const host = String(hostRaw || "").trim().toLowerCase();
  const tenant = String(tenantRaw || "").trim();
  const site = String(siteRaw || "").trim();
  if (extra.length || !host || !tenant || !site) throw new Error(`Invalid Workday ATS identifier: ${value}`);
  if (!host.endsWith(".myworkdayjobs.com") || !/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid Workday host: ${host}`);
  if (!/^[a-z0-9_-]+$/i.test(tenant) || !/^[a-z0-9_-]+$/i.test(site)) throw new Error("Invalid Workday tenant or site token.");
  return { host, tenant, site };
}

function apiBase(identifier: WorkdayIdentifier) {
  return `https://${identifier.host}/wday/cxs/${encodeURIComponent(identifier.tenant)}/${encodeURIComponent(identifier.site)}`;
}

function publicJobUrl(identifier: WorkdayIdentifier, externalPath: string) {
  return `https://${identifier.host}/en-US/${encodeURIComponent(identifier.site)}${externalPath}`;
}

function workdayHeaders(identifier: WorkdayIdentifier) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: `https://${identifier.host}`,
    Referer: `https://${identifier.host}/en-US/${identifier.site}`,
    "User-Agent": "ApplyStronger-Workday-Collector/1.0",
  };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWorkdayPage(identifier: WorkdayIdentifier, offset: number) {
  const response = await fetchWithTimeout(`${apiBase(identifier)}/jobs`, {
    method: "POST",
    headers: workdayHeaders(identifier),
    body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: "" }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Workday list returned HTTP ${response.status}: ${text.slice(0, 800)}`);
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.jobPostings)) throw new Error("Workday list payload has no jobPostings array.");
  return { total: Number(payload.total ?? payload.jobPostings.length), jobs: payload.jobPostings as WorkdayListJob[] };
}

async function fetchAllWorkdayListings(identifier: WorkdayIdentifier) {
  const jobs: WorkdayListJob[] = [];
  let reportedTotal = 0;
  for (let offset = 0; offset < MAX_BOARD_JOBS; offset += PAGE_SIZE) {
    const page = await fetchWorkdayPage(identifier, offset);
    if (offset === 0) {
      reportedTotal = page.total;
      if (!Number.isFinite(reportedTotal) || reportedTotal < 0) throw new Error("Workday returned an invalid total.");
      if (reportedTotal > MAX_BOARD_JOBS) throw new Error(`Workday board reports ${reportedTotal} jobs, above the ${MAX_BOARD_JOBS} safety ceiling.`);
    }
    jobs.push(...page.jobs);
    if (!page.jobs.length || jobs.length >= reportedTotal) break;
  }
  return { reportedTotal, jobs };
}

async function fetchWorkdayDetail(identifier: WorkdayIdentifier, externalPath: string): Promise<WorkdayDetail> {
  const response = await fetchWithTimeout(`${apiBase(identifier)}${externalPath}`, {
    method: "GET",
    headers: workdayHeaders(identifier),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Workday detail returned HTTP ${response.status}: ${text.slice(0, 800)}`);
  const payload = JSON.parse(text);
  if (!payload?.jobPostingInfo || typeof payload.jobPostingInfo !== "object") throw new Error("Workday detail payload has no jobPostingInfo object.");
  return payload.jobPostingInfo as WorkdayDetail;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprintListJob(job: WorkdayListJob): Promise<string> {
  return await sha256(JSON.stringify({
    title: cleanString(job.title, 500),
    externalPath: cleanString(job.externalPath, 2_000),
    locationsText: cleanString(job.locationsText, 700),
    postedOn: cleanString(job.postedOn, 100),
    bulletFields: Array.isArray(job.bulletFields) ? job.bulletFields.map((v) => cleanString(v, 500)) : [],
  }));
}

function normalizedEmploymentType(value: unknown): string | null {
  const raw = cleanString(value, 120);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("full") && lower.includes("time")) return "full_time";
  if (lower.includes("part") && lower.includes("time")) return "part_time";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("temporary") || lower.includes("temp")) return "temporary";
  if (lower.includes("intern")) return "internship";
  if (lower.includes("per diem") || lower.includes("prn")) return "per_diem";
  return raw;
}

function inferWorkSetting(remoteType: unknown, ...texts: unknown[]): string {
  const explicit = cleanString(remoteType, 100)?.toLowerCase() || "";
  if (explicit.includes("hybrid")) return "hybrid";
  if (explicit.includes("remote")) return "remote";
  if (explicit.includes("onsite") || explicit.includes("on-site")) return "onsite";
  const text = texts.map((value) => cleanString(value, 5_000)).filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b/.test(text) || text.includes("work from home")) return "remote";
  return text ? "onsite" : "unclear";
}

function externalPathFrom(job: WorkdayListJob): string | null {
  const path = cleanString(job.externalPath, 2_000);
  return path && path.startsWith("/job/") ? path : null;
}

function externalJobId(identifier: WorkdayIdentifier, externalPath: string) {
  return `${identifier.tenant}:${identifier.site}:${externalPath}`;
}

function reqIdFromPath(externalPath: string): string | null {
  const last = externalPath.split("/").filter(Boolean).pop() || "";
  const match = last.match(/_([^_]+)$/);
  return cleanString(match?.[1] || null, 300);
}

function buildLightweightRecord(
  sourceId: string,
  employer: EmployerRecord,
  identifier: WorkdayIdentifier,
  prepared: PreparedListing,
  now: string,
) {
  const title = cleanString(prepared.list.title, 500);
  if (!title) return null;
  const url = publicJobUrl(identifier, prepared.externalPath);
  const postedAt = parseRelativePostedOn(prepared.list.postedOn, new Date(now));
  const location = cleanString(prepared.list.locationsText, 700);
  return {
    source_id: sourceId,
    employer_id: employer.id,
    external_job_id: prepared.externalJobId,
    source_content_hash: prepared.fingerprint,
    title,
    company_name: employer.name,
    description: null,
    requirements: null,
    industry: employer.industry,
    location_text: location,
    work_setting: inferWorkSetting(null, location, title),
    employment_type: null,
    posted_at: postedAt,
    employer_posted_at: postedAt,
    source_url: url,
    apply_url: url,
    source_name: "Workday",
    ats_provider: "workday",
    ats_job_id: reqIdFromPath(prepared.externalPath),
    direct_apply_url: url,
    direct_apply_verified: true,
    direct_apply_verified_at: now,
    direct_apply_verification_method: "workday_public_cxs_listing_v1",
    direct_apply_verification_note: `Official employer Workday job page discovered through the public CXS listing endpoint. Tenant: ${identifier.