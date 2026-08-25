import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InstagramV2ComplianceService } from "./instagram-v2-compliance-service.js";

const CLIENT_SECRET = randomBytes(32).toString("hex");

function signedRequest(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...payload }), "utf8")
    .toString("base64url");
  const signature = createHmac("sha256", CLIENT_SECRET).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

describe("InstagramV2ComplianceService", () => {
  it("aceita signed_request válido e identifica o usuário", async () => {
    const service = new InstagramV2ComplianceService({ clientSecret: CLIENT_SECRET });
    await expect(service.deleteForSignedRequest(signedRequest({ user_id: "17841400000000999" })))
      .resolves.toEqual({ instagramUserId: "17841400000000999", deletedConnections: 0 });
    await service.close();
  });

  it("rejeita signed_request adulterado", async () => {
    const service = new InstagramV2ComplianceService({ clientSecret: CLIENT_SECRET });
    const valid = signedRequest({ user_id: "17841400000000998" });
    const [signature, payload] = valid.split(".");
    await expect(service.deleteForSignedRequest(`${signature}x.${payload}`)).rejects.toMatchObject({
      code: "INSTAGRAM_SIGNED_REQUEST_INVALID",
      statusCode: 400,
    });
    await service.close();
  });
});
