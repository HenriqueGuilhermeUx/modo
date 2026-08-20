# MODO Publisher — Postiz

## Objetivo

A MODO usa o Postiz como infraestrutura invisível de distribuição social. O cliente continua dentro da MODO para aprovar, escolher canais, publicar/agendar e consultar desempenho.

Fluxo principal:

`contexto -> direção -> criação -> aprovação -> Postiz -> canais -> analytics -> feedback do Diretor -> próximas recomendações`

A aprovação de conteúdo **não publica automaticamente**. A distribuição exige uma ação explícita do usuário após a aprovação.

## Provider

- Cloud API: `https://api.postiz.com/public/v1`
- Autorização: chave da Public API do Postiz enviada no header `Authorization`.
- A chave nunca é enviada ao navegador e não deve ser commitada no repositório.

### Variáveis de produção

No serviço `modo-api` do Render:

```env
POSTIZ_API_KEY=<chave privada criada no Postiz>
POSTIZ_BASE_URL=https://api.postiz.com/public/v1
```

O `render.yaml` já declara `POSTIZ_API_KEY` como `sync: false`, portanto a única ação manual é inserir a chave diretamente no painel do Render.

## Como obter a chave

No Postiz Cloud:

1. entrar no workspace usado pela MODO;
2. abrir **Settings**;
3. abrir **Developers / Public API**;
4. revelar ou gerar a API key;
5. copiar a chave diretamente para `POSTIZ_API_KEY` no Render;
6. reiniciar/deployar o serviço `modo-api`.

Não colocar a chave em arquivos `.env` versionados, tickets, screenshots ou chat.

## Canais habilitados na primeira versão

- Instagram;
- Facebook;
- LinkedIn;
- LinkedIn Page;
- Threads.

A estrutura de contratos permite ampliar a lista depois sem expor o Postiz como produto separado ao cliente.

## Isolamento MODO

Embora o provider possua integrações no workspace do Postiz, a MODO mantém uma tabela própria de ownership:

- `modo_postiz_connections`: associa integration ID a organização e marca MODO;
- `modo_postiz_pending_connections`: registra a tentativa OAuth iniciada pela marca;
- `modo_postiz_publications`: associa conteúdo MODO ao post criado no provider;
- `modo_postiz_analytics_snapshots`: guarda snapshots de performance.

As rotas autenticadas só retornam integrações pertencentes à organização corrente.

## Conexão OAuth

A MODO solicita ao Postiz a URL de conexão do canal e abre a autorização em popup. Antes disso, salva os IDs já existentes daquele provider. Depois da autorização, a MODO identifica a nova integração criada e a reivindica para a organização/marca que iniciou o fluxo.

Para evitar uma associação ambígua enquanto o provider não recebe um `state` próprio da MODO nesse endpoint, apenas uma conexão do mesmo provider fica pendente por vez durante uma janela curta.

## Rotas MODO

### Conexões

- `GET /api/v1/distribution/status?brandId=<uuid>`
- `GET /api/v1/distribution/integrations?brandId=<uuid>`
- `POST /api/v1/distribution/connections`
- `POST /api/v1/distribution/connections/claim`
- `DELETE /api/v1/distribution/integrations/:id`

### Publicação

- `POST /api/v1/content-requests/:id/distribute`
- `GET /api/v1/content-requests/:id/publications`

Modos:

- `now`: publicar imediatamente;
- `schedule`: agendar em data/hora futura;
- `draft`: criar como rascunho no provider.

Só conteúdo com status `approved` pode ser distribuído.

### Analytics

- `POST /api/v1/publications/:id/analytics/refresh`
- `GET /api/v1/brands/:brandId/distribution/insights`

A MODO normaliza métricas em famílias como exposição, curtidas, comentários, compartilhamentos, salvamentos e cliques. O `score MODO` desta primeira versão é um indicador heurístico de engajamento, não uma métrica oficial das plataformas.

## Loop de aprendizado

Ao distribuir uma peça, a MODO registra `published` no sistema de feedback do Diretor.

Quando os analytics são atualizados:

- score >= 60 -> `performed_well`;
- score <= 25 -> `performed_poorly`;
- entre 26 e 59 -> resultado neutro, armazenado sem alterar o peso criativo.

Os sinais fortes são vinculados, quando existir, à recomendação do Diretor que originou a peça. O mesmo sinal da mesma publicação é gravado apenas uma vez, evitando distorção por refresh repetido.

O mecanismo existente de `CreativeIntelligenceService.learningWeights()` passa então a considerar publicação e performance real ao gerar os próximos movimentos criativos.

## Experiência web

Depois da aprovação, `PostApprovalActions` mostra **MODO Publisher**:

1. conectar Instagram/Facebook/LinkedIn/Threads;
2. selecionar um ou mais canais;
3. escolher `Agendar`, `Publicar agora` ou `Rascunho`;
4. executar explicitamente a distribuição;
5. acompanhar status e link da publicação;
6. usar `Atualizar desempenho`;
7. visualizar score, métricas e o efeito do aprendizado.

A integração direta existente com Instagram permanece como fallback durante a transição.

## Próxima evolução

Depois de validar o fluxo real em produção, o ciclo pode evoluir para coleta periódica automática de analytics, ranking por formato/objetivo/canal e recomendações com benchmark interno por marca.
