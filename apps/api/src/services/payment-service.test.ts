import { planEntitlements } from "@modo/contracts";
import type { WooviCheckoutRequest } from "@modo/contracts/payment";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentError, PaymentService } from "./payment-service.js";

const accountId = "11111111-1111-4111-8111-111111111111";

const checkoutInput: WooviCheckoutRequest = {
  plan: "presenca",
  customer: {
    name: "Cliente MODO",
    email: "cliente@example.com",
    phone: "5511999999999",
    taxID: "12345678901",
    address: {
      zipcode: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      complement: "",
    },
  },
};

function subscriptionResponse(correlationID: string, plan: "presenca" | "pro" = "presenca") {
  return {
    subscription: {
      globalID: `subscription-${plan}`,
      correlationID,
      value: planEntitlements[plan].priceCents,
      status: "CREATED",
      paymentLinkUrl: `https://pay.woovi.com/${plan}`,
      customer: { email: checkoutInput.customer.email },
      pixRecurring: {
        status: "CREATED",
        emv: `000201-${plan}`,
        journey: "PAYMENT_ON_APPROVAL",
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaymentService Woovi", () => {
  it("creates Pix Automático with server price and current ISO start", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify(subscriptionResponse(String(sentBody.correlationID))), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new PaymentService({ appId: "woovi-app-id" });
    const result = await service.createCheckout(accountId, checkoutInput);

    expect(sentBody.type).toBe("PIX_RECURRING");
    expect(sentBody.frequency).toBe("MONTHLY");
    expect(sentBody.value).toBe(planEntitlements.presenca.priceCents);
    expect(sentBody.dayGenerateCharge).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(String(sentBody.dayGenerateCharge)))).toBe(false);
    expect(sentBody.pixRecurringOptions).toMatchObject({
      journey: "PAYMENT_ON_APPROVAL",
      retryPolicy: "THREE_RETRIES_7_DAYS",
    });
    expect(result.paymentLinkUrl).toBe("https://pay.woovi.com/presenca");
  });

  it("reuses the open checkout for the same plan instead of duplicating a subscription", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { correlationID: string };
      return new Response(JSON.stringify(subscriptionResponse(body.correlationID)), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new PaymentService({ appId: "woovi-app-id" });

    const first = await service.createCheckout(accountId, checkoutInput);
    const second = await service.createCheckout(accountId, checkoutInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(second.correlationID).toBe(first.correlationID);
  });

  it("blocks a second plan while another subscription is open", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { correlationID: string };
      return new Response(JSON.stringify(subscriptionResponse(body.correlationID)), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new PaymentService({ appId: "woovi-app-id" });
    await service.createCheckout(accountId, checkoutInput);

    await expect(service.createCheckout(accountId, { ...checkoutInput, plan: "pro" }))
      .rejects.toMatchObject<Partial<PaymentError>>({ code: "SUBSCRIPTION_ALREADY_EXISTS", statusCode: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates webhook authorization without plain comparison", () => {
    const service = new PaymentService({ appId: "woovi-app-id", webhookAuthorization: "webhook-secret" });
    expect(() => service.validateWebhookAuthorization("webhook-secret")).not.toThrow();
    expect(() => service.validateWebhookAuthorization("wrong-secret")).toThrowError(PaymentError);
  });

  it("processes a paid webhook once and ignores duplicate delivery", async () => {
    const correlationID = `modo:${accountId}:presenca:22222222-2222-4222-8222-222222222222`;
    const subscription = subscriptionResponse(correlationID).subscription;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ subscription }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new PaymentService({ appId: "woovi-app-id", webhookAuthorization: "webhook-secret" });

    const payload = {
      event: "PIX_AUTOMATIC_COBR_COMPLETED",
      globalID: "charge-1",
      paymentSubscriptionGlobalID: subscription.globalID,
    };
    const first = await service.processWebhook(payload);
    const duplicate = await service.processWebhook(payload);

    expect(first).toMatchObject({ accountId, plan: "presenca", action: "paid" });
    expect(duplicate).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
