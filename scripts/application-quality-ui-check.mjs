import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter(Boolean);

scripts.forEach((source, index) => {
  new vm.Script(source, { filename: `index-inline-${index}.js` });
});

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], [], "HTML IDs must be unique");

for (const id of [
  "recommendedJobsButton",
  "careerEvidenceText",
  "careerEvidenceExperience",
  "analyzeCareerEvidenceButton",
  "careerEvidenceList",
]) {
  assert.match(html, new RegExp(`id="${id}"`));
}

for (const rpc of [
  "applystronger_create_career_evidence",
  "applystronger_update_career_evidence",
  "applystronger_save_career_evidence_review",
  "applystronger_approve_career_evidence",
  "applystronger_archive_career_evidence",
]) {
  assert.match(html, new RegExp(rpc));
}
assert.match(html, /const rpcName = approve[\s\S]{0,180}?applystronger_approve_career_evidence[\s\S]{0,180}?applystronger_save_career_evidence_review/);
assert.match(html, /db\.rpc\(rpcName, \{/);

assert.match(html, /functions\.invoke\("analyze-career-evidence"/);
assert.match(html, /functions\.invoke\("analyze-application-readiness"/);
assert.match(html, /body: \{ job_id: job\.id, check_only: true \}/);
assert.match(html, /p_expected_updated_at: entry\.updated_at/);
assert.match(html, /career_evidence_approved_items/);
assert.match(html, /current_text/);
assert.match(html, /data-evidence-attestation/);
assert.match(html, /attested:/);
assert.match(html, /Evidence Bank only/);
assert.match(html, /Career Profile skill/);
assert.match(html, /Master resume bullet/);
assert.match(html, /Archive Evidence/);
assert.match(html, /Refresh required/);
assert.match(html, /No readiness review yet/);
assert.match(html, /Have you done this but left it off your resume\?/);
assert.match(html, /never manufactures a missing qualification/);
assert.match(html, /not an interview or hiring probability/);
assert.match(html, /matchResult\.data\?\.match_score !== null/);

assert.doesNotMatch(
  html,
  /\.from\("career_evidence_entries"\)[\s\S]{0,240}?\.(?:insert|update|delete)\(/,
  "Career Evidence lifecycle writes must go through controlled RPCs",
);
assert.doesNotMatch(
  html,
  /reviewed_data:\s*payload/,
  "The browser must not directly write reviewed_data",
);
assert.doesNotMatch(
  html,
  /status:\s*"approved"/,
  "The browser must not directly forge approved evidence state",
);
assert.match(
  html,
  /const CAREERPILOT_QUICK_APPLY_PROVIDERS = new Set\(\[\]\)/,
  "This UI change must not enable unimplemented Quick Apply providers",
);

console.log("Application Quality UI regression checks passed.");
