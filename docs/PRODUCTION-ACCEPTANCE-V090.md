# MODO v0.9.0 — Homologação de produção

Este roteiro valida os fluxos que dependem de serviços reais e não podem ser totalmente simulados pelo CI.

## 1. Pré-requisitos

Render:

```env
PLATFORM_ADMIN_EMAIL=seu-email-administrativo
PLATFORM_ADMIN_PASSWORD=uma-senha-exclusiva-com-16-ou-mais-caracteres
PLATFORM_ADMIN_NAME=Henrique Campos
PLATFORM_ADMIN_SESSION_HOURS=12
PUBLIC_WEB_URL=https://modo1.netlify.app
PUBLIC_API_URL=https://modo-api-3m10.onrender.com
CONTENT_PROVIDER=n8n
PAYMENTS_PROVIDER=woovi
```

Não salve a senha administrativa no GitHub, Netlify, n8n, documentação ou mensagens.

## 2. Deploy

1. Render: `Manual Deploy → Deploy latest commit`.
2. Aguarde `/health` responder `version: 0.9.0`.
3. Netlify: `Trigger deploy → Clear cache and deploy site`.
4. Use janela anônima para evitar cache e sessões antigas.

## 3. Smoke test não destrutivo

Em um terminal local, sem registrar as credenciais no shell history:

```bash
MODO_ADMIN_EMAIL='seu-email' MODO_ADMIN_PASSWORD='sua-senha' npm run smoke:production
```

O script confirma:

- API saudável;
- versão 0.9.0;
- PostgreSQL para contas, billing e conteúdo;
- n8n como provedor;
- admin habilitado;
- login/logout administrativo;
- leitura de overview, organizações, convites e campanhas.

## 4. Login administrativo

Acesse:

```text
https://modo1.netlify.app/admin
```

Critérios:

- credencial errada retorna mensagem sem revelar detalhes;
- credencial correta abre o painel;
- atualizar a página mantém a sessão;
- sair remove a sessão;
- sessão de cliente não dá acesso ao admin;
- sessão administrativa não substitui a sessão de cliente.

## 5. Convite de onboarding

No admin:

1. Abra `Convites`.
2. Informe um e-mail ainda não cadastrado.
3. Escolha `trial` ou outro plano.
4. Informe créditos bônus.
5. Gere e copie o link.
6. Abra o link em janela anônima.
7. Crie nome, empresa e senha.
8. Confirme redirecionamento para `/app`.

Critérios:

- e-mail do convite não pode ser alterado;
- plano inicial é aplicado;
- créditos bônus aparecem no painel;
- convite muda para `used`;
- o mesmo link não pode ser utilizado novamente;
- convite expirado ou revogado não cria conta.

## 6. Controle de cliente

No admin → `Clientes`:

1. Localize a organização criada.
2. Adicione 10 créditos.
3. Confirme novo saldo no painel do cliente.
4. Remova 2 créditos com justificativa.
5. Altere plano e status.
6. Confirme limites e situação no portal do cliente.

Critérios:

- ajustes entram no ledger;
- motivo é persistido no audit log;
- nenhuma organização acessa dados de outra;
- status suspenso bloqueia nova produção;
- status ativo restabelece a produção.

## 7. Campanha de desconto

No admin → `Descontos`:

1. Crie campanha `HOMOLOGACAO 20%`.
2. Código: `TESTE20`.
3. Restrinja a um plano.
4. Limite: 2 utilizações.
5. Período: agora até amanhã.
6. Abra uma conta de teste no checkout.
7. Digite `TESTE20`.
8. Inicie o Pix Automático.

Critérios:

- plano não elegível rejeita o cupom;
- código inexistente rejeita o cupom;
- código válido altera o `value` enviado à Woovi;
- tela mostra valor original, economia e valor final;
- campanha incrementa o uso;
- conta não reutiliza o mesmo cupom para o mesmo plano;
- campanha pausada deixa de funcionar;
- campanha encerrada deixa de funcionar.

## 8. Pagamento e webhook Woovi

Use uma conta de homologação ou pagamento de baixo valor controlado.

Critérios:

- checkout retorna link e Pix;
- pagamento concluído gera `PIX_AUTOMATIC_COBR_COMPLETED`;
- webhook retorna HTTP 200;
- assinatura muda para `active`;
- novo ciclo de créditos é aberto apenas uma vez;
- webhook duplicado não duplica créditos;
- retentativa mantém acesso;
- rejeição final suspende;
- cancelamento encerra a recorrência.

## 9. Conteúdo com n8n

1. Crie pedido simples.
2. Confirme os cinco nós verdes.
3. Confirme callback HTTP 200.
4. Solicite revisão.
5. Aprove.
6. Registre desempenho no Signal.
7. Gere novo plano no Director.

Critérios:

- crédito é consumido apenas na primeira geração;
- revisão não consome novo crédito;
- resultado aparece automaticamente;
- Memory e Signal entram no briefing da geração seguinte;
- conteúdo de uma organização não aparece para outra.

## 10. Segurança mínima antes de clientes reais

- senha administrativa exclusiva e com pelo menos 16 caracteres;
- e-mail administrativo dedicado;
- acesso ao Render com MFA;
- GitHub com MFA;
- segredos diferentes para n8n, Woovi, LinkedIn e admin;
- nenhuma chave no frontend;
- backup do PostgreSQL habilitado;
- logs de erro sem corpo de segredo;
- teste de logout e expiração de sessão;
- revisão dos usuários com acesso ao Render e GitHub.

## 11. Critério de aprovação

A versão é considerada homologada quando:

- CI está verde;
- smoke test está verde;
- todos os fluxos 4 a 9 passam;
- não há erro 500 nos logs do Render;
- não há execução vermelha no n8n;
- cobrança e créditos permanecem idempotentes;
- conta de teste não acessa dados de outra organização.
