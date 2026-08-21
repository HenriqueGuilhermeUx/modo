import type { NativeConnection } from "@modo/contracts/native-publisher";

export function connectionCanPublish(connection: NativeConnection) {
  if (!connection.connected) return false;
  const scopes = new Set(connection.scopes);
  if (connection.provider === "instagram") return scopes.has("instagram_business_content_publish");
  if (connection.provider === "facebook") return scopes.has("pages_manage_posts");
  if (connection.provider === "threads") return scopes.has("threads_content_publish");
  if (connection.provider === "linkedin") {
    return connection.metadata?.authorType === "organization"
      ? scopes.has("w_organization_social")
      : scopes.has("w_member_social");
  }
  return false;
}
