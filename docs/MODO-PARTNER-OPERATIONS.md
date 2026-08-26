# MODO Partner — Operação administrativa

## Fluxo

```text
Formulário público /partners
→ PostgreSQL modo_partner_applications
→ notificação operacional por Resend
→ /admin/partners
→ triagem
→ entrevista
→ aprovado / waitlist / não aderente
```

## Status

- `received`: candidatura recebida, ainda não analisada.
- `under_review`: análise interna em andamento.
- `interview`: conversa de aderência agendada/em andamento.
- `approved`: aprovado para ativação/piloto.
- `waitlist`: aderente, mas fora da coorte atual.
- `declined`: não aderente para o programa atual.

## Segurança

A fila usa a mesma sessão administrativa da plataforma (`modo_platform_admin_sessions`). A rota pública cria candidaturas, mas somente uma sessão admin válida pode listar candidatos, acessar informações completas ou alterar status/notas.

## Auditoria

Toda mudança de status ou nota interna gera evento em `modo_admin_audit_log` com ação `partner_application.updated`.

## Regra operacional

Aprovação administrativa **não** cria automaticamente:
- conta MODO Agency;
- cobrança;
- contrato;
- comissão;
- exclusividade;
- white-label.

Esses passos continuam deliberados e separados.
