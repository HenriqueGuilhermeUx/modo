import { describe, expect, it } from "vitest";
import { BillingService } from "./billing-service.js";

describe("BillingService", () => {
  it("grants plan credits and consumes content idempotently", async () => {
    const service = new BillingService();
    await service.initialize();

    const initial = await service.createOrUpdateDemoSubscription("account_test", "start");
    expect(initial.status).toBe("active");
    expect(initial.creditsGranted).toBe(4);
    expect(initial.creditsRemaining).toBe(4);

    const first = await service.consume("account_test", {
      contentType: "carousel",
      referenceId: "content_carousel_1",
    });
    expect(first.creditsUsed).toBe(2);
    expect(first.creditsRemaining).toBe(2);
    expect(first.usageByType.carousel).toBe(1);

    const duplicate = await service.consume("account_test", {
      contentType: "carousel",
      referenceId: "content_carousel_1",
    });
    expect(duplicate.creditsUsed).toBe(2);
    expect(duplicate.usageByType.carousel).toBe(1);
  });

  it("opens a trial with three credits for exactly seven days", async () => {
    const service = new BillingService();
    await service.initialize();

    const trial = await service.createOrUpdateDemoSubscription("account_trial", "trial");
    const duration = new Date(trial.periodEnd).getTime() - new Date(trial.periodStart).getTime();

    expect(trial.plan).toBe("trial");
    expect(trial.creditsGranted).toBe(3);
    expect(duration).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("opens a paid cycle only once for the same Woovi payment", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.createOrUpdateDemoSubscription("account_paid", "trial");

    const first = await service.applyPaidCycle(
      "account_paid",
      "presenca",
      "PIX_AUTOMATIC_COBR_COMPLETED:installment_1",
    );
    const duplicate = await service.applyPaidCycle(
      "account_paid",
      "presenca",
      "PIX_AUTOMATIC_COBR_COMPLETED:installment_1",
    );

    expect(first.plan).toBe("presenca");
    expect(first.status).toBe("active");
    expect(first.creditsGranted).toBe(10);
    expect(duplicate.creditsGranted).toBe(10);
  });

  it("keeps production available during retries and blocks it after suspension", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.applyPaidCycle("account_lifecycle", "start", "payment_1");

    const retrying = await service.setStatus("account_lifecycle", "retrying");
    expect(retrying.status).toBe("retrying");
    await expect(
      service.consume("account_lifecycle", {
        contentType: "static_post",
        referenceId: "retry_post",
      }),
    ).resolves.toMatchObject({ creditsRemaining: 3 });

    const suspended = await service.setStatus("account_lifecycle", "suspended");
    expect(suspended.status).toBe("suspended");
    await expect(
      service.consume("account_lifecycle", {
        contentType: "static_post",
        referenceId: "blocked_post",
      }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_SUSPENDED" });
  });

  it("enforces format sublimits before allowing extra production", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.createOrUpdateDemoSubscription("account_limits", "start");

    await service.consume("account_limits", {
      contentType: "carousel",
      referenceId: "carousel_1",
    });

    await expect(
      service.consume("account_limits", {
        contentType: "carousel",
        referenceId: "carousel_2",
      }),
    ).rejects.toMatchObject({ code: "CAROUSEL_LIMIT_REACHED" });
  });

  it("blocks consumption when the monthly credit balance is exhausted", async () => {
    const service = new BillingService();
    await service.initialize();
    await service.createOrUpdateDemoSubscription("account_balance", "start");

    for (let index = 1; index <= 4; index += 1) {
      await service.consume("account_balance", {
        contentType: "static_post",
        referenceId: `post_${index}`,
      });
    }

    await expect(
      service.consume("account_balance", {
        contentType: "static_post",
        referenceId: "post_5",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });
});
