# MODO Campaign Copilot v1

## Objetivo

Transformar a necessidade de anunciar em uma jornada simples para pessoas que não dominam tráfego pago. O cliente responde quatro etapas e recebe um plano executável, sem precisar escolher configurações técnicas do Gerenciador de Anúncios.

## Jornada

1. Escolher a marca e o resultado desejado.
2. Informar a oferta, o destino da campanha e uma prova ou diferencial.
3. Descrever o cliente ideal e a região em linguagem natural.
4. Definir orçamento e duração do primeiro ciclo.
5. Receber objetivo recomendado, estrutura, público, métricas e três ângulos de anúncio.
6. Enviar qualquer ângulo para o Estúdio com briefing completo e pré-preenchido.

## Princípios de facilitação

- Nenhuma tela começa vazia sem uma pergunta clara.
- Termos técnicos aparecem apenas quando ajudam a executar.
- A Modo recomenda uma estrutura compatível com o orçamento.
- Segmentação começa simples, evitando empilhamento aleatório de interesses.
- O cliente recebe três hipóteses de mensagem, não três variações cosméticas.
- Nenhum anúncio é publicado ou ativado automaticamente.

## Integração atual

O plano é salvo no navegador por organização e pode ser retomado. Cada anúncio usa `modo.directorPrefill` para abrir o MODO Create com:

- marca;
- objetivo;
- canal Meta Ads;
- público;
- região;
- texto-base;
- título;
- CTA;
- direção visual.

A produção segue o fluxo já existente de criação, revisão e aprovação.

## Próximas fases

### v2 — persistência e colaboração

- salvar campanhas na API por organização;
- status rascunho, em produção, pronto para revisão e aprovado;
- comentários e responsáveis;
- vínculo com missões de inteligência e recomendações do Diretor.

### v3 — Meta Ads com aprovação humana

- OAuth seguro com seleção explícita de Business, Ad Account, Página e Pixel;
- criação de campanha, conjunto e anúncios em estado `PAUSED`;
- validação de permissões e expiração dos tokens;
- ativação somente no Meta Ads Manager ou após confirmação explícita;
- importação de métricas para o Signal.

## Critério de sucesso

Uma pessoa sem experiência em anúncios deve conseguir sair de “quero vender mais” para um primeiro anúncio em produção sem escrever prompts e sem configurar manualmente uma estrutura de campanha.
