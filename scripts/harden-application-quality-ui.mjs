import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const indexPath = join(scriptsDir, "..", "index.html");
const careerBlock = readFileSync(join(scriptsDir, "phase0-career-evidence.block.js.txt"), "utf8").trimEnd();
const readinessBlock = readFileSync(join(scriptsDir, "phase0-readiness.block.js.txt"), "utf8").trimEnd();
let html = readFileSync(indexPath, "utf8");

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  assert.equal(matches.length, 1, `${label} must match exactly once; found ${matches.length}`);
  return source.replace(pattern, replacement);
}

const lifecycleRpcs = [
  "applystronger_create_career_evidence",
  "applystronger_update_career_evidence",
  "applystronger_save_career_evidence_review",
  "applystronger_approve_career_evidence",
  "applystronger_archive_career_evidence",
];

const alreadyHardened = lifecycleRpcs.every((rpc) => html.includes(rpc))
  && html.includes("body: { job_id: job.id, check_only: true }")
  && !/\.from\("career_evidence_entries"\)[\s\S]{0,240}?\.(?:insert|update|delete)\(/.test(html);

if (!alreadyHardened) {
  html = replaceExactlyOnce(
    html,
    /    function careerEvidenceStatusLabel\(value\) \{[\s\S]*?    document\.getElementById\("analyzeCareerEvidenceButton"\)\.addEventListener\("click", createCareerEvidence\);\n/,
    `${careerBlock}\n`,
    "Career Evidence UI block",
  );

  html = replaceExactlyOnce(
    html,
    /    function readinessStatusLabel\(value\) \{[\s\S]*?\n    function renderJobMatchError\(job, message\) \{/,
    `${readinessBlock}\n\n    function renderJobMatchError(job, message) {`,
    "Application Readiness UI block",
  );
}

for (const rpc of lifecycleRpcs) assert.match(html, new RegExp(rpc));
assert.match(html, /const rpcName = approve[\s\S]{0,180}?applystronger_approve_career_evidence[\s\S]{0,180}?applystronger_save_career_evidence_review/);
assert.match(html, /db\.rpc\(rpcName, \{/);
assert.match(html, /p_expected_updated_at: entry\.updated_at/);
assert.match(html, /career_evidence_approved_items/);
assert.match(html, /data-evidence-attestation/);
assert.match(html, /Evidence Bank only/);
assert.match(html, /Career Profile/);
assert.match(html, /Master resume/);
assert.match(html, /body: \{ job_id: job\.id, check_only: true \}/);
assert.match(html, /Refresh required/);
assert.doesNotMatch(
  html,
  /\.from\("career_evidence_entries"\)[\s\S]{0,240}?\.(?:insert|update|delete)\(/,
  "Career Evidence lifecycle writes must use controlled RPCs",
);

writeFileSync(indexPath, html);
console.log(alreadyHardened
  ? "Application Quality UI already matches the hardened contract."
  : "Application Quality UI hardened successfully.");
