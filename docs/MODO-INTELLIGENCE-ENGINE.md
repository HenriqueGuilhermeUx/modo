# MODO Intelligence Engine

## Propósito

O MODO Intelligence transforma perguntas de negócio em missões estruturadas de coleta e análise. O motor é universal: o nicho do cliente muda os parâmetros, mas não exige um sistema diferente.

A proposta comercial não menciona Apify, Actors, webhooks ou n8n. Para o cliente, a MODO:

- encontra oportunidades;
- acompanha o mercado;
- transforma dados em próximos passos.

## Playbooks iniciais

### Radar de mercado

Para observar concorrentes, reputação, ofertas, conteúdo, regiões e sinais de demanda.

### Prospecção B2B

Para encontrar e priorizar empresas por setor, região e sinais de oportunidade. Os dados devem ser comerciais, públicos ou obtidos de forma autorizada.

### Monitoramento de preços

Para acompanhar produtos comparáveis, concorrentes, mudanças de preço e condições comerciais. A primeira fase apenas recomenda ações; não altera preços automaticamente.

## Arquitetura

```text
Portal MODO
   ↓
Missão de inteligência
   ↓
API MODO
   ├── queue: salva sem coleta externa
   ├── apify: executa uma Task diretamente
   └── n8n: envia ao workflow orquestrador
             ↓
           Apify
             ↓
      Dataset / prévia
             ↓
Banco e painel MODO
```

## Contrato de uma missão

```json
{
  "brandId": "brand-id",
  "name": "Radar inicial",
  "playbook": "market_radar",
  "objective": "Encontrar oportunidades comerciais na região",
  "regions": ["Campinas, SP"],
  "keywords": ["restaurantes", "bares"],
  "competitors": [],
  "products": [],
  "maxItems": 100
}
```

## Estados

- `queued`: salva e aguardando execução;
- `running`: coleta externa em andamento;
- `succeeded`: coleta concluída;
- `failed`: execução ou configuração precisa de revisão.

## Modos operacionais

### Fila segura

```env
INTELLIGENCE_PROVIDER=queue
```

É o padrão. Permite validar formulários, contratos, banco, painel e playbooks sem consumir Apify.

### Apify direto

```env
INTELLIGENCE_PROVIDER=apify
APIFY_API_TOKEN=SEU_TOKEN
APIFY_MARKET_RADAR_TASK_ID=
APIFY_B2B_PROSPECTING_TASK_ID=
APIFY_PRICE_MONITORING_TASK_ID=
INTELLIGENCE_REQUEST_TIMEOUT_MS=30000
```

A API da MODO inicia a Task correspondente. O endpoint de consulta atualiza o estado da execução e carrega uma prévia do dataset quando a coleta termina.

### n8n + Apify

```env
INTELLIGENCE_PROVIDER=n8n
N8N_INTELLIGENCE_WEBHOOK_URL=https://SEU_N8N/webhook/modo-intelligence-engine
N8N_INTELLIGENCE_SECRET=SEGREDO_ENTRE_MODO_E_N8N
INTELLIGENCE_CALLBACK_SECRET=SEGREDO_DO_CALLBACK
APIFY_MARKET_RADAR_TASK_ID=
APIFY_B2B_PROSPECTING_TASK_ID=
APIFY_PRICE_MONITORING_TASK_ID=
```

Importe no n8n:

```text
n8n/workflows/modo-intelligence-engine.json
```

Credenciais necessárias:

1. **MODO Intelligence Secret**
   - Header: `x-modo-secret`
   - Valor igual a `N8N_INTELLIGENCE_SECRET`.

2. **Apify API Token**
   - Header: `Authorization`
   - Valor: `Bearer SEU_TOKEN_APIFY`.

3. **MODO Intelligence Callback Secret**
   - Header: `x-modo-intelligence-secret`
   - Valor igual a `INTELLIGENCE_CALLBACK_SECRET`.

O workflow inicial usa execução síncrona e é adequado para missões pequenas de validação. Missões longas deverão evoluir para execução assíncrona com webhook de conclusão.

## API

### Catálogo e configuração

```text
GET /api/v1/intelligence/playbooks
```

### Criar missão

```text
POST /api/v1/intelligence/missions
```

### Listar missões

```text
GET /api/v1/intelligence/missions
```

### Consultar e atualizar estado

```text
GET /api/v1/intelligence/missions/:id
```

### Carregar resultados

```text
GET /api/v1/intelligence/missions/:id/results?limit=100
```

### Reexecutar

```text
POST /api/v1/intelligence/missions/:id/retry
```

### Callback interno do n8n

```text
POST /api/v1/internal/intelligence/missions/:id/result
```

## Banco de dados

A tabela `modo_intelligence_missions` guarda:

- organização, usuário e marca;
- playbook e objetivo;
- parâmetros da missão;
- provedor e Task;
- identificadores de execução e dataset;
- mensagem operacional;
- contagem e prévia limitada dos resultados;
- datas de criação e atualização.

O dataset completo permanece no provedor e é carregado sob demanda. Isso evita replicação desnecessária e reduz exposição de dados.

## Comunicação no site

Mensagem principal:

> A MODO não olha apenas para o seu perfil. Ela ajuda a enxergar o mercado.

Três capacidades apresentadas:

1. encontra oportunidades;
2. acompanha o mercado;
3. transforma dados em ação.

A tecnologia fica nos bastidores. A disponibilidade dos módulos depende do objetivo, das fontes e das regras aplicáveis.

## Regras operacionais

- começar com limites pequenos;
- medir custo por missão e por registro útil;
- manter catálogo de Tasks aprovadas;
- não vender dado bruto como lead qualificado;
- não inferir condição sensível de pessoas;
- não automatizar abordagem, publicação ou preço sem validação;
- separar dados por organização;
- manter prazo e finalidade de retenção;
- criar alternativa para Actors críticos.

## Próxima evolução

1. escolher um Actor para cada playbook;
2. executar missões-piloto com 50 a 100 registros;
3. medir custo, cobertura, duplicidade e precisão;
4. criar normalizadores específicos por fonte;
5. adicionar pontuação de oportunidade;
6. transformar prévias técnicas em dashboards comerciais;
7. criar agendamentos somente após validar custo e qualidade.
