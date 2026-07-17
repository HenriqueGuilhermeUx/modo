import { DiagnosticResultSchema, type DiagnosticCreateRequest, type DiagnosticResult } from "@modo/contracts";
import type { DiagnosticProvider } from "./diagnostic-provider.js";

export class N8nDiagnosticProvider implements DiagnosticProvider {
  constructor(private readonly webhookUrl: string, private readonly secret = "") {}

  async generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {"content-type": "application/json", ...(this.secret ? {"x-modo-secret": this.secret} : {})},
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`O workflow respondeu com status ${response.status}.`);
      return DiagnosticResultSchema.parse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
}
