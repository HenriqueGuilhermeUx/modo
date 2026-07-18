# MODO

**Sua marca em modo presença.**

Monorepo do MVP da MODO, uma agência inteligente de presença digital. A base entrega landing page conversiva, diagnóstico assíncrono, captura de leads, planos por capacidade e um ledger de créditos preparado para PostgreSQL.

## Estrutura

```text
apps/
  web/        React + Vite, pronto para Netlify
  api/        Fastify + TypeScript, pronto para Render
packages/
  contracts/  Schemas, planos, limites e tipos compartilhados com Zod
docs/
  ARCHITECTURE.md
  BILLING.md
  DEPLOY.md
  PRD-V2.md
```

## Começar

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Verificação

```bash
npm run typecheck
npm test
npm run build
```

## Planos e créditos

Os planos possuem limites oficiais de créditos, marcas, canais, usuários, carrosséis, roteiros e revisões. O backend registra grants e consumos de forma idempotente.

- Regras e endpoints: [`docs/BILLING.md`](docs/BILLING.md)
- Fonte de verdade: [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts)

Sem `DATABASE_URL`, o ledger funciona em memória. Com PostgreSQL configurado, assinaturas e consumos persistem entre reinícios.

## Modo n8n

O backend começa com `DIAGNOSTIC_PROVIDER=demo`. Quando o workflow estiver pronto, configure:

```env
DIAGNOSTIC_PROVIDER=n8n
N8N_DIAGNOSTIC_WEBHOOK_URL=https://seu-n8n/webhook/modo-diagnostic
N8N_WEBHOOK_SECRET=troque-este-segredo
```

O contrato esperado está em `packages/contracts/src/index.ts`.

## Deploy

Consulte [`docs/DEPLOY.md`](docs/DEPLOY.md).
