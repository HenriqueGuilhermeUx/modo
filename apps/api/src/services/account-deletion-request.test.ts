import { describe, expect, it } from "vitest";
import { AuthService } from "./auth-service.js";

describe("account deletion request intake", () => {
  it("returns a durable reference without deleting a user or logging out", async () => {
    const auth = new AuthService();
    try {
      const first = await auth.requestAccountDeletion("user-1", "org-1");
      expect(first.status).toBe("pending");
      expect(first.id).toBeTruthy();
      expect(new Date(first.createdAt).toString()).not.toBe("Invalid Date");

      const again = await auth.requestAccountDeletion("user-1", "org-1");
      expect(again).toEqual(first);
      const anotherUser = await auth.requestAccountDeletion("user-2", "org-1");
      expect(anotherUser.id).not.toBe(first.id);
    } finally {
      await auth.close();
    }
  });
});
