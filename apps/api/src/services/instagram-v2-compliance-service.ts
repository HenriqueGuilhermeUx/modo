import { createHmac, timingSafeEqual } from "node:crypto";
import pg, { type Pool } from "pg";
import { InstagramError } from "./instagram-service.js";

const { Pool: PgPool } = pg;

type SignedRequestPayload = {
  user_id?: string | number;
  algorithm?: string;
  [key: string]: unknown;
};

interface Options {
  databaseUrl?: string;
  databaseSsl?: boolean;
  clientSecret?: string;
}

export class InstagramV2ComplianceService {
  private readonly pool?: Pool;

  constructor(private readonly options: Options = {}) {
    if (options.databaseUrl) {
      this.pool = new PgPool({
        connectionString: options.databaseUrl,
        ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 2,
      });
    }
  }

  async close() {
    await this.pool?.end();
  }

  async deleteForSignedRequest(signedRequest: string) {
    const instagramUserId = this.userIdFromSignedRequest(signedRequest);
    if (!this.pool) return { instagramUserId, deletedConnections: 0 };

    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM modo_native_social_connections
       WHERE provider='instagram' AND provider_account_id=$1
       RETURNING id`,
      [instagramUserId],
    );

    return {
      instagramUserId,
      deletedConnections: result.rowCount || 0,
    };
  }

  private userIdFromSignedRequest(value: string) {
    if (!this.options.clientSecret) {
      throw new InstagramError(
        "INSTAGRAM_CLIENT_SECRET_MISSING",
        503,
        "O segredo do aplicativo Instagram não está configurado para validar a solicitação.",
      );
    }

    const [encodedSignature, encodedPayload] = value.split(".");
    if (!encodedSignature || !encodedPayload) {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "signed_request inválido.");
    }

    const expected = createHmac("sha256", this.options.clientSecret).update(encodedPayload).digest();
    let received: Buffer;
    try {
      received = Buffer.from(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    } catch {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Assinatura da Meta inválida.");
    }

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Assinatura da Meta inválida.");
    }

    let payload: SignedRequestPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SignedRequestPayload;
    } catch {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Conteúdo do signed_request inválido.");
    }

    if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
      throw new InstagramError("INSTAGRAM_SIGNED_REQUEST_INVALID", 400, "Algoritmo do signed_request não suportado.");
    }

    const instagramUserId = String(payload.user_id || "").trim();
    if (!instagramUserId) {
      throw new InstagramError(
        "INSTAGRAM_SIGNED_REQUEST_USER_MISSING",
        400,
        "A Meta não informou o usuário da solicitação.",
      );
    }
    return instagramUserId;
  }
}
