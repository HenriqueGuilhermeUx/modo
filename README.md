# MODO

**Sua marca em modo presença.**

Monorepo do MVP da MODO, uma agência inteligente de presença digital. A base entrega uma landing page conversiva, diagnóstico assíncrono, captura de leads e uma API preparada para trocar o provedor de demonstração por um webhook do n8n.

## Estrutura

```text
apps/
  web/        React + Vite, pronto para Netlify
  api/        Fastify + TypeScript, pronto para Render
packages/
  contracts/  Schemas e tipos compartilhados com Zod
docs/
  ARCHITECTURE.md
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
