import type { ContentRequest } from "@modo/contracts/content";
import { describe, expect, it, vi } from "vitest";
import { PostizService } from "./postiz-service.js";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const approvedRequest: ContentRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  brandId: "22222222-2222-4222-8222-222222222222",
  contentType: "static_post",
  objective: "autoridade",
  brief: "Mostre como a MODO transforma contexto em presença digital consistente.",
  channel: "Instagram",
  status: "approved",
  creditsCharged: 1,
  revisionCount: 0,
  maxRevisions: 2,
  revisionInstructions: null,
  output: {
    hook: "Conteúdo sem contexto vira ruído.",
    title: "Contexto antes de conteúdo",
    caption: "A MODO organiza contexto, cria e aprende com o que realmente funciona.",
    cta: "Construa presença com intenção.",
    hashtags: ["modo", "marketing"],
    visualDirection: "Fundo claro, tipografia editorial e destaque para a mensagem central.",
    slides: [],
    script: [],
    storyFrames: [],
    adaptationNotes: [],
    imagePrompt: "Editorial visual for a modern marketing platform",
    imageAlt: "Peça editorial da MODO",
    imageUrl: "https://cdn.example.com/modo-post.png",
    imageStatus: "generated",
    visualAssets: [],
  },
  error: null,
  providerRunId: "run-1",
  approvedAt: "2026-08-19T20:00:00.000Z",
  createdAt: "2026-08-19T19:00:00.000Z",
  updatedAt: "2026-08-19T20:00:00.000Z",
};

describe("PostizService", () => {
  it("conecta um novo canal e o associa à marca que iniciou o OAuth", async () => {
    let integrationCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/integrations")) {
        integrationCalls += 1;
        return json(
          integrationCalls === 1
            ? []
            : [
                {
                  id: "integration-instagram-1",
                  name: "@modo",
                  identifier: "instagram",
                  profile: "modo",
                  disabled: false,
                },
              ],
        );
      }
      if (input.endsWith("/social/instagram")) {
        return json({ url: "https://www.instagram.com/oauth/authorize?client_id=postiz" });
      }
      return json({ message: "unexpected" }, 404);
    });

    const service = new PostizService({ apiKey: "test-key", fetcher });
    const started = await service.startConnection(
      "org-1",
      approvedRequest.brandId,
      "instagram",
    );
    expect(started.authorizationUrl).toContain("instagram.com/oauth/authorize");

    const claimed = await service.claimConnection("org-1", started.pendingId);
    expect(claimed.status).toBe("connected");
    expect(claimed.integrations).toHaveLength(1);
    expect(claimed.integrations[0]).toMatchObject({
      id: "integration-instagram-1",
      brandId: approvedRequest.brandId,
      identifier: "instagram",
      disabled: false,
    });
  });

  it("publica peça aprovada usando mídia hospedada pela MODO", async () => {
    let integrationCalls = 0;
    let postPayload: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/integrations")) {
        integrationCalls += 1;
        return json(
          integrationCalls === 1
            ? []
            : [
                {
                  id: "integration-instagram-1",
                  name: "@modo",
                  identifier: "instagram",
                  profile: "modo",
                  disabled: false,
                },
              ],
        );
      }
      if (input.endsWith("/social/instagram")) {
        return json({ url: "https://www.instagram.com/oauth/authorize?client_id=postiz" });
      }
      if (input.endsWith("/upload-from-url")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          url: approvedRequest.output?.imageUrl,
        });
        return json({ id: "media-1", path: "https://uploads.example.com/media-1.png" });
      }
      if (input.endsWith("/posts")) {
        postPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json([{ postId: "postiz-post-1", integration: "integration-instagram-1" }]);
      }
      return json({ message: "unexpected" }, 404);
    });

    const service = new PostizService({ apiKey: "test-key", fetcher });
    const started = await service.startConnection("org-1", approvedRequest.brandId, "instagram");
    await service.claimConnection("org-1", started.pendingId);

    const publications = await service.publish("org-1", approvedRequest, {
      integrationIds: ["integration-instagram-1"],
      mode: "now",
    });

    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({
      postizPostId: "postiz-post-1",
      integrationId: "integration-instagram-1",
      platform: "instagram",
      status: "submitted",
    });
    expect(postPayload).toMatchObject({ type: "now", shortLink: false });
    const posts = postPayload?.posts as Array<Record<string, unknown>>;
    expect(posts[0]).toMatchObject({
      integration: { id: "integration-instagram-1" },
      settings: { __type: "instagram", post_type: "post" },
    });
  });

  it("normaliza analytics e gera sinal forte para o aprendizado da MODO", async () => {
    let integrationCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/integrations")) {
        integrationCalls += 1;
        return json(
          integrationCalls === 1
            ? []
            : [
                {
                  id: "integration-instagram-1",
                  name: "@modo",
                  identifier: "instagram",
                  profile: "modo",
                  disabled: false,
                },
              ],
        );
      }
      if (input.endsWith("/social/instagram")) {
        return json({ url: "https://www.instagram.com/oauth/authorize?client_id=postiz" });
      }
      if (input.endsWith("/upload-from-url")) {
        return json({ id: "media-1", path: "https://uploads.example.com/media-1.png" });
      }
      if (input.endsWith("/posts")) {
        return json([{ postId: "postiz-post-1", integration: "integration-instagram-1" }]);
      }
      if (input.includes("/analytics/post/postiz-post-1")) {
        return json([
          { label: "Impressions", data: [{ total: 1000, date: "2026-08-19" }] },
          { label: "Likes", data: [{ total: 50, date: "2026-08-19" }] },
          { label: "Comments", data: [{ total: 10, date: "2026-08-19" }] },
          { label: "Shares", data: [{ total: 5, date: "2026-08-19" }] },
        ]);
      }
      return json({ message: "unexpected" }, 404);
    });

    const service = new PostizService({ apiKey: "test-key", fetcher });
    const started = await service.startConnection("org-1", approvedRequest.brandId, "instagram");
    await service.claimConnection("org-1", started.pendingId);
    const [publication] = await service.publish("org-1", approvedRequest, {
      integrationIds: ["integration-instagram-1"],
      mode: "now",
    });

    const result = await service.refreshAnalytics("org-1", publication.id, 30);
    expect(result.summary.normalized).toMatchObject({
      exposure: 1000,
      likes: 50,
      comments: 10,
      shares: 5,
    });
    expect(result.summary.engagementRate).toBeCloseTo(8.5);
    expect(result.summary.score).toBe(85);
    expect(result.summary.learningSignal).toBe("performed_well");
  });
});
