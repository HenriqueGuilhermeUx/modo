import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.js";
import { DemoDiagnosticProvider } from "../providers/demo-diagnostic-provider.js";

const previous = process.env.MODO_HYPERFRAMES_PREVIEW_ENABLED;
let app: FastifyInstance | undefined;

async function server() {
  return createApp({
    provider: new DemoDiagnosticProvider(0),
    diagnosticProviderName: "demo",
    logger: false,
    allowedOrigins: ["http://localhost:5173"],
  });
}
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (previous === undefined) delete process.env.MODO_HYPERFRAMES_PREVIEW_ENABLED;
  else process.env.MODO_HYPERFRAMES_PREVIEW_ENABLED = previous;
});

describe("HyperFrames HTML preview release gate", () => {
  const endpoint = "/api/v1/video-projects/11111111-1111-4111-8111-111111111111/hyperframes-preview";

  it("is not registered when the server feature is disabled", async () => {
    delete process.env.MODO_HYPERFRAMES_PREVIEW_ENABLED;
    app = await server();
    await app.ready();
    expect(app.hasRoute({
      method: "GET",
      url: "/api/v1/video-projects/:id/hyperframes-preview",
    })).toBe(false);
    const response = await app.inject({ method: "GET", url: endpoint });
    expect(response.statusCode).toBe(404);
  });

  it("is registered only on opt-in and never returns a preview anonymously", async () => {
    process.env.MODO_HYPERFRAMES_PREVIEW_ENABLED = "true";
    app = await server();
    await app.ready();
    expect(app.hasRoute({
      method: "GET",
      url: "/api/v1/video-projects/:id/hyperframes-preview",
    })).toBe(true);
    const response = await app.inject({ method: "GET", url: endpoint });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("<!DOCTYPE html>");
  });
});
