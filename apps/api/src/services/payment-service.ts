import { planEntitlements, type PublicPlanSlug } from "@modo/contracts";
import type { WooviCheckoutRequest } from "@modo/contracts/payment";
import { randomUUID, timingSafeEqual } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

const planNames: Record<PublicPlanSlug, string> = {
  start: "MODO Start",
  presenca: "MODO Presença",
  pro: "MODO Pro",
  business: "MODO Business",
};

interface PaymentServiceOptions {
  appId?: string;
  webhookAuthorization?: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface WooviSubscription {
  globalID: string;
  correlationID: string;
  value: number;
  status: string;
  paymentLinkUrl?: string;
  customer?: { email?: string };
  pixRecurring?: {
    status?: string;
    emv?: string;
    recurrencyId?: string;
    journey?: string;
  };
}

interface WooviSubscriptionResponse {
  subscription: WooviSubscription;
}

export interface PaymentActivation {
  accountId: string;
  plan: PublicPlanSlug;
  providerId: string;
  event: string;
}

export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export class PaymentService {
  private readonly appId?: string;
  private readonly webhookAuthorization?: string;
  private readonly pool?: Pool;
  private readonly memorySubscriptions = new Map<string, WooviSubscription>();
  private readonly memoryActivated = new Set<string>();

  constructor(options: PaymentServiceOptions) {
    this.appId = options.appId;
    this.webhookAuthorization = options.webhookAuthorization;
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get enabled() {
    return Boolean(this.appId);
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_payment_subscriptions (
        global_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        plan_slug TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'woovi',
        status TEXT NOT NULL,
        pix_recurring_status TEXT,
        payment_link_url TEXT,
        emv TEXT,
        customer_email TEXT,
        activated_at TIMESTAMPTZ,
        last_payment_at TIMESTAMPTZ,
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_payment_subscriptions_account_idx
        ON modo_payment_subscriptions(account_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS modo_payment_events (
        event_key TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        provider_id TEXT,
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createCheckout(accountId: string, input: WooviCheckoutRequest) {
    const correlationID = `modo:${accountId}:${input.plan}:${randomUUID()}`;
    const dayGenerateCharge = Math.min(27, Math.max(1, new Date().getUTCDate()));
    const response = await fetch("https://api.woovi.com/api/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: this.requireAppId(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: planEntitlements[input.plan].priceCents,
        name: planNames[input.plan],
        comment: `${planNames[input.plan]} — assinatura mensal MODO`,
        correlationID,
        frequency: "MONTHLY",
        type: "PIX_RECURRING",
        dayGenerateCharge,
        dayDue: 3,
        pixRecurringOptions: {
          journey: "PAYMENT_ON_APPROVAL",
          retryPolicy: "THREE_RETRIES_7_DAYS",
        },
        customer: {
          name: input.customer.name,
          email: input.customer.email,
          phone: input.customer.phone.replace(/\D/g, ""),
          taxID: input.customer.taxID.replace(/\D/g, ""),
          address: {
            ...input.customer.address,
            zipcode: input.customer.address.zipcode.replace(/\D/g, ""),
          },
        },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Partial<WooviSubscriptionResponse> & {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    const subscription = payload.subscription;
    if (
      !response.ok ||
      !subscription?.globalID ||
      !subscription.paymentLinkUrl ||
      !subscription.pixRecurring?.emv
    ) {
      throw new PaymentError(
        "CHECKOUT_CREATION_FAILED",
        502,
        payload.errors?.[0]?.message || payload.message || "Não foi possível iniciar o Pix Automático.",
      );
    }

    await this.persist(accountId, input.plan, subscription);
    return {
      subscriptionId: subscription.globalID,
      correlationID,
      paymentLinkUrl: subscription.paymentLinkUrl,
      emv: subscription.pixRecurring.emv,
      status: subscription.status,
      pixRecurringStatus: subscription.pixRecurring.status || "CREATED",
    };
  }

  validateWebhookAuthorization(value: string) {
    if (!this.webhookAuthorization) {
      throw new PaymentError("WEBHOOK_NOT_CONFIGURED", 503, "Webhook Woovi não configurado.");
    }
    const received = Buffer.from(value || "", "utf8");
    const expected = Buffer.from(this.webhookAuthorization, "utf8");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new PaymentError("INVALID_WEBHOOK_AUTHORIZATION", 401, "Webhook não autorizado.");
    }
  }

  async processWebhook(body: Record<string, unknown>): Promise<PaymentActivation | null> {
    const event = String(body.event || "");
    if (!event.startsWith("PIX_AUTOMATIC_")) return null;

    const providerId = String(
      body.paymentSubscriptionGlobalID || body.globalID || "",
    );
    if (!providerId) {
      throw new PaymentError("INVALID_WEBHOOK_PAYLOAD", 400, "Assinatura Woovi não identificada.");
    }

    const eventObjectId = String(body.globalID || providerId);
    const eventKey = `${event}:${eventObjectId}`;
    if (!(await this.registerEvent(eventKey, event, providerId, body))) return null;

    const subscription = await this.fetchSubscription(providerId);
    const parsed = this.parseCorrelationID(subscription.correlationID);
    await this.persist(parsed.accountId, parsed.plan, subscription);

    if (event === "PIX_AUTOMATIC_COBR_COMPLETED") {
      await this.markPayment(providerId);
    }

    const approved = subscription.pixRecurring?.status === "APPROVED";
    if (!approved || !["PIX_AUTOMATIC_APPROVED", "PIX_AUTOMATIC_COBR_COMPLETED"].includes(event)) {
      return null;
    }

    const claimed = await this.claimActivation(providerId);
    return claimed ? { ...parsed, providerId, event } : null;
  }

  async fetchSubscription(globalID: string) {
    const response = await fetch(
      `https://api.woovi.com/api/v1/subscriptions/${encodeURIComponent(globalID)}`,
      { headers: { Authorization: this.requireAppId() } },
    );
    const payload = (await response.json().catch(() => ({}))) as Partial<WooviSubscriptionResponse> & {
      message?: string;
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || !payload.subscription?.globalID) {
      throw new PaymentError(
        "SUBSCRIPTION_LOOKUP_FAILED",
        502,
        payload.errors?.[0]?.message || payload.message || "Não foi possível consultar a assinatura.",
      );
    }
    return payload.subscription;
  }

  private parseCorrelationID(value: string) {
    const match = /^modo:([0-9a-f-]{36}):(start|presenca|pro|business):([0-9a-f-]{36})$/i.exec(value);
    if (!match) {
      throw new PaymentError("INVALID_CORRELATION_ID", 400, "Correlação Woovi inválida.");
    }
    return { accountId: match[1], plan: match[2] as PublicPlanSlug };
  }

  private async persist(accountId: string, plan: PublicPlanSlug, subscription: WooviSubscription) {
    if (!this.pool) {
      this.memorySubscriptions.set(subscription.globalID, subscription);
      return;
    }
    await this.pool.query(
      `INSERT INTO modo_payment_subscriptions(
        global_id, correlation_id, account_id, plan_slug, status, pix_recurring_status,
        payment_link_url, emv, customer_email, raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (global_id) DO UPDATE SET
        status=EXCLUDED.status,
        pix_recurring_status=EXCLUDED.pix_recurring_status,
        payment_link_url=COALESCE(EXCLUDED.payment_link_url,modo_payment_subscriptions.payment_link_url),
        emv=COALESCE(EXCLUDED.emv,modo_payment_subscriptions.emv),
        customer_email=COALESCE(EXCLUDED.customer_email,modo_payment_subscriptions.customer_email),
        raw=EXCLUDED.raw,
        updated_at=NOW()`,
      [
        subscription.globalID,
        subscription.correlationID,
        accountId,
        plan,
        subscription.status,
        subscription.pixRecurring?.status || null,
        subscription.paymentLinkUrl || null,
        subscription.pixRecurring?.emv || null,
        subscription.customer?.email || null,
        JSON.stringify(subscription),
      ],
    );
  }

  private async registerEvent(
    eventKey: string,
    event: string,
    providerId: string,
    body: Record<string, unknown>,
  ) {
    if (!this.pool) {
      if (this.memoryActivated.has(`event:${eventKey}`)) return false;
      this.memoryActivated.add(`event:${eventKey}`);
      return true;
    }
    const result = await this.pool.query(
      `INSERT INTO modo_payment_events(event_key,event_type,provider_id,payload)
       VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,
      [eventKey, event, providerId, JSON.stringify(body)],
    );
    return Boolean(result.rowCount);
  }

  private async claimActivation(providerId: string) {
    if (!this.pool) {
      if (this.memoryActivated.has(`activation:${providerId}`)) return false;
      this.memoryActivated.add(`activation:${providerId}`);
      return true;
    }
    const result = await this.pool.query(
      `UPDATE modo_payment_subscriptions SET activated_at=NOW(),updated_at=NOW()
       WHERE global_id=$1 AND activated_at IS NULL RETURNING global_id`,
      [providerId],
    );
    return Boolean(result.rowCount);
  }

  private async markPayment(providerId: string) {
    if (!this.pool) return;
    await this.pool.query(
      `UPDATE modo_payment_subscriptions SET last_payment_at=NOW(),updated_at=NOW() WHERE global_id=$1`,
      [providerId],
    );
  }

  private requireAppId() {
    if (!this.appId) {
      throw new PaymentError("PAYMENTS_NOT_CONFIGURED", 503, "Woovi ainda não está configurada.");
    }
    return this.appId;
  }
}
