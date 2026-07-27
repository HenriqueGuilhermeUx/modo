import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

function replaceOnce(source, search, replacement, label) {
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${occurrences}`);
  }
  return source.replace(search, replacement);
}

function patchFile(path, patches) {
  let source = readFileSync(path, "utf8");
  for (const patch of patches) {
    source = replaceOnce(source, patch.search, patch.replacement, `${path} · ${patch.label}`);
  }
  writeFileSync(path, source);
}

patchFile("apps/api/src/services/billing-service.ts", [
  {
    label: "owner configuration",
    search: `const { Pool: PgPool } = pg;\n`,
    replacement: `const { Pool: PgPool } = pg;\n\nconst DEFAULT_UNLIMITED_OWNER_EMAIL = "henriquecampos66@gmail.com";\nconst UNLIMITED_CREDIT_BALANCE = 1_000_000;\n\nfunction configuredUnlimitedOwnerEmails() {\n  return new Set(\n    (process.env.MODO_UNLIMITED_EMAILS || DEFAULT_UNLIMITED_OWNER_EMAIL)\n      .split(",")\n      .map((value) => value.trim().toLowerCase())\n      .filter(Boolean),\n  );\n}\n\nfunction configuredUnlimitedAccountIds() {\n  return new Set(\n    (process.env.MODO_UNLIMITED_ACCOUNT_IDS || "")\n      .split(",")\n      .map((value) => value.trim())\n      .filter(Boolean),\n  );\n}\n\nfunction unlimitedUsage(usage: BillingUsage): BillingUsage {\n  return {\n    ...usage,\n    status: "active",\n    creditsGranted: UNLIMITED_CREDIT_BALANCE,\n    creditsRemaining: UNLIMITED_CREDIT_BALANCE,\n    entitlements: {\n      ...planEntitlements.business,\n      monthlyCredits: UNLIMITED_CREDIT_BALANCE,\n      maxBrands: 1_000,\n      maxChannels: 1_000,\n      maxUsers: 1_000,\n      maxCarouselsPerMonth: UNLIMITED_CREDIT_BALANCE,\n      maxShortVideoScriptsPerMonth: UNLIMITED_CREDIT_BALANCE,\n      includedRevisionCycles: 100,\n    },\n  };\n}\n`,
  },
  {
    label: "owner fields",
    search: `  private readonly memoryLedger: MemoryLedgerEntry[] = [];\n`,
    replacement: `  private readonly memoryLedger: MemoryLedgerEntry[] = [];\n  private readonly unlimitedOwnerEmails = configuredUnlimitedOwnerEmails();\n  private readonly unlimitedAccountIds = configuredUnlimitedAccountIds();\n`,
  },
  {
    label: "owner billing bypass",
    search: `  async getUsage(accountId: string): Promise<BillingUsage> {\n    if (this.pool) return this.getPostgresUsage(accountId);\n    return this.getMemoryUsage(accountId);\n  }\n\n  async consume(accountId: string, input: CreditConsumeRequest): Promise<BillingUsage> {\n    if (this.pool) return this.consumePostgres(accountId, input);\n    return this.consumeMemory(accountId, input);\n  }\n`,
    replacement: `  private async isUnlimitedAccount(accountId: string) {\n    if (this.unlimitedAccountIds.has(accountId)) return true;\n    if (!this.pool || this.unlimitedOwnerEmails.size === 0) return false;\n\n    try {\n      const result = await this.pool.query(\n        \`SELECT 1\n         FROM modo_memberships membership\n         JOIN modo_users user_account ON user_account.id = membership.user_id\n         WHERE membership.organization_id = $1\n           AND LOWER(user_account.email) = ANY($2::text[])\n         LIMIT 1\`,\n        [accountId, Array.from(this.unlimitedOwnerEmails)],\n      );\n      return Boolean(result.rowCount);\n    } catch {\n      return false;\n    }\n  }\n\n  async getUsage(accountId: string): Promise<BillingUsage> {\n    const usage = this.pool\n      ? await this.getPostgresUsage(accountId)\n      : this.getMemoryUsage(accountId);\n    return (await this.isUnlimitedAccount(accountId)) ? unlimitedUsage(usage) : usage;\n  }\n\n  async consume(accountId: string, input: CreditConsumeRequest): Promise<BillingUsage> {\n    if (await this.isUnlimitedAccount(accountId)) {\n      const usage = this.pool\n        ? await this.getPostgresUsage(accountId)\n        : this.getMemoryUsage(accountId);\n      return unlimitedUsage(usage);\n    }\n    if (this.pool) return this.consumePostgres(accountId, input);\n    return this.consumeMemory(accountId, input);\n  }\n`,
  },
]);

patchFile("apps/api/src/services/content-service.ts", [
  {
    label: "stale constants",
    search: `const { Pool: PgPool } = pg;\n`,
    replacement: `const { Pool: PgPool } = pg;\n\nconst STALE_PROCESSING_MINUTES = 10;\nconst STALE_PROCESSING_MESSAGE =\n  "A automação não confirmou a entrega no tempo esperado. Reenvie este pedido sem novo consumo de créditos.";\n`,
  },
  {
    label: "expire stale list",
    search: `  async list(organizationId: string): Promise<ContentRequest[]> {\n    if (this.pool) {\n      const result = await this.pool.query<Row>(\n        \`SELECT * FROM modo_content_requests\n         WHERE organization_id=$1\n         ORDER BY created_at DESC\n         LIMIT 100\`,\n        [organizationId],\n      );\n      return result.rows.map(mapRow);\n    }\n    return this.items.filter((item) => item.organizationId === organizationId);\n  }\n`,
    replacement: `  async list(organizationId: string): Promise<ContentRequest[]> {\n    if (this.pool) {\n      await this.pool.query(\n        \`UPDATE modo_content_requests\n         SET status='failed', error=$2, updated_at=NOW()\n         WHERE organization_id=$1\n           AND status='processing'\n           AND updated_at < NOW() - INTERVAL '${10} minutes'\`,\n        [organizationId, STALE_PROCESSING_MESSAGE],\n      );\n      const result = await this.pool.query<Row>(\n        \`SELECT * FROM modo_content_requests\n         WHERE organization_id=$1\n         ORDER BY created_at DESC\n         LIMIT 100\`,\n        [organizationId],\n      );\n      return result.rows.map(mapRow);\n    }\n\n    const cutoff = Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000;\n    for (let index = 0; index < this.items.length; index += 1) {\n      const item = this.items[index];\n      if (\n        item.organizationId === organizationId &&\n        item.status === "processing" &&\n        new Date(item.updatedAt).getTime() < cutoff\n      ) {\n        this.items[index] = {\n          ...item,\n          status: "failed",\n          error: STALE_PROCESSING_MESSAGE,\n          updatedAt: new Date().toISOString(),\n        };\n      }\n    }\n    return this.items.filter((item) => item.organizationId === organizationId);\n  }\n`,
  },
]);

patchFile("apps/api/src/services/content-automation-service.ts", [
  {
    label: "fallback when not configured",
    search: `    if (!this.webhookUrl || !this.secret) {\n      await this.content.fail(request.id, "A automação n8n ainda não está configurada.");\n      throw new ContentAutomationError(\n        "CONTENT_AUTOMATION_NOT_CONFIGURED",\n        503,\n        "A automação de conteúdo ainda não está configurada.",\n      );\n    }\n`,
    replacement: `    if (!this.webhookUrl || !this.secret) {\n      return this.content.complete(\n        processing.id,\n        this.buildDemoOutput(processing, brand),\n        \`fallback:not-configured:${processing.id}\`,\n      );\n    }\n`,
  },
  {
    label: "callback watchdog",
    search: `      if (!response.ok) {\n        const detail = await response.text().catch(() => "");\n        throw new Error(\`n8n respondeu ${response.status}${detail ? \`: ${detail.slice(0, 300)}\` : ""}\`);\n      }\n      return processing;\n`,
    replacement: `      if (!response.ok) {\n        const detail = await response.text().catch(() => "");\n        throw new Error(\`n8n respondeu ${response.status}${detail ? \`: ${detail.slice(0, 300)}\` : ""}\`);\n      }\n      this.scheduleFallback(processing, brand);\n      return processing;\n`,
  },
  {
    label: "fallback on dispatch error",
    search: `    } catch (error) {\n      const message = error instanceof Error ? error.message : "Falha ao acionar o n8n.";\n      await this.content.fail(request.id, message);\n      throw new ContentAutomationError(\n        "CONTENT_DISPATCH_FAILED",\n        502,\n        "O pedido foi registrado, mas a automação não respondeu. Você pode reenviá-lo sem novo consumo de créditos.",\n      );\n    }\n  }\n\n  validateCallbackSecret(value: string) {\n`,
    replacement: `    } catch {\n      return this.content.complete(\n        processing.id,\n        this.buildDemoOutput(processing, brand),\n        \`fallback:dispatch:${processing.id}\`,\n      );\n    }\n  }\n\n  private scheduleFallback(processing: ContentRequest, brand: Brand) {\n    const timer = setTimeout(() => {\n      void this.content\n        .getInternal(processing.id)\n        .then((current) => {\n          if (!current || current.status !== "processing") return undefined;\n          return this.content.complete(\n            processing.id,\n            this.buildDemoOutput(processing, brand),\n            \`fallback:callback-timeout:${processing.id}\`,\n          );\n        })\n        .catch(() => undefined);\n    }, 120_000);\n    timer.unref?.();\n  }\n\n  validateCallbackSecret(value: string) {\n`,
  },
]);

patchFile("apps/web/src/ProductionProgress.tsx", [
  {
    label: "human elapsed label",
    search: `  const activeIndex = useMemo(() => {\n    if (elapsed < 8) return 0;\n    if (elapsed < 22) return 1;\n    if (elapsed < 45) return 2;\n    return 3;\n  }, [elapsed]);\n`,
    replacement: `  const activeIndex = useMemo(() => {\n    if (elapsed < 8) return 0;\n    if (elapsed < 22) return 1;\n    if (elapsed < 45) return 2;\n    return 3;\n  }, [elapsed]);\n  const elapsedLabel = elapsed < 120\n    ? \`${elapsed}s\`\n    : elapsed < 3600\n      ? \`${Math.floor(elapsed / 60)}min\`\n      : "mais de 1h";\n`,
  },
  {
    label: "use human elapsed label",
    search: `        <span>{elapsed}s</span>\n`,
    replacement: `        <span>{elapsedLabel}</span>\n`,
  },
  {
    label: "stale guidance",
    search: `      <small>{elapsed > 75 ? "A produção está levando um pouco mais de tempo, mas continua ativa. Você pode sair da página e voltar depois." : "Você pode acompanhar em tempo real ou continuar usando a plataforma."}</small>\n`,
    replacement: `      <small>{elapsed > 300 ? "A entrega está demorando além do esperado. A MODO fará uma entrega de segurança ou liberará o reenvio automaticamente." : elapsed > 75 ? "A produção está levando um pouco mais de tempo, mas continua ativa. Você pode sair da página e voltar depois." : "Você pode acompanhar em tempo real ou continuar usando a plataforma."}</small>\n`,
  },
]);

unlinkSync("scripts/apply-owner-unlimited-content-recovery.mjs");
unlinkSync(".github/workflows/apply-owner-unlimited-content-recovery.yml");
console.log("Owner unlimited and content recovery patch applied.");
