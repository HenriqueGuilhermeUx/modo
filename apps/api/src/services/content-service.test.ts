import { describe, expect, it } from "vitest";
import { ContentService } from "./content-service.js";

describe("ContentService", () => {
  it("creates queued requests and isolates them by organization", async () => {
    const service = new ContentService();
    const first = await service.create(
      "request-one",
      "organization-one",
      {
        brandId: "550e8400-e29b-41d4-a716-446655440000",
        contentType: "carousel",
        objective: "autoridade",
        brief: "Apresentar a proposta da marca de forma educativa.",
        channel: "Instagram",
      },
      2,
    );

    expect(first.status).toBe("queued");
    expect(first.creditsCharged).toBe(2);
    expect(await service.list("organization-one")).toHaveLength(1);
    expect(await service.list("organization-two")).toHaveLength(0);
  });
});
