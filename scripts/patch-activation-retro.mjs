import fs from "node:fs";

const path = "apps/api/src/services/activation-service.ts";
let content = fs.readFileSync(path, "utf8");
const before = '    const latestReady = requests.find((request) => ["ready", "approved"].includes(request.status));\n    const latestApproved = requests.find((request) => request.status === "approved");';
const after = '    const latestReady = requests.find((request) => ["ready", "approved"].includes(request.status));\n    const latestApproved = requests.find((request) => request.status === "approved");\n    const onboardingCompletedAt = firstEvent("onboarding_completed")\n      || (requests.length ? requests[requests.length - 1].createdAt : null);';
if (!content.includes(before)) throw new Error("Ponto de retrocompatibilidade não encontrado.");
content = content.replace(before, after);
content = content.replace(
  '        completed: Boolean(firstEvent("onboarding_completed")),\n        completedAt: firstEvent("onboarding_completed"),',
  '        completed: Boolean(onboardingCompletedAt),\n        completedAt: onboardingCompletedAt,',
);
fs.writeFileSync(path, content);
fs.rmSync("scripts/patch-activation-retro.mjs");
fs.rmSync(".github/workflows/patch-activation-retro.yml");
console.log("Retrocompatibilidade de ativação aplicada.");
