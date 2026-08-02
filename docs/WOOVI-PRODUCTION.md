# Woovi em produção — MODO

Este documento define o caminho de ativação e validação do Pix Automático da MODO. A cobrança Woovi pertence ao produto web. O aplicativo Android consome somente plano, status, limites e créditos já sincronizados com a conta.

## Arquitetura

```text
Web MODO
  POST /api/v1/payments/checkout
    -> API valida usuário, e-mail, plano e preço
    -> Woovi cria PIX_RECURRING
    -> MODO persiste correlação, link e estado

Woovi
  POST /api/v1/payments/woovi/webhook
    -> autorização validada
    -> assinatura consultada novamente na Woovi
    -> evento deduplicado
    -> BillingService atualiza plano/status/créditos

Android
  GET /api/v1/dashboard
    -> exibe somente direitos sincronizados
    -> não abre checkout Woovi
```

## Variáveis no Render

Cadastrar diretamente no serviço `modo-api`:

```env
PAYMENTS_PROVIDER=woovi
WOOVI_APP_ID=<AppID de produção da Woovi>
WOOVI_WEBHOOK_AUTHORIZATION=<segredo aleatório exclusivo>
ENABLE_DEMO_BILLING=false
```

Requisitos:

- nunca reutilizar `WOOVI_APP_ID` como segredo de webhook;
- gerar `WOOVI_WEBHOOK_AUTHORIZATION` com pelo menos 32 bytes aleatórios;
- não registrar esses valores em logs, issues, PRs ou capturas;
- confirmar que `DATABASE_URL` está ativa para persistência e idempotência duráveis.

## Webhook

Cadastrar na Woovi:

```text
Nome: MODO — Pix Automático
URL: https://modo-api-3m10.onrender.com/api/v1/payments/woovi/webhook
Authorization: mesmo valor de WOOVI_WEBHOOK_AUTHORIZATION
Método: POST
Ativo: sim
```

Eventos necessários:

```text
PIX_AUTOMATIC_COBR_COMPLETED
PIX_AUTOMATIC_COBR_TRY_REJECTED
PIX_AUTOMATIC_COBR_REJECTED
PIX_AUTOMATIC_REJECTED
```

Eventos informativos como `PIX_AUTOMATIC_COBR_CREATED`, `PIX_AUTOMATIC_COBR_APPROVED` e `PIX_AUTOMATIC_COBR_TRY_REQUESTED` podem ser recebidos e persistidos sem alterar direitos.

## Comportamento implementado

- o preço vem de `planEntitlements` no servidor;
- o e-mail do pagador deve ser igual ao e-mail autenticado;
- CPF/CNPJ, telefone e CEP são normalizados;
- cada assinatura recebe `correlationID` com conta, plano e UUID;
- a jornada é `PAYMENT_ON_APPROVAL`;
- o início é enviado como data ISO atual;
- a política de retentativa é `THREE_RETRIES_7_DAYS`;
- o mesmo checkout pendente do mesmo plano é reutilizado;
- outra assinatura é bloqueada enquanto houver uma ativa ou aguardando autorização;
- chamadas à Woovi possuem timeout;
- a autorização do webhook é comparada em tempo constante;
- cada entrega de webhook possui chave idempotente;
- a assinatura é consultada na Woovi antes de aplicar o evento;
- cancelamento usa a rota oficial da assinatura;
- falha de atualização do billing libera a chave do evento para nova tentativa.

## Validação antes de abrir vendas

### 1. Saúde da API

Consultar:

```text
GET https://modo-api-3m10.onrender.com/health
```

Esperado:

```json
{
  "status": "ok",
  "paymentsProvider": "woovi",
  "billingStorage": "postgres"
}
```

### 2. Checkout controlado

1. Criar uma conta exclusiva de teste.
2. Selecionar o plano de menor impacto financeiro ou aplicar um cupom interno aprovado.
3. Preencher dados reais autorizados para teste.
4. Confirmar que a API responde com `paymentLinkUrl`, `emv`, `subscriptionId` e `correlationID`.
5. Repetir a mesma solicitação e confirmar que a assinatura não é duplicada.
6. Concluir a autorização e a primeira cobrança no banco.

### 3. Ativação

Depois do pagamento:

- o webhook deve responder HTTP 200;
- o evento deve aparecer uma única vez em `modo_payment_events`;
- `modo_payment_subscriptions` deve conter a assinatura atualizada;
- `/api/v1/dashboard` deve retornar o plano contratado;
- o status deve ser `active`;
- os créditos do ciclo devem estar disponíveis.

### 4. Retentativa e suspensão

Validar em ambiente controlado:

- `PIX_AUTOMATIC_COBR_TRY_REJECTED` mantém acesso em `retrying`;
- `PIX_AUTOMATIC_COBR_REJECTED` muda para `suspended`;
- pagamento posterior aplica novo ciclo uma única vez;
- webhook duplicado não duplica créditos.

### 5. Cancelamento

- cancelar pelo painel web;
- confirmar cancelamento na Woovi;
- confirmar status `canceled` na MODO;
- confirmar que novo checkout só é permitido após o cancelamento persistido.

## Google Play

O app Android não deve conter:

- botão para pagar com Woovi;
- QR Code Pix de assinatura;
- link para checkout web;
- texto incentivando compra externa;
- WebView da página de planos.

O Android pode permitir login e uso de uma assinatura já existente. Caso a MODO venda planos ou créditos dentro do app no futuro, a implementação deverá usar Google Play Billing e validação no backend.

## Evidências de lançamento

Guardar internamente, sem segredos:

- captura do health com `paymentsProvider=woovi`;
- ID da assinatura de teste;
- horário do webhook pago;
- plano e créditos antes/depois;
- cancelamento concluído;
- resultado de `npm test`, `npm run typecheck` e `npm run build`.
