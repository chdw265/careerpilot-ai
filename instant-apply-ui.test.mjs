import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
for (const required of [
  'const CAREERPILOT_QUICK_APPLY_PROVIDERS = new Set(["greenhouse"])',
  "if (!job?.quick_apply_available || !job?.quick_apply_provider) return false",
  'quickButton.textContent = "ApplyStronger Instant Apply"',
  'id="instantApplyConsentCheckbox"',
  'body: { action: "prepare", job_id: job.id }',
  'action: "submit"',
  "idempotency_key: record.id",
  "consent: true",
  'button.textContent = "Application Submitted"',
]) assert.ok(source.includes(required), `missing Instant Apply UI contract: ${required}`);

assert.ok(source.indexOf("careerPilotQuickApplySupported(job)") < source.indexOf('quickButton.textContent = "ApplyStronger Instant Apply"'));
assert.ok(!source.includes("Quick Apply is not enabled for any provider in this beta build yet."));
console.log("instant-apply UI contract checks passed");

