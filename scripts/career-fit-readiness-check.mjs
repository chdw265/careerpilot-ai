import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(html, /function evaluateCareerProfileReadiness\(data = \{\}\)/);
assert.match(html, /careerFitData\.readiness = evaluateCareerProfileReadiness\(careerFitData\)/);
assert.match(html, /careerFitData\.ready = careerFitData\.readiness\.ready/);
assert.doesNotMatch(html, /onboarding_completed\s*(?:===|==|\?|&&|\|\|)/);
assert.match(html, /Your profile has not been marked incomplete/);
assert.match(html, /optionalMissing:/);
assert.match(html, /resumes\.length/);

console.log("career-fit-readiness: ok");
