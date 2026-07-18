# Billing e créditos

A MODO controla produção por créditos mensais. O ledger é a fonte de verdade para saldo, consumo e renovação.

## Custos por unidade

| Tipo | Créditos |
| --- | ---: |
| Post estático | 1 |
| Story | 1 |
| Carrossel | 2 |
| Roteiro de vídeo curto | 2 |
| Adaptação específica para outro canal | 1 |

Os custos e limites oficiais ficam em `packages/contracts/src/index.ts`.

## Armazenamento

- Sem `DATABASE_URL`: memória, útil apenas para desenvolvimento e demonstração.
- Com `DATABASE_URL`: PostgreSQL, com persistência e transações.

A API cria automaticamente:

- `modo_subscriptions`
- `modo_credit_ledger`

## Comportamento do ledger

- Uma assinatura recebe o grant mensal do plano.
- Cada produção registra um lançamento negativo.
- `referenceId` torna o consumo idempotente: repetir a mesma requisição não cobra novamente.
- A renovação é lazy: ao consultar ou consumir depois do fim do período, o novo ciclo é aberto e recebe os créditos do plano.
- Carrosséis e roteiros de vídeo possuem subtetos além do saldo total.

## Endpoints atuais

### Listar planos

```http
GET /api/v1/plans
```

### Criar ou trocar assinatura de demonstração

> Endpoint temporário para desenvolvimento. O checkout real substituirá esta rota.

```http
POST /api/v1/billing/demo/subscriptions
Content-Type: application/json

{
  "accountId": "marca_demo",
  "plan": "presenca"
}
```

### Consultar saldo

```http
GET /api/v1/billing/accounts/marca_demo/usage
```

### Consumir créditos

```http
POST /api/v1/billing/accounts/marca_demo/consume
Content-Type: application/json

{
  "contentType": "carousel",
  "referenceId": "content_2026_07_001",
  "metadata": {
    "campaign": "autoridade"
  }
}
```

## Erros de capacidade

- `INSUFFICIENT_CREDITS`
- `CAROUSEL_LIMIT_REACHED`
- `VIDEO_SCRIPT_LIMIT_REACHED`
- `SUBSCRIPTION_NOT_FOUND`

## Próxima evolução

1. autenticação e organizações;
2. associação entre conta e assinatura paga;
3. webhook do checkout;
4. add-ons de créditos;
5. expiração e cancelamento;
6. painel de uso e histórico de lançamentos.
