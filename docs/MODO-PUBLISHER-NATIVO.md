# MODO Publisher Nativo — sem instalação local

Esta é a rota principal para testes e produção inicial quando o usuário só dispõe de navegador.

## Arquitetura

`MODO Web (Netlify) -> MODO API (Render) -> APIs oficiais Instagram / LinkedIn`

Postiz permanece opcional e não é necessário para o fluxo nativo.

## O que não é necessário

- Docker Desktop
- Git local
- cloudflared
- Postiz local
- Redis local
- PostgreSQL local
- Temporal local
- n8n local

## Instagram

O backend já implementa OAuth, token de longa duração, renovação, publicação de imagem aprovada, persistência e desligamento.

Variáveis no Render:

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
```

O usuário conecta pelo navegador em `/app/settings/integrations`.

## LinkedIn

O backend implementa OAuth, perfil, publicação, agendamento e documentos/carrosséis. As rotas são compostas uma única vez pelo core da API, junto ao módulo de inteligência criativa; `server.ts` não deve registrá-las novamente.

Variáveis no Render:

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
LINKEDIN_TOKEN_ENCRYPTION_SECRET=
LINKEDIN_API_VERSION=202606
```

O usuário conecta pelo navegador em `/app/settings/integrations`.

## Diagnóstico público seguro

```text
https://modo-api-3m10.onrender.com/api/v1/native-publisher/health
```

A rota informa apenas se os conectores estão configurados e os redirect URIs. Nenhum segredo é exposto.

## Composição e prevenção de regressão

LinkedIn e Postiz já são registrados pelo core através de `registerCreativeIntelligenceRoutes()`. Registrar novamente esses módulos no `server.ts` gera colisão de método/URL no Fastify. O CI agora executa também um startup smoke real da API depois do build para detectar esse tipo de erro antes do merge e antes do Render.

## Pós-aprovação

A tela de conteúdo aprovado prioriza o Publisher Nativo. Instagram e LinkedIn operam sem Postiz. Postiz fica como infraestrutura opcional futura.

## Próximos conectores nativos

1. Facebook Pages pela Meta Graph API;
2. Threads pela Threads API;
3. analytics nativo por canal alimentando MODO Learning.
