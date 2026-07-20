# MODO Creative Intelligence

A MODO não depende de o cliente saber escrever prompts ou ter ideias. O produto empresta criatividade, direção, repertório e organização para a marca.

## Ciclo operacional

```text
KNOW → SUGGEST → PLAN → CREATE / DIRECT → APPROVE → PUBLISH → MEASURE → LEARN
```

## Módulos

### MODO Memory

Memória operacional por marca:

- pessoas que podem aparecer;
- conforto diante da câmera;
- tempo semanal disponível;
- locais e bastidores;
- produtos e serviços demonstráveis;
- provas, casos e resultados;
- perguntas e objeções recorrentes;
- prioridades comerciais;
- temas proibidos e restrições;
- canais prioritários.

### MODO Director

Gera movimentos priorizados e explicados:

- conteúdo que a MODO cria;
- missão que a MODO dirige;
- campanha coordenada;
- reaproveitamento de matéria-prima;
- esforço estimado;
- resultado esperado;
- canais indicados;
- ativos derivados.

### MODO Capture

Missões de participação humana com:

- pessoa indicada;
- tempo necessário;
- local;
- duração;
- enquadramento;
- frase de abertura;
- estrutura narrativa;
- B-roll;
- checklist de gravação.

### MODO Create

Transforma recomendações aceitas em pedidos de produção com marca, objetivo, formato, canal e briefing preenchidos automaticamente.

### MODO Signal

Registra desempenho de conteúdos publicados:

- alcance;
- impressões;
- engajamentos;
- cliques;
- leads;
- conversões;
- receita atribuída;
- observação qualitativa.

Cada sinal recebe uma nota de 0 a 100 e é associado ao conteúdo e, quando aplicável, à recomendação original. Sinais positivos ganham peso nos próximos planos; sinais negativos reduzem prioridade e indicam necessidade de outro ângulo, formato ou CTA.

## Canais

O mesmo cérebro opera em:

- Instagram;
- Facebook;
- LinkedIn;
- Reels;
- Stories;
- YouTube Shorts;
- TikTok;
- WhatsApp;
- Blog;
- E-mail;
- Site.

A estratégia é comum, mas a linguagem, formato e objetivo são adaptados por canal.

## Retroalimentação

A MODO aprende com:

- recomendação aceita;
- recomendação descartada;
- pedido levado para produção;
- revisão solicitada;
- conteúdo aprovado;
- publicação;
- desempenho positivo ou negativo;
- métricas comerciais.

A ingestão manual de métricas funciona desde a primeira versão. Integrações de analytics dos canais poderão gravar os mesmos sinais automaticamente quando credenciais e permissões oficiais estiverem disponíveis.

## Endpoints principais

```text
GET  /api/v1/director/profile/:brandId
PUT  /api/v1/director/profile/:brandId
GET  /api/v1/director/recommendations/:brandId
POST /api/v1/director/plan/:brandId
POST /api/v1/director/recommendations/:id/status
POST /api/v1/director/feedback/:brandId

GET  /api/v1/signal/summary/:brandId
POST /api/v1/signal
```

## Limites comerciais

A inteligência não transforma os planos em uso ilimitado. Conteúdos continuam consumindo créditos e respeitando limites mensais de formatos, marcas, canais e revisões.

As recomendações e missões podem futuramente receber limites próprios por plano, mantendo previsibilidade de custo e qualidade.
