import { describe, expect, it } from "vitest";
import { MetricoolService } from "./metricool-service.js";

describe("MetricoolService", () => {
  it("keeps customer credentials out of the connection registry", async () => {
    const service = new MetricoolService({});
    await service.initialize();
    const status = await service.status("org-1", "brand-1");
    expect(status.configured).toBe(false);
    expect(status.linked).toBe(false);
    expect(status.capabilities).toContain("approval_workflow");
    await service.close();
  });

  it("refuses provisioning until the integrator account is configured", async () => {
    const service = new MetricoolService({});
    await expect(service.provision("org-1", "brand-1")).rejects.toThrow(/Metricool ainda não está configurado/);
  });
});
