# Radar de Mercado — MODO Intelligence v3

O Radar de Mercado usa a Task `modo-market-radar-v1`, baseada no Actor oficial `apify/google-search-scraper`.

## Objetivo

Transformar termos, interesses, atividades, regiões e concorrentes informados pelo cliente em consultas econômicas de busca e retornar sinais públicos organizados.

## Controle de custo

- no máximo cinco consultas por missão;
- uma página por consulta;
- recursos de AI Mode, Gemini, Perplexity, ChatGPT, Copilot e conteúdo completo de sites desativados;
- limite adicional pela franquia da organização;
- apenas resultados orgânicos são enviados para a Modo.

## Destino dos resultados

- Prospecção B2B continua alimentando o funil comercial de leads;
- Radar de Mercado alimenta um painel próprio de sinais;
- Monitoramento de Preços terá painel e Task específicos;
- resultados de Radar e Preços não entram no CRM de leads.

## Variáveis

```text
APIFY_MARKET_RADAR_TASK_ID=<task-id>
N8N_INTELLIGENCE_WEBHOOK_URL=https://automation.alternativeventures.com.br/webhook/modo-intelligence-engine-v3
```

## Publicação do workflow

1. importar `n8n/workflows/modo-intelligence-engine-v3.json`;
2. associar `MODO Intelligence Secret` ao Webhook;
3. associar `Apify API Token` aos nós Start, Wait e Fetch;
4. associar `MODO Intelligence Callback Secret` ao retorno para a Modo;
5. publicar o v3;
6. testar uma missão pequena de Radar;
7. somente após o teste, despublicar o v2.
