import fs from 'node:fs';

const EMPLOYERS = [
  { key: 'cardinal-health', name: 'Cardinal Health', host: 'cardinalhealth.wd1.myworkdayjobs.com', tenant: 'cardinalhealth', site: 'EXT' },
  { key: 'adventhealth', name: 'AdventHealth', host: 'adventhealth.wd12.myworkdayjobs.com', tenant: 'adventhealth', site: 'AH_External_Career_Site' },
  { key: 'davita-kidney-care', name: 'DaVita Kidney Care', host: 'davita.wd1.myworkdayjobs.com', tenant: 'davita', site: 'DKC_External' },
  { key: 'elevance-health', name: 'Elevance Health', host: 'elevancehealth.wd1.myworkdayjobs.com', tenant: 'elevancehealth', site: 'ANT' },
  { key: 'johnson-johnson', name: 'Johnson & Johnson', host: 'jj.wd5.myworkdayjobs.com', tenant: 'jj', site: 'JJ' },
];

// This is intentionally a bounded read-only canary. Workday reports the full
// board total in the first response; we sample three pages plus three details
// to validate pagination/detail contracts without crawling the entire board.
const PAGE_SIZE = 20;
const SAMPLE_PAGES = 3;
const DETAIL_SAMPLE_SIZE = 3;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function headersFor(employer) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: `https://${employer.host}`,
    Referer: `https://${employer.host}/en-US/${employer.site}`,
    'User-Agent': 'ApplyStronger-Workday-Pilot-Benchmark/1.0',
  };
}

function apiBase(employer) {
  return `https://${employer.host}/wday/cxs/${encodeURIComponent(employer.tenant)}/${encodeURIComponent(employer.site)}`;
}

async function fetchPage(employer, offset) {
  const response = await fetchWithTimeout(`${apiBase(employer)}/jobs`, {
    method: 'POST',
    headers: headersFor(employer),
    body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from Workday jobs endpoint: ${text.slice(0, 500)}`);
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Workday jobs endpoint returned non-JSON content: ${text.slice(0, 500)}`); }
  if (!payload || !Array.isArray(payload.jobPostings)) throw new Error('Workday jobs endpoint returned no jobPostings array.');
  return payload;
}

async function fetchDetail(employer, externalPath) {
  if (typeof externalPath !== 'string' || !externalPath.startsWith('/job/')) throw new Error(`Invalid Workday externalPath: ${externalPath}`);
  const response = await fetchWithTimeout(`${apiBase(employer)}${externalPath}`, { method: 'GET', headers: headersFor(employer) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from Workday detail endpoint: ${text.slice(0, 500)}`);
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Workday detail endpoint returned non-JSON content: ${text.slice(0, 500)}`); }
  const info = payload?.jobPostingInfo;
  if (!info || typeof info !== 'object') throw new Error('Workday detail endpoint returned no jobPostingInfo object.');
  return {
    title: info.title || null,
    jobReqId: info.jobReqId || null,
    postedOn: info.postedOn || null,
    startDate: info.startDate || null,
    endDate: info.endDate || null,
    timeType: info.timeType || null,
    remoteType: info.remoteType || null,
    location: info.location || null,
    additionalLocations: Array.isArray(info.additionalLocations) ? info.additionalLocations : [],
    externalUrl: info.externalUrl || null,
    hasDescription: Boolean(info.jobDescription),
  };
}

async function benchmarkEmployer(employer) {
  const startedAt = new Date().toISOString();
  const postings = [];
  const seen = new Set();
  let total = null;
  let pagesFetched = 0;

  for (let pageNumber = 0; pageNumber < SAMPLE_PAGES; pageNumber += 1) {
    const offset = pageNumber * PAGE_SIZE;
    if (total !== null && offset >= total) break;
    const page = await fetchPage(employer, offset);
    pagesFetched += 1;
    if (total === null) total = Number(page.total ?? page.jobPostings.length);
    for (const job of page.jobPostings) {
      if (!job?.externalPath || seen.has(job.externalPath)) continue;
      seen.add(job.externalPath);
      postings.push(job);
    }
    if (!page.jobPostings.length) break;
    await sleep(100);
  }

  const samples = [];
  for (const posting of postings.slice(0, DETAIL_SAMPLE_SIZE)) {
    try {
      samples.push({
        externalPath: posting.externalPath || null,
        listTitle: posting.title || null,
        locationsText: posting.locationsText || null,
        postedOn: posting.postedOn || null,
        detail: await fetchDetail(employer, posting.externalPath),
      });
    } catch (error) {
      samples.push({ externalPath: posting.externalPath || null, listTitle: posting.title || null, detailError: error instanceof Error ? error.message : String(error) });
    }
    await sleep(100);
  }

  const detailFailures = samples.filter((sample) => sample.detailError).length;
  return {
    key: employer.key,
    name: employer.name,
    workday: { host: employer.host, tenant: employer.tenant, site: employer.site },
    startedAt,
    completedAt: new Date().toISOString(),
    reportedTotal: total,
    sampledDistinctJobs: postings.length,
    pagesFetched,
    detailSamples: samples,
    detailFailures,
    passed: Number.isFinite(total) && total >= 0 && (total === 0 || postings.length > 0) && detailFailures === 0,
  };
}

const report = { generatedAt: new Date().toISOString(), mode: 'read-only-bounded-canary', productionWrites: false, employers: [] };

for (const employer of EMPLOYERS) {
  process.stdout.write(`Benchmarking ${employer.name}... `);
  try {
    const result = await benchmarkEmployer(employer);
    report.employers.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} (source reports ${result.reportedTotal}; sampled ${result.sampledDistinctJobs})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.employers.push({ key: employer.key, name: employer.name, workday: { host: employer.host, tenant: employer.tenant, site: employer.site }, passed: false, error: message });
    console.log(`FAIL (${message})`);
  }
}

report.summary = {
  employersTested: report.employers.length,
  employersPassed: report.employers.filter((item) => item.passed).length,
  employersFailed: report.employers.filter((item) => !item.passed).length,
  sourceJobsReported: report.employers.reduce((sum, item) => sum + (Number(item.reportedTotal) || 0), 0),
  jobsSampled: report.employers.reduce((sum, item) => sum + (Number(item.sampledDistinctJobs) || 0), 0),
};

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/workday-pilot-benchmark.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
if (report.summary.employersFailed > 0) process.exitCode = 1;
