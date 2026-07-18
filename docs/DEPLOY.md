# Deploy

## API no Render

O repositório inclui `render.yaml`.

1. Crie um Blueprint no Render e selecione o repositório.
2. Defina `ALLOWED_ORIGINS` com a URL final do Netlify.
3. Mantenha `DIAGNOSTIC_PROVIDER=demo` até o workflow estar pronto.
4. Publique e valide `/health`.

Build:

```bash
npm install --include=dev && npm run build --workspace=@modo/contracts && npm run build --workspace=@modo/api
```

O parâmetro `--include=dev` é necessário porque o Render executa o build com `NODE_ENV=production`, enquanto TypeScript e os pacotes de tipos ficam em `devDependencies`.

Start:

```bash
npm run start --workspace=@modo/api
```

## PostgreSQL no Render

A API funciona sem banco usando memória, mas dados são perdidos quando a instância reinicia. Para persistência:

1. Crie um Render Postgres na mesma região do serviço `modo-api`.
2. No banco, abra **Connect** e copie a **Internal Database URL**.
3. No serviço `modo-api`, adicione:

```env
DATABASE_URL=postgresql://...
DATABASE_SSL=false
```

4. Faça um novo deploy.
5. Abra `/health` e confirme:

```json
{
  "status": "ok",
  "service": "modo-api",
  "version": "0.2.0",
  "billingStorage": "postgres"
}
```

As tabelas `modo_subscriptions` e `modo_credit_ledger` são criadas automaticamente no boot.

Ao conectar por uma URL externa, defina `DATABASE_SSL=true`.

## Web no Netlify

O repositório inclui `netlify.toml`.

1. Importe o repositório.
2. Configure `VITE_API_URL` com a URL do Render, sem barra final.
3. Opcionalmente configure `VITE_CHECKOUT_URL` e `VITE_WHATSAPP_URL`.
4. Faça o deploy.

## Teste do ledger

Após o deploy, crie uma assinatura de demonstração:

```bash
curl -X POST https://modo-api-3m10.onrender.com/api/v1/billing/demo/subscriptions \
  -H "content-type: application/json" \
  -d '{"accountId":"marca_demo","plan":"presenca"}'
```

Consulte o saldo:

```bash
curl https://modo-api-3m10.onrender.com/api/v1/billing/accounts/marca_demo/usage
```

Consuma um carrossel:

```bash
curl -X POST https://modo-api-3m10.onrender.com/api/v1/billing/accounts/marca_demo/consume \
  -H "content-type: application/json" \
  -d '{"contentType":"carousel","referenceId":"carousel_demo_001"}'
```

## n8n depois

```env
DIAGNOSTIC_PROVIDER=n8n
N8N_DIAGNOSTIC_WEBHOOK_URL=https://automacao.seudominio.com/webhook/modo-diagnostic
N8N_WEBHOOK_SECRET=um-segredo-forte
```

O painel do n8n não deve ficar exposto diretamente pela porta 5678.
