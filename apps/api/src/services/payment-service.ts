import { planEntitlements, type PublicPlanSlug } from "@modo/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import pg, { type Pool } from "pg";

const { Pool: PgPool } = pg;

const planNames: Record<PublicPlanSlug, string> = {
  start: "MODO Start",
  presenca: "MODO Presença",
  pro: "MODO Pro",
  business: "MODO Business",
};

interface PaymentServiceOptions {
  accessToken?: string;
  webhookSecret?: string;
  publicAppUrl: string;
  databaseUrl?: string;
  databaseSsl?: boolean;
}

interface MercadoPagoSubscription {
  id: string;
  external_reference?: string;
  init_point?: string;
  status: string;
  payer_email?: string;
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
  private readonly accessToken?: string;
  private readonly webhookSecret?: string;
  private readonly publicAppUrl: string;
  private readonly pool?: Pool;

  constructor(options: PaymentServiceOptions) {
    this.accessToken = options.accessToken;
    this.webhookSecret = options.webhookSecret;
    this.publicAppUrl = options.publicAppUrl.replace(/\/$/, "");
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 3,
      });
    }
  }

  get enabled() {
    return Boolean(this.accessToken);
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS modo_payment_subscriptions (
        provider_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
        plan_slug TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'mercado_pago',
        status TEXT NOT NULL,
        checkout_url TEXT,
        payer_email TEXT,
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS modo_payment_subscriptions_account_idx
        ON modo_payment_subscriptions(account_id, updated_at DESC);
    `);
  }

  async close() {
    await this.pool?.end();
  }

  async createCheckout(accountId: string, payerEmail: string, plan: PublicPlanSlug) {
    const accessToken = this.requireAccessToken();
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reason: planNames[plan],
        external_reference: `modo:${accountId}:${plan}`,
        payer_email: payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: planEntitlements[plan].priceCents / 100,
          currency_id: "BRL",
        },
        back_url: `${this.publicAppUrl}/app?checkout=return`,
        status: "pending",
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Partial<MercadoPagoSubscription> & {
      message?: string;
    };
    if (!response.ok || !payload.id || !payload.init_point) {
      throw new PaymentError(
        "CHECKOUT_CREATION_FAILED",
        502,
        payload.message || "Não foi possível iniciar o checkout.",
      );
    }

    await this.persist({
      id: payload.id,
      external_reference: `modo:${accountId}:${plan}`,
      init_point: payload.init_point,
      status: payload.status || "pending",
      payer_email: payerEmail,
    });

    return { id: payload.id, checkoutUrl: payload.init_point, status: payload.status || "pending" };
  }

  validateWebhookSignature(xSignature: string, xRequestId: string, dataId: string) {
    if (!this.webhookSecret) {
      throw new PaymentError("WEBHOOK_NOT_CONFIGURED", 503, "Webhook de pagamentos não configurado.");
    }
    const values = Object.fromEntries(
      xSignature.split(",").map((item) => {
        const [key, value] = item.trim().split("=");
        return [key, value];
      }),
    );
    const ts = values.ts;
    const received = values.v1;
    if (!ts || !received || !xRequestId || !dataId) {
      throw new PaymentError("INVALID_WEBHOOK_SIGNATURE", 401, "Assinatura inválida.");
    }
    const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
    const expected = createHmac("sha256", this.webhookSecret).update(manifest).digest("hex");
    const receivedBuffer = Buffer.from(received, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new PaymentError("INVALID_WEBHOOK_SIGNATURE", 401, "Assinatura inválida.");
    }
  }

  async fetchSubscription(providerId: string) {
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(providerId)}`, {
      headers: { authorization: `Bearer ${this.requireAccessToken()}` },
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<MercadoPagoSubscription> & {
      message?: string;
    };
    if (!response.ok || !payload.id || !payload.status) {
      throw new PaymentError(
        "SUBSCRIPTION_LOOKUP_FAILED",
        502,
        payload.message || "Não foi possível consultar a assinatura.",
      );
    }
    const parsed = this.parseExternalReference(payload.external_reference || "");
    await this.persist(payload as MercadoPagoSubscription);
    return { ...payload, ...parsed };
  }

  private parseExternalReference(reference: string) {
    const match = /^modo:([a-zA-Z0-9-]+):(start|presenca|pro|business)$/.exec(reference);
    if (!match) {
      throw new PaymentError("INVALID_EXTERNAL_REFERENCE", 400, "Referência de assinatura inválida.");
    }
    return { accountId: match[1], plan: match[2] as PublicPlanSlug };
  }

  private async persist(subscription: MercadoPagoSubscription) {
    if (!this.pool) return;
    const parsed = this.parseExternalReference(subscription.external_reference || "");
    await this.pool.query(
      `INSERT INTO modo_payment_subscriptions(
        provider_id, account_id, plan_slug, status, checkout_url, payer_email, raw
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (provider_id) DO UPDATE SET
        status = EXCLUDED.status,
        checkout_url = COALESCE(EXCLUDED.checkout_url, modo_payment_subscriptions.checkout_url),
        payer_email = COALESCE(EXCLUDED.payer_email, modo_payment_subscriptions.payer_email),
        raw = EXCLUDED.raw,
        updated_at = NOW()`,
      [
        subscription.id,
        parsed.accountId,
        parsed.plan,
        subscription.status,
        subscription.init_point || null,
        subscription.payer_email || null,
        JSON.stringify(subscription),
      ],
    );
  }

  private requireAccessToken() {
    if (!this.accessToken) {
      throw new PaymentError(
        "PAYMENTS_NOT_CONFIGURED",
        503,
        "Pagamentos ainda não estão configurados.",
      );
    }
    return this.accessToken;
  }
}
