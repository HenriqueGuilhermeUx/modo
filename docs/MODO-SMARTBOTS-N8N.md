# MODO → SmartBots Assistido → n8n

Este documento descreve somente a implementação do lado da **MODO**. O SmartBots é um serviço externo integrado ao MODO Presença.

## O que já fica pronto no código

- onboarding do SmartBots Assistido dentro da MODO;
- armazenamento do briefing no PostgreSQL da MODO;
- fila administrativa de implantação;
- envio autenticado para o endpoint do SmartBots;
- idempotência pelo identificador do briefing;
- timeout controlado;
- registro da resposta externa no status do briefing;
- reenvio manual pelo painel administrativo;
- alternativa de orquestração pelo n8n.

## Modos de operação

### 1. Fila interna

```env
SMARTBOTS_DISPATCH_PROVIDER=queue
```

A MODO salva o briefing e não chama nenhum serviço externo. Use enquanto a API do SmartBots ainda não estiver ativa.

### 2. Envio direto

```env
SMARTBOTS_DISPATCH_PROVIDER=direct
SMARTBOTS_PARTNER_ENDPOINT=https://smartbots.club/.netlify/functions/partner-smartbots-intake
SMARTBOTS_PARTNER_API_KEY=CHAVE_COMPARTILHADA_COM_O_SMARTBOTS
SMARTBOTS_REQUEST_TIMEOUT_MS=15000
```

A API da MODO envia o briefing diretamente ao SmartBots com estes cabeçalhos:

- `x-partner-key`;
- `idempotency-key`;
- `x-modo-source: modo-presenca`.

### 3. Orquestração pelo n8n

```env
SMARTBOTS_DISPATCH_PROVIDER=n8n
N8N_SMARTBOTS_WEBHOOK_URL=https://SEU_N8N/webhook/modo-smartbots-dispatch
N8N_SMARTBOTS_SECRET=SEGREDO_DO_WEBHOOK
SMARTBOTS_REQUEST_TIMEOUT_MS=30000
```

A MODO envia ao n8n:

```json
{
  "intakeId": "uuid-do-briefing",
  "payload": {
    "partner": "modo",
    "plan": "presenca",
    "businessName": "",
    "ownerName": "",
    "email": "",
    "phone": "",
    "instagram": "",
    "segment": "",
    "services": "",
    "openingHours": "",
    "faq": "",
    "prices": "",
    "welcomeMessage": "",
    "googleReviewLink": "",
    "notes": ""
  }
}
```

## Importar o workflow pelo navegador

1. Abra o n8n.
2. Entre em **Workflows**.
3. Clique em **Import from file**.
4. Baixe do GitHub e importe:

```text
n8n/workflows/modo-smartbots-dispatch.json
```

5. Crie a credencial **MODO SmartBots Secret**:
   - tipo: Header Auth;
   - nome do cabeçalho: `x-modo-secret`;
   - valor: igual a `N8N_SMARTBOTS_SECRET` na MODO.
6. Crie a credencial **SmartBots Partner Key**:
   - tipo: Header Auth;
   - nome do cabeçalho: `x-partner-key`;
   - valor: chave entregue pelo SmartBots.
7. Vincule as duas credenciais aos respectivos nós.
8. Salve e ative o workflow.
9. Copie a URL de produção do webhook para `N8N_SMARTBOTS_WEBHOOK_URL` na MODO.

## Estados usados pela MODO

- `submitted`: briefing salvo na MODO;
- `sent`: serviço externo aceitou o briefing;
- `setup_in_progress`: implantação em andamento;
- `ready`: implantação concluída;
- `failed`: falha no encaminhamento ou necessidade de revisão.

Quando o envio falhar, o briefing não é apagado. O painel administrativo mostra a resposta externa e oferece a ação **Reenviar**.

## Sequência recomendada

1. Publicar esta versão da MODO com `SMARTBOTS_DISPATCH_PROVIDER=queue`.
2. Confirmar que onboarding e fila administrativa continuam funcionando.
3. Ativar e testar a API parceira do SmartBots.
4. Trocar temporariamente para `direct` e testar um briefing real.
5. Importar e ativar o workflow do n8n.
6. Trocar para `n8n` somente após o teste do webhook.

Essa sequência mantém o coração da operação funcionando mesmo quando SmartBots ou n8n estiverem indisponíveis.
