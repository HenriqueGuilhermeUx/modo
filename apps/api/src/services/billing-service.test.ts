import { describe, expect, it } from "vitest";
import { BillingError, BillingService } from "./billing-service.js";

describe("BillingService", () => {
  it("grants plan credits and consumes content idempotently", async () => {
    const service = new BillingService();
    await service.initialize();

    const initial = await service.createOrUpdateDemoSubscription("account_test", "start");
    expect(initial.creditsGranted).toBe(6);
    expect(initial.creditsRemaining).toBe(6);

    const first = await service.consume("account_test", {
      contentType: "carousel",
      referenceId: "content_carousel_1",
    });
    expect(first.creditsUsed).toBe(2);
    expect(first.creditsRemaining).toBe(4);
    expect(first.usageByType.carousel).toBe(1);

    const duplicate = await service.consume("account_test", {
      contentType: "carousel",
      referenceId: "content_carousel_1",
    });
    expect(duplicate.creditsUsed).toBe(2);
    expect(duplicate.usageByType.carousel).toBe(1);
  });

  it("enforces format sublimits before allowing extra production", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.createOrUpdateDemoSubscription("account_limits", "start");

    await service.consume("account_limits", {
      contentType: "carousel",
      referenceId: "carousel_1",
    });
    await service.consume("account_limits", {
      contentType: "carousel",
      referenceId: "carousel_2",
    });

    await expect(
      service.consume("account_limits", {
        contentType: "carousel",
        referenceId: "carousel_3",
      }),
    ).rejects.toMatchObject<Partial<BillingError>>({ code: "CAROUSEL_LIMIT_REACHED" });
  });

  it("blocks consumption when the monthly credit balance is exhausted", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.createOrUpdateDemoSubscription("account_balance", "start");

    for (let index = 1; index <= 6; index += 1) {
      await service.consume("account_balance", {
        contentType: "static_post",
        referenceId: `post_${index}`,
      });
    }

    await expect(
      service.consume("account_balance", {
        contentType: "static_post",
        referenceId: "post_7",
      }),
    ).rejects.toMatchObject<Partial<BillingError>>({ code: "INSUFFICIENT_CREDITS" });
  });
});
