export type QueuedEmployer = {
  queue_id: number | string;
  run_id: string;
  employer_id: string;
  employer_name: string;
  industry: string | null;
  ats_identifier: string;
  attempt_count: number;
};

type WD = { host: string; tenant: string; site: string };
type ListJob = { title?: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };
type Detail = { title?: string; jobReqId?: string; postedOn?: string; startDate?: string; endDate?: string; timeType?: string; remoteType?: string; location?: string; additionalLocations?: string[]; jobDescription?: string; externalUrl?: string };
type Existing = { id: string; external_job_id: string; source_content_hash: string | null; description: string | null };
type Prepared = { list: ListJob; path: string; externalId: string; hash: string; existing: Existing | null; needsDetail: boolean };

const PAGE = 20;
const MAX = 10_000;
const CONCURRENCY = 8;

function clean(value: unknown, max = 20_000): string | null {
  if (typeof value !== "string") return null;
  const out = value.replace(/\s+/g, " ").trim();
  return out ? out.slice(0, max) : null;
}
function err(error: unknown) { return error instanceof Error ? error.message : String(error); }
function parseId(value: string): WD {
  const parts = value.split("|").map((v) => v.trim());
  if (parts.length !== 3) throw new Error(`Invalid Workday ATS identifier: ${value}`);
  const [host, tenant, site] = parts;
  if (!host.endsWith(".myworkdayjobs.com") || !/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid Workday host: ${host}`);
  if (!/^[a-z0-9_-]+$/i.test(tenant) || !/^[a-z0-9_-]+$/i.test(site)) throw new Error("Invalid Workday tenant/site token.");
  return { host: host.toLowerCase(), tenant, site };
}
function base(wd: WD) { return `https://${wd.host}/wday/cxs/${encodeURIComponent(wd.tenant)}/${encodeURIComponent(wd.site)}`; }
function pageUrl(wd: WD, path: string) { return `https://${wd.host}/en-US/${encodeURIComponent(wd.site)}${path}`; }
function headers(wd: WD) {
  return { Accept: "application/json", "Content-Type": "application/json", Origin: `https://${wd.host}`, Referer: `https://${wd.host}/en-US/${wd.site}`, "User-Agent": "ApplyStronger-Workday-Collector/1.0" };
}
async function request(url: string, init: RequestInit, timeout = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function listPage(wd: WD, offset: number) {
  const response = await request(`${base(wd)}/jobs`, { method: "POST", headers: headers(wd), body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText: "" }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Workday list HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  if (!Array.isArray(payload?.jobPostings)) throw new Error("Workday list payload has no jobPostings array.");
  return { total: Number(payload.total ?? payload.jobPostings.length), jobs: payload.jobPostings as ListJob[] };
}
async function allListings(wd: WD) {
  const jobs: ListJob[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const result = await listPage(wd, offset);
    if (offset === 0) {
      total = result.total;
      if (!Number.isFinite(total) || total < 0 || total > MAX) throw new Error(`Invalid/safety-capped Workday total: ${total}`);
    }
    jobs.push(...result.jobs);
    if (!result.jobs.length || jobs.length >= total) break;
  }
  return { total, jobs };
}
async function detail(wd: WD, path: string): Promise<Detail> {
  const response = await request(`${base(wd)}${path}`, { method: "GET", headers: headers(wd) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Workday detail HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  if (!payload?.jobPostingInfo) throw new Error("Workday detail payload has no jobPostingInfo.");
  return payload.jobPostingInfo as Detail;
}
async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function fingerprint(job: ListJob) {
  return await hash({ title: clean(job.title, 500), path: clean(job.externalPath, 2000), location: clean(job.locationsText, 700), posted: clean(job.postedOn, 100), bullets: Array.isArray(job.bulletFields) ? job.bulletFields : [] });
}
function iso(value: unknown) {
  const text = clean(value, 100); if (!text) return null;
  const date = new Date(text); return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function posted(value: unknown, now: Date) {
  const text = clean(value, 100)?.toLowerCase(); if (!text) return null;
  if (text.includes("today")) return now.toISOString();
  if (text.includes("yesterday")) return new Date(now.getTime() - 86400000).toISOString();
  const match = text.match(/(\d+)\s+day/); if (match) return new Date(now.getTime() - Number(match[1]) * 86400000).toISOString();
  return iso(value);
}
function employment(value: unknown) {
  const text = clean(value, 100); if (!text) return null; const low = text.toLowerCase();
  if (low.includes("full") && low.includes("time")) return "full_time";
  if (low.includes("part") && low.includes("time")) return "part_time";
  if (low.includes("contract")) return "contract";
  if (low.includes("intern")) return "internship";
  if (low.includes("temporary") || low.includes("temp")) return "temporary";
  if (low.includes("prn") || low.includes("per diem")) return "per_diem";
  return text;
}
function setting(remote: unknown, ...values: unknown[]) {
  const explicit = clean(remote, 100)?.toLowerCase() || "";
  if (explicit.includes("hybrid")) return "hybrid";
  if (explicit.includes("remote")) return "remote";
  if (explicit.includes("onsite") || explicit.includes("on-site")) return "onsite";
  const text = values.map((v) => clean(v, 5000)).filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b/.test(text) || text.includes("work from home")) return "remote";
  return text ? "onsite" : "unclear";
}
function reqFromPath(path: string) { const last = path.split("/").filter(Boolean).pop() || ""; return clean(last.match(/_([^_]+)$/)?.[1], 300); }
function externalId(wd: WD, path: string) { return `${wd.tenant}:${wd.site}:${path}`; }

async function existingJobs(db: any, sourceId: string, employerId: string) {
  const rows: Existing[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("jobs").select("id,external_job_id,source_content_hash,description").eq("source_id", sourceId).eq("employer_id", employerId).range(from, from + 999);
    if (error) throw new Error(`Could not read existing Workday jobs: ${err(error)}`);
    const batch = (data || []) as Existing[]; rows.push(...batch); if (batch.length < 1000) break;
  }
  return rows;
}
async function sourceId(db: any) {
  const { data, error } = await db.from("job_sources").select("id").eq("name", "Workday").single();
  if (error || !data?.id) throw new Error(`Workday job source is not installed: ${err(error)}`);
  return String(data.id);
}
function lightRecord(source: string, employer: QueuedEmployer, wd: WD, item: Prepared, now: string) {
  const title = clean(item.list.title, 500); if (!title) return null;
  const url = pageUrl(wd, item.path); const when = posted(item.list.postedOn, new Date(now)); const location = clean(item.list.locationsText, 700);
  return { source_id: source, employer_id: employer.employer_id, external_job_id: item.externalId, source_content_hash: item.hash, title, company_name: employer.employer_name, description: null, industry: employer.industry, location_text: location, work_setting: setting(null, location, title), posted_at: when, employer_posted_at: when, source_url: url, apply_url: url, source_name: "Workday", ats_provider: "workday", ats_job_id: reqFromPath(item.path), direct_apply_url: url, direct_apply_verified: true, direct_apply_verified_at: now, direct_apply_verification_method: "workday_public_cxs_listing_v1", application_metadata: { workday: { host: wd.host, tenant: wd.tenant, site: wd.site, external_path: item.path, detail_enriched: false } }, is_active: true, last_seen_at: now, updated_at: now };
}
function fullRecord(source: string, employer: QueuedEmployer, wd: WD, item: Prepared, info: Detail, now: string) {
  const light = lightRecord(source, employer, wd, item, now); if (!light) return null;
  const location = clean(info.location, 700) || light.location_text; const url = pageUrl(wd, item.path);
  return { ...light, title: clean(info.title, 500) || light.title, description: clean(info.jobDescription, 100000), location_text: location, work_setting: setting(info.remoteType, location, info.jobDescription), employment_type: employment(info.timeType), posted_at: iso(info.startDate) || posted(info.postedOn, new Date(now)) || light.posted_at, employer_posted_at: iso(info.startDate) || light.employer_posted_at, expires_at: iso(info.endDate), ats_job_id: clean(info.jobReqId, 300) || light.ats_job_id, apply_url: url, direct_apply_url: url, application_metadata: { workday: { host: wd.host, tenant: wd.tenant, site: wd.site, external_path: item.path, additional_locations: Array.isArray(info.additionalLocations) ? info.additionalLocations : [], detail_enriched: true } } };
}
async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  async function run() { while (true) { const index = next++; if (index >= items.length) return; await worker(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => run()));
}
async function upsertChunks(db: any, records: any[]) {
  let saved = 0;
  for (let i = 0; i < records.length; i += 250) {
    const chunk = records.slice(i, i + 250); const { error } = await db.from("jobs").upsert(chunk, { onConflict: "source_id,external_job_id" });
    if (error) throw new Error(`Could not upsert Workday jobs: ${err(error)}`); saved += chunk.length;
  }
  return saved;
}

export async function syncEmployer(db: any, employer: QueuedEmployer, detailLimit = 400) {
  const wd = parseId(employer.ats_identifier); const source = await sourceId(db); const now = new Date().toISOString();
  const current = await allListings(wd); const old = await existingJobs(db, source, employer.employer_id); const oldMap = new Map(old.map((job) => [job.external_job_id, job]));
  const prepared: Prepared[] = []; let skipped = 0;
  for (const job of current.jobs) {
    const path = clean(job.externalPath, 2000); if (!path?.startsWith("/job/") || !clean(job.title, 500)) { skipped++; continue; }
    const id = externalId(wd, path); const existing = oldMap.get(id) || null; const fp = await fingerprint(job);
    prepared.push({ list: job, path, externalId: id, hash: fp, existing, needsDetail: !existing || existing.source_content_hash !== fp || !existing.description });
  }
  const detailTargets = prepared.filter((item) => item.needsDetail).slice(0, Math.max(0, detailLimit)); const detailMap = new Map<string, Detail>();
  await pool(detailTargets, async (item) => { try { detailMap.set(item.externalId, await detail(wd, item.path)); } catch (error) { console.warn(`Workday detail skipped for ${item.externalId}:`, err(error)); } });

  const records: any[] = []; const unchangedIds: string[] = []; let enriched = 0; let deferred = 0;
  for (const item of prepared) {
    const info = detailMap.get(item.externalId); const record = info ? fullRecord(source, employer, wd, item, info, now) : (!item.existing ? lightRecord(source, employer, wd, item, now) : null);
    if (record) { records.push(record); if (info) enriched++; else if (item.needsDetail) deferred++; }
    else if (item.existing) { unchangedIds.push(item.existing.id); if (item.needsDetail) deferred++; }
  }
  const saved = await upsertChunks(db, records);
  for (let i = 0; i < unchangedIds.length; i += 500) {
    const { error } = await db.from("jobs").update({ last_seen_at: now }).in("id", unchangedIds.slice(i, i + 500));
    if (error) throw new Error(`Could not refresh Workday last_seen_at: ${err(error)}`);
  }
  const currentIds = new Set(prepared.map((item) => item.externalId)); const retire = old.filter((job) => !currentIds.has(job.external_job_id)).map((job) => job.id);
  for (let i = 0; i < retire.length; i += 500) {
    const { error } = await db.from("jobs").update({ is_active: false, updated_at: now }).in("id", retire.slice(i, i + 500));
    if (error) throw new Error(`Could not retire missing Workday jobs: ${err(error)}`);
  }
  const { error: employerError } = await db.from("employers").update({ last_sync_at: now, last_sync_status: "success", last_sync_error: null, last_job_count: prepared.length, updated_at: now }).eq("id", employer.employer_id);
  if (employerError) throw new Error(`Could not update Workday employer state: ${err(employerError)}`);
  return { employer_id: employer.employer_id, employer: employer.employer_name, success: true, reported_total: current.total, fetched: prepared.length, saved, unchanged: unchangedIds.length, detail_enriched: enriched, detail_deferred: deferred, retired: retire.length, skipped };
}
