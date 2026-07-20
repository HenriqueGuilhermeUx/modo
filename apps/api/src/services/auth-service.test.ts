import { describe, expect, it } from "vitest";
import { AuthError, AuthService } from "./auth-service.js";

describe("AuthService", () => {
  it("registers an organization and authenticates its session", async () => {
    const service = new AuthService({ sessionDays: 30 });
    const session = await service.register({
      name: "Henrique",
      email: "henrique@example.com",
      password: "Modo1234",
      organizationName: "Marca teste",
    });

    const context = await service.authenticate(session.token);
    expect(context.user.email).toBe("henrique@example.com");
    expect(context.organization.name).toBe("Marca teste");
    expect(context.organization.role).toBe("owner");
  });

  it("rejects invalid credentials without exposing account details", async () => {
    const service = new AuthService();
    await service.register({
      name: "Pessoa",
      email: "pessoa@example.com",
      password: "Senha123",
      organizationName: "Empresa",
    });

    await expect(
      service.login({ email: "pessoa@example.com", password: "SenhaErrada1" }),
    ).rejects.toMatchObject<Partial<AuthError>>({ code: "INVALID_CREDENTIALS" });
  });

  it("keeps brands isolated by organization", async () => {
    const service = new AuthService();
    const first = await service.register({
      name: "Primeira",
      email: "primeira@example.com",
      password: "Senha123",
      organizationName: "Primeira org",
    });
    const second = await service.register({
      name: "Segunda",
      email: "segunda@example.com",
      password: "Senha123",
      organizationName: "Segunda org",
    });

    await service.createBrand(first.organization.id, {
      name: "Marca um",
      websiteUrl: "https://example.com",
      instagramHandle: "@marcaum",
      niche: "servicos_profissionais",
    });

    expect(await service.listBrands(first.organization.id)).toHaveLength(1);
    expect(await service.listBrands(second.organization.id)).toHaveLength(0);
  });

  it("invalidates the session after logout", async () => {
    const service = new AuthService();
    const session = await service.register({
      name: "Pessoa",
      email: "logout@example.com",
      password: "Senha123",
      organizationName: "Empresa",
    });

    await service.logout(session.token);
    await expect(service.authenticate(session.token)).rejects.toMatchObject<Partial<AuthError>>({
      code: "UNAUTHORIZED",
    });
  });
});
