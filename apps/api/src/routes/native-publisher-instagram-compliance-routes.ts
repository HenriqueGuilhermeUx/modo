import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import pg, { type Pool } from "pg";
import { NativePublisherV2Error } from "../services/native-publisher-v2-service.js";

const { Pool: PgPool } = pg;

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  instagramClientSecret?: string;
  publicWebUrl?: string;
}

function signedRequestFrom(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return String((body as { signed_request?: unknown }).signed_request || "").trim();
}

export async function registerNativePublisherInstagramComplianceRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const pool: Pool | undefined = options.databaseUrl
    ? new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      })
    : undefined;

  app.addHook("onClose", async () => {
    await pool?.end();
  });

  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modo_instagram_data_deletions (
        confirmation_code TEXT PRIMARY KEY,
        instagram_user_id TEXT NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  function decodeSignedRequest(value: string) {
    if (!options.instagramClientSecret) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_CLIENT_SECRET_MISSING",
        503,
        "A validação do callback da Meta não está configurada.",
      );
    }
    const [signaturePart, payloadPart] = value.split(".");
    if (!signaturePart || !payloadPart) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_INVALID",
        400,
        "signed_request inválido.",
      );
    }
    const expected = createHmac("sha256", options.instagramClientSecret)
      .update(payloadPart)
      .digest();
    const received = Buffer.from(signaturePart, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_INVALID",
        400,
        "Assinatura da Meta inválida.",
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_INVALID",
        400,
        "Payload da Meta inválido.",
      );
    }
    const algorithm = String(payload.algorithm || "HMAC-SHA256").toUpperCase();
    if (algorithm !== "HMAC-SHA256") {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_ALGORITHM_INVALID",
        400,
        "Algoritmo de assinatura da Meta não suportado.",
      );
    }
    const instagramUserId = String(payload.user_id || "").trim();
    if (!instagramUserId) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_USER_MISSING",
        400,
        "A Meta não informou o usuário da solicitação.",
      );
    }
    return instagramUserId;
  }

  async function deleteInstagramUserData(instagramUserId: string) {
    if (!pool) {
      throw new NativePublisherV2Error(
        "PUBLISHER_STORAGE_REQUIRED",
        503,
        "A exclusão de dados exige PostgreSQL.",
      );
    }
    await pool.query("BEGIN");
    try {
      await pool.query(
        "DELETE FROM modo_instagram_publications WHERE instagram_user_id=$1",
        [instagramUserId],
      );
      await pool.query(
        "DELETE FROM modo_instagram_connections WHERE instagram_user_id=$1",
        [instagramUserId],
      );
      await pool.query(
        `DELETE FROM modo_native_social_connections
         WHERE provider='instagram' AND provider_account_id=$1`,
        [instagramUserId],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  app.post("/api/v2/publisher/instagram/deauthorize", async (request) => {
    const signedRequest = signedRequestFrom(request.body);
    if (!signedRequest) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_MISSING",
        400,
        "A Meta não enviou o signed_request esperado.",
      );
    }
    const instagramUserId = decodeSignedRequest(signedRequest);
    await deleteInstagramUserData(instagramUserId);
    return { deauthorized: true };
  });

  app.post("/api/v2/publisher/instagram/data-deletion", async (request) => {
    const signedRequest = signedRequestFrom(request.body);
    if (!signedRequest) {
      throw new NativePublisherV2Error(
        "INSTAGRAM_SIGNED_REQUEST_MISSING",
        400,
        "A Meta não enviou o signed_request esperado.",
      );
    }
    const instagramUserId = decodeSignedRequest(signedRequest);
    await deleteInstagramUserData(instagramUserId);
    const confirmationCode = randomBytes(18).toString("hex");
    await pool?.query(
      `INSERT INTO modo_instagram_data_deletions(
         confirmation_code,instagram_user_id,requested_at,completed_at
       ) VALUES($1,$2,NOW(),NOW())
       ON CONFLICT(confirmation_code) DO NOTHING`,
      [confirmationCode, instagramUserId],
    );
    const url = new URL(
      "/exclusao-de-dados",
      options.publicWebUrl || "http://localhost:5173",
    );
    url.searchParams.set("confirmation_code", confirmationCode);
    return { url: url.toString(), confirmation_code: confirmationCode };
  });
}
