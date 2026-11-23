#!/usr/bin/env node
/**
 * Source-only release contract gate. No Apple credentials, external requests,
 * submissions, builds, or production writes.
 *
 * A successful gate is NOT authorization to distribute: Apple team, build number,
 * live backend deployment, account-deletion fulfillment and device QA remain human gates.
 */
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const expo = JSON.parse(read("apps/mobile/app.json")).expo;
const eas = JSON.parse(read("apps/mobile/eas.json"));
const mobileApi = read("apps/mobile/src/api.ts");
const account = read("apps/mobile/app/(tabs)/account.tsx");
const api = read("apps/api/src/app.ts");
const auth = read("apps/api/src/services/auth-service.ts");
const tests = read("apps/api/src/account-deletion-http.test.ts");
const errors = [];

function assert(condition, reason) { if (!condition) errors.push(reason); }
const id = expo.ios?.bundleIdentifier;
assert(id === "br.com.alternativeventures.modo", "Unexpected iOS bundle ID");
assert(/^\d+$/.test(String(expo.ios?.buildNumber ?? "")), "iOS buildNumber must be numeric");
assert(Boolean(expo.extra?.eas?.projectId), "Existing EAS project ID missing");
assert(eas.build?.production?.ios?.simulator !== true, "Production must target a real signed device");
assert(eas.build?.production?.ios?.autoIncrement === false, "Build number must remain manual until ASC confirmed");
assert(eas.submit?.production?.ios && typeof eas.submit.production.ios === "object", "iOS submit profile missing");
const configuredApi = String(eas.build?.production?.env?.EXPO_PUBLIC_API_URL ?? "");
assert(configuredApi === expo.extra?.apiUrl, "Build API URL and app extra API URL mismatch");
assert(/^https:\/\//.test(configuredApi), "Production API URL must be HTTPS");

const contracts = [
  [mobileApi, '"/api/v1/auth/account-deletion-requests"', "Mobile request path missing"],
  [mobileApi, '"/api/v1/auth/account-deletion-requests/current"', "Mobile pending status path missing"],
  [api, '"/api/v1/auth/account-deletion-requests"', "Backend request endpoint missing"],
  [api, '"/api/v1/auth/account-deletion-requests/current"', "Backend pending status endpoint missing"],
  [api, '"/api/v1/admin/privacy/deletion-requests"', "Backend operator queue missing"],
  [api, '"/api/v1/admin/privacy/deletion-requests/:id/start-review"', "Backend operator review missing"],
  [auth, "modo_account_deletion_requests", "Persistent backend deletion intake missing"],
  [account, "Solicitar exclusão da conta", "Native in-app deletion initiation missing"],
  [tests, "denied.statusCode", "Admin authorization HTTP test missing"],
];
for (const [source, match, reason] of contracts) assert(source.includes(match), reason);
assert(mobileApi.includes("requestAccountDeletion(token:"), "Mobile authenticated request call missing");
assert(account.includes("getPendingAccountDeletion(token)"), "Persisted ticket readback missing");
assert(account.includes("setDeletionTicket(ticket.requestId)"), "Confirmed protocol UI missing");

const report = {
  kind: "MODO_IOS_SOURCE_RELEASE_CONTRACT_CHECK",
  bundleId: id,
  iosVersion: expo.version,
  iosBuildNumber: String(expo.ios.buildNumber),
  easProjectId: expo.extra.eas.projectId,
  productionApiOrigin: configuredApi,
  sourceCodeContractPassed: errors.length === 0,
  blockedExternalGates: [
    "Production API endpoint deployment compatibility has NOT been verified",
    "Apple Team and App Store Connect app ownership have NOT been verified",
    "Distribution certificate and provisioning profile have NOT been verified",
    "App Store Connect build number uniqueness has NOT been checked",
    "Actual account erasure and third-party retention procedures remain unverified",
    "Signed IPA, physical iPhone/iPad QA and TestFlight upload remain unverified",
  ],
  safeToSubmit: false,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  for (const e of errors) console.error("FAIL: " + e);
  process.exitCode = 1;
} else console.log("PASS: source-only release contract. BLOCKED: NOT TestFlight-ready.");
