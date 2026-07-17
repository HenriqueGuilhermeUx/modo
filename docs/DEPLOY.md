# Deploy

## API no Render

O repositório inclui `render.yaml`.

1. Crie um Blueprint no Render e selecione o repositório.
2. Defina `ALLOWED_ORIGINS` com a URL final do Netlify.
3. Mantenha `DIAGNOSTIC_PROVIDER=demo` até o workflow estar pronto.
4. Publique e valide `/health`.

Build: `npm install --include=dev && npm run build --workspace=@modo/contracts && npm run build --workspace=@modo/api`

O parâmetro `--include=dev` é necessário porque o Render executa o build com `NODE_ENV=production`, enquanto TypeScript, `@types/node` e outras ferramentas de compilação ficam em `devDependencies`.

Start: `npm run start --workspace=@modo/api`

## Web no Netlify

O repositório inclui `netlify.toml`.

1. Importe o repositório.
2. Configure `VITE_API_URL` com a URL do Render, sem barra final.
3. Opcionalmente configure `VITE_CHECKOUT_URL` e `VITE_WHATSAPP_URL`.
4. Faça o deploy.

## n8n depois

```env
DIAGNOSTIC_PROVIDER=n8n
N8N_DIAGNOSTIC_WEBHOOK_URL=https://automacao.seudominio.com/webhook/modo-diagnostic
N8N_WEBHOOK_SECRET=um-segredo-forte
```

O painel do n8n não deve ficar exposto diretamente pela porta 5678.
