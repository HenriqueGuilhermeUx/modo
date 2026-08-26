import { describe, expect, it } from "vitest";
import { VideoApprovalPublisherGuard } from "./video-approval-publisher-guard.js";

describe("VideoApprovalPublisherGuard", () => {
  it("mantém compatibilidade com vídeo legado sem linha de review", async () => {
    const guard = new VideoApprovalPublisherGuard();
    expect(await guard.canPublish("550e8400-e29b-41d4-a716-446655440010")).toBe(true);
  });

  it("bloqueia projeto novo com aprovação pendente", async () => {
    const guard = new VideoApprovalPublisherGuard();
    (guard as any).pool = {
      async query() {
        return { rows: [{ approval_status: "pending" }] };
      },
    };
    expect(await guard.canPublish("550e8400-e29b-41d4-a716-446655440010")).toBe(false);
  });

  it("libera projeto com aprovação final concluída", async () => {
    const guard = new VideoApprovalPublisherGuard();
    (guard as any).pool = {
      async query() {
        return { rows: [{ approval_status: "approved" }] };
      },
    };
    expect(await guard.canPublish("550e8400-e29b-41d4-a716-446655440010")).toBe(true);
  });
});
