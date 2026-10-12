import { randomUUID } from "node:crypto";
import type { CreativeProviderJob } from "./creative-engine-service.js";

/**
 * Isolated read-only MoneyPrinterTurbo transport.
 * Deliberately not registered as a CreativeProvider: generation must remain disabled
 * until tenant-scoped job storage, billing approval and output ingestion are implemented.
 */
export class MoneyPrinterTurboReadOnlyClient {
  private readonly baseUrl: string;
  constructor(baseUrl: string, private readonly apiKey: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/") {
      throw new Error("MoneyPrinterTurbo requires a private HTTPS base URL");
    }
    if (!apiKey) throw new Error("MoneyPrinterTurbo API key missing");
    // Explicitly approved private worker endpoint; never accept arbitrary user-provided URLs.
    this.baseUrl = url.origin;
  }

  private async get(path: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(this.baseUrl + path, {
        headers: { "x-api-key": this.apiKey },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error(`MoneyPrinterTurbo HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkAuthentication(): Promise<boolean> {
    // An upstream with empty app.api_key accepts any key: test rejection first.
    const invalidKey = "modo-invalid-" + randomUUID();
    const response = await fetch(this.baseUrl + "/api/v1/tasks?page=1&page_size=1", {
      headers: { "x-api-key": invalidKey },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 401) return false;
    const valid = await this.get("/api/v1/tasks?page=1&page_size=1");
    return valid?.status === 200 && Array.isArray(valid?.data?.tasks);
  }

  async getJob(taskId: string): Promise<CreativeProviderJob> {
    if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error("Invalid task ID");
    const body = await this.get(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
    if (body?.status !== 200 || body?.data?.task_id !== taskId) throw new Error("Unexpected upstream task response");
    const data = body.data;
    // Upstream numeric states must be mapped against a pinned version before
    // claiming a completed asset. Fail closed and never expose /tasks URLs.
    return { provider: "moneyprinterturbo", providerJobId: taskId,
      status: "processing", assets: [],
      error: data.error ? String(data.error) : undefined };
  }
}
