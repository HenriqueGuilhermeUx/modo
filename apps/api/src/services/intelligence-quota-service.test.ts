import { describe, expect, it } from "vitest";
import {
  IntelligenceQuotaError,
  IntelligenceQuotaService,
} from "./intelligence-quota-service.js";

describe("IntelligenceQuotaService", () => {
  it("permite repetir uma missão falha mesmo quando a franquia do ciclo acabou", async () => {
    const service = new IntelligenceQuotaService();
    const organizationId = "org-retry-free";

    await service.reserve(organizationId, 10, "create:first-mission");

    const exhausted = await service.usage(organizationId);
    expect(exhausted.runsRemaining).toBe(0);
    expect(exhausted.itemsRemaining).toBe(0);

    await expect(service.assertRetryCapacity(organizationId, 10)).resolves.toMatchObject({
      runsUsed: 1,
      itemsUsed: 10,
      runsRemaining: 0,
      itemsRemaining: 0,
    });

    const unchanged = await service.usage(organizationId);
    expect(unchanged.runsUsed).toBe(1);
    expect(unchanged.itemsUsed).toBe(10);
  });

  it("continua bloqueando uma nova missão quando a franquia acabou", async () => {
    const service = new IntelligenceQuotaService();
    const organizationId = "org-new-run-blocked";

    await service.reserve(organizationId, 10, "create:first-mission");

    await expect(service.reserve(organizationId, 1, "create:second-mission"))
      .rejects.toMatchObject<IntelligenceQuotaError>({
        code: "INTELLIGENCE_MONTHLY_RUNS_EXHAUSTED",
        statusCode: 429,
      });
  });

  it("mantém o limite por missão durante o reenvio", async () => {
    const service = new IntelligenceQuotaService();

    await expect(service.assertRetryCapacity("org-invalid-retry", 11))
      .rejects.toMatchObject<IntelligenceQuotaError>({
        code: "INTELLIGENCE_RUN_LIMIT_EXCEEDED",
        statusCode: 422,
      });
  });
});
