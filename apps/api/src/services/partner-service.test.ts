import { describe, expect, it } from "vitest";
import { PartnerError, PartnerService } from "./partner-service.js";

const application = {
  name: "Ana Partner",
  email: "ana@agency.test",
  whatsapp: "+5511999999999",
  companyName: "Agency Teste",
  city: "São Paulo/SP",
  websiteUrl: "https://agency.example.com",
  instagramUrl: "https://instagram.com/agencyteste",
  businessType: "agency" as const,
  activeClients: 8,
  monthlyServiceRevenueCents: 2500000,
  currentServices: ["Social media", "Criação de conteúdo"],
  whyPartner: "Queremos aumentar a capacidade da operação sem perder o relacionamento e a qualidade entregue aos clientes.",
  targetClientsWithModo: 12,
  consent: true as const,
};

describe("PartnerService", () => {
  it("recebe uma candidatura Founding Partner sem aprová-la automaticamente", async () => {
    const service = new PartnerService();
    const created = await service.createApplication(application);

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("received");
    expect(created.companyName).toBe("Agency Teste");
    expect(created.activeClients).toBe(8);
  });

  it("bloqueia candidatura duplicada da mesma empresa e e-mail", async () => {
    const service = new PartnerService();
    await service.createApplication(application);
    await expect(service.createApplication(application)).rejects.toBeInstanceOf(PartnerError);
  });
});
