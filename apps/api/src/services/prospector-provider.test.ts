import { afterEach, describe, expect, it, vi } from "vitest";
import { ApifyProspectorProvider } from "./prospector-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("ApifyProspectorProvider", () => {
  it("uses bearer auth, task endpoint, template variables and normalizes nested leads", async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      expect(String(url)).toContain("/actor-tasks/task-123/run-sync-get-dataset-items");
      expect(String(url)).toContain("maxItems=5");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-secret");
      const body = JSON.parse(String(init?.body));
      expect(body.queries).toEqual(["SaaS B2B founders Brasil"]);
      expect(body.limit).toBe(5);
      return new Response(JSON.stringify({
        data: {
          people: [
            {
              person: { name: "Ana Souza", title: "Founder", email: "ana@example.com" },
              company: { name: "Acme", website: "https://acme.example" },
              linkedinUrl: "https://linkedin.com/in/ana",
              location: "Brasil",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApifyProspectorProvider({
      token: "token-secret",
      taskId: "task-123",
      inputTemplateJson: JSON.stringify({ queries: ["{{segment}} {{roles}} {{location}}"], limit: "{{limit}}" }),
    });
    const leads = await provider.discover({ segment: "SaaS B2B", roles: ["founders"], location: "Brasil", limit: 5 });
    expect(provider.configured).toBe(true);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: "Ana Souza", role: "Founder", company: "Acme", email: "ana@example.com" });
  });

  it("deduplicates people by name and company", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { name: "João Lima", company: "Beta", title: "CEO" },
      { fullName: "João Lima", companyName: "Beta", jobTitle: "CEO" },
    ]), { status: 200 })));
    const provider = new ApifyProspectorProvider({ token: "t", actorId: "user~actor" });
    const leads = await provider.discover({ segment: "serviços", roles: ["CEO"], limit: 10 });
    expect(leads).toHaveLength(1);
  });
});
