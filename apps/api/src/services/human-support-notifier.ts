type HumanSupportNotification = {
  requestId: string;
  requesterEmail: string;
  brandId: string;
  contentRequestId: string | null;
  supportType: string;
  urgency: string;
  createdAt: string;
};

interface Options {
  resendApiKey?: string;
  emailFrom?: string;
  emailTo?: string;
  webhookUrl?: string;
  publicWebUrl?: string;
  timeoutMs?: number;
}

export class HumanSupportNotifier {
  private readonly resendApiKey?: string;
  private readonly emailFrom?: string;
  private readonly emailTo: string;
  private readonly webhookUrl?: string;
  private readonly publicWebUrl: string;
  private readonly timeoutMs: number;

  constructor(options: Options = {}) {
    this.resendApiKey = options.resendApiKey?.trim() || undefined;
    this.emailFrom = options.emailFrom?.trim() || undefined;
    this.emailTo = options.emailTo?.trim() || "henriquecampos@gmail.com";
    this.webhookUrl = options.webhookUrl?.trim() || undefined;
    this.publicWebUrl = (options.publicWebUrl || "http://localhost:5173").replace(/\/$/, "");
    this.timeoutMs = Math.min(15_000, Math.max(1_000, options.timeoutMs || 8_000));
  }

  get configured() {
    return Boolean((this.resendApiKey && this.emailFrom) || this.webhookUrl);
  }

  async notifyNewRequest(notification: HumanSupportNotification) {
    const adminUrl = `${this.publicWebUrl}/admin/rede`;
    const subject = `[MODO] Novo pedido de curadoria · ${notification.supportType}`;
    const lines = [
      "Novo pedido de Curadoria Modo recebido.",
      "",
      `Tipo: ${notification.supportType}`,
      `Prioridade: ${notification.urgency}`,
      `Solicitante: ${notification.requesterEmail}`,
      `Marca: ${notification.brandId}`,
      notification.contentRequestId ? `Conteúdo relacionado: ${notification.contentRequestId}` : "",
      `Pedido: ${notification.requestId}`,
      `Recebido em: ${notification.createdAt}`,
      "",
      `Abrir a fila interna: ${adminUrl}`,
      "",
      "O contexto completo permanece protegido dentro da MODO.",
    ].filter(Boolean);
    const text = lines.join("\n");
    const attempts: Promise<void>[] = [];

    if (this.resendApiKey && this.emailFrom) {
      attempts.push(this.sendEmail({ subject, text, adminUrl }));
    }
    if (this.webhookUrl) {
      attempts.push(this.sendWebhook({ ...notification, subject, adminUrl }));
    }

    if (!attempts.length) {
      console.warn("[MODO_HUMAN_SUPPORT_NOTIFICATION_NOT_CONFIGURED]", {
        requestId: notification.requestId,
        emailTo: this.emailTo,
      });
      return;
    }

    const results = await Promise.allSettled(attempts);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length) {
      throw new Error("Nenhum canal conseguiu enviar a notificação de curadoria.");
    }
    if (failures.length) {
      console.warn("[MODO_HUMAN_SUPPORT_NOTIFICATION_PARTIAL_FAILURE]", {
        requestId: notification.requestId,
        failures: failures.length,
      });
    }
  }

  private async sendEmail(input: { subject: string; text: string; adminUrl: string }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.emailFrom,
        to: [this.emailTo],
        subject: input.subject,
        text: input.text,
        html: `<div style="font-family:Arial,sans-serif;color:#0d1b3e;line-height:1.6"><h2>Novo pedido de Curadoria Modo</h2><p>${input.text.replace(/\n/g, "<br>")}</p><p><a href="${input.adminUrl}">Abrir fila interna</a></p></div>`,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Resend respondeu ${response.status}: ${detail}`);
    }
  }

  private async sendWebhook(payload: Record<string, unknown>) {
    const response = await fetch(this.webhookUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Webhook respondeu ${response.status}: ${detail}`);
    }
  }
}
