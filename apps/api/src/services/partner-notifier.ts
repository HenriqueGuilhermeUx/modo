import type { PartnerApplication } from "@modo/contracts/strategy-network";

interface Options {
  resendApiKey?: string;
  emailFrom?: string;
  emailTo?: string;
  publicWebUrl?: string;
  timeoutMs?: number;
}

export class PartnerNotifier {
  private readonly resendApiKey?: string;
  private readonly emailFrom?: string;
  private readonly emailTo?: string;
  private readonly publicWebUrl: string;
  private readonly timeoutMs: number;

  constructor(options: Options = {}) {
    this.resendApiKey = options.resendApiKey?.trim() || undefined;
    this.emailFrom = options.emailFrom?.trim() || undefined;
    this.emailTo = options.emailTo?.trim() || undefined;
    this.publicWebUrl = (options.publicWebUrl || "http://localhost:5173").replace(/\/$/, "");
    this.timeoutMs = Math.min(15_000, Math.max(1_000, options.timeoutMs || 8_000));
  }

  get configured() {
    return Boolean(this.resendApiKey && this.emailFrom && this.emailTo);
  }

  async notify(application: PartnerApplication) {
    if (!this.configured) {
      console.warn("[MODO_PARTNER_NOTIFICATION_NOT_CONFIGURED]", { applicationId: application.id });
      return;
    }

    const subject = `[MODO Partner] Nova candidatura · ${application.companyName}`;
    const partnerUrl = `${this.publicWebUrl}/partners`;
    const text = [
      "Nova candidatura ao programa MODO Founding Partners.",
      "",
      `Empresa: ${application.companyName}`,
      `Responsável: ${application.name}`,
      `E-mail: ${application.email}`,
      `WhatsApp: ${application.whatsapp}`,
      `Tipo: ${application.businessType}`,
      `Clientes ativos: ${application.activeClients}`,
      `Meta de clientes com MODO: ${application.targetClientsWithModo}`,
      `Serviços atuais: ${application.currentServices.join(", ")}`,
      `Cidade: ${application.city || "não informada"}`,
      `Site: ${application.websiteUrl || "não informado"}`,
      `Instagram: ${application.instagramUrl || "não informado"}`,
      "",
      `Motivação: ${application.whyPartner}`,
      "",
      `Programa: ${partnerUrl}`,
      `Candidatura: ${application.id}`,
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.emailFrom,
        to: [this.emailTo],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Resend respondeu ${response.status}: ${detail}`);
    }
  }
}
