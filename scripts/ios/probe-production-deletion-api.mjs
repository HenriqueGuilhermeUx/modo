#!/usr/bin/env node
/**
 * Read-only safety probe of the production MODO API.
 * GET only, unauthenticated; never attempts to mutate, create users, issue sessions
 * or inspect data. Does not prove Apple readiness or account erasure.
 */
import { readFileSync } from "node:fs";
const { expo } = JSON.parse(readFileSync("apps/mobile/app.json", "utf8"));
const expected = "https://modo-api-3m10.onrender.com";
const base = expo?.extra?.apiUrl;
if (base !== expected) throw new Error("Unexpected production API URL: refusing probe");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 12000);
const endpoint = new URL("/api/v1/auth/account-deletion-requests/current", base);
let result;
try {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { "Accept": "application/json" },
    signal: controller.signal,
    redirect: "error",
  });
  // This endpoint MUST be registered, and MUST reject anonymous calls with 401.
  result = { host: endpoint.host, route: endpoint.pathname, status: response.status, pass: response.status === 401 };
  console.log("MODO_PRODUCTION_READONLY_PROBE " + JSON.stringify(result));
  if (!result.pass) {
    console.error("BLOCKED: API lacks expected authenticated account-deletion status endpoint or returns an unsafe status.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("BLOCKED: unable to verify live API contract (" + (error?.name || "network error") + ").");
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
