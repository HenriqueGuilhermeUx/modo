import { describe, expect, it } from "vitest";
import { NativePublisherV2Service } from "./native-publisher-v2-service.js";

describe("NativePublisherV2Service", () => {
  it("mantém providers desligados sem credenciais", () => {
    const service = new NativePublisherV2Service({});
    expect(service.storage).toBe("memory");
    expect(service.providers).toEqual({
      instagram: false,
      facebook: false,
      threads: false,
      linkedin: false,
    });
  });

  it("detecta os quatro conectores nativos configurados", () => {
    const service = new NativePublisherV2Service({
      instagramEncryptionSecret: "instagram-secret",
      facebookAppId: "facebook-id",
      facebookAppSecret: "facebook-secret",
      facebookRedirectUri: "https://example.com/facebook/callback",
      threadsAppId: "threads-id",
      threadsAppSecret: "threads-secret",
      threadsRedirectUri: "https://example.com/threads/callback",
      linkedinEncryptionSecret: "linkedin-secret",
    });
    expect(service.providers).toEqual({
      instagram: true,
      facebook: true,
      threads: true,
      linkedin: true,
    });
  });

  it("normaliza escopos do Threads", () => {
    const service = new NativePublisherV2Service({
      threadsScopes: "threads_basic, threads_content_publish threads_manage_insights",
    });
    expect(service.threadsScopes).toEqual([
      "threads_basic",
      "threads_content_publish",
      "threads_manage_insights",
    ]);
  });
});
