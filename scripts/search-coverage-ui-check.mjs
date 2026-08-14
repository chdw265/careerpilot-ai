import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter(Boolean);

scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `coverage-inline-${index}.js` });
});

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateIds, [], "Search coverage UI must not introduce duplicate IDs");

assert.match(html, /id="jobCoverageNotice"/);
assert.match(html, /class="employer-coverage-notice"/);
assert.match(html, /applystronger_resolve_employer_search/);
assert.match(html, /applystronger_report_missing_job/);
assert.match(html, /query\.in\("company_name", companyTerms\)/);
assert.match(html, /coverageRows = company \? await resolveEmployerCoverage\(company, 8\) : \[\]/);
assert.match(html, /canonicalEmployerNameFor\(companyName\)/);
assert.match(html, /Employer covered/);
assert.match(html, /Jobs under review/);
assert.match(html, /Collector being built/);
assert.match(html, /Feed access needed/);
assert.match(html, /Report missing employer or job/);
assert.match(html, /Reports prioritize coverage research/);
assert.match(html, /Sign in to report a missing employer or job/);
assert.match(html, /p_employer_name: company/);
assert.match(html, /p_job_title: keyword \|\| null/);
assert.match(html, /p_location_text: location \|\| null/);
assert.match(html, /p_careers_url: careersUrl \|\| null/);
assert.match(html, /coverageNames = coverageRows\.map\(row => row\.canonical_name\)/);
assert.match(html, /employerCoverageLookupUnavailable/);
assert.match(html, /Coverage check unavailable/);
assert.match(html, /@media \(max-width: 640px\)[\s\S]{0,180}employer-report-form/);

assert.doesNotMatch(
  html,
  /\.from\("employer_coverage_(?:registry|aliases|requests|benchmarks)"\)[\s\S]{0,260}?\.(?:insert|update|delete)\(/,
  "Coverage writes must use controlled RPCs rather than direct browser table writes",
);
assert.doesNotMatch(
  html,
  /CAREERPILOT_QUICK_APPLY_PROVIDERS = new Set\(\[(?!\])/,
  "Search coverage work must not enable Quick Apply providers",
);

console.log("Employer search, coverage status, and missing-job report UI checks passed.");
