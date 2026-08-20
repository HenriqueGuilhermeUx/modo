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

## Isolamento por cliente

Cada cliente cria ou acessa a própria conta MODO. Essa conta pertence a uma `organization` própria no backend.

O fluxo OAuth do Instagram gera um estado assinado contendo:

- `accountId`: organização autenticada na MODO;
- `brandId`: marca escolhida, quando informada;
- `nonce`: identificador descartável;
- expiração do fluxo.

O callback valida e consome esse estado antes de armazenar a conexão. O token de acesso é criptografado antes de ser persistido. As rotas de status, desconexão e publicação autenticam novamente o usuário e consultam somente a organização da sessão.

Portanto, um cliente não enxerga nem utiliza a autorização social de outro cliente.

### Fluxo do cliente

1. Cliente cria a conta MODO ou recebe acesso à sua organização;
2. cadastra a marca;
3. abre **Integrações**;
4. escolhe a marca e clica **Conectar Instagram**;
5. autentica e autoriza no ambiente oficial do Instagram;
6. retorna à MODO com a conta conectada;
7. cria conteúdo para aquela marca;
8. revisa e aprova a peça;
9. confirma **Publicar no Instagram**;
10. a MODO publica usando exclusivamente a autorização da organização autenticada.

Nada é publicado automaticamente.

### Estado atual de multi-marca

O OAuth já carrega `brandId` e a publicação bloqueia conteúdo de outra marca quando a conexão está vinculada a uma marca específica. A persistência atual mantém uma conexão Instagram ativa por organização. Isso atende clientes com uma operação/Instagram principal. Para agências ou organizações com múltiplas marcas e múltiplas contas Instagram simultâneas, a camada de conexões deve evoluir para chave composta organização + marca.

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

O backend implementa OAuth, perfil, publicação, agendamento e documentos/carrosséis. As rotas são registradas pelo core da API uma única vez.

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

## Composição de rotas

`createApp()` registra `registerCreativeIntelligenceRoutes()`, que compõe LinkedIn, Signal e Postiz. O `server.ts` não deve registrar LinkedIn ou Postiz uma segunda vez. O CI executa um startup smoke após o build para impedir regressões de rotas duplicadas.

## Pós-aprovação

A tela de conteúdo aprovado prioriza o Publisher Nativo. Instagram e LinkedIn operam sem Postiz. Postiz fica como infraestrutura opcional futura.

## Próximos conectores nativos

1. Facebook Pages pela Meta Graph API;
2. Threads pela Threads API;
3. analytics nativo por canal alimentando MODO Learning;
4. múltiplas contas sociais simultâneas por marca em organizações multi-marca.
