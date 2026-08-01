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
- Meta Connect para Instagram profissional em modo somente leitura;
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

### Meta Connect — Instagram somente leitura

```env
META_CLIENT_ID=
META_CLIENT_SECRET=
META_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/meta/callback
META_TOKEN_ENCRYPTION_SECRET=
META_SCOPES=instagram_business_basic instagram_business_manage_insights
META_API_VERSION=v25.0
```

O primeiro estágio importa perfil, indicadores permitidos e publicações recentes de contas profissionais. Ele não publica, edita ou exclui conteúdo no Instagram.

### Canva e LinkedIn

As variáveis de Canva e LinkedIn estão descritas em `apps/api/.env.example` e `render.yaml`. Tokens de usuário são armazenados de forma protegida quando os segredos de criptografia estão configurados.

## Segurança operacional

- não execute produção sem `DATABASE_URL`;
- mantenha `ALLOWED_ORIGINS` restrito aos domínios oficiais;
- use segredos independentes e fortes para criptografia de tokens;
- revise as permissões solicitadas por cada integração;
- não habilite publicação automática antes da aprovação do usuário e da plataforma;
- confirme o commit implantado e o endpoint `/health` depois de cada deploy.
