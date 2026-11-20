import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MAX_VIDEO_BYTES = 25_000_000;
const MAX_RETENTION_MS = 15 * 60_000;
const MAX_VAULT_BYTES = 100_000_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type EncryptedPreviewDescriptor = Readonly<{
  jobId: string;
  organizationId: string;
  projectId: string;
  mimeType: "video/mp4";
  bytes: number;
  sha256: string;
  expiresAt: number;
  encrypted: true;
  previewOnly: true;
  published: false;
}>;

type StoredPreview = {
  descriptor: EncryptedPreviewDescriptor;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
};

/**
 * In-process proof of private, authenticated AES-256-GCM MP4 storage.
 *
 * NO backend API route, bucket, database, persistent key store, durable queue,
 * public URL, publisher hook or production import. The isolated scheduler must
 * authenticate the organization independently before calling each method.
 * All bytes and the copied encryption key disappear at process shutdown.
 */
export class HyperframesStagingEncryptedVault {
  private readonly key: Buffer;
  private readonly entries = new Map<string, StoredPreview>();
  private storedBytes = 0;
  private closed = false;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxStoredBytes: number;

  constructor(options: Readonly<{
    key: Uint8Array;
    now?: () => number;
    retentionMs?: number;
    maxStoredBytes?: number;
  }>) {
    if (!(options?.key instanceof Uint8Array) || options.key.byteLength !== 32) {
      throw new Error("HYPERFRAMES_VAULT_INVALID_KEY");
    }
    const retentionMs = options.retentionMs ?? 10 * 60_000;
    const maxStoredBytes = options.maxStoredBytes ?? 50_000_000;
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 ||
        retentionMs > MAX_RETENTION_MS ||
        !Number.isSafeInteger(maxStoredBytes) || maxStoredBytes < 1 ||
        maxStoredBytes > MAX_VAULT_BYTES) {
      throw new Error("HYPERFRAMES_VAULT_INVALID_LIMITS");
    }
    // Never retain the caller's original, mutable key buffer.
    this.key = Buffer.from(options.key);
    this.now = options.now ?? Date.now;
    this.retentionMs = retentionMs;
    this.maxStoredBytes = maxStoredBytes;
  }

  private ensureStaging(): void {
    if (this.closed || process.env.NODE_ENV === "production" ||
        process.env.MODO_HYPERFRAMES_WORKER_MODE !== "isolated-staging" ||
        process.env.MODO_HYPERFRAMES_STORAGE_MODE !== "isolated-staging") {
      throw new Error("HYPERFRAMES_VAULT_DISABLED");
    }
  }

  private sweep(): void {
    for (const [jobId, entry] of this.entries) {
      if (this.now() >= entry.descriptor.expiresAt) {
        this.eraseEntry(jobId, entry);
      }
    }
  }

  private eraseEntry(jobId: string, entry: StoredPreview): void {
    entry.ciphertext.fill(0);
    entry.iv.fill(0);
    entry.tag.fill(0);
    this.storedBytes -= entry.descriptor.bytes;
    this.entries.delete(jobId);
  }

  private aad(descriptor: EncryptedPreviewDescriptor): Buffer {
    return Buffer.from(JSON.stringify([
      "modo-hyperframes-staging-v1",
      descriptor.organizationId,
      descriptor.projectId,
      descriptor.jobId,
      descriptor.bytes,
      descriptor.sha256,
      descriptor.expiresAt,
    ]));
  }

  put(input: Readonly<{
    jobId: string;
    projectId: string;
    organizationId: string;
    authorizedOrganizationId: string;
    video: Buffer;
  }>): EncryptedPreviewDescriptor {
    this.ensureStaging();
    this.sweep();
    if (!input || !ID.test(input.jobId || "") ||
        !ID.test(input.projectId || "") ||
        !ID.test(input.organizationId || "") ||
        input.organizationId !== input.authorizedOrganizationId) {
      throw new Error("HYPERFRAMES_VAULT_TENANT_OR_ID_DENIED");
    }
    if (!Buffer.isBuffer(input.video) ||
        input.video.length < 4000 || input.video.length > MAX_VIDEO_BYTES) {
      throw new Error("HYPERFRAMES_VAULT_INVALID_VIDEO_SIZE");
    }
    if (this.entries.has(input.jobId)) {
      throw new Error("HYPERFRAMES_VAULT_DUPLICATE_JOB");
    }
    if (this.storedBytes + input.video.length > this.maxStoredBytes) {
      throw new Error("HYPERFRAMES_VAULT_CAPACITY");
    }
    const descriptor: EncryptedPreviewDescriptor = {
      jobId: input.jobId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      mimeType: "video/mp4",
      bytes: input.video.length,
      sha256: createHash("sha256").update(input.video).digest("hex"),
      expiresAt: this.now() + this.retentionMs,
      encrypted: true,
      previewOnly: true,
      published: false,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(descriptor));
    const ciphertext = Buffer.concat([cipher.update(input.video), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.entries.set(input.jobId, { descriptor, iv, tag, ciphertext });
    this.storedBytes += descriptor.bytes;
    return { ...descriptor };
  }

  /**
   * Returns no bytes to other tenants. Successful reads are independent copies.
   * Authenticated decryption also verifies the tenant, job, project, size,
   * expiration and SHA-256 inside the AEAD-associated data.
   */
  read(jobId: string, authorizedOrganizationId: string): Buffer | null {
    this.ensureStaging();
    this.sweep();
    const entry = this.entries.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.descriptor.organizationId !== authorizedOrganizationId) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, entry.iv);
      decipher.setAAD(this.aad(entry.descriptor));
      decipher.setAuthTag(entry.tag);
      const bytes = Buffer.concat([decipher.update(entry.ciphertext), decipher.final()]);
      if (bytes.length !== entry.descriptor.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== entry.descriptor.sha256) {
        throw new Error("integrity");
      }
      return bytes;
    } catch {
      throw new Error("HYPERFRAMES_VAULT_ARTIFACT_INTEGRITY_FAILED");
    }
  }

  metadata(jobId: string, authorizedOrganizationId: string):
    EncryptedPreviewDescriptor | null {
    this.ensureStaging();
    this.sweep();
    const entry = this.entries.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.descriptor.organizationId !== authorizedOrganizationId) return null;
    return { ...entry.descriptor };
  }

  forget(jobId: string, authorizedOrganizationId: string): boolean {
    this.ensureStaging();
    this.sweep();
    const entry = this.entries.get(jobId);
    if (!entry || !authorizedOrganizationId ||
        entry.descriptor.organizationId !== authorizedOrganizationId) return false;
    this.eraseEntry(jobId, entry);
    return true;
  }

  /** Explicit teardown: discard ciphertext and zero the copied key. */
  close(): void {
    if (this.closed) return;
    for (const [id, entry] of this.entries) this.eraseEntry(id, entry);
    this.key.fill(0);
    this.closed = true;
  }
}
