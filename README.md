# MODO

**Sua marca em modo presença.**

A MODO é uma plataforma de direção, criação e inteligência de presença digital. O produto combina diagnóstico, memória de marca, planejamento, conteúdo, Studio, inteligência de mercado, integrações e operação assistida em uma experiência orientada ao próximo passo.

## Arquitetura

```text
apps/
  web/        React 19 + Vite, publicado no Netlify
  api/        Fastify + TypeScript, publicado no Render
packages/
  contracts/  Contratos Zod e tipos compartilhados
```

O repositório é um monorepo npm. PostgreSQL é utilizado para contas, organizações, marcas, conteúdo, créditos, integrações, missões e histórico. Alguns serviços possuem fallback em memória apenas para desenvolvimento e testes.

## Módulos atuais

- MODO Scan e diagnóstico público;
- onboarding, conta, organizações e marcas;
- Base Estratégica e memória contextual;
- Meu Próximo Movimento e direção criativa;
- Quick Start, criação de conteúdo e revisões;
- Studio, exportação, Canva e ativos de imagem;
- Minha Semana, campanhas, Signal e ativação;
- Inteligência de mercado, Apify, missões e leads;
- LinkedIn, documentos e publicação assistida;
- Instagram Business Login com conexão profissional e publicação após aprovação;
- SmartBots Assistido;
- Curadoria Modo e área interna Time Modo;
- planos, créditos, convites, descontos e administração.

## Desenvolvimento local

Requer Node.js 22.

```bash
npm install --include=dev
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Validação

```bash
npm run typecheck
npm test
npm run build
```

O workflow `.github/workflows/ci.yml` executa as três verificações em pull requests e alterações no `main`.

## Produção

- Frontend: `https://modo1.netlify.app`
- API: `https://modo-api-3m10.onrender.com`
- Configuração do frontend: `netlify.toml`
- Configuração declarativa da API: `render.yaml`

Nunca registre chaves, tokens ou segredos no repositório. Variáveis marcadas como `sync: false` devem ser cadastradas diretamente no Render.

### Confirmar o provedor real do MODO Scan

O valor de `render.yaml` descreve a configuração declarativa do serviço, mas uma variável já configurada no painel do Render pode prevalecer no ambiente implantado. Depois do deploy, consulte:

```text
GET https://modo-api-3m10.onrender.com/health
```

O campo abaixo representa o valor efetivamente selecionado pelo processo da API:

```json
{
  "diagnosticProvider": "demo"
}
```

- `demo`: o MODO Scan ainda usa o provedor simulado;
- `n8n`: o MODO Scan usa o workflow real configurado no n8n.

Além do health check, confirme o commit implantado pelos campos `buildCommit` e `gitBranch`.

### Conteúdo e imagem

```env
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
```

Com chave OpenAI válida, a MODO utiliza geração contextual de texto e imagem. Sem a chave, o backend mantém o motor nativo contextual.

### Curadoria Modo

```env
RESEND_API_KEY=
HUMAN_SUPPORT_EMAIL_FROM=Time Modo <curadoria@dominio-verificado.com.br>
HUMAN_SUPPORT_EMAIL_TO=henriquecampos@gmail.com
```

O remetente precisa estar autorizado no Resend. A falha de notificação não descarta a solicitação salva na MODO.

### Inteligência e Apify

```env
INTELLIGENCE_PROVIDER=apify
APIFY_API_TOKEN=
APIFY_MARKET_RADAR_TASK_ID=
```

Enquanto as Tasks abaixo não forem ativadas, deixe-as vazias para que os playbooks permaneçam na fila interna sem aparecer como falha:

```env
APIFY_B2B_PROSPECTING_TASK_ID=
APIFY_PRICE_MONITORING_TASK_ID=
```

### Instagram Business Login e publicação

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments
INSTAGRAM_API_VERSION=v21.0
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com
REVIEWER_TEST_PASSWORD=
```

A integração usa diretamente `graph.instagram.com`. O ID da conta profissional é obtido dinamicamente durante a autenticação e salvo com o token criptografado. Nenhum token de Página do Facebook é utilizado.

Uma publicação só pode ser iniciada para conteúdo aprovado e imagem gerada. O backend cria o contêiner em `/{ig-user-id}/media`, acompanha o processamento e conclui em `/{ig-user-id}/media_publish`.

O roteiro e as URLs necessárias ao App Review estão em [`docs/META-APP-REVIEW.md`](docs/META-APP-REVIEW.md).

### Canva e LinkedIn

As variáveis de Canva e LinkedIn estão descritas em `apps/api/.env.example` e `render.yaml`. Tokens de usuário são armazenados de forma protegida quando os segredos de criptografia estão configurados.

## Segurança operacional

- não execute produção sem `DATABASE_URL`;
- mantenha `ALLOWED_ORIGINS` restrito aos domínios oficiais;
- use segredos independentes e fortes para criptografia de tokens;
- revise as permissões solicitadas por cada integração;
- não publique conteúdo sem aprovação explícita do usuário;
- confirme o commit implantado e o endpoint `/health` depois de cada deploy;
- nunca registre `access_token`, `client_secret` ou `REVIEWER_TEST_PASSWORD` em logs.
