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

assert.match(html, /functions\.invoke\("analyze-career-evidence"/);
assert.match(html, /rpc\("applystronger_approve_career_evidence"/);
assert.match(html, /functions\.invoke\("analyze-application-readiness"/);
assert.match(html, /not an interview or hiring probability/);
assert.match(html, /status: "draft"/);
assert.match(html, /reviewed_data: payload/);
assert.match(html, /matchResult\.data\?\.match_score !== null/);
assert.match(
  html,
  /const CAREERPILOT_QUICK_APPLY_PROVIDERS = new Set\(\[\]\)/,
  "This UI change must not enable unimplemented Quick Apply providers",
);

console.log("Application Quality UI regression checks passed.");
