import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectExportEvidence } from "./modo-mobile-security-triage.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || process.argv.length !== 4)
  throw new Error("MODO_MOBILE_EXPORT_INSPECT_CI_ONLY");
const [directory, output] = process.argv.slice(2);
if (!resolve(output).startsWith(resolve(process.env.RUNNER_TEMP || "/unconfigured")+"/") ||
    !output.endsWith(".json")) throw new Error("MODO_MOBILE_EXPORT_BAD_PATH");
const info = await collectExportEvidence(directory);
if (!info.expoAndroidExportGenerated)throw new Error("MODO_MOBILE_EXPORT_MISSING");
await writeFile(output,JSON.stringify(info,null,2),{mode:0o600});
console.log(JSON.stringify({
  exported:true,files:info.fileCount,jsBundles:info.jsBundleCount,
  sourceMaps:info.sourceMapCount,forgePaths:info.potentialNodeForgePathHits.length,
  absentMeansSafe:false,
}));
