import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.js";

type OpenAiAdsAccount = {
  id: string;
  name?: string;
  legal_name?: string;
  account_name?: string;
  brand_name?: string;
  url?: string | null;
  preview_url?: string | null;
  status?: string;
  timezone?: string;
  currency_code?: string;
  review?: { status?: string; reason?: string | null } | null;
  account_integrity_review?: { review?: { status?: string; reason?: string | null } | null } | null;
};

function bearerToken(request: { headers: { authorization?: string } }) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  return value.slice(7).trim();
}

export async function registerOpenAiAdsRoutes(
  app: FastifyInstance,
  options: { auth: AuthService; apiKey?: string },
) {
  app.get(
    "/api/v1/media/openai-ads/account",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        await options.auth.authenticate(bearerToken(request));
      } catch {
        return reply.code(401).send({ code: "UNAUTHORIZED", message: "Faça login para continuar." });
      }

      if (!options.apiKey) {
        return reply.code(503).send({
          code: "OPENAI_ADS_NOT_CONFIGURED",
          message: "ChatGPT Ads ainda não está configurado na MODO.",
        });
      }

      const response = await fetch("https://api.ads.openai.com/v1/ad_account", {
        method: "GET",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      const raw = await response.text();
      let payload: unknown = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        request.log.warn({ status: response.status }, "OpenAI Ads account validation failed");
        return reply.code(response.status === 401 ? 401 : 502).send({
          code: response.status === 401 ? "OPENAI_ADS_INVALID_KEY" : "OPENAI_ADS_UPSTREAM_ERROR",
          message:
            response.status === 401
              ? "A chave do ChatGPT Ads não foi aceita."
              : "Não foi possível consultar a conta do ChatGPT Ads agora.",
        });
      }

      const account = payload as OpenAiAdsAccount;
      return {
        provider: "openai_ads",
        mode: "read_only",
        connected: true,
        account: {
          id: account.id,
          name: account.account_name || account.brand_name || account.name || null,
          legalName: account.legal_name || account.name || null,
          brandName: account.brand_name || null,
          url: account.url || null,
          status: account.status || null,
          timezone: account.timezone || null,
          currencyCode: account.currency_code || null,
          review: account.review || null,
          accountIntegrityReview: account.account_integrity_review || null,
        },
      };
    },
  );
}
