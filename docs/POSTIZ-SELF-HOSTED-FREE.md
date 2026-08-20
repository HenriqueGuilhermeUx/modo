# MODO Publisher — Postiz self-hosted gratuito

Este guia coloca o MODO Publisher para funcionar sem assinatura do Postiz Cloud.

Arquitetura de teste:

`MODO (Netlify + Render) -> Cloudflare Quick Tunnel -> Postiz no seu PC -> Meta/Instagram/Facebook`

O Postiz roda separado da MODO. A MODO usa apenas a Public API dele. Tokens sociais permanecem no Postiz, não no n8n e não no navegador da MODO.

## 1. Pré-requisitos no Windows

Instale:

1. Docker Desktop;
2. Git for Windows;
3. cloudflared.

Para o cloudflared:

```powershell
winget install --id Cloudflare.cloudflared
```

Depois feche e abra um novo PowerShell.

Confirme:

```powershell
docker --version
git --version
cloudflared --version
```

O Docker Desktop precisa estar aberto e com o engine iniciado.

## 2. Preparar o Postiz oficial

Na raiz do repositório MODO:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/bootstrap.ps1
```

O script:

- baixa/atualiza o repositório oficial `gitroomhq/postiz-docker-compose`;
- guarda tudo em `.runtime/postiz`;
- gera um `JWT_SECRET` forte;
- cria `.runtime/postiz-modo.env` fora do Git;
- combina o compose oficial com `infra/postiz/docker-compose.modo.yml`;
- valida o Docker Compose.

Não edite o compose oficial.

## 3. Subir localmente

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/start-local.ps1
```

Na primeira execução o Docker baixa várias imagens e pode demorar.

Quando concluir:

- Postiz: `http://localhost:4007`
- Public API local: `http://localhost:4007/api/public/v1`
- Temporal UI: `http://localhost:8080`

Abra `http://localhost:4007` e crie a primeira conta/workspace local da MODO.

Enquanto estivermos testando, mantenha o cadastro habilitado. Quando a instalação estiver pronta para uso real, altere `POSTIZ_DISABLE_REGISTRATION=true` no arquivo privado `.runtime/postiz-modo.env` e recrie o serviço.

## 4. Abrir um endereço HTTPS gratuito para teste

OAuth da Meta precisa voltar para uma URL HTTPS acessível pela internet. Rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/start-tunnel.ps1
```

O script cria um Cloudflare Quick Tunnel e imprime uma URL parecida com:

```text
https://alguma-coisa.trycloudflare.com
```

Ele também recria o Postiz usando essa URL como `MAIN_URL`, `FRONTEND_URL` e backend público.

A Public API que a MODO deverá usar será:

```text
https://alguma-coisa.trycloudflare.com/api/public/v1
```

IMPORTANTE: Quick Tunnel é temporário. Se ele for reiniciado, a URL pode mudar. Nesse caso é necessário atualizar os Redirect URIs da Meta e `POSTIZ_BASE_URL` no Render.

## 5. Criar/configurar o app da Meta

No Meta for Developers, crie ou reutilize um app adequado para sua empresa. O mesmo app pode ser utilizado para Facebook e Instagram no Postiz.

Use os Redirect URIs exatos mostrados por `start-tunnel.ps1`:

```text
https://SEU-TUNNEL.trycloudflare.com/integrations/social/facebook
https://SEU-TUNNEL.trycloudflare.com/integrations/social/instagram
https://SEU-TUNNEL.trycloudflare.com/integrations/social/instagram-standalone
```

Para o primeiro teste, use uma conta Instagram profissional pertencente a você/equipe de desenvolvimento. Para liberar contas de clientes posteriormente, será necessário concluir os requisitos de produção da Meta, incluindo as permissões/revisões aplicáveis.

Depois de obter `App ID` e `App Secret`, não cole o secret em chat ou GitHub. Na raiz da MODO rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/configure-meta.ps1
```

O script pede:

- Meta App ID;
- Meta App Secret em entrada oculta.

O segredo fica somente em `.runtime/postiz-modo.env`, ignorado pelo Git.

## 6. Gerar a API Key do Postiz local

Entre no Postiz pela URL HTTPS do tunnel.

No workspace local, abra as configurações da Public API/Developers e gere/revele a API Key.

Essa chave pertence ao Postiz local. Não use a chave do Postiz Cloud e não versione a chave.

## 7. Apontar a API da MODO para o Postiz local

No Render, serviço `modo-api`, abra **Environment**.

Defina:

```env
POSTIZ_BASE_URL=https://SEU-TUNNEL.trycloudflare.com/api/public/v1
POSTIZ_API_KEY=SUA_API_KEY_DO_POSTIZ_LOCAL
```

Não altere `DATABASE_URL` nem as demais variáveis existentes.

Salve e redeploy o `modo-api`.

Depois abra no navegador:

```text
https://modo-api-3m10.onrender.com/api/v1/distribution/provider-health
```

O esperado é algo parecido com:

```json
{
  "status": "ok",
  "provider": "postiz",
  "configured": true,
  "mode": "self_hosted",
  "host": "SEU-TUNNEL.trycloudflare.com",
  "storage": "postgres",
  "qualityGate": "enabled"
}
```

Nenhum segredo aparece nessa rota.

## 8. Primeiro teste real da MODO

Na MODO:

1. entre na conta;
2. crie uma peça com imagem;
3. revise;
4. aprove;
5. abra **MODO Publisher**;
6. confira o **MODO Quality Gate**;
7. clique `+ Instagram`;
8. conclua o OAuth;
9. selecione o canal;
10. escolha **Rascunho**;
11. envie.

Começamos por Rascunho para validar a integração sem publicar no perfil.

Depois teste:

1. Agendar;
2. Publicar agora;
3. Atualizar desempenho.

O Quality Gate nunca publica sozinho. Ele bloqueia somente riscos objetivos (por exemplo peça não aprovada, Story sem mídia ou tópico explicitamente proibido no perfil da marca). Notas intermediárias geram aviso e deixam a decisão humana disponível.

## 9. Analytics automático com n8n interno

A MODO possui uma rota interna para buscar analytics de publicações recentes que ainda não tiveram snapshot nas últimas seis horas.

Primeiro gere um segredo forte:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/new-cron-secret.ps1
```

Use o mesmo valor em dois lugares:

### Render

```env
DISTRIBUTION_CRON_SECRET=SEGREDO_GERADO
```

Redeploy o `modo-api`.

### n8n

Importe:

```text
n8n/workflows/modo-distribution-analytics-refresh.json
```

Crie uma credencial **Header Auth** chamada:

```text
MODO Distribution Cron Secret
```

Configure:

```text
Header Name: x-modo-distribution-secret
Header Value: o mesmo DISTRIBUTION_CRON_SECRET do Render
```

Associe essa credencial ao node **Atualizar analytics na MODO**.

Execute primeiro pelo node **Teste manual**. O retorno deve conter:

```json
{
  "processed": 0,
  "refreshed": 0,
  "failed": 0
}
```

Os números podem ser maiores quando já existirem posts elegíveis.

Depois ative o workflow. Ele roda a cada 6 horas.

O n8n não guarda tokens do Instagram/Facebook. Ele conhece apenas o segredo interno da rota MODO.

## 10. Diagnóstico rápido

No PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/status.ps1
```

Para parar sem apagar dados:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/stop.ps1
```

Para apagar também volumes locais de Postgres/Redis/uploads:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/postiz/stop.ps1 -Purge
```

Use `-Purge` somente quando realmente quiser zerar a instalação.

## 11. Passagem para produção estável

O Quick Tunnel serve somente para desenvolvimento/teste. Depois da validação, mantenha a mesma arquitetura e substitua apenas o endereço temporário por infraestrutura estável:

- VPS/servidor próprio + domínio;
- ou Cloudflare Tunnel gerenciado com hostname fixo.

Nesse momento:

1. mover Postiz + banco/volumes para infraestrutura persistente;
2. usar HTTPS e domínio estável;
3. `POSTIZ_DISABLE_REGISTRATION=true`;
4. atualizar Redirect URIs da Meta uma única vez;
5. atualizar `POSTIZ_BASE_URL` no Render;
6. manter a mesma `MODO Publisher API` e o mesmo frontend.

Nenhuma reescrita do Publisher será necessária.
