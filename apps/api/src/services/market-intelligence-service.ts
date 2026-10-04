export type MarketPageSnapshot = {
  url: string;
  title?: string | null;
  text: string;
  fetchedAt: string;
  provider: "scrapling";
};

export class MarketIntelligenceError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

function cleanBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

export class MarketIntelligenceService {
  private changeDetectionBaseUrl: string;
  private scraplingBaseUrl: string;

  constructor(
    private options: {
      changeDetectionBaseUrl?: string;
      changeDetectionApiKey?: string;
      scraplingBaseUrl?: string;
      scraplingApiKey?: string;
    },
  ) {
    this.changeDetectionBaseUrl = cleanBaseUrl(options.changeDetectionBaseUrl);
    this.scraplingBaseUrl = cleanBaseUrl(options.scraplingBaseUrl);
  }

  get capabilities() {
    return {
      changeDetection: {
        configured: Boolean(this.changeDetectionBaseUrl && this.options.changeDetectionApiKey),
        mode: "adapter",
      },
      scrapling: {
        configured: Boolean(this.scraplingBaseUrl),
        mode: "adapter",
      },
    };
  }

  async createWatch(input: { url: string; title?: string; tag?: string }) {
    if (!this.capabilities.changeDetection.configured) {
      throw new MarketIntelligenceError("CHANGE_DETECTION_NOT_CONFIGURED", 503, "Monitoramento contínuo ainda não está configurado.");
    }
    const response = await fetch(`${this.changeDetectionBaseUrl}/api/v1/watch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.changeDetectionApiKey!,
      },
      body: JSON.stringify({
        url: input.url,
        title: input.title,
        tag: input.tag,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new MarketIntelligenceError("CHANGE_DETECTION_UPSTREAM_ERROR", 502, "Não foi possível criar o monitor agora.");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return { provider: "changedetection", watch: payload };
  }

  async listWatches() {
    if (!this.capabilities.changeDetection.configured) {
      throw new MarketIntelligenceError("CHANGE_DETECTION_NOT_CONFIGURED", 503, "Monitoramento contínuo ainda não está configurado.");
    }
    const response = await fetch(`${this.changeDetectionBaseUrl}/api/v1/watch`, {
      headers: { "x-api-key": this.options.changeDetectionApiKey! },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new MarketIntelligenceError("CHANGE_DETECTION_UPSTREAM_ERROR", 502, "Não foi possível consultar os monitores agora.");
    }
    return { provider: "changedetection", watches: await response.json() };
  }

  async inspectPage(url: string): Promise<MarketPageSnapshot> {
    if (!this.capabilities.scrapling.configured) {
      throw new MarketIntelligenceError("SCRAPLING_NOT_CONFIGURED", 503, "Web Intelligence ainda não está configurado.");
    }
    const response = await fetch(`${this.scraplingBaseUrl}/extract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.scraplingApiKey ? { authorization: `Bearer ${this.options.scraplingApiKey}` } : {}),
      },
      body: JSON.stringify({ url, output: "text" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new MarketIntelligenceError("SCRAPLING_UPSTREAM_ERROR", 502, "Não foi possível analisar esta página agora.");
    }
    const payload = (await response.json()) as { title?: string; text?: string; content?: string };
    return {
      url,
      title: payload.title || null,
      text: String(payload.text || payload.content || "").slice(0, 100_000),
      fetchedAt: new Date().toISOString(),
      provider: "scrapling",
    };
  }
}
