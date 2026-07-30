import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.js";
import { DemoDiagnosticProvider } from "../providers/demo-diagnostic-provider.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("registro das rotas da API", () => {
  it("inicializa sem rotas duplicadas", async () => {
    app = await createApp({
      provider: new DemoDiagnosticProvider(0),
      logger: false,
      allowedOrigins: ["http://localhost:5173"],
    });

    await expect(app.ready()).resolves.toBeUndefined();
    const routes = app.printRoutes();
    expect(routes).toContain("intelligence/playbooks");
    expect(routes).toContain("health");
  });
});
