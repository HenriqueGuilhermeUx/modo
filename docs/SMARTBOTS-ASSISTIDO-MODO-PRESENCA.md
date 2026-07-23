# SmartBots Assistido no MODO Presença

## Posicionamento

**Marketing + captação + organização comercial.**

A MODO ajuda o cliente a construir presença, criar campanhas e gerar interesse. O SmartBots Assistido acrescenta uma estrutura simples para receber, organizar e acompanhar os contatos gerados.

### Promessa principal

> Crie demanda com a MODO. Organize os leads com o SmartBots Assistido.

### O que inclui

- mini site com bot;
- captação de leads;
- CRM simples;
- sugestões de ações e próximos passos;
- mensagens prontas para WhatsApp;
- implantação assistida.

### Limite de promessa

O SmartBots Assistido **não envia mensagens automaticamente pelo WhatsApp**. A plataforma prepara textos e sugere próximos passos; o cliente revisa e faz o envio manual.

## Público

- pequenos negócios;
- criadores de conteúdo;
- profissionais liberais;
- consultores;
- prestadores de serviço;
- empresas locais.

## Copy para Instagram

### Post de lançamento

**Você publica. As pessoas se interessam. Mas o que acontece com os contatos depois?**

O MODO Presença agora inclui o SmartBots Assistido: uma estrutura simples para transformar atenção em organização comercial.

Você recebe:

- mini site com bot;
- formulário para captar interessados;
- contatos organizados em um CRM simples;
- sugestões de próximos passos;
- mensagens prontas para continuar pelo WhatsApp.

O envio pelo WhatsApp continua manual e sob seu controle.

**MODO Presença: marketing + captação + organização comercial.**

CTA: Conheça o SmartBots Assistido no link da bio.

### Carrossel

1. Você criou conteúdo e chamou atenção. E agora?
2. Leads podem chegar pelo Instagram, indicação, site e WhatsApp.
3. Sem organização, oportunidades se perdem.
4. A MODO ajuda a atrair.
5. O SmartBots Assistido ajuda a receber e organizar.
6. Mini site + bot + leads + CRM simples.
7. Mensagens prontas para WhatsApp — com envio manual.
8. Incluído no MODO Presença.

### Reel curto

Abertura:

> “O problema nem sempre é conseguir um lead. Às vezes é não saber o que fazer quando ele chega.”

Estrutura:

1. A MODO cria conteúdo e campanhas.
2. O SmartBots recebe o interesse em um mini site com bot.
3. O contato fica organizado.
4. A plataforma sugere a próxima ação e prepara a mensagem.
5. O cliente revisa e envia pelo WhatsApp.

CTA:

> “Conheça o SmartBots Assistido, incluído no MODO Presença.”

## Copy para link na bio

### Título

**MODO Presença + SmartBots Assistido**

### Descrição curta

Crie conteúdo, atraia interessados e organize seus leads com mini site, bot, CRM simples e mensagens prontas para WhatsApp.

### CTA

**Ativar SmartBots Assistido**

### Microcopy

WhatsApp Assistido: a mensagem é preparada pela plataforma e enviada manualmente por você.

## Proposta comercial

# MODO Presença

## Presença digital que também ajuda a organizar oportunidades

O MODO Presença reúne direção criativa, produção de conteúdo e rotina de publicação. Com o SmartBots Assistido, o cliente também recebe uma estrutura simples para captar e acompanhar os contatos gerados pela divulgação.

### Frente 1 — Marketing e conteúdo

- diagnóstico da presença;
- direção criativa;
- posts, carrosséis, stories e roteiros;
- conteúdo para Instagram, Facebook e LinkedIn;
- orientação para vídeos;
- agenda semanal;
- revisão e aprendizado por desempenho.

### Frente 2 — Captação e organização comercial

- mini site com bot;
- formulário de interesse;
- organização inicial de leads;
- CRM simples;
- sugestões de ações;
- mensagens prontas para WhatsApp;
- implantação assistida.

### Como funciona

1. O cliente ativa o MODO Presença.
2. Preenche o onboarding do SmartBots Assistido.
3. A equipe configura a estrutura inicial.
4. O cliente começa a divulgar e captar contatos.
5. O SmartBots organiza os interessados e sugere próximos passos.
6. O cliente revisa e envia as mensagens manualmente pelo WhatsApp.

### Resultado esperado

Uma operação mais simples para quem precisa divulgar o próprio negócio e não quer perder oportunidades por falta de processo comercial.

### Observação importante

O SmartBots Assistido não realiza disparos automáticos nem opera o WhatsApp sem ação do cliente.

## Integração técnica

### Fase inicial

A MODO coleta o briefing, salva no PostgreSQL e disponibiliza o pedido na fila administrativa de implantação.

### Fase com endpoint

Variável da API MODO:

```env
SMARTBOTS_PARTNER_ENDPOINT=https://smartbots.club/.netlify/functions/partner-smartbots-intake
```

Payload:

```json
{
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
```
