# MODO Publisher — pacote de Meta App Review

## Produto

- App: **MODO — Presença e Conteúdo**
- Desenvolvedor: **Alternative Ventures**
- Web: `https://modo1.netlify.app`
- API: `https://modo-api-3m10.onrender.com`
- Política de privacidade: `https://modo1.netlify.app/politica-de-privacidade`
- Exclusão de conta e dados: `https://modo1.netlify.app/exclusao-de-dados`
- Central de integrações: `https://modo1.netlify.app/app/settings/integrations`

A MODO cria conteúdo a partir do contexto da marca, exige aprovação humana e permite que o cliente confirme publicação imediata ou agendamento em canais que ele próprio autorizou.

## Governança para revisão

- nenhuma senha social é solicitada ou armazenada;
- OAuth acontece na interface oficial da plataforma;
- tokens são criptografados com AES-256-GCM antes da persistência;
- estado OAuth contém organização, marca, nonce e expiração;
- uma organização não acessa os tokens de outra;
- publicação exige conteúdo previamente aprovado;
- Quality Gate roda antes de criar qualquer publicação/agendamento;
- nada é publicado automaticamente apenas porque o conteúdo foi aprovado;
- um agendamento só é executado depois da confirmação explícita do usuário;
- o usuário pode desconectar o canal;
- callbacks de desautorização/exclusão de dados continuam disponíveis para Instagram.

## Instagram — Instagram API with Instagram Login

Callback:

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/callback
```

Permissões utilizadas:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_insights
instagram_business_manage_comments
```

Finalidade:

- `instagram_business_basic`: identificar a conta profissional que o próprio cliente autorizou;
- `instagram_business_content_publish`: publicar peça que o cliente aprovou e confirmou;
- `instagram_business_manage_insights`: coletar desempenho da publicação para mostrar ao cliente e alimentar o MODO Learning;
- `instagram_business_manage_comments`: preparar gestão de interação e leitura operacional dentro da conta autorizada; não é usada para publicidade comportamental.

## Facebook Pages

Callback:

```text
https://modo-api-3m10.onrender.com/api/v1/native-publisher/facebook/callback
```

Escopos previstos no backend:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
read_insights
```

Fluxo:

1. cliente escolhe a marca na MODO;
2. clica **Conectar Facebook**;
3. autoriza a Meta;
4. a MODO consulta as Páginas administradas pela conta autorizada;
5. quando existe uma Página, ela é vinculada automaticamente;
6. quando existem várias Páginas, a MODO pede que o cliente escolha qual pertence à marca;
7. somente o Page Access Token da Página escolhida é persistido, criptografado;
8. publicação acontece apenas após aprovação e confirmação.

## Threads

Callback:

```text
https://modo-api-3m10.onrender.com/api/v1/native-publisher/threads/callback
```

Escopos previstos:

```text
threads_basic
threads_content_publish
threads_manage_insights
```

Fluxo equivalente ao Instagram: conectar -> criar -> revisar -> aprovar -> confirmar publicar/agendar -> coletar desempenho.

## Conta do revisor

A senha NÃO deve ser colocada neste documento ou no GitHub.

```text
Usuário: revisor@trynexa.com.br
Senha: valor atual de REVIEWER_TEST_PASSWORD no Render / credencial fornecida diretamente no painel de revisão
```

A conta deve permanecer:

- ativa;
- sem OTP obrigatório;
- acessível de qualquer região;
- com organização e marca de demonstração;
- com créditos suficientes;
- com conteúdo aprovado disponível ou capacidade de gerar um conteúdo de teste.

## Roteiro do screencast de revisão — Instagram

Gravar uma única captura contínua:

1. abrir `https://modo1.netlify.app`;
2. entrar com a conta de revisão;
3. abrir **Integrações**;
4. selecionar a marca de revisão;
5. clicar **Conectar Instagram**;
6. mostrar a tela oficial de consentimento e concluir OAuth;
7. mostrar o username conectado dentro da MODO;
8. abrir/criar uma peça para a mesma marca;
9. mostrar a etapa de revisão;
10. aprovar a peça;
11. mostrar o **MODO Quality Gate**;
12. selecionar Instagram;
13. escolher **Publicar agora** ou agendar poucos minutos à frente;
14. confirmar explicitamente;
15. mostrar o status da publicação;
16. abrir a publicação real pela URL retornada;
17. voltar à MODO e clicar **Atualizar desempenho**;
18. mostrar métricas e a mensagem de aprendizado.

O vídeo deve deixar claro por que cada permissão é necessária para uma funcionalidade iniciada pelo usuário.

## Roteiro do screencast — Facebook Pages

1. Integrações -> marca;
2. Conectar Facebook;
3. OAuth Meta;
4. quando houver várias Páginas, selecionar a Página correta;
5. mostrar Página vinculada à marca;
6. aprovar uma peça;
7. selecionar Facebook no Publisher;
8. confirmar publicação/agendamento;
9. mostrar status e, quando disponível, desempenho.

## Roteiro do screencast — Threads

1. Integrações -> marca;
2. Conectar Threads;
3. OAuth;
4. mostrar conta vinculada;
5. peça aprovada -> Publisher;
6. selecionar Threads;
7. confirmar publicação/agendamento;
8. mostrar status e analytics quando disponíveis.

## Texto-base de justificativa para Advanced Access

> A MODO é uma plataforma SaaS de presença digital. Cada empresa cliente cria uma organização e uma ou mais marcas. O próprio cliente conecta sua conta profissional por OAuth, cria ou revisa conteúdo dentro da MODO e aprova explicitamente cada peça. A publicação só acontece depois de uma segunda confirmação do usuário para publicar agora ou agendar. Os identificadores e tokens são usados apenas para operar a conta que o titular autorizou, ficam criptografados e isolados por organização/marca. Insights são lidos para mostrar desempenho ao próprio cliente e alimentar recomendações futuras da MODO. A MODO não vende esses dados nem os utiliza para publicidade comportamental.

## Teste antes de enviar para revisão

- [ ] `/health` responde 200;
- [ ] `/api/v1/native-publisher/health` responde 200;
- [ ] `instagram.configured=true`;
- [ ] login da conta de revisão funciona;
- [ ] marca de revisão disponível;
- [ ] OAuth Instagram conclui e volta à MODO;
- [ ] username correto aparece;
- [ ] conteúdo pode ser criado e aprovado;
- [ ] Quality Gate aparece;
- [ ] publicação real funciona;
- [ ] permalink abre;
- [ ] desconectar/reconectar funciona;
- [ ] política de privacidade abre sem login;
- [ ] exclusão de dados abre sem login;
- [ ] callbacks registrados no painel Meta são idênticos aos de produção;
- [ ] vídeo de revisão mostra o uso real de cada permissão solicitada.

## Depois da aprovação

Advanced Access é uma aprovação externa da Meta. O merge deste código não concede Advanced Access por si só. Após aprovação, clientes que não são administradores/testadores do nosso app poderão conectar suas próprias contas profissionais pelo mesmo fluxo já usado em produção pela conta de teste.
