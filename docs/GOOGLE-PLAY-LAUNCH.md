# Lançamento Android — MODO

Este documento mantém código, experiência e informações do Google Play coerentes. Não marcar um item como concluído antes de validar a versão AAB que será enviada.

## Identidade fixa

```text
Nome do app: MODO — Presença e Conteúdo
Package ID: br.com.alternativeventures.modo
Versão inicial: 1.0.0
Version code inicial: 1
Categoria sugerida: Negócios ou Produtividade
Desenvolvedor: Alternative Ventures
```

O package ID não deve ser alterado depois da criação do app no Play Console.

## O que a versão 1 realmente entrega

- login e criação de conta MODO;
- configuração da primeira marca/operação no próprio app;
- seleção de contexto, canal, intenção e formato;
- criação real de conteúdo via backend MODO;
- texto, direção visual e imagem para revisão;
- aprovação e compartilhamento manual;
- histórico e acompanhamento da produção;
- plano, status e créditos sincronizados;
- política de privacidade, suporte e início de exclusão da conta;
- demonstração informativa da Inteligência MODO.

A versão 1 não deve ser descrita como capaz de:

- publicar automaticamente em todas as redes;
- executar inteligência completa ou ilimitada;
- cobrar planos dentro do Android;
- editar vídeo;
- funcionar offline;
- substituir aprovação humana.

## Texto da ficha

### Título

```text
MODO — Presença e Conteúdo
```

### Descrição curta

```text
Crie conteúdo e organize sua presença com contexto, revisão e controle.
```

### Descrição completa

```text
A MODO transforma o contexto da sua marca, empresa, perfil ou projeto em conteúdo prático para sua presença digital.

Comece informando sua operação e escolha o que precisa gerar: autoridade, oportunidades, divulgação, educação ou relacionamento. A MODO usa o contexto salvo para preparar textos, direção visual e imagens para Instagram, Facebook e LinkedIn.

No aplicativo você pode:
• criar posts, imagens, carrosséis, stories e roteiros;
• preparar posts e textos profissionais para LinkedIn;
• acompanhar conteúdos em produção;
• revisar e aprovar cada entrega;
• compartilhar conteúdos aprovados;
• consultar créditos e direitos da sua conta;
• conhecer uma prévia da Inteligência MODO.

Nada é publicado automaticamente sem sua aprovação. O aplicativo mantém sua sessão protegida e oferece acesso fácil à política de privacidade, suporte e exclusão da conta.
```

Não inserir na ficha:

- preços que podem mudar;
- nomes de funções ainda não disponíveis;
- promessas de resultados comerciais garantidos;
- referências a checkout Woovi;
- chamadas para comprar fora do Google Play.

## Assets

O script `apps/mobile/scripts/generate-assets.mjs` gera:

```text
assets/icon.png             1024 x 1024
assets/adaptive-icon.png    1024 x 1024 com área segura
assets/splash-icon.png      1024 x 1024 com transparência
```

Regras:

- não usar borda externa no ícone;
- não colocar texto pequeno no ícone;
- manter o símbolo principal dentro da área segura adaptativa;
- revisar em launcher circular, arredondado e quadrado;
- não usar alfa no recurso gráfico da loja.

### Recurso gráfico

Preparar PNG ou JPEG de 24 bits, sem transparência:

```text
1024 x 500 px
```

A composição deve complementar o ícone, não reproduzi-lo em tamanho gigante. Sugestão:

```text
MODO
Contexto que vira presença.
Social · LinkedIn · Inteligência
```

### Capturas obrigatórias

Gerar capturas reais do AAB de produção, sem mockup enganoso:

1. Login.
2. Home com Social, LinkedIn e Inteligência.
3. Fluxo de criação.
4. Resultado com imagem e texto.
5. Agenda/produção.
6. Conta, privacidade e exclusão.

Usar pelo menos um telefone compacto e um telefone grande. Não mostrar dados pessoais, tokens, e-mails reais de equipe ou conteúdo de clientes.

## Política de pagamentos

A MODO vende funcionalidade digital. Por padrão, o Android publicado no Google Play:

- não abre checkout Woovi;
- não exibe QR Code Pix de assinatura;
- não inclui botão para comprar no site;
- não inclui WebView de planos;
- não direciona o usuário para pagamento externo.

O app pode autenticar e permitir uso de direitos comprados em outro contexto, desde que não conduza a compra externa dentro do aplicativo.

Caso seja necessário vender planos ou créditos dentro do Android, criar uma etapa separada com Google Play Billing, confirmação no backend, reconhecimento da compra e tratamento de cancelamento/reembolso.

## Privacidade e exclusão

URLs públicas:

```text
Política de privacidade:
https://modo1.netlify.app/politica-de-privacidade

Exclusão de dados:
https://modo1.netlify.app/exclusao-de-dados
```

O app contém essas opções em `Conta` e permite iniciar o pedido de exclusão com o e-mail autenticado.

Antes do envio, confirmar que a página de exclusão informa:

- como solicitar;
- como confirmar identidade;
- quais dados são apagados;
- quais dados podem ser retidos por obrigação legal;
- prazo de processamento;
- canal de contato.

## Data Safety — inventário inicial

Responder de acordo com o comportamento real da versão enviada.

Dados usados pela conta e pelo serviço:

- nome;
- e-mail;
- senha, armazenada somente como hash no backend;
- empresa, marca ou operação;
- site e perfil informados;
- briefing e conteúdo criado;
- imagens geradas;
- status de plano e uso de créditos;
- dados técnicos essenciais de sessão e segurança.

Declarações que precisam ser verdadeiras antes do envio:

- dados em trânsito protegidos por HTTPS;
- token salvo no cofre seguro do dispositivo;
- nenhuma venda de dados pessoais;
- nenhuma publicidade comportamental;
- nenhuma coleta oculta em segundo plano;
- exclusão disponível no app e na web;
- política de privacidade compatível com o formulário.

Não marcar `dados não coletados`: o produto possui conta, conteúdo e contexto de marca.

## Permissões

A versão 1 declara nenhuma permissão Android sensível adicional.

Não adicionar sem função ativa e justificativa:

- contatos;
- localização;
- câmera;
- microfone;
- SMS;
- telefone;
- arquivos amplos;
- execução persistente em segundo plano.

Quando voz, câmera ou upload forem implementados, pedir permissão somente no momento de uso e atualizar política, Data Safety e capturas.

## Acesso para revisão

Em `Play Console > App content > App access`, informar que o app exige login e fornecer conta estável:

```text
E-mail: revisor@trynexa.com.br
Senha: valor vigente de REVIEWER_TEST_PASSWORD
```

Antes de enviar:

- executar o seed do revisor;
- confirmar login no AAB de produção;
- garantir marca de teste pronta;
- deixar créditos suficientes;
- fornecer instruções curtas para chegar à criação e à exclusão da conta;
- não exigir OTP, aprovação manual ou onboarding externo do revisor.

## Build

Pré-requisitos:

```bash
npm install --include=dev
npm run typecheck
npm test
npm run build
npx eas-cli build --platform android --profile production
```

O perfil de produção gera `app-bundle` e incrementa a versão remotamente.

A partir de 31 de agosto de 2026, novos apps e atualizações precisam segmentar Android 16 / API 36. Confirmar o target no relatório do build antes de subir o AAB.

## Trilhas de teste

Ordem recomendada:

1. build APK `preview` para equipe;
2. teste em aparelhos físicos variados;
3. AAB em teste interno;
4. teste fechado, quando exigido para a conta do desenvolvedor;
5. correção de crashes e ANRs;
6. produção com rollout gradual.

Cenários mínimos:

- instalação limpa;
- cadastro;
- login;
- restauração de sessão;
- conta sem marca;
- criação da primeira marca;
- criação com saldo;
- bloqueio sem saldo;
- polling de produção;
- conteúdo falho;
- aprovação;
- compartilhamento;
- perda de internet;
- sessão expirada;
- política de privacidade;
- início da exclusão;
- logout;
- telas pequenas e tablets.

## Formulários do Play Console

Revisar:

- App access;
- Ads: não contém anúncios;
- Content rating;
- Target audience: não direcionado a crianças;
- News app: não;
- Data Safety;
- Account deletion;
- Financial features: não é app financeiro;
- Health: não oferece diagnóstico médico;
- Government: não representa governo;
- Permissions declaration, caso surja permissão sensível;
- Store listing e informações de contato.

## Bloqueadores de publicação

Não enviar para produção enquanto houver:

- crash no primeiro acesso;
- tela vazia ou WebView como produto principal;
- checkout externo no Android;
- conta do revisor inválida;
- política inacessível;
- exclusão não iniciável;
- capturas divergentes do app;
- função descrita na loja que não existe;
- ícone cortado;
- target API abaixo do exigido;
- credencial, token ou segredo dentro do bundle;
- backend de produção instável.
